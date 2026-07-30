import type { SaveWizardStepInput } from "../../repositories/contracts/initialization-repository.ts";
import { parseAppEnvironment } from "../../lib/environment.ts";
import { requireLocalReviewManager } from "../../services/local-review-authorization.ts";
import { AuthorizationError } from "../../services/production-authorization.ts";

const propertyId="20000000-0000-0000-0000-000000000011";
type State={lastActiveStep:number;steps:Record<string,{explicitlyConfirmed?:boolean;warning?:string|null;blockingReason?:string|null}>;version:number;completedAt:string|null};
let state:State={lastActiveStep:1,steps:{},version:1,completedAt:null};
function responseState(){return {...state,state:state.completedAt?"ready" as const:"in_progress" as const}}

export async function GET(request:Request){if(!isMock())return Response.json({message:"not found"},{status:404});try{requireLocalReviewManager(request);const id=new URL(request.url).searchParams.get("propertyId");if(id!==propertyId)return Response.json({message:"未找到当前酒店启用资料"},{status:404});return noStore(responseState())}catch(error){return authFailure(error)}}
export async function POST(request:Request){if(!isMock())return Response.json({message:"not found"},{status:404});try{requireLocalReviewManager(request);const body=await request.json() as SaveWizardStepInput&{action?:"complete"|"navigate"};if(body.propertyId!==propertyId)return Response.json({message:"无权修改其他酒店启用资料"},{status:403});if(body.expectedVersion&&body.expectedVersion!==state.version)return Response.json({message:"酒店启用资料已更新，请刷新后重试"},{status:409});if(body.action==="complete")state={...state,completedAt:new Date().toISOString(),version:state.version+1};else if(body.action==="navigate")state={...state,lastActiveStep:body.lastActiveStep,version:state.version+1};else state={...state,lastActiveStep:body.lastActiveStep,steps:{...state.steps,[body.stepKey]:{...state.steps[body.stepKey],explicitlyConfirmed:body.explicitlyConfirmed??state.steps[body.stepKey]?.explicitlyConfirmed,warning:body.warning??state.steps[body.stepKey]?.warning??null,blockingReason:body.blockingReason??state.steps[body.stepKey]?.blockingReason??null}},version:state.version+1};return noStore(responseState())}catch(error){return authFailure(error)}}
function isMock(){try{const environment=parseAppEnvironment();return environment.appEnv==="local"&&environment.dataMode==="mock"}catch{return false}}
function noStore(value:unknown){return Response.json(value,{headers:{"Cache-Control":"no-store"}})}
function authFailure(error:unknown){return error instanceof AuthorizationError?Response.json({message:error.message},{status:error.status,headers:{"Cache-Control":"no-store"}}):Response.json({message:"访问被拒绝"},{status:403,headers:{"Cache-Control":"no-store"}})}
