import type { Employee } from "../types/domain.ts";
import { departments } from "./departments.ts";

const surnames = ["陈","林","王","李","张","赵","周","吴","徐","孙"];
const given = ["雅婷","子轩","欣怡","晨曦","嘉豪","雨桐","思远","可欣"];
const english = ["Amy","Leo","Chloe","Ethan","Mia","Jason","Ivy","Kevin"];
const leafDepartments = departments.filter((item) => !departments.some((child) => child.parentId === item.id));
export const employees: Employee[] = Array.from({ length: 88 }, (_, index) => {
  const department = leafDepartments[index % leafDepartments.length];
  return {
    id: `employee-${index + 1}`,
    employeeId: `${department.id.slice(0,2).toUpperCase()}-${String(1801 + index).padStart(4,"0")}`,
    nameZh: `${surnames[index % surnames.length]}${given[index % given.length]}`,
    nameEn: english[index % english.length], departmentId: department.id,
    positionId: index % 11 === 0 ? "manager" : index % 5 === 0 ? "supervisor" : index % 7 === 0 ? "trainer" : "associate",
    hireDate: `202${3 + (index % 4)}-${String((index % 12) + 1).padStart(2,"0")}-12`, newEmployee: index % 8 === 0,
    active: index % 29 !== 0, completion: 62 + (index * 7) % 39, riskTags: index % 9 === 0 ? ["必修课逾期"] : index % 13 === 0 ? ["新员工进度"] : [],
  };
});
for (const department of departments) department.employeeCount = employees.filter((e) => e.departmentId === department.id || e.departmentId && departments.find((d) => d.id === e.departmentId)?.path.includes(department.id)).length;
