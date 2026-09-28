import {familyNames,numericalQuality} from './experiments.ts';
import type {AnalysisEvidence,NormalizedDiagnosis,RepairCandidate,RobustnessStatus,StressEvidence} from './diagnostics.ts';

export function diagnosisLabel(d?:NormalizedDiagnosis){return d?`${familyNames[d.family]} · ${d.asset}`:'No reliable positive dominant sensitivity among tested mechanisms'}
// Read-only adapter. Legacy numbers and ordering are retained; they are never
// recomputed with V4 methodology or written back to the immutable artifact.
export function normalizeEvidenceVersion(e:AnalysisEvidence){
 if(e.version===4)return {...e,legacy:false,legacyNote:'',dominantLabel:diagnosisLabel(e.diagnosis.dominant),
  search:{description:e.repairSearch.scope,grid:e.repairSearch.grid,attempts:e.repairSearch.candidates.flatMap(c=>c.attempts),selected:e.repairSearch.selected?.firstAdmissible},
  storms:e.robustness.scenarios,untested:e.diagnosis.untested};
 const diagnosis=e.autopsy;
 const chosen=e.search.selected;
 // Old candidate records could carry another asset's firstAdmissible. Do not
 // trust those associations, or their arbitrary stored robustness field.
 const legacyCandidates=(e.repairSearch?.candidates??[]).map(c=>{
  const first=c.firstAdmissible?.spec.kind===c.family&&c.firstAdmissible.spec.asset===c.asset?c.firstAdmissible:undefined;
  return {...c,firstAdmissible:first,admissible:!!first,magnitude:first?.spec.percent??null,benefit:first?.comparison?.volumeReduction??null,robustness:'UNTESTED' as RobustnessStatus,attempts:first?[first]:[],grid:[],searchStatus:'INCOMPLETE' as const,stressEvidence:[] as StressEvidence[],diagnosisRank:0};
 });
 let selected:RepairCandidate|undefined;
 if(chosen){
  selected={family:chosen.spec.kind,asset:chosen.spec.asset,firstAdmissible:chosen,admissible:true,magnitude:chosen.spec.percent,benefit:chosen.comparison?.volumeReduction??null,networkHarm:chosen.comparison?.worsenedNodes.length??null,reason:'Historical selected repair; candidate-specific V4 stress binding unavailable.',attempts:e.search.attempts,grid:e.search.grid,searchStatus:'COMPLETE',stressEvidence:[],robustness:'UNTESTED',diagnosisRank:0};
 }
 const candidates=selected?[selected,...legacyCandidates.filter(c=>c.family!==selected!.family||c.asset!==selected!.asset)]:legacyCandidates;
 return {...e,legacy:true,legacyNote:'Historical evidence: original metrics and ranking preserved. Legacy robustness is not V4-bound; rerun autopsy for candidate-specific verification.',
  executionStatus:'COMPLETE' as const,
  dominantLabel:diagnosis?.dominant?diagnosisLabel(diagnosis.dominant):e.dominant??'No historical dominant recorded',
  diagnosis:{methodology:'LEGACY_RECORDED' as const,dominant:diagnosis?.dominant,ranking:diagnosis?.ranking??[],curves:diagnosis?.families??[],untested:e.untested},
  repairSearch:{grid:e.search.grid,candidates,selected,scope:e.search.description},
  robustness:{candidate:chosen?.spec,scenarios:e.storms,status:'UNTESTED' as RobustnessStatus},
  numericalQuality:{status:numericalQuality(e.baseline.result)?'PASS' as const:'FAIL' as const,continuityError:e.baseline.result.continuityError,nonConvergingPercent:e.baseline.result.nonConvergingPercent},
  budget:undefined};
}
export type UnifiedAnalysisEvidence=ReturnType<typeof normalizeEvidenceVersion>;
