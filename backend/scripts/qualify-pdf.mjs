// Explicit local qualification; no database, provider or real .env is loaded.
import fs from 'node:fs/promises';
import {existsSync,openSync,closeSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');process.chdir(project);
assert.equal(process.versions.node.split('.')[0],'24');
const mode=process.argv[2]??'local';assert.ok(['local','serverless'].includes(mode));
const output=path.join(project,'output/pdf-render-qualification');await fs.mkdir(output,{recursive:true});const run=await fs.mkdtemp(path.join(output,'run-'));
const env=Object.fromEntries(['PATH','Path','SystemRoot','WINDIR'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
Object.assign(env,{NODE_ENV:'test',TEMP:run,TMP:run,TMPDIR:run,REPORT_PDF_BROWSER_MODE:mode,DOTENV_CONFIG_PATH:path.join(run,'nonexistent.env')});
const log=openSync(path.join(run,'process.log'),'w');
const child=spawn(process.execPath,['--import','tsx','backend/tests/helpers/pdf-render-probe.ts',run],{cwd:project,env,windowsHide:true,stdio:['ignore',log,log,'ipc']});closeSync(log);
const childExit=once(child,'exit');
let sampler,interval,timeout;const stop=path.join(run,'stop-sampler'),samples=path.join(run,'memory.jsonl');
async function linuxSample(){
 try{const pids=new Set([child.pid]);for(const pid of pids){try{for(const p of (await fs.readFile(`/proc/${pid}/task/${pid}/children`,'utf8')).trim().split(/\s+/).filter(Boolean))pids.add(Number(p))}catch{}}
  const processes=[];for(const pid of pids){try{const s=await fs.readFile(`/proc/${pid}/status`,'utf8');processes.push({pid,name:s.match(/^Name:\s+(.+)$/m)?.[1],workingSetBytes:Number(s.match(/^VmRSS:\s+(\d+)/m)?.[1]??0)*1024})}catch{}}
  await fs.appendFile(samples,JSON.stringify({at:new Date().toISOString(),workingSetBytes:processes.reduce((n,p)=>n+p.workingSetBytes,0),processes})+'\n');
 }catch{await fs.appendFile(samples,JSON.stringify({unavailable:'PROCESS_MEMORY_UNAVAILABLE'})+'\n')}
}
try{
 timeout=setTimeout(()=>{child.kill();},180000);
 await Promise.race([once(child,'message'),childExit.then(()=>{throw Error('Renderer exited before readiness; inspect process.log')})]);
 if(process.platform==='win32'){
  const samplerLog=openSync(path.join(run,'sampler.log'),'w');sampler=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(project,'backend/scripts/sample-pdf-memory.ps1'),'-TargetProcessId',String(child.pid),'-OutputPath',samples,'-StopPath',stop],{env,windowsHide:true,stdio:['ignore',samplerLog,samplerLog]});closeSync(samplerLog);
  for(let n=0;n<40&&!existsSync(samples);n++)await new Promise(r=>setTimeout(r,100));
 }else if(process.platform==='linux'){await linuxSample();interval=setInterval(()=>void linuxSample(),100)}
 child.send({start:true});const [code]=await childExit;assert.equal(code,0,'Render qualification failed; inspect renders.json/process.log');
 const renders=JSON.parse(await fs.readFile(path.join(run,'renders.json'),'utf8'));assert.equal(renders.success,true);
 const records=existsSync(samples)?(await fs.readFile(samples,'utf8')).replace(/^\uFEFF/,'').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse):[];
 const measured=records.filter(r=>!r.unavailable),peak=Math.max(0,...measured.map(r=>r.workingSetBytes||0));
 const result={...renders,run,memory:{samples:measured.length,peakProcessTreeWorkingSetBytes:peak,available:measured.length>0,
  interpretation:'Sampled sum of Node + descendant process resident/working-set memory; shared pages may be counted repeatedly. Not a Linux/Vercel container limit.'}};
 await fs.writeFile(path.join(run,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){console.error(error.message);process.exitCode=1}
finally{
 clearTimeout(timeout);if(interval)clearInterval(interval);await fs.writeFile(stop,'stop');
 if(child.exitCode===null&&child.signalCode===null){child.kill();await childExit.catch(()=>{})}
 if(sampler){const end=once(sampler,'exit');if(sampler.exitCode===null&&sampler.signalCode===null)await Promise.race([end,new Promise(r=>setTimeout(r,5000))]);if(sampler.exitCode===null&&sampler.signalCode===null){sampler.kill();await end}}
 console.log(JSON.stringify({qualificationRun:run}));
}
