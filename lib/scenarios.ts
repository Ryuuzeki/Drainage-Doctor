import {readInp,rowsIn,sameId,setToken,sha256} from './inp.ts';
import type {ParameterChange} from './experiments';
export type StormScenario={label:string;mode:'inflow'|'rainfall';factor:number};
export function generateScenario(input:string,scenario:StormScenario){
 if(!['inflow','rainfall'].includes(scenario.mode)||!Number.isFinite(scenario.factor)||scenario.factor<.25||scenario.factor>3)throw new Error('Use rainfall or direct-inflow factors from 0.25 to 3.');
 const {lines,rows}=readInp(input),changes:ParameterChange[]=[];
 const scale=(row:typeof rows[number],index:number,parameter:string)=>{
  const before=Number(row.tokens[index]);if(!Number.isFinite(before)||before<0)throw new Error('Scenario input has invalid or implicit values.');
  const after=Number((before*scenario.factor).toPrecision(12));changes.push({section:row.section,asset:row.tokens[0],parameter,before,after});setToken(lines,row,index,after);
 };
 if(scenario.mode==='inflow'){
  const inflows=rowsIn(rows,'INFLOWS').filter(r=>sameId(r.tokens[1],'FLOW'));
  if(!inflows.length)throw new Error('No direct FLOW inflows are available for this scenario mode.');
  for(const row of inflows){scale(row,5,'FLOW hydrograph scale factor');if(row.tokens[6]!==undefined)scale(row,6,'FLOW baseline value')}
 }else{
  const gages=rowsIn(rows,'RAINGAGES');if(!gages.length||gages.some(r=>r.tokens[4]?.toUpperCase()!=='TIMESERIES'))throw new Error('Rainfall scenarios require embedded time series for every rain gage.');
  const series=new Set(gages.map(r=>r.tokens[5].toUpperCase()));
  if(rowsIn(rows,'INFLOWS').some(r=>series.has(r.tokens[2]?.toUpperCase()))||rowsIn(rows,'OUTFALLS').some(r=>r.tokens[2]?.toUpperCase()==='TIMESERIES'&&series.has(r.tokens[3]?.toUpperCase()))||rowsIn(rows,'EVAPORATION').some(r=>sameId(r.tokens[0],'TIMESERIES')&&series.has(r.tokens[1]?.toUpperCase())))throw new Error('Rainfall series is shared with a non-rainfall boundary; separate it before scaling.');
  for(const id of series){const data=rowsIn(rows,'TIMESERIES').filter(r=>sameId(r.tokens[0],id));if(!data.length)throw new Error('Missing rainfall series.');for(const row of data)scale(row,row.tokens.length-1,'Rainfall series ordinate')}
 }
 return {input:lines.join(''),changes,scenario};
}
/** Identity of the topology, independent of forcing and permitted parameter edits. */
export async function networkSignature(input:string){
 const {rows}=readInp(input);
 const nodes=rows.filter(r=>['[JUNCTIONS]','[STORAGE]','[OUTFALLS]','[DIVIDERS]'].includes(r.section)).map(r=>[r.section,r.tokens[0].toUpperCase()]);
 const links=rows.filter(r=>['[CONDUITS]','[PUMPS]','[WEIRS]','[ORIFICES]','[OUTLETS]'].includes(r.section)).map(r=>[r.section,...r.tokens.slice(0,3).map(t=>t.toUpperCase())]);
 return sha256(JSON.stringify([...nodes,...links].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))));
}
