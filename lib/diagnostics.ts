import {experimentOptions,generateExperiment,compareResults,familyNames,maxPercent,numericalQuality,type ExperimentSpec,type ParameterChange,type Comparison} from './experiments.ts';
import {readInp,sameId,sha256} from './inp.ts';
import {inspectHydrology,plausibility,defaultScreening,type ScreeningThresholds,type ReviewWarning} from './integrity.ts';
import {generateScenario,networkSignature,type StormScenario} from './scenarios.ts';
import type {SolverResult} from './swmm-results';

export type SimulationEvidence={inputHash:string;reportHash:string;outputHash:string;engineHash:string;enginePackage:string;executedAt:string;elapsedMs:number;result:SolverResult;verification:'SERVER VERIFIED';warnings:ReviewWarning[]};
export type TestedHypothesis={spec:ExperimentSpec;changes:ParameterChange[];rationale:string;run?:SimulationEvidence;comparison?:Comparison;error?:string;score:number;status:'REJECTED'|'TESTED'|'ELIGIBLE FOR REVIEW'};
export type AnalysisConfig={targetNode:string;minReduction:number;pondedDepthLimit:number;scenarios:StormScenario[];screening:ScreeningThresholds};
export type StressEvidence={scenario:StormScenario;changes:ParameterChange[];baseline?:SimulationEvidence;intervention?:SimulationEvidence;comparison?:Comparison;status:'PASS'|'WARN'|'FAIL';error?:string};
export type AnalysisEvidence={version:2;modelHash:string;networkHash:string;config:AnalysisConfig;createdAt:string;hydrology:ReturnType<typeof inspectHydrology>;baseline:SimulationEvidence;hypotheses:TestedHypothesis[];untested:{family:string;reason:string}[];dominant?:string;search:{description:string;grid:number[];attempts:TestedHypothesis[];selected?:TestedHypothesis};storms:StressEvidence[];limitations:string[]};
export type Solve=(input:string)=>Promise<SimulationEvidence>;
export const defaultAnalysisConfig=(targetNode:string,imperial=false):AnalysisConfig=>({targetNode,minReduction:20,pondedDepthLimit:imperial?.492126:.15,scenarios:[.75,1,1.25].map((factor,i)=>({label:`Scenario ${String.fromCharCode(65+i)} · ${factor}× supplied inflow`,mode:'inflow',factor})),screening:{...defaultScreening}});
export function validateAnalysisConfig(c:AnalysisConfig){
 if(!c||typeof c.targetNode!=='string'||!c.targetNode||c.targetNode.length>100||!Number.isFinite(c.minReduction)||c.minReduction<=0||c.minReduction>100||!Number.isFinite(c.pondedDepthLimit)||c.pondedDepthLimit<0||!Array.isArray(c.scenarios)||c.scenarios.length<3||c.scenarios.length>4)throw new Error('Choose a hotspot, positive benefit target (≤100%), nonnegative depth threshold and 3–4 scenarios.');
 if(new Set(c.scenarios.map(s=>`${s.mode}:${s.factor}`)).size!==c.scenarios.length)throw new Error('Scenarios must have distinct forcing definitions.');
 if(c.scenarios.some(s=>!s||typeof s.label!=='string'||!s.label.trim()||s.label.length>100||!['inflow','rainfall'].includes(s.mode)||!Number.isFinite(s.factor)||s.factor<.25||s.factor>3))throw new Error('Invalid storm scenario.');
 if(!c.screening||Object.keys(defaultScreening).some(k=>!Number.isFinite(c.screening[k as keyof ScreeningThresholds])||c.screening[k as keyof ScreeningThresholds]<=0))throw new Error('Screening thresholds must be positive.');
}

