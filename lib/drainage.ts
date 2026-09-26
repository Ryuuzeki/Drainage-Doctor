export type Project = { id:string; name:string; location:string; createdAt:string; demo?:boolean; selected?:string; comments?:{text:string;date:string}[]; model?:Model };
export type Model = { filename:string; hash:string; nodes:number; conduits:number; units:string; warnings:string[]; coordinates:{id:string;x:number;y:number}[]; links:{id:string;from:string;to:string}[] };
export const sample:Project={id:'riverside-demo',name:'Riverside Business Park',location:'Bandung, Indonesia',createdAt:'2026-09-24T09:00:00Z',demo:true};
export const hotspots=[{id:'J-014',name:'North parking area',depth:.42,volume:186.4,duration:38,severity:'Critical',x:425,y:230},{id:'J-021',name:'East access road',depth:.28,volume:92.6,duration:24,severity:'High',x:640,y:310},{id:'J-008',name:'Loading bay',depth:.18,volume:41.8,duration:16,severity:'Moderate',x:252,y:345}];
export const candidates=[
 {id:'INT-01',name:'Add a parallel inlet',type:'Inlet capacity',change:'J-014: equivalent inlet area 0.24 → 0.48 m²',depth:.134,volume:59.6,duration:12,reduction:68,burden:'1 element',score:92,downstream:'+0.0%',detail:'Increase local capture capacity at the north parking area.'},
 {id:'INT-02',name:'Add local detention',type:'Storage',change:'J-014: additional conceptual storage 120 m³',depth:.185,volume:82,duration:17,reduction:56,burden:'120 m³ storage',score:78,downstream:'−8.2%',detail:'Provide temporary storage upstream of the hotspot.'},
 {id:'INT-03',name:'Upsize downstream conduit',type:'Conduit capacity',change:'C-018: diameter 450 → 600 mm · length 85 m',depth:.403,volume:179,duration:36,reduction:4,burden:'85 m of pipe',score:34,downstream:'+6.1%',detail:'Test additional conveyance capacity downstream.'}
];
export const experiments=[{name:'Inlet capture limitation',effect:68,change:'Equivalent inlet capacity ×2'},{name:'Insufficient local storage',effect:56,change:'Add 120 m³ of storage'},{name:'High runoff contribution',effect:21,change:'Impervious area −15%'},{name:'Downstream restriction',effect:9,change:'Tailwater level −0.20 m'},{name:'Conduit capacity limitation',effect:4,change:'Conduit diameter 450 → 600 mm'}];
export function stressRows(id:string){const index=candidates.findIndex(c=>c.id===id);const values=[[.08,.134,.148,.319],[.11,.185,.255,.439],[.202,.403,.557,.958]][index];return ['2-year','10-year','25-year','100-year'].map((s,i)=>[s,[.21,.42,.58,.86][i],values[i],values[i]<=.15?'Within threshold':'Exceeds threshold']);}
export function parseInp(text:string){
 const sections:Record<string,string[][]>={};let section='';
 for(const raw of text.split(/\r?\n/)){const line=raw.split(';')[0].trim();if(!line)continue;if(/^\[.+\]$/.test(line)){section=line.slice(1,-1).toUpperCase();sections[section]??=[];}else if(section)sections[section].push(line.split(/\s+/));}
 const j=sections.JUNCTIONS??[],o=sections.OUTFALLS??[],c=sections.CONDUITS??[];
 if(!j.length||!o.length||!c.length)throw new Error('Model requires JUNCTIONS, CONDUITS, and OUTFALLS sections.');
 const nodes=[...j,...o,...(sections.STORAGE??[]),...(sections.DIVIDERS??[])];const ids=new Set(nodes.map(r=>r[0]));
 if(ids.size!==nodes.length)throw new Error('Duplicate node IDs found.');
 if(new Set(c.map(r=>r[0])).size!==c.length)throw new Error('Duplicate conduit IDs found.');
 for(const r of j)if(r.length<3||!Number.isFinite(Number(r[1]))||!Number.isFinite(Number(r[2]))||Number(r[2])<=0)throw new Error(`Invalid elevation or maximum depth at ${r[0]}.`);
 for(const r of c){if(r.length<5||!ids.has(r[1])||!ids.has(r[2]))throw new Error(`Conduit ${r[0]} has missing nodes or incomplete data.`);if(!Number.isFinite(Number(r[3]))||Number(r[3])<=0||!Number.isFinite(Number(r[4]))||Number(r[4])<=0)throw new Error(`Conduit ${r[0]} requires positive length and roughness.`);}
 const units=sections.OPTIONS?.find(r=>r[0].toUpperCase()==='FLOW_UNITS')?.[1]?.toUpperCase();if(!units||!['CFS','GPM','MGD','CMS','LPS','MLD'].includes(units))throw new Error('Set valid FLOW_UNITS in [OPTIONS]. Units are never inferred.');
 const warnings=['Structural screening only. Full SWMM validation has not run.'];if(!sections.RAINGAGES?.length)warnings.push('No rain gages found. Rainfall inputs need review.');if(!sections.COORDINATES?.length)warnings.push('No coordinates found. A schematic layout will be used.');
 const interpreted=new Set(['TITLE','OPTIONS','JUNCTIONS','OUTFALLS','STORAGE','DIVIDERS','CONDUITS','COORDINATES','RAINGAGES']);const retained=Object.keys(sections).filter(s=>!interpreted.has(s));if(retained.length)warnings.push(`Preserved in original file, not interpreted: ${retained.join(', ')}.`);
 const coordinates=(sections.COORDINATES??[]).filter(r=>ids.has(r[0])&&Number.isFinite(Number(r[1]))&&Number.isFinite(Number(r[2]))).map(r=>({id:r[0],x:Number(r[1]),y:Number(r[2])}));
 return {nodes:ids.size,conduits:c.length,units,warnings,coordinates,links:c.map(r=>({id:r[0],from:r[1],to:r[2]}))};
}
