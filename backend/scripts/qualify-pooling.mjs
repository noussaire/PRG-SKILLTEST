// Explicit LOCAL qualification. Requires existing native PostgreSQL and PgBouncer
// binaries, creates its own loopback-only synthetic cluster, never reads .env.
import fs from 'node:fs/promises';
import { existsSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
process.chdir(project);
assert.equal(process.versions.node.split('.')[0],'24');
const args=process.argv.slice(2),arg=name=>args[args.indexOf(name)+1];
assert.ok(args.includes('--pg-bin')&&args.includes('--pgbouncer'),'Provide --pg-bin and --pgbouncer (existing native binaries)');
const bin=path.resolve(arg('--pg-bin')),bouncer=path.resolve(arg('--pgbouncer'));
const exe=name=>path.join(bin,name+(process.platform==='win32'?'.exe':''));
for(const file of [exe('postgres'),exe('pg_ctl'),exe('initdb'),exe('psql'),bouncer])assert.ok(existsSync(file),'Missing native binary: '+file);
const output=path.join(project,'output/lot4-pooling-step5b');await fs.mkdir(output,{recursive:true});
const root=await fs.mkdtemp(path.join(output,'native-')),data=path.join(root,'data'),nonce=randomUUID();
const write=(name,value)=>fs.writeFile(path.join(root,name),JSON.stringify(value,null,2));
await write('owner.json',{purpose:'skillquest-lot4-native',nonce,root,data});
const env=Object.fromEntries(['PATH','Path','SystemRoot','WINDIR'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
Object.assign(env,{TEMP:root,TMP:root,TMPDIR:root});
let port,poolPort,poolChild,testExit=null;
const audit=(event,details)=>fs.appendFile(path.join(root,'events.jsonl'),JSON.stringify({at:new Date().toISOString(),event,details})+'\n');
async function command(name,file,argv,timeout=120000){
 const out=openSync(path.join(root,name+'.stdout.log'),'w'),err=openSync(path.join(root,name+'.stderr.log'),'w');
 try{return await new Promise((done,reject)=>{
  const child=spawn(file,argv,{env,windowsHide:true,stdio:['ignore',out,err]}),timer=setTimeout(()=>child.kill(),timeout);
  child.once('error',e=>{clearTimeout(timer);reject(e)});
  child.once('exit',async(code,signal)=>{clearTimeout(timer);await audit('command',{name,code,signal});done({code,signal})});
 });}finally{closeSync(out);closeSync(err)}
}
async function must(name,file,argv){const r=await command(name,file,argv);assert.equal(r.code,0,name+' failed');return fs.readFile(path.join(root,name+'.stdout.log'),'utf8')}
const sql=(name,query,p=port,db='postgres')=>must(name,exe('psql'),['-X','-h','127.0.0.1','-p',String(p),'-U','lot4_synthetic','-d',db,'-v','ON_ERROR_STOP=1','-At','-c',query]);
async function freePort(){const s=net.createServer();await new Promise((r,j)=>{s.once('error',j);s.listen(0,'127.0.0.1',r)});const p=s.address().port;await new Promise(r=>s.close(r));assert.notEqual(p,5432);return p}
const closed=p=>new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port:p});s.once('connect',()=>{s.destroy();resolve(false)});s.once('error',e=>{s.destroy();resolve(e.code==='ECONNREFUSED')});s.setTimeout(1000,()=>{s.destroy();resolve(false)})});
try{
 await must('postgres-version',exe('postgres'),['--version']);assert.match(await must('pgbouncer-version',bouncer,['--version']),/PgBouncer 1\.26\.1\b/);
 await must('initdb',exe('initdb'),['-D',data,'-U','lot4_synthetic','--auth=trust','--encoding=UTF8','--no-locale']);port=await freePort();
 await must('start',exe('pg_ctl'),['-D',data,'-l',path.join(root,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -c timezone=UTC`,'-w','start']);
 const identity=JSON.parse((await sql('identity',`SELECT json_build_object('directory',current_setting('data_directory'),'systemId',(SELECT system_identifier::text FROM pg_control_system()),'port',inet_server_port(),'listen',current_setting('listen_addresses'),'username',current_user,'tables',(SELECT count(*)::int FROM information_schema.tables WHERE table_schema='public'))`)).trim());
 assert.equal(await fs.realpath(identity.directory),await fs.realpath(data));assert.equal(identity.port,port);assert.equal(identity.listen,'127.0.0.1');assert.equal(identity.username,'lot4_synthetic');assert.equal(identity.tables,0);
 await write('identity-before-migrations.json',identity);
 for(const folder of (await fs.readdir('backend/prisma/migrations',{withFileTypes:true})).filter(f=>f.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name))){
  const file=path.resolve('backend/prisma/migrations',folder.name,'migration.sql');await audit('migration',{name:folder.name,sha256:createHash('sha256').update(await fs.readFile(file)).digest('hex')});
  await must('migration-'+folder.name,exe('psql'),['-X','-h','127.0.0.1','-p',String(port),'-U','lot4_synthetic','-d','postgres','-v','ON_ERROR_STOP=1','-f',file]);
 }
 poolPort=await freePort();assert.notEqual(poolPort,port);
 const forward=p=>p.replaceAll('\\','/');
 const users=path.join(root,'users.txt');await fs.writeFile(users,'"lot4_synthetic" "synthetic-unused"\n');
 const config=path.join(root,'pgbouncer.ini');
 const databases=[1,2,4].map(n=>`pool${n} = host=127.0.0.1 port=${port} dbname=postgres pool_size=${n}`).join('\n');
 await fs.writeFile(config,`[databases]\n${databases}\nwait120 = host=127.0.0.1 port=${port} dbname=postgres pool_size=1 query_wait_timeout=120\nlimited = host=127.0.0.1 port=${port} dbname=postgres pool_size=1 max_db_client_connections=2\n[pgbouncer]\nlisten_addr=127.0.0.1\nlisten_port=${poolPort}\nunix_socket_dir=\nauth_type=trust\nauth_file=${forward(users)}\nadmin_users=lot4_synthetic\npool_mode=transaction\nmax_client_conn=100\ndefault_pool_size=2\nreserve_pool_size=0\nmax_prepared_statements=1000\nquery_wait_timeout=3\nserver_login_retry=1\nserver_connect_timeout=2\nlogfile=${forward(path.join(root,'pgbouncer.log'))}\npidfile=${forward(path.join(root,'pgbouncer.pid'))}\n`);
 const out=openSync(path.join(root,'pooler-process.log'),'w');
 poolChild=spawn(bouncer,[config],{env,windowsHide:true,stdio:['ignore',out,out]});closeSync(out);
 let ready=false;for(let n=0;n<40;n++){if(poolChild.exitCode!==null)throw Error('PgBouncer exited before readiness');if(!await closed(poolPort)){ready=true;break}await new Promise(r=>setTimeout(r,100))}assert.equal(ready,true);
 const mode=await sql('pooler-config','SHOW CONFIG',poolPort,'pgbouncer');assert.match(mode,/pool_mode\|transaction\|/);assert.match(mode,/max_prepared_statements\|1000\|/);
 assert.equal((await sql('pooled-probe','SELECT inet_server_port()',poolPort,'pool2')).trim(),String(port));
 const context={root,data,port,systemId:identity.systemId,nonce,migrationsVerified:true,pooling:{port:poolPort,poolMode:'transaction',version:'1.26.1',config,executable:bouncer,pid:poolChild.pid}};
 const contextFile=path.join(root,'context.json');await write('context.json',context);
 const guard=path.join(root,'network-guard.mjs');await fs.writeFile(guard,`globalThis.fetch=()=>{throw Error('ALL_EXTERNAL_FETCH_FORBIDDEN')};`);
 const log=openSync(path.join(root,'tests.log'),'w');
 try{testExit=await new Promise((r,j)=>{
  const child=spawn(process.execPath,['--import','tsx','--import',pathToFileURL(guard).href,'--test','--test-concurrency=1','backend/tests/postgres-pooling-native.test.ts'],{env:{...env,NODE_ENV:'test',LOT4_NATIVE_CONTEXT:contextFile},windowsHide:true,stdio:['ignore',log,log]});child.once('error',j);child.once('exit',r);
 });}finally{closeSync(log)}
 await audit('test-exit',{code:testExit});assert.equal(testExit,0,'Pooling qualification failed');
}catch(error){await audit('failed',{message:error.message});process.exitCode=1;console.error(error.message)}
finally{
 try{
  if(poolChild&&poolChild.exitCode===null&&poolChild.signalCode===null){const ended=new Promise(r=>poolChild.once('exit',r));poolChild.kill();await ended}
  const owner=JSON.parse(await fs.readFile(path.join(root,'owner.json'),'utf8'));assert.equal(owner.nonce,nonce);assert.equal(owner.data,data);assert.equal(path.dirname(await fs.realpath(root)),await fs.realpath(output));
  if(existsSync(path.join(data,'postmaster.pid')))await must('stop',exe('pg_ctl'),['-D',data,'-m','fast','-w','stop']);
  if(existsSync(path.join(data,'PG_VERSION'))){const status=await command('status',exe('pg_ctl'),['-D',data,'status']);assert.equal(status.code,3)}
  assert.equal(existsSync(path.join(data,'postmaster.pid')),false);
  if(port)assert.equal(await closed(port),true);if(poolPort)assert.equal(await closed(poolPort),true);
  if(existsSync(data)){assert.equal(await fs.realpath(data),path.join(await fs.realpath(root),'data'));await fs.rm(data,{recursive:true})}
  await write('shutdown.json',{testExit,stopped:true,portsClosed:true,dataRemoved:!existsSync(data)});
 }catch(error){await audit('cleanup-failed',{message:error.message});process.exitCode=1;console.error('Retained owned cluster for verified cleanup: '+error.message)}
 console.log(JSON.stringify({root,testExit}));
}
