import type { AuthSession } from "../../repositories/contracts/auth-repository.ts";

const sessions = new Map<string,{session:AuthSession;expiresAt:number}>();
const ttlMs = 12 * 60 * 60 * 1000;

export function createMockSession(session:AuthSession){prune();const token=crypto.randomUUID();sessions.set(token,{session:structuredClone(session),expiresAt:Date.now()+ttlMs});return token}
export function readMockSession(token:string|null){if(!token)return null;const record=sessions.get(token);if(!record||record.expiresAt<=Date.now()){if(record)sessions.delete(token);return null}return structuredClone(record.session)}
export function removeMockSession(token:string|null){if(token)sessions.delete(token)}
function prune(){for(const[token,record]of sessions)if(record.expiresAt<=Date.now())sessions.delete(token)}
