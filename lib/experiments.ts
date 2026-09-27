import type {SolverResult} from './swmm-results';
import {readInp, setToken, sameId, type InpRow} from './inp.ts';

export type ExperimentSpec={kind:'diameter'|'roughness'|'storage'|'inlet'|'tailwater'|'runoff';asset:string;percent:number;targetNode:string};
export type ParameterChange={section:string;asset:string;parameter:string;before:number;after:number};
export type Experiment={baselineId:string;spec:ExperimentSpec;changes:ParameterChange[];rationale:string;affectedLength:number|null;inputHash:string};
export type Comparison={targetNode:string;volumeReduction:number|null;depthReduction:number;durationReduction:number;systemVolumeReduction:number;worsenedNodes:string[];qualityPassed:boolean;eligible:boolean;warnings:string[]};
export const familyNames:Record<ExperimentSpec['kind'],string>={diameter:'Conduit capacity',roughness:'Conduit friction',storage:'Existing storage',inlet:'Inlet capture',tailwater:'Downstream control',runoff:'Runoff / supplied inflow'};
export const maxPercent=(kind:ExperimentSpec['kind'])=>['roughness','tailwater','runoff'].includes(kind)?30:100;

// SWMM does not apply Qmax to custom depth/rating curves.
function inletLimitApplies(rows:InpRow[],usage:InpRow){
 const designs=rows.filter(r=>r.section==='[INLETS]'&&sameId(r.tokens[0],usage.tokens[1]));
 if(!designs.length)return false;
 const custom=designs.find(r=>sameId(r.tokens[1],'CUSTOM'));
 return !custom||rows.some(r=>r.section==='[CURVES]'&&sameId(r.tokens[0],custom.tokens[2])&&sameId(r.tokens[1],'DIVERSION'));
}

export function experimentOptions(input:string){
 const {rows}=readInp(input);
 return {
  pipes:rows.filter(r=>r.section==='[CONDUITS]').map(r=>{const x=rows.find(x=>x.section==='[XSECTIONS]'&&sameId(x.tokens[0],r.tokens[0]));return {id:r.tokens[0],from:r.tokens[1],to:r.tokens[2],length:Number(r.tokens[3]),roughness:Number(r.tokens[4]),diameter:x?.tokens[1].toUpperCase()==='CIRCULAR'?Number(x.tokens[2]):null}}),
  storage:rows.filter(r=>r.section==='[STORAGE]'&&r.tokens[4]?.toUpperCase()==='FUNCTIONAL').map(r=>({id:r.tokens[0]})),
  inlets:rows.filter(r=>r.section==='[INLET_USAGE]'&&Number(r.tokens[5])>0&&inletLimitApplies(rows,r)).map(r=>({id:r.tokens[0],to:r.tokens[2],capacity:Number(r.tokens[5])})),
  outfalls:rows.filter(r=>r.section==='[OUTFALLS]'&&r.tokens[2]?.toUpperCase()==='FIXED'&&Number(r.tokens[3])>Number(r.tokens[1])).map(r=>({id:r.tokens[0],stage:Number(r.tokens[3]),invert:Number(r.tokens[1])})),
  runoff:[...rows.filter(r=>r.section==='[SUBCATCHMENTS]'&&Number(r.tokens[4])>0).map(r=>({id:'catchment:'+r.tokens[0],to:r.tokens[2],parameter:'Imperviousness'})),...rows.filter(r=>r.section==='[INFLOWS]'&&r.tokens[1]?.toUpperCase()==='FLOW'&&Number(r.tokens[5])>0).map(r=>({id:'inflow:'+r.tokens[0],to:r.tokens[0],parameter:'Supplied hydrograph multiplier'}))]
 };
}

