import {randomBytes} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
const exists=async file=>{try{return await readFile(file,'utf8')}catch(e){if(e.code==='ENOENT')return null;throw e}};
const solver=await exists('.env.solver'),vars=await exists('.dev.vars');
if(solver||vars){console.log('Local configuration already exists. Preserve it and check SOLVER_URL / SOLVER_TOKEN in both files.');}
else{
 const token=randomBytes(32).toString('hex');
 await writeFile('.env.solver',`SOLVER_TOKEN=${token}\nSOLVER_PORT=8788\n`,{flag:'wx'});
 await writeFile('.dev.vars',`SOLVER_URL=http://127.0.0.1:8788\nSOLVER_TOKEN=${token}\n`,{flag:'wx'});
 console.log('Created ignored local solver configuration. Next: npm run db:migrate, npm run solver, and npm run dev.');
}
