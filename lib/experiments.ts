import type {SolverResult} from './swmm-results';

export type ExperimentSpec={kind:'diameter'|'roughness'|'storage';asset:string;percent:number;targetNode:string};
export type ParameterChange={section:string;asset:string;parameter:string;before:number;after:number};
export type Experiment={baselineId:string;spec:ExperimentSpec;changes:ParameterChange[];rationale:string;affectedLength:number|null;inputHash:string};
export type Comparison={targetNode:string;volumeReduction:number|null;depthReduction:number;durationReduction:number;systemVolumeReduction:number;worsenedNodes:string[];qualityPassed:boolean;eligible:boolean;warnings:string[]};
type Row={section:string;tokens:string[];line:number};
function read(input:string){let section='';const lines=input.split(/(?<=\n)/);const rows:Row[]=[];lines.forEach((line,i)=>{const s=line.split(';')[0].trim();if(s.startsWith('[')){section=s.toUpperCase();return}if(s)rows.push({section,tokens:s.split(/\s+/),line:i})});return {lines,rows}}
const match=(a:string,b:string)=>a.toUpperCase()===b.toUpperCase();
export function experimentOptions(input:string){const {rows}=read(input);const conduits=rows.filter(r=>r.section==='[CONDUITS]');return {
 pipes:conduits.map(r=>{const x=rows.find(x=>x.section==='[XSECTIONS]'&&match(x.tokens[0],r.tokens[0]));return {id:r.tokens[0],from:r.tokens[1],to:r.tokens[2],length:Number(r.tokens[3]),roughness:Number(r.tokens[4]),diameter:x?.tokens[1].toUpperCase()==='CIRCULAR'?Number(x.tokens[2]):null}}),
 storage:rows.filter(r=>r.section==='[STORAGE]'&&r.tokens[4]?.toUpperCase()==='FUNCTIONAL').map(r=>({id:r.tokens[0]}))
}}
export function generateExperiment(input:string,spec:ExperimentSpec){
 if(!['diameter','roughness','storage'].includes(spec.kind))throw new Error('Unsupported experiment.');
 if(!Number.isFinite(spec.percent)||spec.percent<5||spec.percent>(spec.kind==='roughness'?30:100))throw new Error('Use 5–30% roughness reduction or 5–100% size increase.');
 const {lines,rows}=read(input);const changes:ParameterChange[]=[];const factor=1+(spec.kind==='roughness'?-1:1)*spec.percent/100;
 const target=rows.find(r=>['[JUNCTIONS]','[STORAGE]','[DIVIDERS]'].includes(r.section)&&match(r.tokens[0],spec.targetNode));if(!target)throw new Error('Select a junction, storage node, or divider as the hotspot.');
 function one(section:string){const found=rows.filter(r=>r.section===section&&match(r.tokens[0],spec.asset));if(found.length!==1)throw new Error('Asset is missing or ambiguous.');return found[0]}
 function edit(row:Row,index:number,parameter:string){const before=Number(row.tokens[index]);if(!Number.isFinite(before)||before<0)throw new Error('Invalid source parameter.');const after=Number((before*factor).toPrecision(12));if(after===before)return;changes.push({section:row.section,asset:row.tokens[0],parameter,before,after});const semicolon=lines[row.line].indexOf(';');const content=semicolon<0?lines[row.line]:lines[row.line].slice(0,semicolon);const matches=[...content.matchAll(/\S+/g)];const token=matches[index];if(!token)throw new Error('Incomplete asset definition.');lines[row.line]=lines[row.line].slice(0,token.index)+after+lines[row.line].slice(token.index!+token[0].length);row.tokens[index]=String(after)}
 let affectedLength:number|null=null;let rationale='';
 if(spec.kind==='storage'){const row=one('[STORAGE]');if(row.tokens[4]?.toUpperCase()!=='FUNCTIONAL')throw new Error('Only existing FUNCTIONAL storage is supported.');if(+row.tokens[5]<0||+row.tokens[6]<0||+row.tokens[7]<0)throw new Error('Storage needs nonnegative coefficients and exponent.');edit(row,5,'Area coefficient');edit(row,7,'Constant area');rationale='Scale the existing area-versus-depth relation; preserve depth, exponent, elevations, losses, and routing. This does not add a new storage facility.'}
 else {const pipe=one('[CONDUITS]');affectedLength=Number(pipe.tokens[3]);if(spec.kind==='diameter'){const row=one('[XSECTIONS]');if(row.tokens[1]?.toUpperCase()!=='CIRCULAR')throw new Error('Diameter experiments require a CIRCULAR conduit.');if(+row.tokens[2]<=0)throw new Error('Diameter must be positive.');edit(row,2,'Diameter');rationale='Increase one circular conduit diameter; preserve length, invert elevations, offsets, roughness, and barrel count.'}else{if(+pipe.tokens[4]<=0)throw new Error('Roughness must be positive.');edit(pipe,4,'Manning n');rationale='Reduce one conduit Manning roughness to test friction sensitivity. This is a modeling hypothesis, not a promised maintenance outcome.'}}
 if(!changes.length)throw new Error('The selected experiment makes no effective change.');
 return {input:lines.join(''),changes,rationale,affectedLength};
}
export function compareResults(base:SolverResult,next:SolverResult,targetNode:string):Comparison{
 if(base.engineVersion!==next.engineVersion||base.flowUnits!==next.flowUnits||base.routing!==next.routing||base.nodes.length!==next.nodes.length||base.nodes.some(n=>!next.nodes.some(v=>v.id===n.id)))throw new Error('Runs are not comparable: engine, units, routing, or network differ.');
 const before=base.nodes.find(n=>match(n.id,targetNode)),after=next.nodes.find(n=>match(n.id,targetNode));if(!before||!after)throw new Error('Hotspot is absent from the solver output.');
 const depthTolerance=base.depthUnit==='m'?.002:.006562;const volumeTolerance=.002;
 const worsenedNodes=base.nodes.filter(n=>!match(n.id,targetNode)).filter(n=>{const v=next.nodes.find(v=>v.id===n.id)!;return v.floodVolume-n.floodVolume>volumeTolerance||v.maxDepth-n.maxDepth>depthTolerance||v.floodHours-n.floodHours>.02}).map(n=>n.id);
 const qualityPassed=[base,next].every(r=>r.continuityError!==null&&Math.abs(r.continuityError)<=1&&(r.nonConvergingPercent??0)<=1);
 const volumeReduction=before.floodVolume>0?(before.floodVolume-after.floodVolume)/before.floodVolume*100:null;
 const warnings:string[]=[];if(!qualityPassed)warnings.push('Numerical screening failed: require routing continuity within ±1% and non-converging steps ≤1%.');if(worsenedNodes.length)warnings.push('Other nodes worsen beyond report tolerance: '+worsenedNodes.join(', ')+'.');if(volumeReduction===null)warnings.push('Baseline hotspot flood volume is zero at report precision; relative benefit is unavailable.');
 const systemVolumeReduction=base.totalFloodVolume-next.totalFloodVolume;
 if(systemVolumeReduction < -volumeTolerance)warnings.push('Summed network flood volume increased.');
 return {targetNode:before.id,volumeReduction,depthReduction:before.maxDepth-after.maxDepth,durationReduction:before.floodHours-after.floodHours,systemVolumeReduction,worsenedNodes,qualityPassed,eligible:qualityPassed&&!worsenedNodes.length&&before.floodVolume-after.floodVolume>volumeTolerance&&systemVolumeReduction>=-volumeTolerance,warnings};
}
