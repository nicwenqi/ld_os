import type { TrainingSession } from "../types/domain.ts";
import { courses, trainers } from "./courses.ts";
export const sessions: TrainingSession[] = Array.from({length:20},(_,i)=>({
  id:`session-${i+1}`,courseId:courses[i%courses.length].id,titleZh:courses[i%courses.length].nameZh,titleEn:courses[i%courses.length].nameEn,
  departmentIds:[i%3===0?"rooms":i%3===1?"fb":"hr"],trainerId:trainers[i%trainers.length].id,
  startAt:`2026-07-${String(2+i).padStart(2,"0")}T${String(9+(i%5)*2).padStart(2,"0")}:00:00+08:00`,endAt:`2026-07-${String(2+i).padStart(2,"0")}T${String(11+(i%5)*2).padStart(2,"0")}:00:00+08:00`,
  location:["三楼培训室","宴会厅 B","前厅会议室","员工学习中心"][i%4],capacity:16+(i%4)*8,status:["draft","published","notified","checkin","completed","feedback","closed"][i%7] as TrainingSession["status"],mandatory:courses[i%courses.length].mandatory,
}));
