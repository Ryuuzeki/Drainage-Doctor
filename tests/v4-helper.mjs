import {readFile} from 'node:fs/promises';
import {readInp,sha256} from '../lib/inp.ts';
import {compareResults} from '../lib/experiments.ts';
export const input=await readFile('tests/fixtures/baseline.inp','utf8');
export function result(volume=100,ponded=1){
 return {engineVersion:'5.2.2',flowUnits:'CMS',depthUnit:'m',volumeUnit:'10^6 ltr',routing:'DYNWAVE',continuityError:0,nonConvergingPercent:0,warnings:[],links:[],totalFloodVolume:volume,floodedNodes:volume>0?1:0,peakPondedDepth:ponded,nodes:[{id:'J1',type:'JUNCTION',maxDepth:ponded,maxHead:10+ponded,floodHours:volume>0?1:0,floodVolume:volume,maxFloodRate:1,pondedDepth:ponded},{id:'J2',type:'JUNCTION',maxDepth:0,maxHead:9,floodHours:0,floodVolume:0,maxFloodRate:0,pondedDepth:null},{id:'O1',type:'OUTFALL',maxDepth:0,maxHead:8,floodHours:0,floodVolume:0,maxFloodRate:0,pondedDepth:null}]};
}
export async function evidence(source,r=result()){
 return {inputHash:await sha256(source),reportHash:await sha256('report:'+JSON.stringify(r)),outputHash:await sha256('out:'+JSON.stringify(r)),engineHash:await sha256('test engine'),enginePackage:'test-only',executedAt:'2026-09-28T00:00:00Z',elapsedMs:1,result:r,verification:'SERVER VERIFIED',warnings:[]};
}
// Deliberately controlled response for algorithm regression; physics is tested
// separately with the real SWMM engine in physics.test.mjs and v3.test.mjs.
export function syntheticSolver({failAt=0,abortAt=0,controller,wrongHashAt=0,harm=false}={}){
 const calls=[];
 const solve=async source=>{
  calls.push(source);
  if(calls.length===failAt)throw new Error('SWMM error: controlled regression failure');
  if(calls.length===abortAt)controller?.abort();
  const {rows}=readInp(source),xs=rows.filter(r=>r.section==='[XSECTIONS]');
  const p1=Math.round((Number(xs.find(r=>r.tokens[0]==='C1').tokens[2])/.3-1)*100);
  const p2=Math.round((Number(xs.find(r=>r.tokens[0]==='C2').tokens[2])/.3-1)*100);
  const volume=Math.max(0,100-p1*1.5-p2),ponded=p1>=50||p2>=30?0.05:1;
  const r=result(volume,ponded);if(harm&&(p1||p2)){r.nodes[1].floodVolume=5;r.totalFloodVolume+=5}
  const run=await evidence(source,r);if(calls.length===wrongHashAt)run.inputHash='wrong';return run;
 };
 return {solve,calls};
}
export async function hypothesis(asset,percent,benefit,kind='diameter'){
 const run=await evidence(asset+percent,result(100-benefit,.1));
 return {spec:{kind,asset,percent,targetNode:'J1'},run,changes:[],rationale:'Test response',comparison:compareResults(result(),run.result,'J1'),score:benefit,status:'ELIGIBLE FOR REVIEW'};
}
