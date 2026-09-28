import {database,bucket,identity,jsonError} from '@/lib/storage';
import {sha256} from '@/lib/inp';
import type {AnalysisRecord} from '@/lib/analysis-record';
import type {AnalysisEvidence} from '@/lib/diagnostics';
export const dynamic='force-dynamic';

function escapePdf(value:string){return value.replace(/\\/g,'\\\\').replace(/[()]/g,m=>`\\${m}`).replace(/[^\x20-\x7e]/g,'?')}
function makePdf(lines:string[]){
 const pageLines=lines.slice(0,56),stream=['BT','/F1 10 Tf','50 760 Td',...pageLines.flatMap((line,i)=>[`${i?'0 -13 Td':''} (${escapePdf(line.slice(0,115))}) Tj`]),'ET'].join('\n');
 const objects=[`<< /Type /Catalog /Pages 2 0 R >>`,`<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`];
 let pdf='%PDF-1.4\n',offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`}
 const xref=pdf.length;pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 return new TextEncoder().encode(pdf);
}
function reportLines(e:AnalysisEvidence){
 const lines=[`DrainageDoctor engineering evidence report`,`Evidence version: ${e.version}`,`Created: ${e.createdAt}`,`Model SHA-256: ${e.modelHash}`,`Network SHA-256: ${e.networkHash}`,`Solver: SWMM ${e.baseline.result.engineVersion} · ${e.baseline.engineHash}`,`Verification: ${e.baseline.verification}`,`Hotspot: ${e.config.targetNode}`,`Hydrology status: ${e.hydrology.status}`,`Rainfall-runoff present: ${e.hydrology.rainfallRunoff?'yes':'no'}`,`Subcatchments: ${e.hydrology.subcatchments} · rain gages: ${e.hydrology.rainGages} · time series: ${e.hydrology.timeSeries}`,`Baseline flood volume: ${e.baseline.result.totalFloodVolume} ${e.baseline.result.volumeUnit}`,`Baseline flooded nodes: ${e.baseline.result.floodedNodes}`,`Dominant modeled sensitivity: ${e.dominant??'none'}`];
 for(const d of e.autopsy?.ranking??[])lines.push(`#${d.rank} ${d.family} ${d.asset} · ${d.modeledSensitivity} · elasticity ${d.localElasticity??'unavailable'} · benefit ${d.benefit}% · ${d.monotonicity}`);
 lines.push(`Repair search: ${e.repairSearch?.scopeDescription??e.search.description}`);for(const c of e.repairSearch?.candidates??[])lines.push(`Candidate ${c.family} ${c.asset}: ${c.admissible?'admissible':'not admissible'} · magnitude ${c.magnitude??'none'} · benefit ${c.benefit??'none'} · robustness ${c.robustness}`);
 lines.push('Limitations:');for(const l of e.limitations)lines.push(`- ${l}`);return lines;
}
export async function GET(request:Request){try{const owner=await identity();if(!owner)return jsonError('Sign in to export evidence.',401);const id=new URL(request.url).searchParams.get('id');if(!id)return jsonError('Analysis required.');const row=await database().prepare('SELECT data FROM analysis_jobs WHERE id = ? AND owner = ?').bind(id,owner).first<{data:string}>();if(!row)return jsonError('Analysis unavailable.',404);const record=JSON.parse(row.data) as AnalysisRecord;if(record.status!=='completed'||!record.resultHash)return jsonError('Completed evidence is required.',409);const object=await bucket().get(`analyses/${owner}/${id}/${record.resultHash}.json`);if(!object)return jsonError('Saved evidence unavailable.',404);const text=await object.text();if(await sha256(text)!==record.resultHash)return jsonError('Saved evidence checksum mismatch.',409);const bytes=makePdf(reportLines(JSON.parse(text) as AnalysisEvidence));return new Response(bytes,{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="drainagedoctor-${id}.pdf"`,'Cache-Control':'private, no-store'}})}catch(e){return jsonError((e as Error).message,503)}}
