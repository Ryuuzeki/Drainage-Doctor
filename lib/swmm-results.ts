export type NodeResult={id:string;type:string;maxDepth:number;maxHead:number;floodHours:number;floodVolume:number;maxFloodRate:number;pondedDepth:number|null};
export type SolverResult={engineVersion:string;flowUnits:string;depthUnit:'m'|'ft';volumeUnit:'10^6 ltr'|'10^6 gal';routing:string;continuityError:number|null;warnings:string[];nodes:NodeResult[];links:{id:string;maxFlow:number;maxVelocity:number;fullFlowRatio:number;fullDepthRatio:number}[];totalFloodVolume:number;peakPondedDepth:number|null;floodedNodes:number;nonConvergingPercent:number|null};
function section(report:string,title:string){const start=report.indexOf(title);if(start<0)return '';const tail=report.slice(start+title.length);return tail.replace(/^\s*\*+\s*\n/,'').split(/\n\s*\*{5,}/)[0];}
const finite=(s:string)=>{const n=Number(s);if(!Number.isFinite(n))throw new Error('Solver report contains a non-finite value.');return n};
export function parseReport(report:string):SolverResult{
 if(/\bERROR\s+\d+/i.test(report))throw new Error(report.match(/.*\bERROR\s+\d+[^\n]*/i)?.[0]?.trim()??'SWMM rejected the model.');
 const engineVersion=report.match(/Build\s+([\d.]+)/)?.[1];const flowUnits=report.match(/Flow Units\s*\.+\s*(\w+)/)?.[1];const routing=report.match(/Flow Routing Method\s*\.+\s*(\w+)/)?.[1]??'Unknown';
 if(!engineVersion||!flowUnits||!report.includes('Analysis ended on:'))throw new Error('Incomplete or unrecognized solver report.');
 if(!['CFS','GPM','MGD','CMS','LPS','MLD'].includes(flowUnits))throw new Error('Unrecognized solver units.');
 const us=['CFS','GPM','MGD'].includes(flowUnits);const nodes:NodeResult[]=[];
 for(const line of section(report,'Node Depth Summary').split('\n')){const r=line.trim().split(/\s+/);if(r.length>=8&&['JUNCTION','OUTFALL','STORAGE','DIVIDER'].includes(r[1]))nodes.push({id:r[0],type:r[1],maxDepth:finite(r[3]),maxHead:finite(r[4]),floodHours:0,floodVolume:0,maxFloodRate:0,pondedDepth:null});}
 if(!nodes.length)throw new Error('No node depth summary was produced. Enable flow routing and summary reporting.');
 const flooding=section(report,'Node Flooding Summary');if(!flooding)throw new Error('Node flooding summary is missing; zero flooding cannot be assumed.');
 const hasDepth=/Volume\s+Depth/.test(flooding);
 for(const line of flooding.split('\n')){const r=line.trim().split(/\s+/);const node=nodes.find(n=>n.id===r[0]);if(node&&r.length>=7&&/^\d{2}:\d{2}$/.test(r[4])){node.floodHours=finite(r[1]);node.maxFloodRate=finite(r[2]);node.floodVolume=finite(r[5]);node.pondedDepth=hasDepth?finite(r[6]):null;}}
 if(!flooding.includes('No nodes were flooded.')&&!nodes.some(n=>n.floodHours>0))throw new Error('Flooding summary could not be interpreted. Inspect the original report.');
 const links:SolverResult['links']=[];for(const line of section(report,'Link Flow Summary').split('\n')){const r=line.trim().split(/\s+/);if(r.length>=8&&r[1]==='CONDUIT')links.push({id:r[0],maxFlow:finite(r[2]),maxVelocity:finite(r[5]),fullFlowRatio:finite(r[6]),fullDepthRatio:finite(r[7])});}
 const start=report.indexOf('Flow Routing Continuity');const continuity=start<0?null:report.slice(start).split(/\n[ \t]*\n[ \t]*\n/)[0].match(/Continuity Error \(%\)\s*\.+\s*([+-]?[\d.]+)/);const continuityError=continuity?finite(continuity[1]):null;
 const convergence=report.match(/% of Steps Not Converging\s*:\s*([\d.]+)/);const nonConvergingPercent=convergence?finite(convergence[1]):null;
 const warnings=report.split('\n').filter(l=>/\bWARNING\b/.test(l)).map(l=>l.trim());
 if(continuityError===null)warnings.push('Flow routing mass-balance error was not reported.');else if(Math.abs(continuityError)>1)warnings.push(`Routing mass-balance error ${continuityError}% exceeds the 1% screening limit. Review numerical stability.`);
 if(nonConvergingPercent!==null&&nonConvergingPercent>0)warnings.push(`${nonConvergingPercent}% of routing steps did not converge. Review the solver report.`);
 warnings.push('Metrics retain SWMM report precision. Flood volumes sum rounded per-node values and may include water ponded and later returned to the network.');
 const depths=nodes.filter(n=>n.pondedDepth!==null).map(n=>n.pondedDepth!);
 return {engineVersion,flowUnits,depthUnit:us?'ft':'m',volumeUnit:us?'10^6 gal':'10^6 ltr',routing,continuityError,warnings,nodes,links,totalFloodVolume:nodes.reduce((sum,n)=>sum+n.floodVolume,0),peakPondedDepth:depths.length?Math.max(...depths):null,floodedNodes:nodes.filter(n=>n.floodHours>0).length,nonConvergingPercent};
}
export type RunRecord={id:string;projectId:string;modelHash:string;createdAt:string;status:'queued'|'running'|'completed'|'failed'|'cancelled'|'interrupted';elapsedMs:number;result?:SolverResult;error?:string;reportHash?:string;outputHash?:string;engineHash?:string;warnings?:import('./integrity').ReviewWarning[];experiment?:import('./experiments').Experiment;comparison?:import('./experiments').Comparison;source:'browser-swmm'|'server-swmm';label:string;enginePackage:'@fileops/swmm-wasm-web@0.0.4';verification:'client-executed; server-parsed report'|'pending'|'SERVER VERIFIED'};
export function validateRunnableModel(input:string){
 if(input.length>5*1024*1024)throw new Error('Model exceeds 5 MB.');
 const rows=input.split(/\r?\n/).map(l=>l.split(';')[0].trim()).filter(Boolean);
 if(rows.some(l=>/\bFILE\b/i.test(l))||rows.includes('[FILES]'))throw new Error('This browser runner supports self-contained INP files only. Embed external rainfall/time-series data first.');
 const option=(key:string)=>rows.find(l=>new RegExp('^'+key+'\\s','i').test(l))?.split(/\s+/)[1];
 const startDate=option('START_DATE'),endDate=option('END_DATE');if(!startDate||!endDate)throw new Error('Explicit START_DATE and END_DATE are required for browser execution.');
 const date=(d:string,t:string)=>{const m=d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);const h=t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);if(!m||!h)throw new Error('Use MM/DD/YYYY dates and HH:MM:SS times.');return Date.UTC(+m[3],+m[1]-1,+m[2],+h[1],+h[2],+(h[3]??0))};
 const duration=date(endDate,option('END_TIME')??'00:00:00')-date(startDate,option('START_TIME')??'00:00:00');if(duration<=0||duration>7*24*3600000)throw new Error('Browser runs support a positive simulation duration up to 7 days.');
 const step=option('REPORT_STEP')??'00:15:00';const parts=step.split(':').map(Number);const seconds=parts[0]*3600+(parts[1]??0)*60+(parts[2]??0);if(!Number.isFinite(seconds)||seconds<30)throw new Error('Use a REPORT_STEP of at least 30 seconds.');if(duration/1000/seconds>12000)throw new Error('Browser runs support up to 12,000 reporting periods. Increase REPORT_STEP.');
}
