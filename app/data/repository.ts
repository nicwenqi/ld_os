import { departments, positions } from "./departments.ts";
import { employees } from "./employees.ts";
import { courses, trainers } from "./courses.ts";
import { sessions } from "./sessions.ts";
import { kpiDefinitions, kpiOverrides } from "./kpis.ts";
import { risks } from "./risks.ts";
export const mockRepository = { departments, positions, employees, courses, trainers, sessions, kpiDefinitions, kpiOverrides, risks,
  department:(id:string)=>departments.find((item)=>item.id===id), employee:(id:string)=>employees.find((item)=>item.id===id), session:(id:string)=>sessions.find((item)=>item.id===id) } as const;
