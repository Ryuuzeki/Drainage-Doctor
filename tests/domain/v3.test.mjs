import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inspectHydrology} from '../../lib/integrity.ts';
import {buildNormalizedDiagnosis,normalizedElasticity,monotonicity} from '../../lib/diagnostics.ts';
import {validateRunnableModel,parseReport} from '../../lib/swmm-results.ts';
import {runEngine} from '../engine-helper.mjs';
import {generateScenario} from '../../lib/scenarios.ts';
import {generateExperiment,compareResults} from '../../lib/experiments.ts';

test('normalized elasticity and monotonicity use bounded local response',()=>{
 assert.equal(normalizedElasticity(100,10,20),2);
 assert.equal(monotonicity([{percent:5,asset:'C1',family:'diameter',status:'TESTED',volumeReduction:2,systemVolumeReduction:1,elasticity:0.4},{percent:10,asset:'C1',family:'diameter',status:'TESTED',volumeReduction:5,systemVolumeReduction:2,elasticity:0.5}]),'MONOTONIC');
 const out=buildNormalizedDiagnosis([{spec:{kind:'diameter',asset:'C1',percent:5,targetNode:'J1'},changes:[],rationale:'',comparison:{targetNode:'J1',volumeReduction:5,depthReduction:1,durationReduction:1,systemVolumeReduction:2,worsenedNodes:[],qualityPassed:true,eligible:true,warnings:[]},score:1,status:'ELIGIBLE FOR REVIEW'}],100);
 assert.equal(out.ranking[0].localElasticity,null,'a comparison without solver evidence cannot support normalized elasticity');
});

test('model validation rejects only real external file references',()=>{
 const title='[TITLE]\nA FILE label is harmless\n[OPTIONS]\nSTART_DATE 01/01/2026\nEND_DATE 01/01/2026\nEND_TIME 01:00:00\nREPORT_STEP 00:01:00';
 assert.doesNotThrow(()=>validateRunnableModel(title));
 assert.throws(()=>validateRunnableModel(title+'\n[FILES]\nUSE HOTSTART x.hsf'),/self-contained/);
 assert.throws(()=>validateRunnableModel(title+'\n[RAINGAGES]\nG1 INTENSITY 00:05 FILE rain.dat'),/self-contained/);
});

test('rainfall-runoff fixture has explicit hydrology and runs through SWMM',async()=>{
 const input=await readFile('tests/fixtures/rainfall-runoff.inp','utf8');
 const h=inspectHydrology(input);assert.equal(h.status,'HYDROLOGY MODEL PRESENT');assert.equal(h.subcatchments,1);assert.equal(h.rainGages,1);assert.equal(h.infiltrationMethod,'HORTON');
 const execution=await runEngine(input);assert.equal(execution.code,0,execution.report);const result=parseReport(execution.report);assert.ok(result.totalFloodVolume>0);assert.ok(result.floodedNodes>0);
});

test('rainfall forcing and imperviousness produce directional runoff responses',async()=>{
 const input=await readFile('tests/fixtures/rainfall-runoff.inp','utf8');
 const base=parseReport((await runEngine(input)).report);
 const wet=generateScenario(input,{label:'wet',mode:'rainfall',factor:1.5});
 const wetResult=parseReport((await runEngine(wet.input)).report);assert.ok(wetResult.totalFloodVolume>=base.totalFloodVolume);assert.ok(wetResult.nodes.find(n=>n.id==='J1').maxDepth>=base.nodes.find(n=>n.id==='J1').maxDepth);
 const lessImpervious=generateExperiment(input,{kind:'runoff',asset:'catchment:S1',percent:20,targetNode:'J1'});
 const lessResult=parseReport((await runEngine(lessImpervious.input)).report);assert.ok(lessResult.totalFloodVolume<=base.totalFloodVolume);assert.ok(compareResults(base,lessResult,'J1').volumeReduction>=0);
 const moreInfiltration=input.replace('S1 50 5 0.001 4 0','S1 80 5 0.001 4 0');
 const infiltrationResult=parseReport((await runEngine(moreInfiltration)).report);assert.ok(infiltrationResult.totalFloodVolume<=base.totalFloodVolume);
});
