import type { KpiDefinition, KpiOverride } from "../types/domain.ts";
export const kpiDefinitions: KpiDefinition[] = [
  ["hours","人均培训小时","Avg. Training Hours","培训总小时 ÷ 在岗员工人数","小时",4,12,48,90,75,18],
  ["mandatory","必修培训覆盖率","Mandatory Coverage","完成必修培训人数 ÷ 应完成人数","%",95,96,98,90,82,18],
  ["newhire","新员工完成率","New Hire Completion","按期完成入职培训人数 ÷ 新员工人数","%",92,94,96,86,78,14],
  ["plan","培训计划完成率","Plan Completion","已完成场次 ÷ 计划场次","%",90,92,94,85,75,14],
  ["attendance","出席率","Attendance Rate","实际出席人数 ÷ 应出席人数","%",90,91,92,84,75,12],
  ["feedback","反馈回收率","Feedback Response","已提交反馈人数 ÷ 实际出席人数","%",80,82,85,72,60,8],
  ["satisfaction","平均满意度","Avg. Satisfaction","有效反馈满意度平均分","分",4.5,4.5,4.6,4.2,3.8,8],
  ["trainer","部门培训员覆盖率","Trainer Coverage","已配置培训员部门 ÷ 全部部门","%",85,88,90,78,65,8],
].map(([id,nameZh,nameEn,formulaZh,unit,monthlyTarget,quarterlyTarget,yearlyTarget,warning,critical,weight])=>({id:String(id),nameZh:String(nameZh),nameEn:String(nameEn),formulaZh:String(formulaZh),unit:String(unit),monthlyTarget:Number(monthlyTarget),quarterlyTarget:Number(quarterlyTarget),yearlyTarget:Number(yearlyTarget),warning:Number(warning),critical:Number(critical),weight:Number(weight),active:true}));
export const kpiOverrides: KpiOverride[] = [{kpiId:"hours",departmentId:"front-office",month:4.5,quarter:13.5,year:52},{kpiId:"mandatory",departmentId:"rooms",month:97}];
