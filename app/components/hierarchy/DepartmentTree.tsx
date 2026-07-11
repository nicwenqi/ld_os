"use client";
import { departments } from "../../data/departments";
import { buildDepartmentTree, type DepartmentNode } from "../../lib/department-tree";
function Branch({node,selectedId,onSelect}:{node:DepartmentNode;selectedId:string;onSelect:(id:string)=>void}){return <li><button className={`tree-item ${selectedId===node.id?"active":""}`} onClick={()=>onSelect(node.id)}><span className="tree-marker">{node.children.length?"＋":"·"}</span><span><strong>{node.nameZh}</strong><small>{node.nameEn}</small></span><em>{node.employeeCount}</em></button>{node.children.length>0&&<ul>{node.children.map((child)=><Branch key={child.id} node={child} selectedId={selectedId} onSelect={onSelect}/>)}</ul>}</li>}
export function DepartmentTree({selectedId,onSelect}:{selectedId:string;onSelect:(id:string)=>void}){return <ul className="department-tree">{buildDepartmentTree(departments).map((node)=><Branch key={node.id} node={node} selectedId={selectedId} onSelect={onSelect}/>)}</ul>}