export function generateHypotheses(input:string,targetNode:string){
 const options=experimentOptions(input),{rows}=readInp(input),distance=new Map([[targetNode.toUpperCase(),0]]);
 const links=rows.filter(r=>['[CONDUITS]','[PUMPS]','[WEIRS]','[ORIFICES]','[OUTLETS]'].includes(r.section)).map(r=>({from:r.tokens[1].toUpperCase(),to:r.tokens[2].toUpperCase()}));
 const frontier=[targetNode.toUpperCase()];
 for(let i=0;i<frontier.length;i++){const node=frontier[i];for(const edge of links){const next=edge.from===node?edge.to:edge.to===node?edge.from:null;if(next&&!distance.has(next)){distance.set(next,distance.get(node)!+1);frontier.push(next)}}}
 const near=(id:string)=>distance.get(id.toUpperCase())??Infinity;
 const specs:ExperimentSpec[]=[],untested:{family:string;reason:string}[]=[];
 function add(kind:ExperimentSpec['kind'],assets:string[],reason:string){
  const selected=assets.slice(0,2);for(const asset of selected)specs.push({kind,asset,percent:20,targetNode});
  if(!selected.length)untested.push({family:familyNames[kind],reason});
  if(assets.length>2)untested.push({family:familyNames[kind],reason:`${assets.length-2} additional assets omitted by the two-assets-per-family budget.`});
 }
 const pipes=options.pipes.filter(p=>Math.min(near(p.from),near(p.to))<=2).sort((a,b)=>Math.min(near(a.from),near(a.to))-Math.min(near(b.from),near(b.to))||a.id.localeCompare(b.id));
 add('diameter',pipes.filter(p=>p.diameter!==null).map(p=>p.id),'No circular conduit within two network edges.');
 add('roughness',pipes.map(p=>p.id),'No conduit within two network edges.');
 add('storage',options.storage.filter(s=>near(s.id)<=2).sort((a,b)=>near(a.id)-near(b.id)).map(s=>s.id),'No existing functional storage within two network edges.');
 add('inlet',options.inlets.filter(i=>{const p=options.pipes.find(p=>sameId(p.id,i.id));return near(i.to)<=2||!!p&&Math.min(near(p.from),near(p.to))<=2}).map(i=>i.id),'No nearby explicit positive inlet Qmax; unrestricted/implicit capture and geometry changes are not tested.');
 add('tailwater',options.outfalls.filter(o=>Number.isFinite(near(o.id))).sort((a,b)=>near(a.id)-near(b.id)).map(o=>o.id),'No connected fixed-stage outfall above invert. Time-series/tidal/free boundaries are not perturbed.');
 add('runoff',options.runoff.filter(r=>near(r.to)<=2).map(r=>r.id),'No supported local subcatchment or explicit FLOW multiplier.');
 untested.push({family:'Other mechanisms',reason:'Terrain, blockage geometry, pump controls, infiltration parameters, calibration and inlet construction design are outside this search.'});
 return {specs,untested};
}
export function rankHypotheses(tests:TestedHypothesis[]){
 const tier=(t:TestedHypothesis)=>t.status==='ELIGIBLE FOR REVIEW'?2:t.status==='TESTED'?1:0;
 return [...tests].sort((a,b)=>tier(b)-tier(a)||b.score-a.score||a.spec.percent-b.spec.percent||a.spec.asset.localeCompare(b.spec.asset));
}
export function candidateScore(comparison:Comparison,percent:number,networkVolume:number){
 // Declared screening objective; no monetary cost or invented robustness component.
 return (comparison.volumeReduction??0)+20*(networkVolume>0?comparison.systemVolumeReduction/networkVolume:0)-.1*percent;
}
export function stressStatus(base:SolverResult,next:SolverResult,target:string,limit:number){
 const c=compareResults(base,next,target),node=next.nodes.find(n=>sameId(n.id,target))!;
 if(!c.qualityPassed||c.worsenedNodes.length||c.systemVolumeReduction<-.002)return 'FAIL' as const;
 if(node.pondedDepth===null)return node.floodHours===0?'PASS' as const:'WARN' as const;
 return node.pondedDepth<=limit?'PASS' as const:'FAIL' as const;
}
export async function runAutopsy(input:string,config:AnalysisConfig,solve:Solve,progress:(message:string)=>void=()=>{}):Promise<AnalysisEvidence>{
 validateAnalysisConfig(config);
 const modelHash=await sha256(input),networkHash=await networkSignature(input),hydrology=inspectHydrology(input);
 const issues=plausibility(input,undefined,config.screening);if(issues.some(w=>w.severity==='error'))throw new Error(issues.filter(w=>w.severity==='error').map(w=>`${w.asset??'Model'}: ${w.message}`).join(' '));
 progress('Running independent reference baseline');const baseline=await solve(input);
 baseline.warnings=plausibility(input,baseline.result,config.screening);
 if(!baseline.result.nodes.some(n=>sameId(n.id,config.targetNode)&&n.type!=='OUTFALL'))throw new Error('Hotspot is absent from this baseline.');
 const {specs,untested}=generateHypotheses(input,config.targetNode);
 const test=async(spec:ExperimentSpec):Promise<TestedHypothesis>=>{
  let changes:ParameterChange[]=[],rationale='';
  try{
   const generated=generateExperiment(input,spec);changes=generated.changes;rationale=generated.rationale;
   const run=await solve(generated.input);run.warnings=plausibility(generated.input,run.result,config.screening);
   const comparison=compareResults(baseline.result,run.result,config.targetNode);
   const rejected=!comparison.qualityPassed||comparison.worsenedNodes.length>0||comparison.systemVolumeReduction<-.002;
   return {spec,changes,rationale,run,comparison,score:candidateScore(comparison,spec.percent,baseline.result.totalFloodVolume),status:rejected?'REJECTED':comparison.eligible?'ELIGIBLE FOR REVIEW':'TESTED'};
  }catch(e){return {spec,changes,rationale,error:(e as Error).message,score:-1e9,status:'REJECTED'}}
 };
 const tested:TestedHypothesis[]=[];
 for(const spec of specs){progress(`Testing ${familyNames[spec.kind]} · ${spec.asset}`);tested.push(await test(spec))}
 const hypotheses=rankHypotheses(tested);
 const dominant=hypotheses.find(h=>h.status!=='REJECTED'&&(h.comparison?.volumeReduction??0)>0);
 // Boundary and supplied-runoff sensitivities cannot automatically become physical repair recommendations.
 const repair=hypotheses.find(h=>['diameter','roughness','storage','inlet'].includes(h.spec.kind)&&h.comparison?.qualityPassed&&(h.comparison.volumeReduction??0)>0);
 const grid=repair?[5,10,20,30,50,75,100].filter(n=>n<=maxPercent(repair.spec.kind)):[];
 const search:AnalysisEvidence['search']={description:repair?`Ascending grid on ${familyNames[repair.spec.kind]} / ${repair.spec.asset} only. First admissible tested magnitude; not a global optimum. Benefit ≥${config.minReduction}%, ponding ≤${config.pondedDepthLimit} ${baseline.result.depthUnit}, numerical pass and no network harm. Boundary and runoff sensitivities excluded from physical repair selection.`:'No physical repair hypothesis with a numerically valid positive response; no repair selected.',grid,attempts:[]};
 for(const percent of grid){
  progress(`Searching ${repair!.spec.asset} · ${percent}%`);const candidate=await test({...repair!.spec,percent});search.attempts.push(candidate);
  const node=candidate.run?.result.nodes.find(n=>sameId(n.id,config.targetNode));
  const below=node&&(node.pondedDepth!==null?node.pondedDepth<=config.pondedDepthLimit:node.floodHours===0);
  if(candidate.status==='ELIGIBLE FOR REVIEW'&&(candidate.comparison?.volumeReduction??0)>=config.minReduction&&below){search.selected=candidate;break}
 }
 const storms:StressEvidence[]=[];
 if(search.selected){
  for(const scenario of config.scenarios){
   const storm:StressEvidence={scenario,changes:[],status:'FAIL'};
   try{
    progress(`Verifying ${scenario.label} · baseline + intervention`);
    const source=generateScenario(input,scenario);storm.changes=source.changes;
    const changed=generateExperiment(source.input,search.selected.spec);
    if(await networkSignature(source.input)!==networkHash||await networkSignature(changed.input)!==networkHash)throw new Error('Scenario network mismatch.');
    storm.baseline=await solve(source.input);storm.baseline.warnings=plausibility(source.input,storm.baseline.result,config.screening);
    storm.intervention=await solve(changed.input);storm.intervention.warnings=plausibility(changed.input,storm.intervention.result,config.screening);
    storm.comparison=compareResults(storm.baseline.result,storm.intervention.result,config.targetNode);
    storm.status=stressStatus(storm.baseline.result,storm.intervention.result,config.targetNode,config.pondedDepthLimit);
   }catch(e){storm.error=(e as Error).message}
   storms.push(storm);
  }
 }
 return {version:2,modelHash,networkHash,config:structuredClone(config),createdAt:new Date().toISOString(),hydrology,baseline,hypotheses,untested,dominant:dominant?`${familyNames[dominant.spec.kind]} · ${dominant.spec.asset}`:undefined,search,storms,limitations:[
  'Dominant modeled sensitivity among tested hypotheses; neither proof of real-world root cause nor engineering approval.',
  'Each experiment starts from the original input. Unequal physical perturbations across families are not normalized causal attribution.',
  'Rank: admissibility first, then hotspot volume reduction + 20 × network fractional reduction − 0.1 × percent change. No monetary cost or untested robustness is scored.',
  'Stress scenarios scale supplied forcing; no return period, probability or rainfall provenance is inferred.',
  'Screening thresholds: USER CONFIGURATION; numerical tolerance ±1% and other-node tolerances are DrainageDoctor screening rules, not regulatory limits.',
  'Only explicit fixed-stage tailwater and Qmax-limited inlets are supported. Surcharge duration is not parsed; reported flooding duration is a separate metric.',
  ...(!numericalQuality(baseline.result)?['Baseline failed numerical screening; all alternatives are rejected.']:[]),
  ...(!search.selected?['No admissible repair in the declared search; stress verification has not run.']:[])
 ]};
}
