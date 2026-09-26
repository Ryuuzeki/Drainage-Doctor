import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {generateExperiment,compareResults,experimentOptions} from '../lib/experiments.ts';
import {parseReport} from '../lib/swmm-results.ts';
import {runEngine} from './engine-helper.mjs';
const input=fs.readFileSync('tests/fixtures/baseline.inp','utf8');
const spec={kind:'diameter',asset:'C1',percent:25,targetNode:'J1'};
test('Changes only the selected diameter token, preserving all other bytes',()=>{
 const source=input.replace('C1 CIRCULAR 0.30 0 0 0 1','  C1\tCIRCULAR 0.30 0 0 0 1 ; keep this comment');
 const r=generateExperiment(source,spec);assert.equal(r.input,source.replace('CIRCULAR 0.30','CIRCULAR 0.375'));assert.deepEqual(r.changes,[{section:'[XSECTIONS]',asset:'C1',parameter:'Diameter',before:.3,after:.375}]);assert.equal(r.affectedLength,100);
 assert.equal(generateExperiment(source,spec).input,r.input);
});
test('Roughness bounds and unsupported geometry reject without falling back',()=>{
 const r=generateExperiment(input,{...spec,kind:'roughness',percent:20});assert.equal(r.input,input.replace('C1 J1 J2 100 0.013','C1 J1 J2 100 0.0104'));
 assert.throws(()=>generateExperiment(input,{...spec,percent:101}));assert.throws(()=>generateExperiment(input,{...spec,kind:'roughness',percent:50}));assert.throws(()=>generateExperiment(input.replace('C1 CIRCULAR','C1 RECT_CLOSED'),spec));assert.throws(()=>generateExperiment(input,{...spec,asset:'missing'}));assert.throws(()=>generateExperiment(input,{...spec,targetNode:'O1'}));
});
test('Functional storage changes area at every depth without changing exponent or losses',async()=>{
 const storage=input.replace('J2 9 1.5 0 0 100','').replace('[OUTFALLS]','[STORAGE]\nS1 9 1.5 0 FUNCTIONAL 20 1 80 0 0\n\n[OUTFALLS]').replaceAll('J2','S1');
 const r=generateExperiment(storage,{kind:'storage',asset:'S1',percent:50,targetNode:'J1'});assert.ok(r.input.includes('S1 9 1.5 0 FUNCTIONAL 30 1 120 0 0'));assert.equal(r.changes.length,2);assert.equal(experimentOptions(storage).storage[0].id,'S1');
 const result=await runEngine(r.input);assert.equal(result.code,0);assert.equal(parseReport(result.report).nodes.length,3);
});
test('Real counterfactual runs measure benefit and detect transferred flooding',async()=>{
 const base=parseReport((await runEngine(input)).report);const modified=generateExperiment(input,spec);const after=parseReport((await runEngine(modified.input)).report);const comparison=compareResults(base,after,'J1');assert.ok(comparison.volumeReduction>0);assert.ok(comparison.worsenedNodes.includes('J2'));assert.equal(comparison.eligible,false);
 const repeated=parseReport((await runEngine(modified.input)).report);assert.deepEqual(compareResults(base,repeated,'J1'),comparison);
});
test('Comparison refuses mismatches and flags numerical failures and zero denominators',async()=>{
 const base=parseReport((await runEngine(input)).report);assert.throws(()=>compareResults(base,{...base,flowUnits:'CFS'},'J1'));assert.throws(()=>compareResults(base,{...base,nodes:base.nodes.slice(1)},'J1'));
 assert.equal(compareResults(base,{...base,continuityError:2},'J1').qualityPassed,false);
 const zero={...base,nodes:base.nodes.map(n=>({...n,floodVolume:0}))};assert.equal(compareResults(zero,zero,'J1').volumeReduction,null);assert.equal(compareResults(zero,zero,'J1').eligible,false);
});
