"use client";
import { PrototypeFeedbackProvider } from "./state/prototype-feedback";
import { AuthSessionProvider } from "./state/auth-session";
import { SessionGate } from "./components/auth/SessionGate";
export function AppProviders({children}:{children:React.ReactNode}){return <AuthSessionProvider><PrototypeFeedbackProvider>{children}</PrototypeFeedbackProvider></AuthSessionProvider>}
export function ProtectedAppProviders({children}:{children:React.ReactNode}){return <AppProviders><SessionGate>{children}</SessionGate></AppProviders>}
