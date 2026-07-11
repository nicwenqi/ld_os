"use client";
import { createContext, useContext, useMemo, useState } from "react";
import { getDepartmentBreadcrumb, getDescendantIds } from "../lib/department-tree.ts";
const ScopeContext=createContext<ReturnType<typeof useScopeValue>|null>(null);
function useScopeValue(){const [departmentId,setDepartmentId]=useState("rooms");return useMemo(()=>({departmentId,setDepartmentId,descendantIds:getDescendantIds(departmentId),breadcrumb:getDepartmentBreadcrumb(departmentId)}),[departmentId]);}
export function DepartmentScopeProvider({children}:{children:React.ReactNode}){return <ScopeContext.Provider value={useScopeValue()}>{children}</ScopeContext.Provider>}
export function useDepartmentScope(){const value=useContext(ScopeContext);if(!value)throw new Error("useDepartmentScope must be used within DepartmentScopeProvider");return value}
