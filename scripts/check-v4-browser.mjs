import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const evidence=JSON.parse(await readFile('outputs/v4/analysis.json','utf8')).evidence;
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
try{
 const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('Browser error:',e.message)});
 const login=await page.request.get('http://localhost:5173/signin-with-chatgpt',{maxRedirects:0});
 assert.ok(login.status()<400,'Local sign-in failed');
 await page.goto('http://localhost:5173/');
 // Wait for the React effect to hydrate and load the signed-in workspace
 // before interacting with server-rendered buttons.
 await page.getByText('Private account',{exact:true}).waitFor();
 await page.locator('.workspace-label').click();
 await page.getByRole('button').filter({hasText:'Autopsy V4 verification'}).first().click();
 await page.getByRole('button',{name:'Hotspot autopsy',exact:true}).click();
 await page.getByText('Evidence V4',{exact:true}).waitFor();
 await page.locator('.diagnosis-summary').scrollIntoViewIfNeeded();
 assert.ok((await page.locator('.diagnosis-summary').innerText()).includes(evidence.diagnosis.dominant.asset));
 assert.ok((await page.locator('.selected-repair').innerText()).includes('Robustness: '+evidence.robustness.status));
 const widths=await page.locator('.ranking-track i').evaluateAll(els=>els.map(el=>el.style.width));
 const ranking=evidence.diagnosis.ranking,max=Math.max(1,...ranking.map(r=>Math.abs(r.localElasticity??0)));
 for(let i=0;i<widths.length;i++)assert.ok(Math.abs(parseFloat(widths[i])-Math.abs(ranking[i].localElasticity??0)/max*100)<.01);
 await mkdir('outputs/v4',{recursive:true});
 await page.screenshot({path:'outputs/v4/desktop.png'});
 await page.locator('.response-detail').first().locator('summary').click();
 await page.locator('.response-detail').first().screenshot({path:'outputs/v4/curve.png'});
 await page.locator('.selected-repair').scrollIntoViewIfNeeded();await page.screenshot({path:'outputs/v4/repair.png'});
 await page.setViewportSize({width:390,height:844});await page.locator('.diagnosis-summary').scrollIntoViewIfNeeded();await page.screenshot({path:'outputs/v4/mobile.png'});
 const size=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(size.scroll<=size.viewport+1,JSON.stringify(size));
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({desktop:'passed',mobile:size,normalizedBars:'elasticity verified',robustness:evidence.robustness.status,consoleErrors:errors}));
}catch(error){await page.screenshot({path:'outputs/v4/browser-failure.png'});console.log((await page.locator('body').innerText()).slice(0,5000));throw error}finally{await browser.close()}
