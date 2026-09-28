import type {AnalysisEvidence,SimulationEvidence,EvidenceRef} from './diagnostics.ts';
import {normalizeEvidenceVersion} from './evidence-view.ts';
import {familyNames} from './experiments.ts';
import {sameId} from './inp.ts';
export type ReportSection={title:string;lines:string[]};
export function reportSections(raw:AnalysisEvidence,project:string,generatedAt:string):ReportSection[]{
 const e=normalizeEvidenceVersion(raw),selected=e.repairSearch.selected?.firstAdmissible;
 const sections:ReportSection[]=[],add=(title:string,lines:string[])=>sections.push({title,lines});
 const refs=(r?:EvidenceRef)=>r?[`Input SHA-256: ${r.inputHash}`,`Report SHA-256: ${r.reportHash}`,`OUT SHA-256: ${r.outputHash}`,`Pinned engine SHA-256: ${r.engineHash}`]:['No completed solver evidence.'];
 const metrics=(r?:SimulationEvidence)=>{const n=r?.result.nodes.find(n=>sameId(n.id,e.config.targetNode));return r&&n?[`Hotspot flood volume: ${n.floodVolume} ${r.result.volumeUnit}`,`Maximum node depth: ${n.maxDepth} ${r.result.depthUnit}; ponded depth: ${n.pondedDepth??'unavailable'}`,`Flooding duration: ${n.floodHours} h`,`System flood volume: ${r.result.totalFloodVolume} ${r.result.volumeUnit}`]:['Metrics unavailable.']};
 add('Engineering Evidence Report',[`DrainageDoctor | Project: ${project}`,`Evidence V${e.version} | Analysis: ${e.executionStatus}`,`Evidence created: ${e.createdAt}`,`Report generated: ${generatedAt}`,`Verification: ${e.baseline.verification} | SWMM ${e.baseline.result.engineVersion}`,...(e.legacy?[e.legacyNote]:[])]);
 add('Executive diagnosis',[`Hotspot: ${e.config.targetNode}`,`Dominant modeled sensitivity: ${e.dominantLabel}`,`Methodology: ${e.diagnosis.methodology}`,`Local elasticity: ${e.diagnosis.dominant?.localElasticity??'unavailable'}`,`Response reliability: ${e.diagnosis.dominant?.reliability??'not recorded'}`,`Baseline numerical quality: ${e.numericalQuality.status}`,`Selected repair robustness: ${e.robustness.status}`]);
 add('Baseline',metrics(e.baseline));
 add('Sensitivity ranking and response curves',e.diagnosis.ranking.length?e.diagnosis.ranking.flatMap(r=>[`#${r.rank} ${familyNames[r.family]} / ${r.asset}: E=${r.localElasticity??'unavailable'}; ${r.reliability??'historical'}; ${r.monotonicity}`,...e.diagnosis.curves.filter(c=>c.family===r.family&&c.asset===r.asset).flatMap(c=>c.points.map(p=>`${p.percent}% change: hotspot reduction ${p.volumeReduction??'unavailable'}%; E=${p.elasticity??'unavailable'}; ${p.status}${p.error?' | '+p.error:''}`))]):['No recorded normalized ranking.']);
 add('Untested mechanisms',e.untested.map(u=>`${u.family}: ${u.reason}`));
 add('Repair search',[e.repairSearch.scope,`Preferred tested repair: ${selected?`${familyNames[selected.spec.kind]} / ${selected.spec.asset} / ${selected.spec.percent}%`:'none'}`,...e.repairSearch.candidates.flatMap(c=>[`Candidate ${familyNames[c.family]} / ${c.asset}: ${c.admissible?'ADMISSIBLE':'NOT ADMISSIBLE'}; ${c.searchStatus}; robustness ${c.robustness}`,`Declared grid: ${c.grid.join(', ')}%; first admissible: ${c.magnitude??'none'}%`,...c.attempts.map(a=>`${a.spec.percent}%: ${a.status}; hotspot benefit ${a.comparison?.volumeReduction??'unavailable'}%; ${a.error??a.comparison?.warnings.join(' ')??''}`),c.reason,...(c.firstAdmissible?refs(c.firstAdmissible.run):[])])]);
 add('Before / after',['Before:',...metrics(e.baseline),'After:',...metrics(selected?.run)]);
 add('Network harm',[`Other nodes worsened: ${selected?.comparison?.worsenedNodes.join(', ')|| (selected?.comparison?'None above tolerance':'not evaluated')}`,`System volume before: ${e.baseline.result.totalFloodVolume} ${e.baseline.result.volumeUnit}`,`System volume after: ${selected?.run?.result.totalFloodVolume??'unavailable'} ${e.baseline.result.volumeUnit}`,...(selected?.comparison?.warnings??[])]);
 add('Forcing Sensitivity Test',[`Overall robustness: ${e.robustness.status}`,`Required scenarios: ${e.config.scenarios.length}; recorded rows: ${e.storms.length}`,`Ponding screen: ${e.config.pondedDepthLimit} ${e.baseline.result.depthUnit}`,'Multipliers are not verified design storms or return periods.',...e.config.scenarios.map(s=>`Required: ${s.label} | ${s.mode} x ${s.factor}`),...e.storms.flatMap(s=>[`Scenario: ${s.scenario.label} | ${s.scenario.mode} x ${s.scenario.factor} | ${s.status}`,`Repair: ${s.repairSpec?`${s.repairSpec.kind} / ${s.repairSpec.asset} / ${s.repairSpec.percent}%`:'historical binding unavailable'}`,...(s.error?[s.error]:[]),'Scenario baseline:',...metrics(s.baseline),...refs(s.baseline),'Scenario intervention:',...metrics(s.intervention),...refs(s.intervention)])]);
 add('Hydrology',[`Status: ${e.hydrology.status}`,`Rain gages: ${e.hydrology.rainGages}; subcatchments: ${e.hydrology.subcatchments}; time series: ${e.hydrology.timeSeries}`,`Infiltration: ${e.hydrology.infiltrationMethod}; external inflows: ${e.hydrology.externalInflows}`,`Simulation period: ${e.hydrology.period.start} - ${e.hydrology.period.end}`,...e.hydrology.assumptions,...e.hydrology.warnings.map(w=>`${w.severity} ${w.asset??''}: ${w.message}`)]);
 const runs=new Map<string,SimulationEvidence>();
 for(const r of [e.baseline,...e.hypotheses.map(h=>h.run),...e.repairSearch.candidates.flatMap(c=>c.attempts.map(a=>a.run)),...e.storms.flatMap(s=>[s.baseline,s.intervention])])if(r)runs.set(r.inputHash+':'+r.reportHash,r);
 add('Numerical quality and warnings',[...runs.values()].flatMap(r=>[`Input ${r.inputHash}`,`Routing continuity: ${r.result.continuityError??'unavailable'}%; non-convergence: ${r.result.nonConvergingPercent??'unavailable'}%`,...r.result.warnings,...r.warnings.map(w=>`${w.severity} ${w.asset??''}: ${w.message}`)]));
 add('Provenance and evidence chain',[`Model SHA-256: ${e.modelHash}`,`Network SHA-256: ${e.networkHash}`,...(e.budget?[`Budget ${e.budget.mode}: ${e.budget.usedRuns}/${e.budget.maxRuns}; remaining ${e.budget.remainingRuns}`]:['Historical budget not verified.']),...[...runs.values()].flatMap(r=>[`Executed: ${r.executedAt} | ${r.elapsedMs} ms | ${r.verification}`,...refs(r)])]);
 add('Limitations',e.limitations);
 return sections;
}
// Fixed-width font makes wrapping deterministic in Workers and Node. No rows
// are dropped; long hashes and user labels are wrapped, including long words.
export function asciiReportText(s:string){return s.replace(/→/g,' -> ').replace(/[–—]/g,'-').replace(/·/g,' | ').replace(/×/g,'x').replace(/≥/g,'>=').replace(/≤/g,'<=').replace(/±/g,'+/-').replace(/[^\x20-\x7e]/gu,c=>c==='\n'?' ':c==='\t'?' ':String.raw`\u{${c.codePointAt(0)!.toString(16)}}`)}
export function wrapReportLine(text:string,width=92){
 const words=asciiReportText(text).split(/\s+/),lines:string[]=[];let line='';
 for(let word of words){while(word.length>width){if(line){lines.push(line);line=''}lines.push(word.slice(0,width));word=word.slice(width)}if(line.length+word.length+1>width){lines.push(line);line=word}else line+=(line?' ':'')+word}
 if(line||!lines.length)lines.push(line);return lines;
}
export function makeEngineeringPdf(sections:ReportSection[]){
 type Row={text:string;heading:boolean};
 const pages:Row[][]=[[]];let rows=pages[0];
 for(const section of sections){
  if(rows.length>42){rows=[];pages.push(rows)}
  if(rows.length)rows.push({text:'',heading:false});
  for(const title of wrapReportLine(section.title,60))rows.push({text:title,heading:true});
  for(const line of section.lines)for(const text of wrapReportLine(line)){if(rows.length>=46){rows=[];pages.push(rows)}rows.push({text,heading:false})}
 }
 const escape=(s:string)=>s.replace(/\\/g,'\\\\').replace(/[()]/g,c=>'\\'+c);
 const objects:string[]=['<< /Type /Catalog /Pages 2 0 R >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'];
 const pageIds:number[]=[];
 pages.forEach((page,index)=>{
  const pageId=objects.length+1,streamId=pageId+1;pageIds.push(pageId);
  const header='BT /F2 10 Tf 0.04 0.39 0.46 rg 48 798 Td (DRAINAGEDOCTOR / ENGINEERING EVIDENCE) Tj ET';
  const body=page.map((r,i)=>`BT /${r.heading?'F2 12':'F1 9'} Tf 0.12 0.2 0.25 rg 48 ${764-i*15} Td (${escape(r.text)}) Tj ET`).join('\n');
  const stream=`${header}\n${body}\nBT /F1 9 Tf 48 32 Td (Page ${index+1} of ${pages.length} | Model evidence requires engineering review.) Tj ET`;
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamId} 0 R >>`,`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
 });
 objects[1]=`<< /Type /Pages /Kids [${pageIds.map(id=>id+' 0 R').join(' ')}] /Count ${pageIds.length} >>`;
 let pdf='%PDF-1.4\n';const offsets:number[]=[];
 objects.forEach((o,i)=>{offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${o}\nendobj\n`});
 const xref=pdf.length;pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.map(o=>String(o).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Root 1 0 R /Size ${objects.length+1} >>\nstartxref\n${xref}\n%%EOF\n`;
 return new TextEncoder().encode(pdf);
}
