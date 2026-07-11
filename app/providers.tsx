"use client";
import { DepartmentScopeProvider } from "./state/department-scope";
import { MockRoleProvider } from "./state/mock-role";
import { PrototypeFeedbackProvider } from "./state/prototype-feedback";
export function AppProviders({children}:{children:React.ReactNode}){return <MockRoleProvider><DepartmentScopeProvider><PrototypeFeedbackProvider>{children}</PrototypeFeedbackProvider></DepartmentScopeProvider></MockRoleProvider>}
