import {experimentOptions,generateExperiment,compareResults,familyNames,maxPercent,numericalQuality,type ExperimentSpec,type ParameterChange,type Comparison} from './experiments.ts';
import {readInp,sameId,sha256} from './inp.ts';
import {inspectHydrology,plausibility,defaultScreening,type ScreeningThresholds,type ReviewWarning} from './integrity.ts';
import {generateScenario,networkSignature,type StormScenario} from './scenarios.ts';
import {DomainError,classifyError} from './errors.ts';
import {RunBudget,BudgetExceeded} from './run-budget.ts';
import type {SolverResult} from './swmm-results';
export type EvidenceRef={inputHash:string;reportHash:string;outputHash:string;engineHash:string};
export type SimulationEvidence=EvidenceRef & {enginePackage:string;executedAt:string;elapsedMs:number;result:SolverResult;verification:'SERVER VERIFIED';warnings:ReviewWarning[]};
export type TestedHypothesis={spec:ExperimentSpec;changes:ParameterChange[];rationale:string;run?:SimulationEvidence;comparison?:Comparison;error?:string;errorCode?:string;score:number;status:'REJECTED'|'TESTED'|'ELIGIBLE FOR REVIEW'|'UNTESTED'};
export type AnalysisMode='QUICK'|'DETAILED';
export const MODE_BUDGET={QUICK:36,DETAILED:60} as const;
export type AnalysisConfig={targetNode:string;minReduction:number;pondedDepthLimit:number;scenarios:StormScenario[];screening:ScreeningThresholds;mode?:AnalysisMode;maxRuns?:number};
export type RobustnessStatus='NOT_REQUIRED'|'UNTESTED'|'RUNNING'|'PASS'|'WARN'|'FAIL'|'INCOMPLETE';
export type StressEvidence={scenario:StormScenario;changes:ParameterChange[];baseline?:SimulationEvidence;intervention?:SimulationEvidence;comparison?:Comparison;status:'PASS'|'WARN'|'FAIL'|'INCOMPLETE';error?:string;errorCode?:string;repairSpec?:ExperimentSpec;expectedBaselineHash?:string;expectedInterventionHash?:string;evidence?:{baseline:EvidenceRef;intervention:EvidenceRef}};
export type ResponseReliability='STRONG'|'MODERATE'|'WEAK'|'UNRELIABLE';
export type SensitivityPoint={percent:number;asset:string;family:ExperimentSpec['kind'];status:TestedHypothesis['status'];volumeReduction:number|null;systemVolumeReduction:number|null;elasticity:number|null;comparison?:Comparison;error?:string;evidence?:EvidenceRef};
export type SensitivityCurve={family:ExperimentSpec['kind'];asset:string;points:SensitivityPoint[];monotonicity:'MONOTONIC'|'NON_MONOTONIC'|'INSUFFICIENT DATA';localElasticity:number|null;modeledSensitivity:'LOW'|'MEDIUM'|'HIGH'|'UNAVAILABLE';reliability?:ResponseReliability};
export type NormalizedDiagnosis={family:ExperimentSpec['kind'];asset:string;modeledSensitivity:SensitivityCurve['modeledSensitivity'];localElasticity:number|null;benefit:number;monotonicity:SensitivityCurve['monotonicity'];admissible:boolean;rank:number;numericallyAdmissible?:boolean;networkSafe?:boolean;reliability?:ResponseReliability;proximity?:number;evidence?:EvidenceRef[]};
export type LegacyRepairCandidate={family:ExperimentSpec['kind'];asset:string;admissible:boolean;robustness:RobustnessStatus;magnitude:number|null;benefit:number|null;networkHarm:number|null;firstAdmissible?:TestedHypothesis;reason:string};
export type LegacyAnalysisEvidence={version:2|3;modelHash:string;networkHash:string;config:AnalysisConfig;createdAt:string;hydrology:ReturnType<typeof inspectHydrology>;baseline:SimulationEvidence;hypotheses:TestedHypothesis[];untested:{family:string;reason:string}[];dominant?:string;search:{description:string;grid:number[];attempts:TestedHypothesis[];selected?:TestedHypothesis};storms:StressEvidence[];limitations:string[];autopsy?:{families:SensitivityCurve[];ranking:NormalizedDiagnosis[];dominant?:NormalizedDiagnosis;budget:{maxRuns:number;used:number;failed:number}};repairSearch?:{candidates:LegacyRepairCandidate[];selected?:LegacyRepairCandidate;scopeDescription:string};provenance?:{engineVersion:string;engineHash:string;createdAt:string};partial?:{succeeded:number;failed:number;failedReasons:string[]}};

