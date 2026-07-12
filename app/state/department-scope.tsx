"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getDepartmentBreadcrumb, getDescendantIds } from "../lib/department-tree.ts";
import { departments } from "../data/departments.ts";
const ScopeContext=createContext<ReturnType<typeof useScopeValue>|null>(null);
const scopeStorageKey="hotel-ld-scope";
function useScopeValue(){const [departmentId,setDepartmentIdState]=useState("rooms");useEffect(()=>{const stored=localStorage.getItem(scopeStorageKey);if(stored&&departments.some(item=>item.id===stored))setDepartmentIdState(stored)},[]);const setDepartmentId=useCallback((next:string)=>{setDepartmentIdState(next);localStorage.setItem(scopeStorageKey,next)},[]);return useMemo(()=>({departmentId,setDepartmentId,descendantIds:getDescendantIds(departmentId),breadcrumb:getDepartmentBreadcrumb(departmentId)}),[departmentId,setDepartmentId]);}
export function DepartmentScopeProvider({children}:{children:React.ReactNode}){return <ScopeContext.Provider value={useScopeValue()}>{children}</ScopeContext.Provider>}
export function useDepartmentScope(){const value=useContext(ScopeContext);if(!value)throw new Error("useDepartmentScope must be used within DepartmentScopeProvider");return value}
