import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const origin=process.env.HOME_REVIEW_URL||'http://127.0.0.1:3000';
const out='node_modules/.skillquest-local/home-final';await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const context=await browser.newContext({reducedMotion:'reduce'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));const checks=[];
try{await page.goto(origin,{waitUntil:'networkidle'});
for(const lang of ['fr','ar']){await page.getByRole('button',{name:lang==='fr'?'Français':'العربية',exact:true}).first().click();await page.waitForFunction(l=>document.documentElement.lang===l,lang);
for(const width of [375,768,1024,1440]){await page.setViewportSize({width,height:900});await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${lang} ${width} overflow`);assert.ok(await page.locator('h1').isVisible());assert.ok(await page.locator('.hq-header-inner .hq-button').isVisible());if(width===375){assert.ok(await page.locator('.hq-site-header').evaluate(e=>e.getBoundingClientRect().height)<200,'Compact mobile header');}await page.screenshot({path:`${out}/${lang}-${width}-fold.png`});checks.push(`${lang}: ${width}px, no overflow, CTA visible`);}
const tabs=page.getByRole('tab');for(let i=0;i<4;i++){await tabs.nth(i).click();assert.equal(await page.getByRole('tabpanel').count(),1);assert.ok((await page.getByRole('tabpanel').locator('li').count())>=6);}await tabs.first().click();await page.keyboard.press(lang==='ar'?'ArrowLeft':'ArrowRight');assert.equal(await tabs.nth(1).getAttribute('aria-selected'),'true');assert.equal(await page.locator('.hq-skill-panel li').count(),31);
const choices=page.locator('input[name=demo-choice]');await choices.first().check();const first=await page.locator('.hq-demo-result').innerText();await choices.last().check();assert.notEqual(await page.locator('.hq-demo-result').innerText(),first);assert.equal(await page.locator('.hq-faq details').count(),6);const wasOpen=await page.locator('.hq-faq details').first().getAttribute('open');await page.locator('.hq-faq summary').first().click();assert.notEqual(await page.locator('.hq-faq details').first().getAttribute('open'),wasOpen);await page.screenshot({path:`${out}/${lang}-full.png`,fullPage:true});checks.push(`${lang}: four families, 31 skills, RTL-aware keyboard, adaptive demo, six FAQs`);}
assert.deepEqual(errors,[]);await writeFile(`${out}/checks.json`,JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors},null,2));}finally{await browser.close();}


