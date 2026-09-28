import {z} from 'zod';
import {database,bucket,identity,jsonError,sameOrigin,auditStatement} from '@/lib/storage';
import {solverRequest,solverResult,type SolverJob} from '@/lib/solver-client';
import {sha256} from '@/lib/inp';
import {validateAnalysisConfig,type AnalysisEvidence,type AnalysisConfig} from '@/lib/diagnostics';
import type {AnalysisRecord} from '@/lib/analysis-record';
import type {RunRecord} from '@/lib/swmm-results';
import type {Project} from '@/lib/drainage';
export const dynamic='force-dynamic';
async function find(id:string,owner:string){const row=await database().prepare('SELECT data FROM analysis_jobs WHERE id = ? AND owner = ?').bind(id,owner).first<{data:string}>();return row?JSON.parse(row.data) as AnalysisRecord:null}
async function sync(record:AnalysisRecord,owner:string){
 if(!['queued','running'].includes(record.status))return record;
 const job=await (await solverRequest(`/jobs/${record.id}`)).json() as SolverJob;
 if(job.inputHash!==record.modelHash)throw new Error('Autopsy input checksum mismatch.');
 const updated:AnalysisRecord={...record,status:job.status,progress:job.progress,error:job.error,errorCode:job.errorCode,resultHash:job.resultHash};
 if(['queued','running'].includes(job.status))return updated;
 if(job.status==='completed'){
  const evidence=await solverResult<AnalysisEvidence>(record.id,job.resultHash!);
  if(evidence.modelHash!==record.modelHash||evidence.baseline.verification!=='SERVER VERIFIED')throw new Error('Autopsy provenance mismatch.');
  await bucket().put(`analyses/${owner}/${record.id}/${job.resultHash}.json`,JSON.stringify(evidence),{httpMetadata:{contentType:'application/json'}});
 }
 const changed=await database().prepare("UPDATE analysis_jobs SET status = ?, data = ? WHERE id = ? AND owner = ? AND status IN ('queued','running') RETURNING data").bind(updated.status,JSON.stringify(updated),record.id,owner).all<{data:string}>();
 if(changed.results.length){await auditStatement(owner,record.projectId,`Autopsy ${updated.status}: ${record.id}; evidence ${updated.resultHash??'none'}`).run();return updated}
 return (await find(record.id,owner))!;
}
export async function GET(request:Request){try{
 const owner=await identity();if(!owner)return jsonError('Sign in to inspect evidence.',401);
 const params=new URL(request.url).searchParams,id=params.get('id');
 if(id){
  const existing=await find(id,owner);if(!existing)return jsonError('Analysis unavailable.',404);
  const record=await sync(existing,owner),artifact=params.get('artifact');
  if(artifact){
   if(!/^[a-f0-9]{64}\.(inp|rpt|out)$/.test(artifact))return jsonError('Invalid artifact.');
   const response=await solverRequest(`/jobs/${record.id}/artifacts/${artifact}`);
   return new Response(response.body,{headers:{'Content-Type':artifact.endsWith('.out')?'application/octet-stream':'text/plain','Content-Disposition':`attachment; filename="${artifact}"`,'Cache-Control':'private, no-store'}});
  }
  if(record.status==='completed'){
   const object=await bucket().get(`analyses/${owner}/${id}/${record.resultHash}.json`);if(!object)throw new Error('Saved evidence unavailable.');
   const text=await object.text();if(await sha256(text)!==record.resultHash)throw new Error('Saved evidence checksum mismatch.');record.evidence=JSON.parse(text);
  }
  return Response.json({analysis:record});
 }
 const projectId=params.get('projectId');if(!projectId)return jsonError('Project required.');
 const rows=await database().prepare('SELECT data FROM analysis_jobs WHERE owner = ? AND project_id = ? ORDER BY created_at DESC LIMIT 30').bind(owner,projectId).all<{data:string}>();
 return Response.json({analyses:rows.results.map(r=>JSON.parse(r.data))});
 }catch(e){return jsonError((e as Error).message,503)}}
