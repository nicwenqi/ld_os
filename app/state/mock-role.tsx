"use client";
import { createContext,useContext,useState } from "react";
export type MockRole="ld_manager"|"department_admin";
const RoleContext=createContext<{role:MockRole;setRole:(role:MockRole)=>void}|null>(null);
export function MockRoleProvider({children}:{children:React.ReactNode}){const[role,setRole]=useState<MockRole>("ld_manager");return <RoleContext.Provider value={{role,setRole}}>{children}</RoleContext.Provider>}
export function useMockRole(){const value=useContext(RoleContext);if(!value)throw new Error("useMockRole must be used within MockRoleProvider");return value}
