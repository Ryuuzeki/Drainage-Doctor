import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runEngine} from '../engine-helper.mjs';
import {parseReport} from '../../lib/swmm-results.ts';
import {generateExperiment,compareResults,numericalQuality} from '../../lib/experiments.ts';
import {generateScenario,networkSignature} from '../../lib/scenarios.ts';
import {inspectHydrology,plausibility} from '../../lib/integrity.ts';
import {generateHypotheses,runAutopsy,defaultAnalysisConfig,stressStatus} from '../../lib/diagnostics.ts';
import {sha256} from '../../lib/inp.ts';
const input=fs.readFileSync('public/autopsy-demo.inp','utf8'),stress=fs.readFileSync('tests/fixtures/baseline.inp','utf8');
const run=async source=>{const execution=await runEngine(source);assert.equal(execution.code,0,execution.report);return parseReport(execution.report)};
const baseline=await run(input);

test('Manning full-pipe benchmark agrees with SWMM reported full-flow ratio',()=>{
 const diameter=.3,n=.013,slope=(10-8)/100;
 const q=(Math.PI*diameter**2/4)/n*(diameter/4)**(2/3)*Math.sqrt(slope);
 const link=baseline.links.find(l=>l.id==='C1');assert.ok(Math.abs(link.maxFlow/link.fullFlowRatio-q)<.002);
});
test('External hydrograph volume matches independent trapezoidal integration',async()=>{
 const times=[0,900,1800,3600,5400,7200,10800],flow=[0,.1,.5,.5,.1,0,0];
 const volume=flow.slice(1).reduce((sum,q,i)=>sum+(q+flow[i])/2*(times[i+1]-times[i])*.4,0);
 const report=(await runEngine(input)).report;
 const reported=Number(report.match(/External Inflow\s*\.+\s*[\d.]+\s*([\d.]+)/)[1])*1000;
 assert.ok(Math.abs(volume-reported)<=1,`${volume} vs ${reported} cubic metres`);
});
test('Larger pipe and lower roughness reduce hotspot flooding in this controlled fixture',async()=>{
 for(const kind of ['diameter','roughness']){
  const after=await run(generateExperiment(input,{kind,asset:'C1',percent:20,targetNode:'J1'}).input);
  assert.ok(after.nodes[0].floodVolume<baseline.nodes[0].floodVolume);
  assert.ok(numericalQuality(after));
 }
 const rough=await run(input.replace('100 0.013','100 0.02'));assert.ok(rough.nodes[0].floodVolume>baseline.nodes[0].floodVolume);
});
test('Increasing existing functional storage reduces peak node depth',async()=>{
 const source=input.replace('J1 10 1.5 0 0 100','').replace('[OUTFALLS]','[STORAGE]\nJ1 10 1.5 0 FUNCTIONAL 0 1 100 0 0\n[OUTFALLS]');
 const before=await run(source),after=await run(generateExperiment(source,{kind:'storage',asset:'J1',percent:100,targetNode:'J1'}).input);
 assert.ok(after.nodes[0].maxDepth<before.nodes[0].maxDepth);assert.ok(after.totalFloodVolume<=before.totalFloodVolume);
});
test('Fixed-stage downstream backwater increases upstream head; lowering stage reduces it',async()=>{
 const source=input.replace('FIXED 8.1','FIXED 11.2');
 const high=await run(source),lower=await run(generateExperiment(source,{kind:'tailwater',asset:'O1',percent:20,targetNode:'J1'}).input);
 assert.ok(high.nodes[0].maxHead>baseline.nodes[0].maxHead);assert.ok(lower.nodes[0].maxHead<high.nodes[0].maxHead);
 assert.throws(()=>generateExperiment(input.replace('FIXED 8.1','FREE'),{kind:'tailwater',asset:'O1',percent:20,targetNode:'J1'}));
});
test('Explicit inlet Qmax increase reduces local surface flooding with real SWMM',async()=>{
 const source=fs.readFileSync('tests/fixtures/inlet.inp','utf8'),before=await run(source);
 const generated=generateExperiment(source,{kind:'inlet',asset:'ST',percent:100,targetNode:'D'}),after=await run(generated.input);
 assert.equal(generated.changes[0].before,.02);assert.equal(generated.changes[0].after,.04);
 assert.ok(after.nodes.find(n=>n.id==='D').floodVolume<before.nodes.find(n=>n.id==='D').floodVolume);
 assert.throws(()=>generateExperiment(source.replace('S 1 0 0.02','S 1 0 0'),{kind:'inlet',asset:'ST',percent:20,targetNode:'D'}));
 assert.throws(()=>generateExperiment(source.replace('I DROP_GRATE 1 0.5 P_BAR-50','I CUSTOM CAPTURE')+'\n[CURVES]\nCAPTURE RATING 0 0\nCAPTURE 1 1\n',{kind:'inlet',asset:'ST',percent:20,targetNode:'D'}),/ignores Qmax/);
});
test('Real direct-inflow scenarios preserve topology and increase modeled ponding with forcing',async()=>{
 const results=[];for(const factor of [.75,1,1.25]){
  const scenario=generateScenario(input,{label:String(factor),mode:'inflow',factor});
  assert.equal(await networkSignature(scenario.input),await networkSignature(input));results.push(await run(scenario.input));
 }
 assert.ok(results[0].totalFloodVolume<results[1].totalFloodVolume);assert.ok(results[1].totalFloodVolume<results[2].totalFloodVolume);
});
test('Dry and extreme inputs preserve zero/large flooding behavior without invented depth',async()=>{
 const dry=await run(input.replace('FLOW 1.0 0.4 0','FLOW 1.0 0 0'));
 assert.equal(dry.totalFloodVolume,0);assert.equal(dry.peakPondedDepth,null);
 const extreme=await run(generateScenario(stress,{label:'Extreme',mode:'inflow',factor:3}).input);
 assert.ok(extreme.totalFloodVolume>baseline.totalFloodVolume);assert.ok(plausibility(stress,extreme).some(w=>w.code==='excessive-ponding'));
});
test('Ponding screen converts imperial depth and remains user configurable',async()=>{
 const result=await run(stress);assert.ok(plausibility(stress,result).some(w=>w.code==='excessive-ponding'));
 const t={pondingM:20,velocityMps:8,floodHours:6,fullFlowRatio:3,headDifferenceM:10};assert.ok(!plausibility(stress,result,t).some(w=>w.code==='excessive-ponding'));
 const usInput=stress.replace('FLOW_UNITS CMS','FLOW_UNITS CFS'),us={...result,depthUnit:'ft',nodes:result.nodes.map(n=>({...n,pondedDepth:n.pondedDepth===null?null:n.pondedDepth/.3048}))};
 assert.equal(plausibility(usInput,us).filter(w=>w.code==='excessive-ponding').length,plausibility(stress,result).filter(w=>w.code==='excessive-ponding').length);
});
test('Invalid diameter, slope and hydrology are exposed with source and severity',()=>{
 assert.ok(plausibility(input.replace('CIRCULAR 0.30','CIRCULAR 0')).some(w=>w.code==='invalid-dimension'&&w.severity==='error'));
 assert.ok(plausibility(input.replace('J1 10 1.5','J1 7 1.5')).some(w=>w.code==='suspicious-slope'));
 const invalid=input+'\n[SUBCATCHMENTS]\nA G J1 -1 120 10 1\n[RAINGAGES]\nG INTENSITY 0:05 1 TIMESERIES RAIN\n[TIMESERIES]\nRAIN 0:00 -1\n[INFILTRATION]\nA 1 2 -1 7 0\n';
 const h=inspectHydrology(invalid);assert.equal(h.rainfallRunoff,true);for(const code of ['area','imperviousness','rainfall-negative','infiltration','horton'])assert.ok(h.warnings.some(w=>w.code===code),code);
 assert.equal(inspectHydrology(input).status,'EXTERNAL INFLOW ONLY');
});
test('Rainfall replacement edits only rain-gage ordinates and refuses shared boundary series',()=>{
 const source=input+'\n[RAINGAGES]\nG INTENSITY 0:05 1 TIMESERIES RAIN\n[TIMESERIES]\nRAIN 0:00 2\nRAIN 1:00 4\n';
 const changed=generateScenario(source,{label:'Rain',mode:'rainfall',factor:2});assert.ok(changed.input.includes('RAIN 1:00 8'));assert.ok(changed.input.includes('INFLOW FLOW 1.0 0.4 0'));
 assert.throws(()=>generateScenario(source.replace('G INTENSITY 0:05 1 TIMESERIES RAIN','G INTENSITY 0:05 1 TIMESERIES INFLOW'),{label:'Shared',mode:'rainfall',factor:2}),/shared/);
});
test('Hypotheses are neighborhood-bounded and list missing families; invalid quality never passes',()=>{
 const h=generateHypotheses(input,'J1');assert.ok(h.specs.some(s=>s.kind==='tailwater'));assert.ok(h.untested.some(u=>u.family==='Inlet capture'));
 assert.equal(compareResults(baseline,{...baseline,nonConvergingPercent:null},'J1').qualityPassed,false);
 assert.equal(stressStatus(baseline,{...baseline,continuityError:3},'J1',10),'FAIL');
});
test('Complete autopsy loop runs actual SWMM, declares bounded search and solves three paired scenarios',async()=>{
 const seen=[];
 const solve=async source=>{
  seen.push(source);const raw=await runEngine(source);assert.equal(raw.code,0,raw.report);
  return {inputHash:await sha256(source),reportHash:await sha256(raw.report),outputHash:'test-harness-no-binary',engineHash:'test-harness',enginePackage:'@fileops/swmm-wasm-web@0.0.4',executedAt:new Date().toISOString(),elapsedMs:0,result:parseReport(raw.report),verification:'SERVER VERIFIED',warnings:[]};
 };
 const config=defaultAnalysisConfig('J1'),analysis=await runAutopsy(input,config,solve);
 assert.ok(analysis.search.selected,JSON.stringify(analysis.search));assert.equal(analysis.storms.length,3);assert.ok(seen.length>=10);
 assert.equal(analysis.modelHash,await sha256(input));assert.equal(analysis.search.selected.status,'ELIGIBLE FOR REVIEW');
 for(const h of analysis.hypotheses.filter(h=>h.run))assert.equal(h.run.inputHash,await sha256(generateExperiment(input,h.spec).input));
 for(const s of analysis.storms){assert.ok(s.baseline&&s.intervention);assert.notEqual(s.baseline.inputHash,s.intervention.inputHash);assert.equal(s.baseline.result.engineVersion,'5.2.2')}
 assert.deepEqual(config,defaultAnalysisConfig('J1'));
 assert.ok(analysis.search.attempts.slice(0,-1).every(h=>h.spec.percent<analysis.search.selected.spec.percent));
});
