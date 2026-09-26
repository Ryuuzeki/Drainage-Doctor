/* Solver runs in an isolated Web Worker. No model files leave this origin. */
importScripts('/vendor/swmmwasm-0.0.4.js');
self.onmessage=async(event)=>{
 const started=performance.now();
 try{
  self.postMessage({type:'progress',stage:'Loading SWMM 5.2.2…'});
  const messages=[];
  const engine=await createModule({print:(m)=>{if(messages.length<100)messages.push(String(m))},printErr:(m)=>{if(messages.length<100)messages.push(String(m))}});
  engine.FS.writeFile('/input.inp',new Uint8Array(event.data.bytes));
  self.postMessage({type:'progress',stage:'Running deterministic hydraulic simulation…'});
  const code=engine.ccall('swmm_run','number',['string','string','string'],['/input.inp','/report.rpt','/output.out']);
  const report=engine.FS.readFile('/report.rpt',{encoding:'utf8'});
  self.postMessage({type:'result',code,report,elapsedMs:Math.round(performance.now()-started),messages});
 }catch(error){self.postMessage({type:'error',error:error instanceof Error?error.message:String(error),elapsedMs:Math.round(performance.now()-started)});}
 self.close();
};
