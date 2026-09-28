// Integration smoke test against the local development app and solver.
// Creates a labeled local test project; it never deletes existing projects.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {defaultAnalysisConfig} from '../lib/diagnostics.ts';
const origin='http://localhost:5173';
const login=await fetch(origin+'/signin-with-chatgpt',{redirect:'manual'});
const cookie=login.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie,'Local development sign-in required');
const request=(url,init={})=>fetch(origin+url,{...init,headers:{Cookie:cookie,Origin:origin,...init.headers}});
async function json(url,body){const r=await request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();assert.ok(r.ok,JSON.stringify(d));return d}
async function terminal(url,key){for(let i=0;i<120;i++){const r=await request(url),d=await r.json();assert.ok(r.ok,JSON.stringify(d));if(!['queued','running'].includes(d[key].status)){assert.equal(d[key].status,'completed',JSON.stringify(d));return d[key]}await delay(500)}throw new Error('Local integration job timed out')}
const project=(await json('/api/projects',{id:randomUUID(),name:'Autopsy V4 verification',location:'Synthetic local validation'})).project;
const form=new FormData();form.set('projectId',project.id);form.set('file',new File([await readFile('public/autopsy-demo.inp')],'autopsy-demo.inp'));
const upload=await request('/api/models',{method:'POST',body:form}),model=await upload.json();assert.ok(upload.ok,JSON.stringify(model));
const modelHash=model.project.model.hash;
const run=(await json('/api/runs',{id:randomUUID(),projectId:project.id,modelHash,label:'Verified local baseline'})).run;
const baseline=await terminal(`/api/runs?id=${run.id}&state=1`,'run');assert.equal(baseline.verification,'SERVER VERIFIED');
const forged=await request('/api/runs',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:run.id,status:'completed',report:'forged'})});assert.equal(forged.status,403);
const analysis=(await json('/api/analyses',{id:randomUUID(),projectId:project.id,modelHash,baselineId:run.id,config:defaultAnalysisConfig('J1')})).analysis;
const complete=await terminal(`/api/analyses?id=${analysis.id}`,'analysis');
assert.equal(complete.evidence.version,4);assert.ok(complete.evidence.repairSearch.selected.firstAdmissible);assert.equal(complete.evidence.robustness.scenarios.length,3);
assert.ok(complete.evidence.budget.usedRuns<=complete.evidence.budget.maxRuns);
assert.deepEqual(complete.evidence.robustness.candidate,complete.evidence.repairSearch.selected.firstAdmissible.spec);
const pdf=await request(`/api/analyses/report?id=${analysis.id}`);assert.equal(pdf.status,200);assert.equal(pdf.headers.get('content-type'),'application/pdf');
const pdfBytes=Buffer.from(await pdf.arrayBuffer());assert.match(pdfBytes.toString('ascii'),/%PDF-1.4/);
await mkdir('outputs/v4',{recursive:true});await writeFile('outputs/v4/engineering-report.pdf',pdfBytes);await writeFile('outputs/v4/analysis.json',JSON.stringify(complete,null,2));
const rpt=await request(`/api/analyses?id=${analysis.id}&artifact=${complete.evidence.baseline.reportHash}.rpt`);assert.equal(rpt.status,200);assert.match(await rpt.text(),/EPA STORM WATER MANAGEMENT MODEL/);
console.log(JSON.stringify({projectId:project.id,baseline:baseline.verification,analysis:complete.status,hypotheses:complete.evidence.hypotheses.length,repair:complete.evidence.repairSearch.selected.firstAdmissible.spec,scenarios:complete.evidence.robustness.scenarios.map(s=>({label:s.scenario.label,status:s.status})),forgedReport:'rejected'},null,2));
