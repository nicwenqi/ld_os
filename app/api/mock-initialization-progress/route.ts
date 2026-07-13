import type { SaveWizardStepInput } from "../../repositories/contracts/initialization-repository.ts";

const propertyId="20000000-0000-0000-0000-000000000011";
type State={lastActiveStep:number;steps:Record<string,{explicitlyConfirmed?:boolean;warning?:string|null;blockingReason?:string|null}>;version:number;completedAt:string|null};
let state:State={lastActiveStep:1,steps:{},version:1,completedAt:null};

export async function GET(request:Request){if(!isMock())return Response.json({message:"not found"},{status:404});const id=new URL(request.url).searchParams.get("propertyId");if(id!==propertyId)return Response.json({message:"未找到当前酒店初始化资料"},{status:404});return noStore(state)}
export async function POST(request:Request){if(!isMock())return Response.json({message:"not found"},{status:404});const body=await request.json() as SaveWizardStepInput&{action?:"complete"};if(body.propertyId!==propertyId)return Response.json({message:"无权修改其他酒店初始化资料"},{status:403});if(body.expectedVersion&&body.expectedVersion!==state.version)return Response.json({message:"初始化进度已更新，请刷新后重试"},{status:409});if(body.action==="complete")state={...state,completedAt:new Date().toISOString(),version:state.version+1};else state={...state,lastActiveStep:body.lastActiveStep,steps:{...state.steps,[body.stepKey]:{...state.steps[body.stepKey],explicitlyConfirmed:body.explicitlyConfirmed??state.steps[body.stepKey]?.explicitlyConfirmed,warning:body.warning??state.steps[body.stepKey]?.warning??null,blockingReason:body.blockingReason??state.steps[body.stepKey]?.blockingReason??null}},version:state.version+1};return noStore(state)}
function isMock(){return(process.env.APP_ENV??"local")==="local"&&(process.env.APP_DATA_MODE??"mock")==="mock"}
function noStore(value:unknown){return Response.json(value,{headers:{"Cache-Control":"no-store"}})}
