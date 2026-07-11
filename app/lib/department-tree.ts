import { departments } from "../data/departments.ts";
import type { Department } from "../types/domain.ts";
export type DepartmentNode = Department & { children: DepartmentNode[] };
export function buildDepartmentTree(items=departments): DepartmentNode[] { const nodes=new Map(items.map((item)=>[item.id,{...item,children:[]} as DepartmentNode])); const roots:DepartmentNode[]=[]; for(const node of nodes.values()){if(node.parentId&&nodes.has(node.parentId))nodes.get(node.parentId)!.children.push(node);else roots.push(node)} return roots; }
export function getDescendantIds(id:string,items=departments):string[]{ const result:string[]=[]; const visit=(current:string)=>{result.push(current); items.filter((item)=>item.parentId===current).forEach((item)=>visit(item.id));}; visit(id); return result; }
export function isWithinScope(candidateId:string,scopeId:string){return getDescendantIds(scopeId).includes(candidateId)}
export function getDepartmentBreadcrumb(id:string,items=departments){ const result:Department[]=[]; let current=items.find((item)=>item.id===id); const seen=new Set<string>(); while(current&&!seen.has(current.id)){seen.add(current.id);result.unshift(current);current=current.parentId?items.find((item)=>item.id===current!.parentId):undefined} return result; }
export function getAncestors(id:string){return getDepartmentBreadcrumb(id).slice(0,-1)}
