import {env} from 'cloudflare:workers';
import {sha256} from './inp';
export type SolverJob={id:string;kind:'single'|'autopsy';inputHash:string;status:'queued'|'running'|'completed'|'failed'|'cancelled';progress?:string;error?:string;resultHash?:string;createdAt:string;finishedAt?:string};
export async function solverRequest(path:string,init:RequestInit={}){
 const url=env.SOLVER_URL,token=env.SOLVER_TOKEN;
 if(!url||!token)throw new Error('Trusted solver is not configured. Set SOLVER_URL and SOLVER_TOKEN on the server.');
 const response=await fetch(url.replace(/\/$/,'')+path,{...init,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
 if(!response.ok){const body=await response.json() as {error?:string};throw new Error(body.error??'Trusted solver unavailable.')}
 return response;
}
export async function solverResult<T>(id:string,hash:string):Promise<T>{
 const response=await solverRequest(`/jobs/${id}/result`),text=await response.text();
 if(await sha256(text)!==hash)throw new Error('Solver result checksum mismatch.');
 return JSON.parse(text) as T;
}