export type RepairCandidate=LegacyRepairCandidate & {attempts:TestedHypothesis[];grid:number[];searchStatus:'COMPLETE'|'INCOMPLETE';stressEvidence:StressEvidence[];diagnosisRank:number;firstAdmissibleEvidence?:EvidenceRef};
export type AnalysisEvidenceV4={
 version:4;modelHash:string;networkHash:string;config:AnalysisConfig;createdAt:string;executionStatus:'COMPLETE'|'INCOMPLETE';
 hydrology:ReturnType<typeof inspectHydrology>;baseline:SimulationEvidence;hypotheses:TestedHypothesis[];
 diagnosis:{methodology:'NORMALIZED_LOCAL_ELASTICITY';dominant?:NormalizedDiagnosis;ranking:NormalizedDiagnosis[];curves:SensitivityCurve[];untested:{family:string;reason:string}[]};
 repairSearch:{grid:number[];candidates:RepairCandidate[];selected?:RepairCandidate;scope:string};
 robustness:{candidate?:ExperimentSpec;scenarios:StressEvidence[];status:RobustnessStatus};
 numericalQuality:{status:'PASS'|'FAIL';continuityError:number|null;nonConvergingPercent:number|null};
 budget:{mode:AnalysisMode;maxRuns:number;usedRuns:number;remainingRuns:number;reservedRuns:number;byType:Record<string,number>};
 provenance:{engineVersion:string;engineHash:string;createdAt:string};limitations:string[];
};
export type AnalysisEvidence=LegacyAnalysisEvidence|AnalysisEvidenceV4;
export type Solve=(input:string)=>Promise<SimulationEvidence>;
export const defaultAnalysisConfig=(targetNode:string,imperial=false):AnalysisConfig=>({targetNode,minReduction:20,pondedDepthLimit:imperial?.492126:.15,mode:'QUICK',maxRuns:36,scenarios:[.75,1,1.25].map((factor,i)=>({label:`Scenario ${String.fromCharCode(65+i)} · ${factor}× supplied inflow`,mode:'inflow',factor})),screening:{...defaultScreening}});
export function validateAnalysisConfig(c:AnalysisConfig){
 if(!c||typeof c.targetNode!=='string'||!c.targetNode||c.targetNode.length>100||!Number.isFinite(c.minReduction)||c.minReduction<=0||c.minReduction>100||!Number.isFinite(c.pondedDepthLimit)||c.pondedDepthLimit<0||!Array.isArray(c.scenarios)||c.scenarios.length<3||c.scenarios.length>4)throw new DomainError('INPUT_ERROR','Choose a hotspot, positive benefit target (≤100%), nonnegative depth threshold and 3–4 scenarios.');
 if(c.mode!==undefined&&!['QUICK','DETAILED'].includes(c.mode))throw new DomainError('INPUT_ERROR','Choose QUICK or DETAILED mode.');
 if(c.maxRuns!==undefined&&(!Number.isInteger(c.maxRuns)||c.maxRuns<1||c.maxRuns>MODE_BUDGET[c.mode??'QUICK']))throw new DomainError('INPUT_ERROR','Solver budget must be a positive integer within the mode limit.');
 if(c.mode==='QUICK'&&c.scenarios.length!==3)throw new DomainError('INPUT_ERROR','Quick mode uses three forcing scenarios.');
 if(c.scenarios.some(s=>!s||typeof s.label!=='string'||!s.label.trim()||s.label.length>100||!['inflow','rainfall'].includes(s.mode)||!Number.isFinite(s.factor)||s.factor<.25||s.factor>3))throw new DomainError('INPUT_ERROR','Invalid forcing scenario.');
 if(new Set(c.scenarios.map(s=>`${s.mode}:${s.factor}`)).size!==c.scenarios.length)throw new DomainError('INPUT_ERROR','Scenarios must have distinct forcing definitions.');
 if(!c.screening||Object.keys(defaultScreening).some(k=>!Number.isFinite(c.screening[k as keyof ScreeningThresholds])||c.screening[k as keyof ScreeningThresholds]<=0))throw new DomainError('INPUT_ERROR','Screening thresholds must be positive.');
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

export const evidenceRef=(run:SimulationEvidence):EvidenceRef=>({inputHash:run.inputHash,reportHash:run.reportHash,outputHash:run.outputHash,engineHash:run.engineHash});
export const networkSafe=(c?:Comparison)=>!!c&&!c.worsenedNodes.length&&c.systemVolumeReduction>=-.002;
export function monotonicity(points:SensitivityPoint[]):SensitivityCurve['monotonicity']{
 const values=points.filter(p=>p.elasticity!==null&&p.volumeReduction!==null&&Number.isFinite(p.volumeReduction)).sort((a,b)=>a.percent-b.percent).map(p=>p.volumeReduction!);
 if(values.length<2)return 'INSUFFICIENT DATA';
 return values.every((v,i)=>i===0||v>=values[i-1]-.001)?'MONOTONIC':'NON_MONOTONIC';
}
export function normalizedElasticity(baselineVolume:number,percent:number,volumeReduction:number|null){
 if(!Number.isFinite(baselineVolume)||baselineVolume<=0||volumeReduction===null||!Number.isFinite(volumeReduction)||!Number.isFinite(percent)||percent<=0)return null;
 return volumeReduction/percent;
}
const median=(values:number[])=>{const a=[...values].sort((x,y)=>x-y),i=Math.floor(a.length/2);return a.length%2?a[i]:(a[i-1]+a[i])/2};
const reliabilityOrder={STRONG:3,MODERATE:2,WEAK:1,UNRELIABLE:0};
export function buildNormalizedDiagnosis(tests:TestedHypothesis[],baselineHotspotVolume:number,proximity:Map<string,number>=new Map()){
 const groups=new Map<string,TestedHypothesis[]>();
 for(const t of tests){const key=JSON.stringify([t.spec.kind,t.spec.asset]);groups.set(key,[...(groups.get(key)??[]),t])}
 const families:SensitivityCurve[]=[],ranking:NormalizedDiagnosis[]=[];
 for(const group of groups.values()){
  const {kind:family,asset}=group[0].spec;
  const points:SensitivityPoint[]=group.map(t=>({percent:t.spec.percent,asset,family,status:t.status,volumeReduction:t.comparison?.volumeReduction??null,systemVolumeReduction:t.comparison?.systemVolumeReduction??null,elasticity:t.comparison?.qualityPassed&&t.run?normalizedElasticity(baselineHotspotVolume,t.spec.percent,t.comparison.volumeReduction):null,comparison:t.comparison,error:t.error,evidence:t.run?evidenceRef(t.run):undefined})).sort((a,b)=>a.percent-b.percent);
  const valid=points.filter(p=>p.elasticity!==null),coefficients=valid.map(p=>p.elasticity!);
  const localElasticity=coefficients.length?median(coefficients):null,trend=monotonicity(points);
  const numericallyAdmissible=valid.length>0&&!group.some(t=>t.run&&!t.comparison?.qualityPassed);
  const safe=valid.length>0&&valid.every(p=>networkSafe(p.comparison));
  const spread=coefficients.length?(Math.max(...coefficients)-Math.min(...coefficients))/Math.max(Math.abs(localElasticity??0),.01):Infinity;
  const reliability:ResponseReliability=trend==='NON_MONOTONIC'||!numericallyAdmissible||coefficients.some(n=>n<0)?'UNRELIABLE':valid.length===points.length&&valid.length>=3&&safe&&spread<=1&&(localElasticity??0)>=.05?'STRONG':valid.length>=2&&trend==='MONOTONIC'&&(localElasticity??0)>=.05?'MODERATE':'WEAK';
  const modeledSensitivity=localElasticity===null?'UNAVAILABLE':localElasticity>=1.5?'HIGH':localElasticity>=.5?'MEDIUM':'LOW';
  families.push({family,asset,points,monotonicity:trend,localElasticity,modeledSensitivity,reliability});
  ranking.push({family,asset,modeledSensitivity,localElasticity,benefit:Math.max(0,...valid.map(p=>p.volumeReduction??0)),monotonicity:trend,admissible:numericallyAdmissible&&safe,numericallyAdmissible,networkSafe:safe,reliability,proximity:proximity.get(JSON.stringify([family,asset]))??0,evidence:valid.map(p=>p.evidence!),rank:0});
 }
 ranking.sort((a,b)=>Number(b.numericallyAdmissible)-Number(a.numericallyAdmissible)||Number(b.networkSafe)-Number(a.networkSafe)||reliabilityOrder[b.reliability!]-reliabilityOrder[a.reliability!]||(b.localElasticity??-Infinity)-(a.localElasticity??-Infinity)||b.benefit-a.benefit||a.proximity!-b.proximity!||a.family.localeCompare(b.family)||a.asset.localeCompare(b.asset));
 ranking.forEach((r,i)=>{r.rank=i+1});
 return {families,ranking};
}
export function stressStatus(base:SolverResult,next:SolverResult,target:string,limit:number){
 const c=compareResults(base,next,target),node=next.nodes.find(n=>sameId(n.id,target))!;
 if(!c.qualityPassed||!networkSafe(c))return 'FAIL' as const;
 if(node.pondedDepth===null)return node.floodHours===0?'PASS' as const:'WARN' as const;
 return node.pondedDepth<=limit?'PASS' as const:'FAIL' as const;
}
export function deriveRobustness(scenarios:StressEvidence[],expectedCount:number,repair?:ExperimentSpec):RobustnessStatus{
 if(!scenarios.length)return 'UNTESTED';
 if(expectedCount<1||scenarios.length!==expectedCount||new Set(scenarios.map(s=>`${s.scenario.mode}:${s.scenario.factor}`)).size!==expectedCount)return 'INCOMPLETE';
 if(scenarios.some(s=>s.status==='FAIL'))return 'FAIL';
 const sameSpec=(a?:ExperimentSpec,b?:ExperimentSpec)=>!!a&&!!b&&a.kind===b.kind&&a.asset===b.asset&&a.percent===b.percent&&a.targetNode===b.targetNode;
 if(scenarios.some(s=>s.status==='INCOMPLETE'||s.error||!s.baseline||!s.intervention||!s.comparison||s.baseline.verification!=='SERVER VERIFIED'||s.intervention.verification!=='SERVER VERIFIED'||s.expectedBaselineHash!==s.baseline.inputHash||s.expectedInterventionHash!==s.intervention.inputHash||s.baseline.engineHash!==s.intervention.engineHash||(repair&&!sameSpec(s.repairSpec,repair))))return 'INCOMPLETE';
 if(scenarios.some(s=>!s.comparison!.qualityPassed||!networkSafe(s.comparison)))return 'FAIL';
 return scenarios.some(s=>s.status==='WARN')?'WARN':'PASS';
}
export const REPAIR_GRID=[5,10,20,30,50,75,100];
export const repairGrid=(kind:ExperimentSpec['kind'])=>REPAIR_GRID.filter(n=>n<=maxPercent(kind));
export function repairAdmissible(candidate:TestedHypothesis,config:AnalysisConfig){
 const node=candidate.run?.result.nodes.find(n=>sameId(n.id,config.targetNode));
 return candidate.status==='ELIGIBLE FOR REVIEW'&&!!candidate.comparison?.qualityPassed&&networkSafe(candidate.comparison)&&(candidate.comparison.volumeReduction??0)>=config.minReduction&&!!node&&(node.pondedDepth!==null?node.pondedDepth<=config.pondedDepthLimit:node.floodHours===0);
}
export function rankRepairCandidates(candidates:RepairCandidate[]){
 return [...candidates].sort((a,b)=>Number(b.admissible)-Number(a.admissible)||(a.magnitude??Infinity)-(b.magnitude??Infinity)||a.diagnosisRank-b.diagnosisRank||(b.benefit??0)-(a.benefit??0)||(b.firstAdmissible?.comparison?.systemVolumeReduction??0)-(a.firstAdmissible?.comparison?.systemVolumeReduction??0)||a.family.localeCompare(b.family)||a.asset.localeCompare(b.asset));
}
export async function runAutopsy(input:string,config:AnalysisConfig,solve:Solve,progress:(message:string)=>void=()=>{},options:{signal?:AbortSignal}={}):Promise<AnalysisEvidenceV4>{
 validateAnalysisConfig(config);
 const mode=config.mode??'QUICK',budget=new RunBudget(config.maxRuns??MODE_BUDGET[mode],config.scenarios.length*2);
 const modelHash=await sha256(input),networkHash=await networkSignature(input),hydrology=inspectHydrology(input);
 const issues=plausibility(input,undefined,config.screening).filter(w=>w.severity==='error');
 if(issues.length)throw new DomainError(hydrology.warnings.some(w=>w.severity==='error')?'HYDROLOGY_ERROR':'INPUT_ERROR',issues.map(w=>`${w.asset??'Model'}: ${w.message}`).join(' '));
 let engineHash:string|undefined,incomplete=false;
 const execute=async(source:string,type:'baseline'|'autopsy'|'repair'|'stress')=>{
  if(options.signal?.aborted)throw new DomainError('TIMEOUT','Analysis cancelled or timed out. Completed evidence retained.');
  budget.consume(type);const run=await solve(source);
  if(options.signal?.aborted)throw new DomainError('TIMEOUT','Analysis cancelled during solver execution. Completed earlier evidence retained.');
  if(run.verification!=='SERVER VERIFIED'||run.inputHash!==await sha256(source)||!run.reportHash||!run.outputHash||!run.engineHash||(engineHash&&run.engineHash!==engineHash))throw new DomainError('SECURITY_ERROR','Solver evidence does not match its input or pinned engine.');
  engineHash=run.engineHash;run.warnings=plausibility(source,run.result,config.screening);return run;
 };
 progress('Running independent reference baseline');
 const baseline=await execute(input,'baseline'),hotspot=baseline.result.nodes.find(n=>sameId(n.id,config.targetNode)&&n.type!=='OUTFALL');
 if(!hotspot)throw new DomainError('INPUT_ERROR','Hotspot is absent from this baseline.');
 const {specs,untested}=generateHypotheses(input,config.targetNode);
 const cache=new Map<string,TestedHypothesis>(),key=(s:ExperimentSpec)=>JSON.stringify([s.kind,s.asset,s.percent]);
 const test=async(spec:ExperimentSpec,type:'autopsy'|'repair'):Promise<TestedHypothesis>=>{
  const prior=cache.get(key(spec));if(prior)return prior;
  let changes:ParameterChange[]=[],rationale='';
  try{
   const generated=generateExperiment(input,spec);changes=generated.changes;rationale=generated.rationale;
   const run=await execute(generated.input,type),comparison=compareResults(baseline.result,run.result,config.targetNode);
   const result:TestedHypothesis={spec,changes,rationale,run,comparison,score:comparison.volumeReduction??0,status:!comparison.qualityPassed||!networkSafe(comparison)?'REJECTED':comparison.eligible?'ELIGIBLE FOR REVIEW':'TESTED'};
   cache.set(key(spec),result);return result;
  }catch(e){
   if(e instanceof BudgetExceeded||options.signal?.aborted){incomplete=true;return {spec,changes,rationale,error:(e as Error).message,errorCode:classifyError(e),score:0,status:'UNTESTED'}}
   const result:TestedHypothesis={spec,changes,rationale,error:(e as Error).message,errorCode:classifyError(e),score:0,status:'REJECTED'};
   cache.set(key(spec),result);return result;
  }
 };
 const representatives:ExperimentSpec[]=[],proximity=new Map<string,number>();
 for(const family of Object.keys(familyNames) as ExperimentSpec['kind'][]){
  const familySpecs=specs.filter(s=>s.kind===family);familySpecs.forEach((s,i)=>proximity.set(JSON.stringify([s.kind,s.asset]),i));
  representatives.push(...familySpecs.slice(0,mode==='QUICK'?1:2));
  if(mode==='QUICK')for(const s of familySpecs.slice(1))untested.push({family:familyNames[family],reason:`${s.asset} omitted in QUICK mode; use DETAILED to test a second nearby asset.`});
 }
 const hypotheses:TestedHypothesis[]=[];
 for(const spec of representatives){
  if(budget.available()<3||options.signal?.aborted){incomplete=true;untested.push({family:familyNames[spec.kind],reason:`${spec.asset}: three-point curve not started because budget or cancellation prevents completion.`});continue}
  for(const percent of [5,10,20]){progress(`Normalized autopsy · ${familyNames[spec.kind]} / ${spec.asset} · ${percent}% · ${budget.used}/${budget.max} runs`);hypotheses.push(await test({...spec,percent},'autopsy'))}
 }
 const normalized=buildNormalizedDiagnosis(hypotheses,hotspot.floodVolume,proximity);
 const first=normalized.ranking[0],dominant=first?.admissible&&first.reliability!=='UNRELIABLE'&&(first.localElasticity??0)>0?first:undefined;
 const shortlist=normalized.ranking.filter(r=>['diameter','roughness','storage','inlet'].includes(r.family)&&r.numericallyAdmissible).slice(0,mode==='QUICK'?2:3);
 let candidates:RepairCandidate[]=shortlist.map(r=>({family:r.family,asset:r.asset,admissible:false,robustness:'UNTESTED',magnitude:null,benefit:null,networkHarm:null,reason:'No admissible magnitude found.',attempts:[],grid:repairGrid(r.family),searchStatus:'INCOMPLETE',stressEvidence:[],diagnosisRank:r.rank}));
 // Round-robin: each remaining candidate receives the same level before any advances.
 for(const percent of REPAIR_GRID){
  const pending=candidates.filter(c=>!c.firstAdmissible&&c.grid.includes(percent));
  const newRuns=pending.filter(c=>!cache.has(key({kind:c.family,asset:c.asset,percent,targetNode:config.targetNode}))).length;
  if(newRuns>budget.available()||options.signal?.aborted){incomplete=true;break}
  for(const c of pending){
   progress(`Repair search · ${c.asset} · ${percent}% · ${budget.used}/${budget.max} runs`);
   const attempt=await test({kind:c.family,asset:c.asset,percent,targetNode:config.targetNode},'repair');c.attempts.push(attempt);
   if(repairAdmissible(attempt,config)){c.firstAdmissible=attempt;c.firstAdmissibleEvidence=evidenceRef(attempt.run!);c.admissible=true;c.magnitude=percent;c.benefit=attempt.comparison!.volumeReduction;c.networkHarm=attempt.comparison!.worsenedNodes.length;c.searchStatus='COMPLETE';c.reason='Smallest tested admissible magnitude for this candidate.'}
   else if(percent===c.grid.at(-1))c.searchStatus='COMPLETE';
  }
 }
 for(const c of candidates)if(c.searchStatus==='INCOMPLETE')c.reason='Search incomplete: budget or cancellation prevented testing the remaining declared magnitudes.';
 candidates=rankRepairCandidates(candidates);
 const selected=candidates.find(c=>c.admissible),storms:StressEvidence[]=[];
 if(selected){
  const repair=selected.firstAdmissible!.spec;
  for(const scenario of config.scenarios){
   const storm:StressEvidence={scenario,changes:[],status:'INCOMPLETE',repairSpec:{...repair}};
   try{
    if(budget.remaining()<2)throw new BudgetExceeded();
    if(options.signal?.aborted)throw new DomainError('TIMEOUT','Scenario cancelled before both runs completed.');
    progress(`Forcing Sensitivity Test · ${scenario.label} · ${repair.asset} ${repair.percent}%`);
    const source=generateScenario(input,scenario),changed=generateExperiment(source.input,repair);storm.changes=source.changes;
    storm.expectedBaselineHash=await sha256(source.input);storm.expectedInterventionHash=await sha256(changed.input);
    if(await networkSignature(source.input)!==networkHash||await networkSignature(changed.input)!==networkHash)throw new DomainError('SECURITY_ERROR','Scenario network mismatch.');
    storm.baseline=await execute(source.input,'stress');storm.intervention=await execute(changed.input,'stress');
    storm.comparison=compareResults(storm.baseline.result,storm.intervention.result,config.targetNode);
    storm.evidence={baseline:evidenceRef(storm.baseline),intervention:evidenceRef(storm.intervention)};
    storm.status=stressStatus(storm.baseline.result,storm.intervention.result,config.targetNode,config.pondedDepthLimit);
   }catch(e){storm.error=(e as Error).message;storm.errorCode=classifyError(e);storm.status=e instanceof BudgetExceeded||options.signal?.aborted?'INCOMPLETE':'FAIL';incomplete=true}
   storms.push(storm);
  }
  selected.stressEvidence=storms;selected.robustness=deriveRobustness(storms,config.scenarios.length,repair);
 }
 incomplete ||= candidates.some(c=>c.searchStatus==='INCOMPLETE'||c.attempts.some(a=>!a.run))||hypotheses.some(h=>!h.run)||!!options.signal?.aborted;
 const createdAt=new Date().toISOString();
 return {version:4,modelHash,networkHash,config:structuredClone({...config,mode,maxRuns:budget.max}),createdAt,executionStatus:incomplete?'INCOMPLETE':'COMPLETE',hydrology,baseline,hypotheses,
  diagnosis:{methodology:'NORMALIZED_LOCAL_ELASTICITY',curves:normalized.families,ranking:normalized.ranking,dominant,untested},
  repairSearch:{grid:[...REPAIR_GRID],candidates,selected,scope:`Top ${mode==='QUICK'?2:3} numerically valid physical candidates from normalized diagnosis; equivalent ascending grids clipped to family bounds. Benefit >= ${config.minReduction}%, ponding <= ${config.pondedDepthLimit} ${baseline.result.depthUnit}, numerical pass and no network harm. Each attempt starts from the original baseline. Exact autopsy attempts are reused.`},
  robustness:{candidate:selected?.firstAdmissible?.spec,scenarios:storms,status:selected?.robustness??'UNTESTED'},
  numericalQuality:{status:numericalQuality(baseline.result)?'PASS':'FAIL',continuityError:baseline.result.continuityError,nonConvergingPercent:baseline.result.nonConvergingPercent},
  budget:{mode,maxRuns:budget.max,usedRuns:budget.used,remainingRuns:budget.remaining(),reservedRuns:Math.min(budget.reserved,budget.remaining()),byType:{...budget.byType}},
  provenance:{engineVersion:baseline.result.engineVersion,engineHash:baseline.engineHash,createdAt},
  limitations:[
   'Normalized modeled sensitivity among tested mechanisms is not proof of real-world causality. Engineering review is required.',
   'Elasticity = hotspot flood-volume reduction / relative perturbation magnitude. Median of numerically valid 5/10/20% points; positive means benefit in the declared intervention direction.',
   'Diagnosis rank: numerical admissibility, network safety, response reliability, median elasticity, absolute benefit, nearby asset order, deterministic family/asset ID.',
   'Reliability is not probabilistic confidence. STRONG: 3 valid monotonic safe points, relative elasticity spread <=1 and median >=0.05. MODERATE: 2 monotonic positive points. Others: WEAK or UNRELIABLE.',
   'Repair rank: admissibility, smaller magnitude, diagnosis rank, hotspot benefit, network benefit. Stress evidence belongs only to the selected repair and never promotes an untested alternative.',
   'Boundary and runoff sensitivities are diagnostic only. Calibration, rainfall provenance, physical feasibility and cost remain unverified. No return period is inferred.',
   'Numerical tolerance +/-1% and network tolerances are screening rules, not regulatory requirements. Results retain SWMM report precision; surcharge duration differs from flooding duration.',
   ...(incomplete?['Analysis incomplete. Budget, cancellation or failed execution limited the search; completed evidence remains available.']:[]),
   ...(!dominant?['No reliable positive dominant sensitivity can be concluded.']:[]),
   ...(!selected?['No admissible repair found in the completed search; robustness is UNTESTED.']:[])
  ]};
}
