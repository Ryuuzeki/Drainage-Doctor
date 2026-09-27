import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fork} from 'node:child_process';
import {createHash,timingSafeEqual} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,readdir} from 'node:fs/promises';
import {parseReport,validateRunnableModel} from '../lib/swmm-results.ts';
import {parseInp} from '../lib/drainage.ts';
import {plausibility} from '../lib/integrity.ts';
import {runAutopsy,validateAnalysisConfig} from '../lib/diagnostics.ts';
const manifest=JSON.parse(await readFile(new URL('./engine-manifest.json',import.meta.url),'utf8'));
const digest=value=>createHash('sha256').update(value).digest('hex');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const childFile=fileURLToPath(new URL('./engine-child.mjs',import.meta.url));

export async function createSolverService({token,dataDir,timeoutMs=120000,jobTimeoutMs=900000}={}){
 if(typeof token!=='string'||token.length<32)throw new Error('SOLVER_TOKEN must contain at least 32 characters.');
 dataDir=path.resolve(dataDir??'solver-data');await mkdir(dataDir,{recursive:true});
 const jobs=new Map(),pending=[],children=new Set();let draining=false,closed=false;
 const jobPath=id=>path.join(dataDir,id);
 async function record(job){const directory=jobPath(job.id);await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'record.tmp'),JSON.stringify(job));await rename(path.join(directory,'record.tmp'),path.join(directory,'record.json'))}
 // Do not silently replay partially executed jobs after a service restart.
 for(const entry of await readdir(dataDir,{withFileTypes:true}))if(entry.isDirectory()&&uuid.test(entry.name)){
  const job=JSON.parse(await readFile(path.join(dataDir,entry.name,'record.json'),'utf8'));
  if(['queued','running'].includes(job.status)){job.status='failed';job.error='Worker service restarted before terminal completion. Submit a new job.';job.finishedAt=new Date().toISOString();await record(job)}
  jobs.set(job.id,job);
 }
 async function immutableArtifact(id,name,value){
  try{await writeFile(path.join(jobPath(id),name),value,{flag:'wx'})}catch(e){if(e.code!=='EEXIST')throw e;const existing=await readFile(path.join(jobPath(id),name));if(digest(existing)!==digest(value))throw new Error('Immutable artifact collision.')}
 }
 async function isolated(input,signal){
  for(let attempt=0;attempt<2;attempt++){
   if(signal.aborted)throw new Error('Job cancelled or exceeded its total time limit.');
   try{return await new Promise((resolve,reject)=>{
    const child=fork(childFile,[],{execArgv:['--max-old-space-size=192'],stdio:['ignore','ignore','ignore','ipc'],env:{}});children.add(child);
    let settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);children.delete(child);child.kill();error?reject(error):resolve(value)};
    const abort=()=>finish(new Error('Job cancelled or timed out.'));
    const timer=setTimeout(()=>finish(new Error('SWMM exceeded its 120-second execution limit.')),timeoutMs);
    signal.addEventListener('abort',abort,{once:true});
    child.once('message',m=>finish(null,m));child.once('error',e=>finish(Object.assign(e,{retryable:true})));child.once('exit',code=>finish(Object.assign(new Error(`Isolated worker exited (${code}).`),{retryable:true})));
    child.send({input});
   })}catch(e){if(!e.retryable||attempt===1)throw e}
  }
 }
 async function execute(job,payload){
  const abort=new AbortController();job.abort=abort;
  const totalTimer=setTimeout(()=>abort.abort(),jobTimeoutMs);
  const solve=async input=>{
   validateRunnableModel(input);const model=parseInp(input);
   if(model.nodes>500||model.conduits>2000)throw new Error('Model exceeds 500 nodes or 2,000 conduits.');
   const problems=plausibility(input);if(problems.some(w=>w.severity==='error'))throw new Error(problems.filter(w=>w.severity==='error').map(w=>w.message).join(' '));
   const inputHash=digest(input);await immutableArtifact(job.id,`${inputHash}.inp`,input);
   const executedAt=new Date().toISOString(),output=await isolated(input,abort.signal);
   if(output.error)throw new Error(output.error);
   const reportHash=digest(output.report);await immutableArtifact(job.id,`${reportHash}.rpt`,output.report);
   if(output.code!==0)throw new Error(output.report.match(/.*ERROR\s+\d+[^\n]*/)?.[0]?.trim()??`SWMM error ${output.code}`);
   const result=parseReport(output.report);
   if(result.engineVersion!==manifest.version)throw new Error('Unexpected solver version.');
   if(result.nodes.length!==model.nodes||result.flowUnits!==model.units)throw new Error('Solver output differs from source model nodes or units.');
   const binary=Buffer.from(output.output,'base64'),outputHash=digest(binary);await immutableArtifact(job.id,`${outputHash}.out`,binary);
   return {inputHash,reportHash,outputHash,executedAt,elapsedMs:output.elapsedMs,result,verification:'SERVER VERIFIED',engineHash:manifest.sha256,enginePackage:manifest.package,warnings:plausibility(input,result)};
  };
  try{
   job.status='running';job.startedAt=new Date().toISOString();await record({...job,abort:undefined});
   const evidence=payload.kind==='autopsy'?await runAutopsy(payload.input,payload.config,solve,message=>{job.progress=message}):await solve(payload.input);
   if(abort.signal.aborted)throw new Error('Job cancelled or exceeded its time limit.');
   const data=JSON.stringify(evidence),resultHash=digest(data);await immutableArtifact(job.id,`${resultHash}.json`,data);
   job.resultHash=resultHash;job.status='completed';job.progress='Completed';
  }catch(e){job.status=abort.signal.aborted?'cancelled':'failed';job.error=e.message}
  finally{clearTimeout(totalTimer);delete job.abort;job.finishedAt=new Date().toISOString();await record(job)}
 }
 async function drain(){
  if(draining||closed)return;draining=true;
  try{while(pending.length&&!closed){const {job,payload}=pending.shift();if(job.status==='queued')await execute(job,payload)}}finally{draining=false}
 }
 function publicJob(job){const {abort,...record}=job;return record}
 const server=http.createServer(async(req,res)=>{
  const reply=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body))};
  try{
   const actual=createHash('sha256').update(req.headers.authorization??'').digest(),expected=createHash('sha256').update(`Bearer ${token}`).digest();
   if(!timingSafeEqual(actual,expected))return reply(401,{error:'Unauthorized solver request.'});
   const parts=new URL(req.url,'http://localhost').pathname.split('/').filter(Boolean);
   if(req.method==='GET'&&parts[0]==='health')return reply(200,{engine:manifest,queue:pending.length,active:draining});
   if(req.method==='POST'&&parts.length===1&&parts[0]==='jobs'){
    let body='',length=0;for await(const chunk of req){length+=chunk.length;if(length>6*1024*1024)return reply(413,{error:'Job exceeds 6 MB.'});body+=chunk}
    const payload=JSON.parse(body);
    if(!uuid.test(payload.id)||!['single','autopsy'].includes(payload.kind)||typeof payload.input!=='string'||payload.input.length>5*1024*1024||payload.inputHash!==digest(payload.input))return reply(400,{error:'Invalid immutable job input.'});
    if(payload.kind==='autopsy')validateAnalysisConfig(payload.config);
    validateRunnableModel(payload.input);
    const requestHash=digest(JSON.stringify({kind:payload.kind,inputHash:payload.inputHash,config:payload.config}));
    const existing=jobs.get(payload.id);if(existing)return reply(existing.requestHash===requestHash?200:409,existing.requestHash===requestHash?publicJob(existing):{error:'Job ID already belongs to different immutable inputs.'});
    if(pending.length>=8)return reply(429,{error:'Solver queue is full. Retry later.'});
    const job={id:payload.id,kind:payload.kind,inputHash:payload.inputHash,requestHash,status:'queued',createdAt:new Date().toISOString(),progress:'Queued'};
    await record(job);jobs.set(job.id,job);pending.push({job,payload});reply(202,publicJob(job));void drain();return;
   }
   if(parts[0]==='jobs'&&uuid.test(parts[1]??'')){
    const job=jobs.get(parts[1]);if(!job)return reply(404,{error:'Job unavailable.'});
    if(req.method==='DELETE'&&parts.length===2){
     if(job.status==='queued'){job.status='cancelled';job.finishedAt=new Date().toISOString();await record(job)}else job.abort?.abort();
     return reply(200,publicJob(job));
    }
    if(req.method==='GET'&&parts.length===2)return reply(200,publicJob(job));
    if(req.method==='GET'&&parts.length===3&&parts[2]==='result'){
     if(job.status!=='completed')return reply(409,{error:'Job has no completed result.'});
     const data=await readFile(path.join(jobPath(job.id),`${job.resultHash}.json`));res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-SHA256':job.resultHash});res.end(data);return;
    }
    if(req.method==='GET'&&parts.length===4&&parts[2]==='artifacts'&&/^[a-f0-9]{64}\.(inp|rpt|out)$/.test(parts[3])){
     const data=await readFile(path.join(jobPath(job.id),parts[3]));if(digest(data)!==parts[3].split('.')[0])throw new Error('Artifact hash mismatch.');
     res.writeHead(200,{'Content-Type':parts[3].endsWith('.out')?'application/octet-stream':'text/plain','Cache-Control':'no-store'});res.end(data);return;
    }
   }
   reply(404,{error:'Unknown solver endpoint.'});
  }catch(e){if(!res.headersSent)reply(e.code==='ENOENT'?404:400,{error:e.message});else res.end()}
 });
 server.requestTimeout=30000;
 return {server,async close(){closed=true;for(const job of jobs.values())job.abort?.abort();for(const child of children)child.kill();await new Promise(resolve=>server.close(resolve))}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const service=await createSolverService({token:process.env.SOLVER_TOKEN,dataDir:process.env.SOLVER_DATA_DIR});
 const host=process.env.SOLVER_HOST??'127.0.0.1',port=Number(process.env.SOLVER_PORT??8788);
 service.server.listen(port,host,()=>console.log(`DrainageDoctor solver listening at ${host}:${port}; SWMM ${manifest.version}`));
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void service.close());
}
