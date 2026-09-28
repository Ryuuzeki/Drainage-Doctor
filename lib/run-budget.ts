export type RunType='baseline'|'autopsy'|'repair'|'stress';
export class BudgetExceeded extends Error { constructor(){super('Analysis reached the declared solver-run budget. Completed evidence remains available.');this.name='BudgetExceeded'} }
export class RunBudget {
 max:number;used=0;reserved:number;byType:Record<RunType,number>={baseline:0,autopsy:0,repair:0,stress:0};
 constructor(max:number,reserved=0){if(!Number.isInteger(max)||max<1||!Number.isInteger(reserved)||reserved<0)throw new Error('Invalid solver budget.');this.max=max;this.reserved=reserved}
 remaining(){return Math.max(0,this.max-this.used)}
 available(){return Math.max(0,this.remaining()-this.reserved)}
 consume(type:RunType){if(this.remaining()===0||((type==='autopsy'||type==='repair')&&this.available()===0))throw new BudgetExceeded();this.used++;this.byType[type]++;if(type==='stress')this.reserved=Math.max(0,this.reserved-1)}
}
