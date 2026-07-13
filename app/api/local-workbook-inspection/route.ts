import { inspectEmployeeMasterAggregate } from "../../services/import/workbook-parser.ts";

export async function POST(request: Request) {
  if ((process.env.APP_ENV ?? "local") !== "local" || (process.env.APP_DATA_MODE ?? "mock") !== "mock") return Response.json({ message:"本地工作簿检查只在本机 mock 模式可用" },{ status:404 });
  const form=await request.formData();const file=form.get("file");
  if(!(file instanceof File))return Response.json({message:"请选择工作簿"},{status:400});
  try{
    const result=inspectEmployeeMasterAggregate({fileName:file.name,mimeType:file.type||mimeFor(file.name),bytes:new Uint8Array(await file.arrayBuffer())});
    return Response.json(result,{headers:{"Cache-Control":"no-store"}});
  }catch(error){return Response.json({message:error instanceof Error?error.message:"工作簿检查失败"},{status:422,headers:{"Cache-Control":"no-store"}})}
}
function mimeFor(name:string){const extension=name.split(".").at(-1)?.toLowerCase();return extension==="xls"?"application/vnd.ms-excel":extension==="xlsx"?"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":"text/csv"}
