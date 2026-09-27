import {readInp,rowsIn,optionValue,sameId} from './inp.ts';
import type {SolverResult} from './swmm-results';

export const engineeringSources={
 input:'https://www.epa.gov/system/files/documents/2022-04/swmm-users-manual-version-5.2.pdf',
 hydraulics:'https://www.epa.gov/water-research/storm-water-management-model-swmm',
 screening:'DrainageDoctor screening rule — not a regulatory requirement',
};
export type ReviewWarning={code:string;severity:'error'|'warning';asset?:string;message:string;source:string};
export type ScreeningThresholds={pondingM:number;velocityMps:number;floodHours:number;fullFlowRatio:number;headDifferenceM:number};
export const defaultScreening:ScreeningThresholds={pondingM:2,velocityMps:8,floodHours:6,fullFlowRatio:3,headDifferenceM:10};
export function inspectHydrology(input:string){
 const {rows}=readInp(input),sub=rowsIn(rows,'SUBCATCHMENTS'),gages=rowsIn(rows,'RAINGAGES'),infiltration=rowsIn(rows,'INFILTRATION');
 const external=rowsIn(rows,'INFLOWS').filter(r=>sameId(r.tokens[1],'FLOW'));
 const active=sub.length>0&&optionValue(rows,'IGNORE_RAINFALL')?.toUpperCase()!=='YES';
 const warnings:ReviewWarning[]=[];
 const warn=(code:string,message:string,asset?:string,severity:ReviewWarning['severity']='warning')=>warnings.push({code,message,asset,severity,source:engineeringSources.input});
 const timeseries=rowsIn(rows,'TIMESERIES'),series=new Set(timeseries.map(r=>r.tokens[0].toUpperCase()));
 const method=optionValue(rows,'INFILTRATION')?.toUpperCase()??'HORTON';
 for(const r of sub){
  const t=r.tokens;
  if(!Number.isFinite(+t[3])||+t[3]<=0)warn('area','Subcatchment area must be positive.',t[0],'error');
  if(!Number.isFinite(+t[4])||+t[4]<0||+t[4]>100)warn('imperviousness','Imperviousness must be between 0 and 100%.',t[0],'error');
  if(!Number.isFinite(+t[5])||+t[5]<=0||!Number.isFinite(+t[6])||+t[6]<0)warn('catchment-geometry','Review subcatchment width and slope.',t[0],'error');
  if(!gages.some(g=>sameId(g.tokens[0],t[1])))warn('rain-gage','Referenced rain gage is missing.',t[0],'error');
  if(!infiltration.some(i=>sameId(i.tokens[0],t[0])))warn('infiltration-missing','No explicit infiltration parameters; inspect solver defaults.',t[0]);
 }
 for(const r of infiltration){
  const p=r.tokens.slice(1).filter(t=>!/[A-Za-z_]/.test(t)).map(Number);
  if(p.some(n=>!Number.isFinite(n)||n<0)||p.length<3)warn('infiltration','Invalid or incomplete infiltration parameters.',r.tokens[0],'error');
  if(method.includes('HORTON')&&p[0]<p[1])warn('horton','Horton maximum rate is below minimum rate.',r.tokens[0],'error');
  if(method.includes('GREEN_AMPT')&&(p[1]<=0||p[2]>1))warn('green-ampt','Review conductivity and initial moisture deficit (0–1).',r.tokens[0],'error');
  if(method==='CURVE_NUMBER'&&(p[0]<=0||p[0]>100))warn('curve-number','Curve number must be within (0, 100].',r.tokens[0],'error');
 }
 const rainfallSeries=new Set<string>();
 for(const r of gages){
  if(r.tokens[4]?.toUpperCase()==='TIMESERIES'){
   const id=r.tokens[5]?.toUpperCase();if(id)rainfallSeries.add(id);
   if(!id||!series.has(id))warn('rain-series','Rainfall time series is missing.',r.tokens[0],'error');
  }else warn('rain-external','External rainfall file is not supported by the self-contained runner.',r.tokens[0],'error');
 }
 for(const r of timeseries){
  if(rainfallSeries.has(r.tokens[0].toUpperCase())&&(!Number.isFinite(Number(r.tokens.at(-1)))||Number(r.tokens.at(-1))<0))warn('rainfall-negative','Rainfall value must be finite and nonnegative.',r.tokens[0],'error');
 }
 for(const r of external){const id=r.tokens[2];if(id&&id!=='*'&&!series.has(id.toUpperCase()))warn('inflow-series','External flow time series is missing.',r.tokens[0],'error')}
 const assumptions=['Calibration status unknown.','Rainfall return period and IDF provenance are not verified.','Terrain, surface connectivity and boundary representativeness require engineering review.'];
 if(!active)assumptions.push('Rainfall-runoff is not active. Supplied hydrographs are engineering inputs whose derivation has not been verified.');
 if(active&&external.length)assumptions.push('Rainfall-runoff and external inflows coexist; review potential double counting.');
 return {status:active?'HYDROLOGY MODEL PRESENT':external.length?'EXTERNAL INFLOW ONLY':'NO ACTIVE HYDROLOGIC INPUT',rainfallRunoff:active,subcatchments:sub.length,rainGages:gages.length,timeSeries:series.size,infiltrationMethod:method,externalInflows:external.length,units:optionValue(rows,'FLOW_UNITS')??'Unknown',routing:optionValue(rows,'FLOW_ROUTING')??'Unknown',period:{start:`${optionValue(rows,'START_DATE')??'unspecified'} ${optionValue(rows,'START_TIME')??'00:00:00'}`,end:`${optionValue(rows,'END_DATE')??'unspecified'} ${optionValue(rows,'END_TIME')??'00:00:00'}`},routingStep:optionValue(rows,'ROUTING_STEP')??'solver default',wetStep:optionValue(rows,'WET_STEP')??'solver default',reportStep:optionValue(rows,'REPORT_STEP')??'solver default',antecedentDryDays:optionValue(rows,'DRY_DAYS')??'0 (solver default)',warnings,assumptions};
}
export function plausibility(input:string,result?:SolverResult,thresholds:ScreeningThresholds=defaultScreening):ReviewWarning[]{
 if(Object.values(thresholds).some(n=>!Number.isFinite(n)||n<=0))throw new Error('Screening thresholds must be finite and positive.');
 const {rows}=readInp(input),warnings:ReviewWarning[]=[...inspectHydrology(input).warnings];
 const us=['CFS','GPM','MGD'].includes(optionValue(rows,'FLOW_UNITS')??''),toM=us?.3048:1;
 const warn=(code:string,message:string,asset?:string,severity:ReviewWarning['severity']='warning')=>warnings.push({code,message,asset,severity,source:engineeringSources.screening});
 const nodes=rows.filter(r=>['[JUNCTIONS]','[STORAGE]','[OUTFALLS]','[DIVIDERS]'].includes(r.section));
 for(const r of rowsIn(rows,'XSECTIONS')){
  if(['CIRCULAR','RECT_CLOSED','RECT_OPEN','TRAPEZOIDAL'].includes(r.tokens[1]?.toUpperCase())){
   const depth=Number(r.tokens[2]);if(!Number.isFinite(depth)||depth<=0)warn('invalid-dimension','Cross-section depth / diameter must be positive.',r.tokens[0],'error');
   else if(depth*toM>10)warn('extreme-dimension','Cross-section depth / diameter exceeds the 10 m screening threshold.',r.tokens[0]);
  }
 }
 for(const r of rowsIn(rows,'CONDUITS')){
  const t=r.tokens,length=Number(t[3]);if(!Number.isFinite(length)||length<=0||!(Number(t[4])>0)){warn('conduit-geometry','Conduit length and Manning n must be positive.',t[0],'error');continue}
  const from=nodes.find(n=>sameId(n.tokens[0],t[1])),to=nodes.find(n=>sameId(n.tokens[0],t[2]));
  if(from&&to){
   const offsetMode=optionValue(rows,'LINK_OFFSETS')?.toUpperCase();
   const invert=(node:typeof from,offset:string|undefined)=>offsetMode==='ELEVATION'?(offset==='*'?Number(node.tokens[1]):Number(offset)):Number(node.tokens[1])+Number(offset??0);
   const slope=(invert(from,t[5])-invert(to,t[6]))/length;
   if(!Number.isFinite(slope))warn('invalid-slope','Conduit slope could not be evaluated.',t[0],'error');
   else if(slope<=0||slope>.2)warn('suspicious-slope',`Conduit nominal slope ${slope.toPrecision(4)} needs review; adverse slopes may be intentional in dynamic-wave models.`,t[0]);
  }
 }
 if(result){
  for(const n of result.nodes){
   if(n.pondedDepth!==null&&n.pondedDepth*toM>thresholds.pondingM)warn('excessive-ponding',`Ponded depth ${n.pondedDepth} ${result.depthUnit} exceeds screening ${thresholds.pondingM} m. Review ponding area, surface elevation, storage, inflow and downstream boundary.`,n.id);
   if(n.floodHours>thresholds.floodHours)warn('flood-duration',`Flooding duration ${n.floodHours} h exceeds screening ${thresholds.floodHours} h.`,n.id);
  }
  for(const l of result.links){
   if(l.maxVelocity*toM>thresholds.velocityMps)warn('velocity',`Velocity ${l.maxVelocity} ${result.depthUnit}/s exceeds screening ${thresholds.velocityMps} m/s.`,l.id);
   if(l.fullFlowRatio>thresholds.fullFlowRatio)warn('full-flow',`Maximum / full flow ratio ${l.fullFlowRatio} exceeds screening ${thresholds.fullFlowRatio}.`,l.id);
  }
  for(const r of rowsIn(rows,'CONDUITS')){
   const a=result.nodes.find(n=>sameId(n.id,r.tokens[1])),b=result.nodes.find(n=>sameId(n.id,r.tokens[2]));
   if(a&&b&&Math.abs(a.maxHead-b.maxHead)*toM>thresholds.headDifferenceM)warn('head-difference','Difference between reported node peak heads exceeds screening. Peaks may occur at different times; inspect time series before interpreting a gradient.',r.tokens[0]);
  }
  if(result.continuityError===null||Math.abs(result.continuityError)>1)warn('mass-balance',`Routing continuity ${result.continuityError??'unavailable'}%; required within ±1%.`);
  if(result.routing==='DYNWAVE'&&(result.nonConvergingPercent===null||result.nonConvergingPercent>1))warn('nonconvergence','Dynamic-wave convergence is unavailable or exceeds the 1% screening threshold.');
  for(const warning of result.warnings)warn('solver-warning',warning);
 }
 return warnings;
}
