import type { Course, Trainer } from "../types/domain.ts";
export const courses: Course[] = [
  ["orientation","酒店文化与服务承诺","Hotel Culture & Service Promise","onboarding",true,2],
  ["fire","消防安全与应急响应","Fire Safety & Emergency Response","mandatory",true,2],
  ["privacy","宾客隐私与信息安全","Guest Privacy & Information Security","mandatory",true,1.5],
  ["luxury","奢华服务沟通","Luxury Service Communication","service",false,2],
  ["complaint","宾客投诉处理","Guest Complaint Recovery","service",false,2],
  ["upsell","前厅收益与升级销售","Front Office Upselling","commercial",false,1.5],
  ["hygiene","食品卫生与HACCP","Food Hygiene & HACCP","mandatory",true,2.5],
  ["leadership","一线主管领导力","Frontline Leadership","leadership",false,3],
  ["firstaid","急救基础","First Aid Essentials","mandatory",true,3],
  ["brand","品牌标准焕新","Brand Standards Refresh","service",true,2],
  ["trainer","部门培训员认证","Department Trainer Certification","trainer",false,4],
  ["sustainability","酒店可持续运营","Sustainable Hotel Operations","culture",false,1.5],
].map(([id,nameZh,nameEn,type,mandatory,durationHours]) => ({ id:String(id),nameZh:String(nameZh),nameEn:String(nameEn),type:String(type),mandatory:Boolean(mandatory),durationHours:Number(durationHours) }));
export const trainers: Trainer[] = Array.from({length:8},(_,i)=>({id:`trainer-${i+1}`,nameZh:["沈悦","唐宁","顾言","程曦","叶澜","方睿","陆遥","宋然"][i],nameEn:["Sherry Shen","Nina Tang","Ian Gu","Cici Cheng","Lana Ye","Ray Fang","Yao Lu","Ryan Song"][i],departmentIds:[i<3?"rooms":i<5?"fb":"hr"]}));
