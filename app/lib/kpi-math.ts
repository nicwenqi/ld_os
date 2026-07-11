import { departments } from "../data/departments.ts";
import { kpiDefinitions, kpiOverrides } from "../data/kpis.ts";
import type { PeriodType } from "../types/domain.ts";
import { getDepartmentBreadcrumb } from "./department-tree.ts";
export function calculateCompletion(actual:number,target:number){return target===0?0:Math.round(actual/target*1000)/10}
export function calculateGap(actual:number,target:number){return Math.round((actual-target)*100)/100}
export function resolveTarget(kpiId:string,departmentId:string,period:PeriodType){const key=period; const ancestors=getDepartmentBreadcrumb(departmentId,departments).reverse(); for(const dept of ancestors){const override=kpiOverrides.find((item)=>item.kpiId===kpiId&&item.departmentId===dept.id); const value=override?.[key]; if(value!==undefined)return value;} const definition=kpiDefinitions.find((item)=>item.id===kpiId); if(!definition)throw new Error(`Unknown KPI: ${kpiId}`); return period==="month"?definition.monthlyTarget:period==="quarter"?definition.quarterlyTarget:definition.yearlyTarget;}
export function calculateHealthScore(items:{completion:number;weight:number}[]){const total=items.reduce((sum,item)=>sum+item.weight,0); if(!total)return 0; return Math.round(items.reduce((sum,item)=>sum+Math.min(item.completion,100)*item.weight,0)/total*10)/10}
