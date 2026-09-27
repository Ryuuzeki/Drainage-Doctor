import {z} from 'zod';
import {database,bucket,identity,jsonError,sameOrigin,auditStatement} from '@/lib/storage';
import {generateExperiment,compareResults,experimentOptions,type Experiment} from '@/lib/experiments';
import {validateRunnableModel,type RunRecord} from '@/lib/swmm-results';
import {solverRequest,solverResult,type SolverJob} from '@/lib/solver-client';
import {sha256} from '@/lib/inp';
import {inspectHydrology,plausibility} from '@/lib/integrity';
import type {SimulationEvidence} from '@/lib/diagnostics';
import type {Project} from '@/lib/drainage';
const specSchema=z.object({kind:z.enum(['diameter','roughness','storage','inlet','tailwater','runoff']),asset:z.string().min(1).max(100),percent:z.number().finite(),targetNode:z.string().min(1).max(100)}).strict();
const begin=z.object({id:z.string().uuid(),projectId:z.string().uuid(),modelHash:z.string().regex(/^[a-f0-9]{64}$/),label:z.string().trim().min(1).max(100),experiment:z.object({baselineId:z.string().uuid(),spec:specSchema}).strict().optional()}).strict();
export const dynamic='force-dynamic';
async function findRun(id:string,owner:string){const row=await database().prepare('SELECT data FROM simulation_runs WHERE id = ? AND owner = ?').bind(id,owner).first<{data:string}>();return row?JSON.parse(row.data) as RunRecord:null}
async function syncRun(run:RunRecord,owner:string){
 if(run.source!=='server-swmm'||!['queued','running'].includes(run.status))return run;
 const job=await (await solverRequest(`/jobs/${run.id}`)).json() as SolverJob;
 if(job.inputHash!==(run.experiment?.inputHash??run.modelHash))throw new Error('Solver job input mismatch.');
 if(['queued','running'].includes(job.status))return {...run,status:job.status as RunRecord['status']};
 let updated:RunRecord={...run,status:job.status,elapsedMs:Math.max(0,Date.parse(job.finishedAt??run.createdAt)-Date.parse(run.createdAt)),error:job.error};
 if(job.status==='completed'){
  const evidence=await solverResult<SimulationEvidence>(run.id,job.resultHash!);
  if(evidence.inputHash!==job.inputHash||evidence.result.engineVersion!=='5.2.2'||evidence.verification!=='SERVER VERIFIED')throw new Error('Invalid trusted solver evidence.');
  let comparison;
  if(run.experiment){const base=await findRun(run.experiment.baselineId,owner);if(!base?.result||base.verification!=='SERVER VERIFIED')throw new Error('Verified baseline unavailable.');comparison=compareResults(base.result,evidence.result,run.experiment.spec.targetNode)}
  updated={...updated,result:evidence.result,elapsedMs:evidence.elapsedMs,reportHash:evidence.reportHash,outputHash:evidence.outputHash,engineHash:evidence.engineHash,warnings:evidence.warnings,verification:'SERVER VERIFIED',comparison};
  const rpt=await solverRequest(`/jobs/${run.id}/artifacts/${evidence.reportHash}.rpt`),text=await rpt.text();if(await sha256(text)!==evidence.reportHash)throw new Error('Report hash mismatch.');
  await bucket().put(`runs/${owner}/${run.id}/${evidence.reportHash}.rpt`,text,{httpMetadata:{contentType:'text/plain'}});
 }
 const result=await database().prepare("UPDATE simulation_runs SET status = ?, data = ? WHERE id = ? AND owner = ? AND status IN ('queued','running') RETURNING data").bind(updated.status,JSON.stringify(updated),run.id,owner).all<{data:string}>();
 if(result.results.length){await auditStatement(owner,run.projectId,`Server SWMM ${updated.status}: ${run.id}; report ${updated.reportHash??'none'}`).run();return updated}
 return (await findRun(run.id,owner))!;
}
export async function GET(request:Request){try{
 const owner=await identity();if(!owner)return jsonError('Sign in to view runs.',401);
 const params=new URL(request.url).searchParams,id=params.get('id');
 if(id){
  let run=await findRun(id,owner);if(!run)return jsonError('Run unavailable.',404);
  if(params.get('state')==='1')return Response.json({run:await syncRun(run,owner)});
  if(params.get('input')==='1'){
   const object=await bucket().get(run.experiment?`scenarios/${owner}/${run.projectId}/${run.experiment.inputHash}.inp`:`models/${owner}/${run.projectId}/${run.modelHash}.inp`);if(!object)return jsonError('Input unavailable.',404);
   return new Response(object.body,{headers:{'Content-Type':'text/plain','Content-Disposition':`attachment; filename="scenario-${run.id}.inp"`,'Cache-Control':'private, no-store'}});
  }
  if(params.get('output')==='1'&&run.outputHash){const response=await solverRequest(`/jobs/${id}/artifacts/${run.outputHash}.out`);return new Response(response.body,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="swmm-${id}.out"`,'Cache-Control':'private, no-store'}})}
  const report=await bucket().get(`runs/${owner}/${id}/${run.reportHash}.rpt`);if(!report)return jsonError('No solver report is available.',404);
  return new Response(report.body,{headers:{'Content-Type':'text/plain','Content-Disposition':`attachment; filename="swmm-${id}.rpt"`,'Cache-Control':'private, no-store'}});
 }
 const projectId=params.get('projectId');if(!projectId)return jsonError('Project required.');
 if(params.get('options')==='1'){
  const row=await database().prepare('SELECT data FROM projects WHERE id = ? AND owner = ?').bind(projectId,owner).first<{data:string}>();if(!row)return jsonError('Project unavailable.',404);
  const p:Project=JSON.parse(row.data);if(!p.model)return jsonError('Import a model first.');
  const source=await bucket().get(`models/${owner}/${projectId}/${p.model.hash}.inp`);if(!source)return jsonError('Input unavailable.',404);
  const input=await source.text();return Response.json({...experimentOptions(input),modelHash:p.model.hash,hydrology:inspectHydrology(input),warnings:plausibility(input)});
 }
 const rows=await database().prepare('SELECT data FROM simulation_runs WHERE owner = ? AND project_id = ? ORDER BY created_at DESC LIMIT 100').bind(owner,projectId).all<{data:string}>();
 const runs:RunRecord[]=[];for(const row of rows.results)runs.push(await syncRun(JSON.parse(row.data),owner));
 return Response.json({runs});
 }catch(e){return jsonError((e as Error).message,503)}}

export async function POST(request:Request){try{
 const owner=await identity();if(!owner)return jsonError('Sign in to run a model.',401);if(!sameOrigin(request))return jsonError('Request origin rejected.',403);
 const raw=await request.text();if(raw.length>3000)return jsonError('Request too large.',413);
 const parsed=begin.safeParse(JSON.parse(raw));if(!parsed.success)return jsonError('Invalid run request. Client result submission is not accepted.');const b=parsed.data;
 const existing=await findRun(b.id,owner);if(existing)return Response.json({run:await syncRun(existing,owner)});
 const row=await database().prepare('SELECT data FROM projects WHERE owner = ? AND id = ?').bind(owner,b.projectId).first<{data:string}>();if(!row)return jsonError('Project unavailable.',404);
 const p:Project=JSON.parse(row.data);if(p.demo||!p.model||p.model.hash!==b.modelHash)return jsonError('The model changed. Reload before running.',409);
 const source=await bucket().get(`models/${owner}/${b.projectId}/${b.modelHash}.inp`);if(!source)return jsonError('Input unavailable.',404);
 let input=await source.text();if(await sha256(input)!==b.modelHash)throw new Error('Source model checksum mismatch.');
 let experiment:Experiment|undefined;
 if(b.experiment){
  const baseline=await findRun(b.experiment.baselineId,owner);
  if(!baseline||baseline.projectId!==b.projectId||baseline.status!=='completed'||baseline.experiment||baseline.modelHash!==b.modelHash||baseline.verification!=='SERVER VERIFIED')return jsonError('Choose a server-verified baseline for this model.',409);
  const generated=generateExperiment(input,b.experiment.spec);input=generated.input;const inputHash=await sha256(input);
  await bucket().put(`scenarios/${owner}/${b.projectId}/${inputHash}.inp`,input,{httpMetadata:{contentType:'text/plain'}});
  experiment={baselineId:baseline.id,spec:b.experiment.spec,changes:generated.changes,rationale:generated.rationale,affectedLength:generated.affectedLength,inputHash};
 }
 validateRunnableModel(input);const inputHash=await sha256(input);
 const run:RunRecord={experiment,id:b.id,projectId:b.projectId,modelHash:b.modelHash,label:b.label,createdAt:new Date().toISOString(),status:'queued',elapsedMs:0,source:'server-swmm',enginePackage:'@fileops/swmm-wasm-web@0.0.4',verification:'pending'};
 await database().prepare('INSERT INTO simulation_runs (id, owner, project_id, model_hash, status, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(run.id,owner,run.projectId,run.modelHash,run.status,JSON.stringify(run),run.createdAt).run();
 try{await solverRequest('/jobs',{method:'POST',body:JSON.stringify({id:run.id,kind:'single',input,inputHash})})}catch(e){run.status='failed';run.error=(e as Error).message;await database().prepare('UPDATE simulation_runs SET status = ?, data = ? WHERE id = ? AND owner = ?').bind(run.status,JSON.stringify(run),run.id,owner).run()}
 await auditStatement(owner,run.projectId,`Trusted SWMM requested: ${run.id}; input ${inputHash}`).run();return Response.json({run});
 }catch(e){return jsonError((e as Error).message,400)}}

export async function PATCH(request:Request){try{
 const owner=await identity();if(!owner)return jsonError('Sign in to manage runs.',401);if(!sameOrigin(request))return jsonError('Request origin rejected.',403);
 const parsed=z.object({id:z.string().uuid(),status:z.literal('cancelled')}).strict().safeParse(await request.json());
 if(!parsed.success)return jsonError('Client-supplied reports and completed results are forbidden. Only cancellation is accepted.',403);
 const run=await findRun(parsed.data.id,owner);if(!run)return jsonError('Run unavailable.',404);
 if(run.source==='server-swmm'&&['queued','running'].includes(run.status))await solverRequest(`/jobs/${run.id}`,{method:'DELETE'});
 return Response.json({run:await syncRun(run,owner)});
 }catch(e){return jsonError((e as Error).message,503)}}
