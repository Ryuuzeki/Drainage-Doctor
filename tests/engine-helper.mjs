import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('public/vendor/swmmwasm-0.0.4.js','utf8');
export async function runEngine(input){
 const scope={console,WebAssembly,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,ArrayBuffer,TextDecoder,TextEncoder,atob,btoa,setTimeout,clearTimeout,performance,importScripts(){}};
 vm.createContext(scope);vm.runInContext(source,scope);
 const engine=await scope.createModule({print(){},printErr(){}});engine.FS.writeFile('/input.inp',input);
 const code=engine.ccall('swmm_run','number',['string','string','string'],['/input.inp','/report.rpt','/output.out']);
 return {code,report:engine.FS.readFile('/report.rpt',{encoding:'utf8'})};
}
