import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createSolverService} from '../server/solver-service.mjs';
import {defaultAnalysisConfig} from '../lib/diagnostics.ts';

const input=await readFile('public/autopsy-demo.inp','utf8');
const hash=value=>createHash('sha256').update(value).digest('hex');
const token='local-test-token-for-solver-service-123456789';
async function fixture(t,options={}){
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'drainage-solver-'));
 const service=await createSolverService({token,dataDir,...options});
 await new Promise(resolve=>service.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await service.close();await rm(dataDir,{recursive:true,force:true})});
 const base=`http://127.0.0.1:${service.server.address().port}`;
 const request=(url,init={})=>fetch(base+url,{...init,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...init.headers}});
 async function terminal(id){
  for(let i=0;i<200;i++){
   const job=await (await request(`/jobs/${id}`)).json();
   if(!['queued','running'].includes(job.status))return job;
   await delay(50);
  }
  throw new Error('Timed out waiting for solver job.');
 }
 return {request,terminal};
}
test('Trusted service executes isolated SWMM and binds immutable evidence to input',async t=>{
 const {request,terminal}=await fixture(t),id=randomUUID();
 assert.equal((await request('/health',{headers:{Authorization:''}})).status,401);
 const payload={id,kind:'single',input,inputHash:hash(input)};
 assert.equal((await request('/jobs',{method:'POST',body:JSON.stringify({...payload,inputHash:'wrong'})})).status,400);
 assert.equal((await request('/jobs',{method:'POST',body:JSON.stringify(payload)})).status,202);
 const job=await terminal(id);assert.equal(job.status,'completed',job.error);
 const response=await request(`/jobs/${id}/result`),text=await response.text(),result=JSON.parse(text);
 assert.equal(hash(text),job.resultHash);assert.equal(result.inputHash,hash(input));assert.equal(result.verification,'SERVER VERIFIED');
 assert.equal(result.result.engineVersion,'5.2.2');assert.ok(result.result.floodedNodes>0);
 for(const [key,ext] of [['inputHash','inp'],['reportHash','rpt'],['outputHash','out']]){
  const artifact=await request(`/jobs/${id}/artifacts/${result[key]}.${ext}`);
  assert.equal(hash(Buffer.from(await artifact.arrayBuffer())),result[key]);
 }
 const altered=input+'\n; different input\n';
 assert.equal((await request('/jobs',{method:'POST',body:JSON.stringify({...payload,input:altered,inputHash:hash(altered)})})).status,409);
 assert.equal((await request(`/jobs/${id}`,{method:'PATCH',body:JSON.stringify({status:'completed',report:'forged report'})})).status,404);
 await request(`/jobs/${id}`,{method:'DELETE'});
 assert.deepEqual(await (await request(`/jobs/${id}`)).json(),job);
});
test('Trusted autopsy service returns real paired storm evidence',async t=>{
 const {request,terminal}=await fixture(t),id=randomUUID();
 await request('/jobs',{method:'POST',body:JSON.stringify({id,kind:'autopsy',input,inputHash:hash(input),config:defaultAnalysisConfig('J1')})});
 const job=await terminal(id);assert.equal(job.status,'completed',job.error);
 const result=await (await request(`/jobs/${id}/result`)).json();
 assert.ok(result.repairSearch.selected);assert.equal(result.robustness.scenarios.length,3);
 assert.ok(result.robustness.scenarios.every(s=>s.baseline?.verification==='SERVER VERIFIED'&&s.intervention?.verification==='SERVER VERIFIED'));
});
test('Worker timeout creates a failed job with no completed result',async t=>{
 const {request,terminal}=await fixture(t,{timeoutMs:1}),id=randomUUID();
 await request('/jobs',{method:'POST',body:JSON.stringify({id,kind:'single',input,inputHash:hash(input)})});
 const job=await terminal(id);assert.equal(job.status,'failed');assert.match(job.error,/execution limit/);
 assert.equal((await request(`/jobs/${id}/result`)).status,409);
});
test('Cancelling a live autopsy retains partial immutable evidence without robustness PASS',async t=>{
 const {request,terminal}=await fixture(t),id=randomUUID();
 await request('/jobs',{method:'POST',body:JSON.stringify({id,kind:'autopsy',input,inputHash:hash(input),config:defaultAnalysisConfig('J1')})});
 let started=false;
 for(let i=0;i<300;i++){
  const job=await (await request(`/jobs/${id}`)).json();
  if(job.progress?.startsWith('Normalized autopsy')){started=true;break}
  await delay(10);
 }
 assert.equal(started,true,'Cancel after the trusted baseline, while a hypothesis is running');
 await request(`/jobs/${id}`,{method:'DELETE'});
 const job=await terminal(id);assert.equal(job.status,'completed',job.error);
 const text=await (await request(`/jobs/${id}/result`)).text(),e=JSON.parse(text);
 assert.equal(hash(text),job.resultHash);assert.equal(e.version,4);assert.equal(e.executionStatus,'INCOMPLETE');
 assert.equal(e.baseline.verification,'SERVER VERIFIED');assert.notEqual(e.robustness.status,'PASS');
 assert.ok(e.budget.usedRuns<=e.budget.maxRuns);
});
