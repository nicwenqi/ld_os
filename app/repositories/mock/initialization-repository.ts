import type { InitializationRepository, SaveWizardStepInput } from "../contracts/initialization-repository.ts";
const propertyId = "20000000-0000-0000-0000-000000000011";
let state = { lastActiveStep: 1, steps: {}, version: 1, completedAt: null as string | null };
export function createMockInitializationRepository(): InitializationRepository { return {
  async getProgress(id) { return browserAvailable() ? requestOrLocalFallback(() => request(`?propertyId=${encodeURIComponent(id)}`), () => getLocalProgress(id)) : getLocalProgress(id); },
  async saveStep(input: SaveWizardStepInput) { return browserAvailable() ? requestOrLocalFallback(() => request("",input), () => saveLocalStep(input)) : saveLocalStep(input); },
  async complete(id,expectedVersion) { if (browserAvailable()) { await requestOrLocalFallback(() => request("",{propertyId:id,expectedVersion,action:"complete"}), () => completeLocally(id,expectedVersion)); return; } completeLocally(id,expectedVersion); },
}; }
function browserAvailable(){return typeof window!=="undefined"}
function getLocalProgress(id:string){if(id!==propertyId)throw new Error("未找到当前酒店初始化资料");return structuredClone(state)}
function saveLocalStep(input:SaveWizardStepInput){if(input.propertyId!==propertyId)throw new Error("无权修改其他酒店初始化资料");if(input.expectedVersion&&input.expectedVersion!==state.version)throw new Error("初始化进度已更新，请刷新后重试");state={...state,lastActiveStep:input.lastActiveStep,steps:{...state.steps,[input.stepKey]:{...state.steps[input.stepKey],explicitlyConfirmed:input.explicitlyConfirmed??state.steps[input.stepKey]?.explicitlyConfirmed,warning:input.warning??state.steps[input.stepKey]?.warning??null,blockingReason:input.blockingReason??state.steps[input.stepKey]?.blockingReason??null}},version:state.version+1};return structuredClone(state)}
function completeLocally(id:string,expectedVersion?:number){if(id!==propertyId)throw new Error("无权完成其他酒店初始化");if(expectedVersion&&expectedVersion!==state.version)throw new Error("初始化进度已更新，请刷新后重试");state={...state,completedAt:new Date().toISOString(),version:state.version+1}}
async function requestOrLocalFallback<T>(remote:()=>Promise<T>,fallback:()=>T){try{return await remote()}catch(error){if(error instanceof LocalOnlyEndpointUnavailable)return fallback();throw error}}
class LocalOnlyEndpointUnavailable extends Error{}
async function request(path:string,body?:unknown){const response=await fetch(`/api/mock-initialization-progress${path}`,body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:undefined);const payload=await response.json();if(!response.ok){if(response.status===404&&payload.message==="not found")throw new LocalOnlyEndpointUnavailable();throw new Error(payload.message??"无法保存本地初始化进度")}return payload}