export function generateExperiment(input:string,spec:ExperimentSpec){
 if(!Object.hasOwn(familyNames,spec.kind))throw new Error('Unsupported experiment.');
 if(!Number.isFinite(spec.percent)||spec.percent<5||spec.percent>maxPercent(spec.kind))throw new Error(`Use 5–${maxPercent(spec.kind)}% for this family.`);
 const {lines,rows}=readInp(input),changes:ParameterChange[]=[];
 const factor=1+(['roughness','runoff'].includes(spec.kind)?-1:1)*spec.percent/100;
 if(!rows.some(r=>['[JUNCTIONS]','[STORAGE]','[DIVIDERS]'].includes(r.section)&&sameId(r.tokens[0],spec.targetNode)))throw new Error('Select a junction, storage node, or divider as the hotspot.');
 function one(section:string,asset=spec.asset){const found=rows.filter(r=>r.section===section&&sameId(r.tokens[0],asset));if(found.length!==1)throw new Error('Asset is missing or ambiguous.');return found[0]}
 function edit(row:InpRow,index:number,parameter:string,value?:number){
  const before=Number(row.tokens[index]);if(!Number.isFinite(before)||(before<0&&spec.kind!=='tailwater'))throw new Error('Invalid source parameter.');
  const after=Number((value??before*factor).toPrecision(12));if(!Number.isFinite(after))throw new Error('Invalid modified parameter.');if(after===before)return;
  changes.push({section:row.section,asset:row.tokens[0],parameter,before,after});setToken(lines,row,index,after);
 }
 let affectedLength:number|null=null,rationale='';
 if(spec.kind==='storage'){
  const row=one('[STORAGE]');if(row.tokens[4]?.toUpperCase()!=='FUNCTIONAL')throw new Error('Only existing FUNCTIONAL storage is supported.');
  if([5,6,7].some(i=>!Number.isFinite(+row.tokens[i])||+row.tokens[i]<0))throw new Error('Storage needs nonnegative coefficients and exponent.');
  edit(row,5,'Area coefficient');edit(row,7,'Constant area');rationale='Scale the existing area-versus-depth relation; preserve maximum depth, exponent, elevations and losses. No new storage facility is designed.';
 }else if(spec.kind==='inlet'){
  const row=one('[INLET_USAGE]');if(!(Number(row.tokens[5])>0))throw new Error('Inlet capture requires an explicit positive Qmax. Zero means unrestricted capture.');
  if(!inletLimitApplies(rows,row))throw new Error('Qmax experiments require a standard inlet or custom DIVERSION curve. SWMM ignores Qmax for custom RATING curves.');
  edit(row,5,'Inlet Qmax (original flow units)');rationale='Increase the existing inlet capture limit Qmax. Preserve inlet geometry, clogging and receiving node. This is not a construction-ready inlet design; physical capture may remain geometry-limited.';
 }else if(spec.kind==='tailwater'){
  const row=one('[OUTFALLS]'),invert=Number(row.tokens[1]),stage=Number(row.tokens[3]);
  if(row.tokens[2]?.toUpperCase()!=='FIXED'||!Number.isFinite(invert)||!(stage>invert))throw new Error('Tailwater requires a FIXED outfall with stage above its invert.');
  edit(row,3,'Fixed tailwater stage',stage-(stage-invert)*spec.percent/100);rationale='Lower fixed stage by the specified fraction of boundary water depth above invert. This is a downstream boundary sensitivity, not a feasible construction commitment.';
 }else if(spec.kind==='runoff'){
  const [source,...parts]=spec.asset.split(':'),asset=parts.join(':');
  if(source==='catchment'){
   const row=one('[SUBCATCHMENTS]',asset);if(!(Number(row.tokens[4])>0&&Number(row.tokens[4])<=100))throw new Error('Invalid imperviousness.');
   edit(row,4,'Imperviousness (%)');rationale='Reduce relative impervious fraction in one existing subcatchment. Infiltration and rainfall remain unchanged; land-use feasibility is unverified.';
  }else if(source==='inflow'){
   const found=rows.filter(r=>r.section==='[INFLOWS]'&&sameId(r.tokens[0],asset)&&sameId(r.tokens[1],'FLOW'));
   if(found.length!==1||!(Number(found[0].tokens[5])>0))throw new Error('Require a unique FLOW inflow with an explicit positive scale factor.');
   edit(found[0],5,'External hydrograph scale factor');rationale='Reduce the supplied flow hydrograph multiplier. Its hydrologic derivation is unverified; baseline flow is preserved. This is an input sensitivity, not a designed runoff-control measure.';
  }else throw new Error('Select a supported catchment or external inflow.');
 }else{
  const pipe=one('[CONDUITS]');affectedLength=Number(pipe.tokens[3]);
  if(spec.kind==='diameter'){const row=one('[XSECTIONS]');if(row.tokens[1]?.toUpperCase()!=='CIRCULAR')throw new Error('Diameter experiments require a CIRCULAR conduit.');if(!(Number(row.tokens[2])>0))throw new Error('Diameter must be positive.');edit(row,2,'Diameter');rationale='Increase one circular conduit diameter; preserve length, invert elevations, offsets, roughness, and barrel count.'}
  else{if(!(Number(pipe.tokens[4])>0))throw new Error('Roughness must be positive.');edit(pipe,4,'Manning n');rationale='Reduce one conduit Manning roughness to test friction sensitivity. This is a modeling hypothesis, not a promised maintenance outcome.'}
 }
 if(!changes.length)throw new Error('The selected experiment makes no effective change.');
 return {input:lines.join(''),changes,rationale,affectedLength};
}