export async function POST(request:Request){try{
 const owner=await identity();if(!owner)return jsonError('Sign in to run autopsy.',401);if(!sameOrigin(request))return jsonError('Request origin rejected.',403);
 const raw=await request.text();if(raw.length>6000)return jsonError('Request too large.',413);
 const parsed=z.object({id:z.string().uuid(),projectId:z.string().uuid(),modelHash:z.string().regex(/^[a-f0-9]{64}$/),baselineId:z.string().uuid(),config:z.unknown()}).strict().safeParse(JSON.parse(raw));
 if(!parsed.success)return jsonError('Invalid analysis request.');const b=parsed.data,config=b.config as AnalysisConfig;validateAnalysisConfig(config);
 const old=await find(b.id,owner);if(old)return Response.json({analysis:await sync(old,owner)});
 const projectRow=await database().prepare('SELECT data FROM projects WHERE id = ? AND owner = ?').bind(b.projectId,owner).first<{data:string}>();if(!projectRow)return jsonError('Project unavailable.',404);
 const project:Project=JSON.parse(projectRow.data);if(project.demo||project.model?.hash!==b.modelHash)return jsonError('Model version changed. Reload the project.',409);
 const baselineRow=await database().prepare('SELECT data FROM simulation_runs WHERE id = ? AND owner = ? AND project_id = ?').bind(b.baselineId,owner,b.projectId).first<{data:string}>();
 const baseline:RunRecord|undefined=baselineRow?JSON.parse(baselineRow.data):undefined;
 if(!baseline||baseline.modelHash!==b.modelHash||baseline.experiment||baseline.status!=='completed'||baseline.verification!=='SERVER VERIFIED')return jsonError('A server-verified baseline of this model is required.',409);
 const inputObject=await bucket().get(`models/${owner}/${b.projectId}/${b.modelHash}.inp`);if(!inputObject)return jsonError('Source model unavailable.',404);
 const input=await inputObject.text();if(await sha256(input)!==b.modelHash)throw new Error('Source checksum mismatch.');
 const record:AnalysisRecord={id:b.id,projectId:b.projectId,modelHash:b.modelHash,baselineId:b.baselineId,config,createdAt:new Date().toISOString(),status:'queued'};
 await database().prepare('INSERT INTO analysis_jobs (id, owner, project_id, model_hash, status, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(record.id,owner,record.projectId,record.modelHash,record.status,JSON.stringify(record),record.createdAt).run();
 try{await solverRequest('/jobs',{method:'POST',body:JSON.stringify({id:record.id,kind:'autopsy',input,inputHash:b.modelHash,config})})}catch(e){record.status='failed';record.error=(e as Error).message;await database().prepare('UPDATE analysis_jobs SET status = ?, data = ? WHERE id = ? AND owner = ?').bind(record.status,JSON.stringify(record),record.id,owner).run()}
 await auditStatement(owner,b.projectId,`Autopsy requested: ${record.id}; hotspot ${config.targetNode}; model ${b.modelHash}`).run();return Response.json({analysis:record});
 }catch(e){return jsonError((e as Error).message,400)}}
export async function DELETE(request:Request){try{
 const owner=await identity();if(!owner)return jsonError('Sign in to manage analyses.',401);if(!sameOrigin(request))return jsonError('Request origin rejected.',403);
 const parsed=z.object({id:z.string().uuid()}).strict().safeParse(await request.json());if(!parsed.success)return jsonError('Invalid cancellation.');
 const record=await find(parsed.data.id,owner);if(!record)return jsonError('Analysis unavailable.',404);
 if(['queued','running'].includes(record.status))await solverRequest(`/jobs/${record.id}`,{method:'DELETE'});
 return Response.json({analysis:await sync(record,owner)});
 }catch(e){return jsonError((e as Error).message,503)}}
