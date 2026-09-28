import type {AnalysisConfig,AnalysisEvidence} from './diagnostics';
export type AnalysisRecord={id:string;projectId:string;modelHash:string;baselineId:string;createdAt:string;status:'queued'|'running'|'completed'|'failed'|'cancelled';config:AnalysisConfig;progress?:string;error?:string;errorCode?:string;resultHash?:string;evidence?:AnalysisEvidence};
