export type ErrorCode='INPUT_ERROR'|'HYDROLOGY_ERROR'|'SOLVER_ERROR'|'NUMERICAL_FAILURE'|'UNSUPPORTED_MODEL'|'TIMEOUT'|'SECURITY_ERROR'|'INTERNAL_ERROR';
export class DomainError extends Error{code:ErrorCode;constructor(code:ErrorCode,message:string){super(message);this.code=code;this.name='DomainError'}}
export function classifyError(error:unknown):ErrorCode{
 if(error instanceof DomainError)return error.code;
 const message=error instanceof Error?error.message:String(error);
 if(/unauthor|token|sandbox|security|checksum|hash mismatch|provenance/i.test(message))return 'SECURITY_ERROR';
 if(/timed? out|execution limit|time limit|cancelled|budget/i.test(message))return 'TIMEOUT';
 if(/rain|gage|infiltration|hydrolog|subcatchment/i.test(message))return 'HYDROLOGY_ERROR';
 if(/continuity|converg|numerical|non-finite/i.test(message))return 'NUMERICAL_FAILURE';
 if(/SWMM error|ERROR\s+\d+|worker exited|incomplete.*report|unrecognized.*report|solver.*(failed|error)/i.test(message))return 'SOLVER_ERROR';
 if(/unsupported|not supported|self-contained/i.test(message))return 'UNSUPPORTED_MODEL';
 if(/exceeds|invalid|missing|model|choose|required/i.test(message))return 'INPUT_ERROR';
 return 'INTERNAL_ERROR';
}
export function suggestedAction(code:string){return ({HYDROLOGY_ERROR:'Check rain-gage references, embedded time series and subcatchment infiltration parameters.',NUMERICAL_FAILURE:'Inspect continuity and convergence in the original SWMM report before comparing alternatives.',TIMEOUT:'Review partial evidence and retry with a smaller model or the detailed run budget.',SECURITY_ERROR:'Re-import the original model and verify the configured solver and artifact checksums.',UNSUPPORTED_MODEL:'Embed external data or choose a supported model configuration.',INPUT_ERROR:'Correct the named input parameter and run the baseline again.',SOLVER_ERROR:'Inspect the original SWMM report and correct the reported solver error.',INTERNAL_ERROR:'Retry the job and inspect the solver service log.'} as Record<string,string>)[code]??'Inspect the input and solver report.'}
