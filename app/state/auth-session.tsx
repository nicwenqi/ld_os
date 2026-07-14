"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createHttpAuthRepository } from "../repositories/http/auth-repository.ts";
import { anonymousSession, type AuthSession, type LoginInput } from "../repositories/contracts/auth-repository.ts";

type AuthState={session:AuthSession;status:"loading"|"authenticated"|"anonymous";login:(input:LoginInput)=>Promise<AuthSession>;logout:()=>Promise<void>;refresh:()=>Promise<AuthSession>};
const AuthContext=createContext<AuthState|null>(null);

export function AuthSessionProvider({children}:{children:React.ReactNode}){
  const repository=useMemo(()=>createHttpAuthRepository(),[]);const[session,setSession]=useState<AuthSession>(anonymousSession);const[status,setStatus]=useState<AuthState["status"]>("loading");
  const refresh=useCallback(async()=>{const next=await repository.getSession();setSession(next);setStatus(next.authenticated?"authenticated":"anonymous");return next},[repository]);
  useEffect(()=>{let active=true;repository.getSession().then(next=>{if(!active)return;setSession(next);setStatus(next.authenticated?"authenticated":"anonymous")}).catch(()=>{if(active)setStatus("anonymous")});return()=>{active=false}},[repository]);
  const login=useCallback(async(input:LoginInput)=>{const next=await repository.login(input);setSession(next);setStatus("authenticated");return next},[repository]);
  const logout=useCallback(async()=>{await repository.logout();setSession(anonymousSession);setStatus("anonymous")},[repository]);
  return <AuthContext.Provider value={{session,status,login,logout,refresh}}>{children}</AuthContext.Provider>;
}
export function useAuthSession(){const value=useContext(AuthContext);if(!value)throw new Error("useAuthSession must be used within AuthSessionProvider");return value}
