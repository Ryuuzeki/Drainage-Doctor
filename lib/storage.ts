import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
export function database(){if(!env.DB)throw new Error('Project storage is temporarily unavailable.');return env.DB}
export function bucket(){if(!env.BUCKET)throw new Error('File storage is temporarily unavailable.');return env.BUCKET}
export async function identity(){const user=await getChatGPTUser();return user?.userId??null}
export function jsonError(error:string,status=400){return Response.json({error},{status})}
export function sameOrigin(request:Request){const origin=request.headers.get('origin');return !origin||origin===new URL(request.url).origin}
export function auditStatement(owner:string,projectId:string,event:string){return database().prepare('INSERT INTO audit_events (id, owner, project_id, event, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(),owner,projectId,event,new Date().toISOString())}
