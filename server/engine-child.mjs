import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(fs.readFileSync(new URL('./engine-manifest.json',import.meta.url),'utf8'));
process.once('message',async({input})=>{
 try{
  const source=fs.readFileSync(new URL('../public/vendor/swmmwasm-0.0.4.js',import.meta.url),'utf8');
  if(createHash('sha256').update(source).digest('hex')!==manifest.sha256)throw new Error('Pinned engine checksum mismatch.');
  // The WASM engine gets an in-memory filesystem, no host filesystem or network API.
  const scope={console:{log(){},error(){},warn(){}},WebAssembly,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,ArrayBuffer,TextDecoder,TextEncoder,atob,btoa,setTimeout,clearTimeout,performance,importScripts(){}};
  vm.createContext(scope);vm.runInContext(source,scope,{timeout:10000});
  const engine=await scope.createModule({print(){},printErr(){}});
  engine.FS.writeFile('/input.inp',input);
  const started=performance.now();
  const code=engine.ccall('swmm_run','number',['string','string','string'],['/input.inp','/report.rpt','/output.out']);
  const report=engine.FS.readFile('/report.rpt',{encoding:'utf8'});
  const bytes=code===0?engine.FS.readFile('/output.out'):new Uint8Array();
  if(bytes.length>64*1024*1024||report.length>3000000)throw new Error('Solver output exceeds the bounded artifact size.');
  process.send({code,report,output:Buffer.from(bytes).toString('base64'),elapsedMs:Math.round(performance.now()-started)},()=>process.exit(0));
 }catch(e){process.send({error:e.message},()=>process.exit(0))}
});