export function numericalQuality(result:SolverResult){
 return result.continuityError!==null&&Math.abs(result.continuityError)<=1&&(result.routing!=='DYNWAVE'||result.nonConvergingPercent!==null)&&(result.nonConvergingPercent??0)<=1;
}
export function compareResults(base:SolverResult,next:SolverResult,targetNode:string):Comparison{
 if(base.engineVersion!==next.engineVersion||base.flowUnits!==next.flowUnits||base.routing!==next.routing||base.nodes.length!==next.nodes.length||base.nodes.some(n=>!next.nodes.some(v=>v.id===n.id)))throw new Error('Runs are not comparable: engine, units, routing, or network differ.');
 const before=base.nodes.find(n=>sameId(n.id,targetNode)),after=next.nodes.find(n=>sameId(n.id,targetNode));if(!before||!after)throw new Error('Hotspot is absent from the solver output.');
 const depthTolerance=base.depthUnit==='m'?.002:.006562,volumeTolerance=.002;
 const worsenedNodes=base.nodes.filter(n=>!sameId(n.id,targetNode)).filter(n=>{const v=next.nodes.find(v=>v.id===n.id)!;return v.floodVolume-n.floodVolume>volumeTolerance||v.maxDepth-n.maxDepth>depthTolerance||v.floodHours-n.floodHours>.02}).map(n=>n.id);
 const qualityPassed=[base,next].every(numericalQuality);
 const volumeReduction=before.floodVolume>0?(before.floodVolume-after.floodVolume)/before.floodVolume*100:null;
 const warnings:string[]=[];if(!qualityPassed)warnings.push('Numerical screening failed: require routing continuity within ±1% and reported dynamic-wave non-convergence ≤1%.');if(worsenedNodes.length)warnings.push('Other nodes worsen beyond report tolerance: '+worsenedNodes.join(', ')+'.');if(volumeReduction===null)warnings.push('Baseline hotspot flood volume is zero at report precision; relative benefit is unavailable.');
 const systemVolumeReduction=base.totalFloodVolume-next.totalFloodVolume;
 if(systemVolumeReduction < -volumeTolerance)warnings.push('Summed network flood volume increased.');
 return {targetNode:before.id,volumeReduction,depthReduction:before.maxDepth-after.maxDepth,durationReduction:before.floodHours-after.floodHours,systemVolumeReduction,worsenedNodes,qualityPassed,eligible:qualityPassed&&!worsenedNodes.length&&before.floodVolume-after.floodVolume>volumeTolerance&&systemVolumeReduction>=-volumeTolerance,warnings};
}
