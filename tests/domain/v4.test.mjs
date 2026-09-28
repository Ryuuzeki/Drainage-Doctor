import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultAnalysisConfig,runAutopsy,deriveRobustness,buildNormalizedDiagnosis,repairGrid} from '../../lib/diagnostics.ts';
import {normalizeEvidenceVersion} from '../../lib/evidence-view.ts';
import {makeEngineeringPdf,reportSections,wrapReportLine} from '../../lib/engineering-report.ts';
import {RunBudget} from '../../lib/run-budget.ts';
import {classifyError,DomainError} from '../../lib/errors.ts';
import {generateScenario} from '../../lib/scenarios.ts';
import {generateExperiment} from '../../lib/experiments.ts';
import {sha256} from '../../lib/inp.ts';
import {input,syntheticSolver,hypothesis} from '../v4-helper.mjs';
const config={...defaultAnalysisConfig('J1'),mode:'DETAILED',maxRuns:60};
const harness=syntheticSolver(),analysis=await runAutopsy(input,config,harness.solve);

test('Robustness requires complete bound solver pairs, never default PASS',()=>{
 assert.equal(deriveRobustness([],3),'UNTESTED');
 assert.equal(deriveRobustness(analysis.robustness.scenarios.slice(0,2),3),'INCOMPLETE');
 assert.equal(deriveRobustness([{scenario:config.scenarios[0],status:'PASS'},{scenario:config.scenarios[1],status:'PASS'},{scenario:config.scenarios[2],status:'PASS'}],3),'INCOMPLETE');
 assert.equal(analysis.robustness.status,'PASS');
 for(const c of analysis.repairSearch.candidates.filter(c=>c!==analysis.repairSearch.selected)){assert.equal(c.robustness,'UNTESTED');assert.deepEqual(c.stressEvidence,[])}
});
test('Selected repair is exactly the intervention in every forcing scenario',async()=>{
 const spec=analysis.repairSearch.selected.firstAdmissible.spec;
 assert.deepEqual(analysis.robustness.candidate,spec);
 for(const s of analysis.robustness.scenarios){
  const scenario=generateScenario(input,s.scenario),modified=generateExperiment(scenario.input,spec);
  assert.deepEqual(s.repairSpec,spec);assert.equal(s.expectedInterventionHash,await sha256(modified.input));assert.equal(s.intervention.inputHash,s.expectedInterventionHash);assert.equal(s.baseline.inputHash,await sha256(scenario.input));assert.deepEqual(s.evidence.intervention,{inputHash:s.intervention.inputHash,reportHash:s.intervention.reportHash,outputHash:s.intervention.outputHash,engineHash:s.intervention.engineHash});
 }
});
test('Equivalent grids discover candidate B at 30% and select it before stress testing',()=>{
 const a=analysis.repairSearch.candidates.find(c=>c.family==='diameter'&&c.asset==='C1'),b=analysis.repairSearch.candidates.find(c=>c.family==='diameter'&&c.asset==='C2');
 assert.deepEqual(a.grid,b.grid);assert.deepEqual(b.grid,[5,10,20,30,50,75,100]);assert.deepEqual(repairGrid('roughness'),[5,10,20,30]);
 assert.equal(a.magnitude,50);assert.equal(b.magnitude,30);assert.equal(analysis.repairSearch.selected.asset,'C2');
 assert.deepEqual(b.attempts.map(a=>a.spec.percent),[5,10,20,30]);assert.equal(a.robustness,'UNTESTED');
});
test('Every repair attempt starts at original baseline and has its own exact reference',async()=>{
 for(const c of analysis.repairSearch.candidates)for(const a of c.attempts)assert.equal(a.run.inputHash,await sha256(generateExperiment(input,a.spec).input));
 for(const c of analysis.repairSearch.candidates.filter(c=>c.admissible))assert.equal(c.firstAdmissibleEvidence.inputHash,c.firstAdmissible.run.inputHash);
 assert.equal(new Set(harness.calls.slice(0,-6)).size,harness.calls.length-6,'exact autopsy attempts are reused, not solved again');
});
test('Normalized elasticity outranks larger absolute benefit with equal reliability',async()=>{
 const a=await Promise.all([10,20,50].map(p=>hypothesis('A',p,p*.8))),b=await Promise.all([5,10,12.5].map(p=>hypothesis('B',p,p*2)));
 const {ranking}=buildNormalizedDiagnosis([...a,...b],100);
 assert.equal(ranking[0].asset,'B');assert.equal(ranking[0].localElasticity,2);assert.equal(ranking[1].benefit,40);assert.equal(ranking[0].benefit,25);
});
test('Median elasticity resists last-point outlier; colon asset identity is preserved',async()=>{
 const tests=await Promise.all([[5,5],[10,10],[20,60]].map(([p,b])=>hypothesis('catchment:S:1',p,b,'runoff')));
 const {ranking}=buildNormalizedDiagnosis(tests,100);assert.equal(ranking[0].localElasticity,1);assert.equal(ranking[0].asset,'catchment:S:1');
});
test('Non-monotonic response is retained with unreliable status and ranking penalty',async()=>{
 const bad=await Promise.all([[5,10],[10,8],[20,30]].map(([p,b])=>hypothesis('bad',p,b))),good=await Promise.all([5,10,20].map(p=>hypothesis('good',p,p)));
 const {ranking,families}=buildNormalizedDiagnosis([...bad,...good],100);
 assert.equal(ranking[0].asset,'good');assert.equal(families[0].monotonicity,'NON_MONOTONIC');assert.equal(families[0].reliability,'UNRELIABLE');
});
test('Numerical failures, zero baseline and network harm cannot support dominant or repair',async()=>{
 const points=await Promise.all([5,10,20].map(p=>hypothesis('bad',p,p*2)));points[0].comparison.qualityPassed=false;
 assert.equal(buildNormalizedDiagnosis(points,100).ranking[0].reliability,'UNRELIABLE');assert.equal(buildNormalizedDiagnosis(points,0).ranking[0].localElasticity,null);
 const h=syntheticSolver({harm:true}),e=await runAutopsy(input,config,h.solve);assert.equal(e.repairSearch.selected,undefined);assert.equal(e.diagnosis.dominant,undefined);
 assert.ok(e.repairSearch.candidates.every(c=>!c.admissible));
});
test('Hard budget counts baseline, failures and stress; exhaustion retains evidence',async()=>{
 for(const maxRuns of [1,7,11,15,24]){
  const h=syntheticSolver({failAt:3}),e=await runAutopsy(input,{...config,maxRuns},h.solve);
  assert.ok(h.calls.length<=maxRuns);assert.equal(e.budget.usedRuns,h.calls.length);assert.equal(e.budget.remainingRuns,maxRuns-h.calls.length);
  assert.equal(Object.values(e.budget.byType).reduce((a,b)=>a+b,0),h.calls.length);assert.equal(e.executionStatus,'INCOMPLETE');
 }
 const b=new RunBudget(8,6);b.consume('baseline');b.consume('autopsy');assert.throws(()=>b.consume('repair'));for(let i=0;i<6;i++)b.consume('stress');assert.throws(()=>b.consume('stress'));
});
test('Failure in one hypothesis does not discard successful evidence',async()=>{
 const h=syntheticSolver({failAt:3}),e=await runAutopsy(input,config,h.solve);
 assert.ok(e.hypotheses.some(h=>h.error));assert.ok(e.hypotheses.some(h=>h.run));assert.equal(e.executionStatus,'INCOMPLETE');assert.equal(e.version,4);
});
test('Failed, cancelled or mismatched scenarios cannot leave robustness PASS',async()=>{
 const rows=structuredClone(analysis.robustness.scenarios),spec=analysis.robustness.candidate;
 rows[1].status='FAIL';assert.equal(deriveRobustness(rows,3,spec),'FAIL');
 rows[1].status='INCOMPLETE';assert.equal(deriveRobustness(rows,3,spec),'INCOMPLETE');
 rows[1].status='PASS';rows[1].expectedInterventionHash='wrong';assert.equal(deriveRobustness(rows,3,spec),'INCOMPLETE');
 rows[1]=structuredClone(analysis.robustness.scenarios[1]);rows[1].repairSpec.asset='another';assert.equal(deriveRobustness(rows,3,spec),'INCOMPLETE');
 const controller=new AbortController(),h=syntheticSolver({abortAt:3,controller}),e=await runAutopsy(input,config,h.solve,()=>{},{signal:controller.signal});
 assert.equal(e.executionStatus,'INCOMPLETE');assert.notEqual(e.robustness.status,'PASS');assert.ok(h.calls.length<=3);
 const firstStress=harness.calls.length-5;
 const failed=syntheticSolver({failAt:firstStress+1}),failedEvidence=await runAutopsy(input,config,failed.solve);
 assert.equal(failedEvidence.robustness.status,'FAIL');assert.ok(failedEvidence.robustness.scenarios.some(s=>s.error));
 const lastController=new AbortController(),last=syntheticSolver({abortAt:harness.calls.length,controller:lastController});
 const lastEvidence=await runAutopsy(input,config,last.solve,()=>{},{signal:lastController.signal});
 assert.equal(lastEvidence.robustness.status,'INCOMPLETE','cancellation during the final solver invocation must never produce PASS');
 assert.equal(lastEvidence.repairSearch.selected.robustness,'INCOMPLETE');
});
test('Input provenance mismatch is rejected before any conclusion can use it',async()=>{
 const h=syntheticSolver({wrongHashAt:2}),e=await runAutopsy(input,config,h.solve);
 assert.equal(e.hypotheses[0].errorCode,'SECURITY_ERROR');assert.equal(e.hypotheses[0].run,undefined);
});
test('V4 summary, chart, JSON and PDF use the same canonical diagnosis',()=>{
 const e=normalizeEvidenceVersion(analysis);assert.deepEqual(e.diagnosis.dominant,e.diagnosis.ranking[0]);
 assert.equal('dominant' in analysis,false);assert.equal('autopsy' in analysis,false);
 const sections=reportSections(JSON.parse(JSON.stringify(analysis)),'Regression project','2026-09-28');
 assert.ok(sections.find(s=>s.title==='Executive diagnosis').lines.includes('Dominant modeled sensitivity: '+e.dominantLabel));
 const nonselected=analysis.repairSearch.candidates.find(c=>c!==analysis.repairSearch.selected);
 assert.ok(sections.find(s=>s.title==='Repair search').lines.some(l=>l.includes(nonselected.asset)&&l.includes('robustness UNTESTED')));
});
test('V2/V3 adapter preserves history and prefers recorded normalized dominant',()=>{
 const v3={...analysis,version:3,dominant:'conflicting old label',search:{description:'Historical search',grid:[5,10,20],attempts:[],selected:analysis.repairSearch.selected.firstAdmissible},storms:analysis.robustness.scenarios,untested:[],autopsy:{dominant:analysis.diagnosis.ranking[1],ranking:analysis.diagnosis.ranking, families:analysis.diagnosis.curves},repairSearch:{candidates:analysis.repairSearch.candidates}};
 const original=JSON.stringify(v3),view=normalizeEvidenceVersion(v3);assert.equal(view.diagnosis.dominant.asset,v3.autopsy.dominant.asset);assert.notEqual(view.dominantLabel,v3.dominant);assert.equal(view.robustness.status,'UNTESTED');assert.equal(JSON.stringify(v3),original);
 const v2={...v3,version:2,autopsy:undefined};assert.equal(normalizeEvidenceVersion(v2).dominantLabel,'conflicting old label');
});
test('PDF paginates long warnings without truncating final limitations or hashes',()=>{
 const sections=reportSections({...analysis,limitations:[...analysis.limitations,'FINAL_LIMITATION_TOKEN '+ 'very-long-word'.repeat(50)]},'Long report','2026-09-28');
 sections.splice(-1,0,{title:'Long warnings',lines:Array.from({length:150},(_,i)=>'Warning '+i)});
 const pdf=Buffer.from(makeEngineeringPdf(sections)).toString('ascii');
 assert.match(pdf,/%PDF-1.4/);assert.match(pdf,/Warning 149/);assert.match(pdf,/FINAL_LIMITATION_TOKEN/);assert.match(pdf,new RegExp(analysis.modelHash));assert.ok((pdf.match(/\/Type \/Page /g)??[]).length>3);
 assert.ok(wrapReportLine('x'.repeat(500)).every(l=>l.length<=92));assert.equal(wrapReportLine('x'.repeat(500)).join(''),'x'.repeat(500));
});
test('Specific error taxonomy wins over generic input wording',()=>{
 assert.equal(classifyError(new Error('Rain gage is missing')),'HYDROLOGY_ERROR');assert.equal(classifyError(new Error('SWMM exceeded execution limit')),'TIMEOUT');assert.equal(classifyError(new Error('Model checksum mismatch')),'SECURITY_ERROR');assert.equal(classifyError(new Error('Numerical convergence missing')),'NUMERICAL_FAILURE');assert.equal(classifyError(new DomainError('UNSUPPORTED_MODEL','Invalid model')),'UNSUPPORTED_MODEL');
});
