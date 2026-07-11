import type { Department, Position } from "../types/domain.ts";

export const departments: Department[] = [
  ["rooms","房务部","Rooms",null,1],["front-office","前厅部","Front Office","rooms",2],["concierge","礼宾部","Concierge","front-office",3],["front-desk","前台","Front Desk","front-office",3],["guest-relations","宾客关系","Guest Relations","front-office",3],["housekeeping","客房部","Housekeeping","rooms",2],["room-attendant","客房服务","Room Attendant","housekeeping",3],["public-area","公共区域","Public Area","housekeeping",3],["laundry","洗衣房","Laundry","housekeeping",3],
  ["fb","餐饮部","Food & Beverage",null,1],["restaurants","餐厅运营","Restaurants","fb",2],["banquet","宴会服务","Banquet","fb",2],["kitchen","厨房","Culinary","fb",2],
  ["sales","市场销售部","Sales & Marketing",null,1],["revenue","收益管理","Revenue","sales",2],["marcom","市场传讯","Marketing Communications","sales",2],
  ["finance","财务部","Finance",null,1],["purchasing","采购部","Purchasing","finance",2],
  ["hr","人力资源部","Human Resources",null,1],["learning","学习与发展","Learning & Development","hr",2],
  ["engineering","工程部","Engineering",null,1],["security","保安部","Security",null,1],
].map(([id,nameZh,nameEn,parentId,level]) => ({ id: String(id), nameZh: String(nameZh), nameEn: String(nameEn), parentId: parentId ? String(parentId) : null, level: Number(level), path: [], employeeCount: 0, active: true }));

for (const department of departments) {
  const path: string[] = [department.id]; let parentId = department.parentId;
  while (parentId) { path.unshift(parentId); parentId = departments.find((item) => item.id === parentId)?.parentId ?? null; }
  department.path = path;
}
const displayCounts:Record<string,number>={rooms:32,"front-office":18,concierge:6,"front-desk":8,"guest-relations":4,housekeeping:14,"room-attendant":8,"public-area":4,laundry:2,fb:24,restaurants:10,banquet:8,kitchen:6,sales:9,revenue:3,marcom:3,finance:8,purchasing:4,hr:7,learning:3,engineering:10,security:9};
for(const department of departments) department.employeeCount=displayCounts[department.id]??department.employeeCount;

export const positions: Position[] = [
  { id: "manager", nameZh: "部门经理", nameEn: "Department Manager", departmentIds: departments.map((d) => d.id) },
  { id: "supervisor", nameZh: "主管", nameEn: "Supervisor", departmentIds: departments.map((d) => d.id) },
  { id: "associate", nameZh: "服务专员", nameEn: "Service Associate", departmentIds: departments.map((d) => d.id) },
  { id: "trainer", nameZh: "部门培训员", nameEn: "Department Trainer", departmentIds: departments.map((d) => d.id) },
];
