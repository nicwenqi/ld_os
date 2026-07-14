"use client";
import { DepartmentScopeProvider } from "./state/department-scope";
import { PrototypeFeedbackProvider } from "./state/prototype-feedback";
import { AuthSessionProvider } from "./state/auth-session";
export function AppProviders({children}:{children:React.ReactNode}){return <AuthSessionProvider><DepartmentScopeProvider><PrototypeFeedbackProvider>{children}</PrototypeFeedbackProvider></DepartmentScopeProvider></AuthSessionProvider>}
