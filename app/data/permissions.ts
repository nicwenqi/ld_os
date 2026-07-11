export const roles = [
  {id:"ld_manager",nameZh:"学习与发展经理",nameEn:"L&D Manager",scopeIds:[],permissions:["all"]},
  {id:"department_admin",nameZh:"部门培训管理员",nameEn:"Department Training Admin",scopeIds:["front-office"],permissions:["people:view","session:manage","attendance:manage","feedback:manage"]},
];
export const accounts = [{id:"account-1",employeeId:"employee-1",roleId:"ld_manager",status:"active"},{id:"account-2",employeeId:"employee-7",roleId:"department_admin",status:"active"}];
