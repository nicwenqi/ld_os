import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createMockEmployeeRepository } from "../app/repositories/mock/employee-repository.ts";
import { createMockImportRepository } from "../app/repositories/mock/import-repository.ts";

test("employee repository preserves leading-zero identifiers and truthful master fields",async()=>{const repo=createMockEmployeeRepository();const employee=await repo.findByEmployeeNumber("synthetic-property-a1","0007");assert.equal(employee?.employeeNumber,"0007");assert.equal(employee?.departmentName,"房务部 › 前厅部 › 礼宾部");assert.ok(employee?.externalIdentifierTypes.includes("LMS"));});
test("import repository separates unresolved rows and excludes training history",async()=>{const repo=createMockImportRepository();const batch=(await repo.listImportHistory("synthetic-property-a1"))[0];assert.equal(batch.summary.unresolved,2);const sheets=await repo.listSheets(batch.id);assert.match(JSON.stringify(sheets),/不导入培训历史/);const issue=(await repo.listIssues(batch.id))[0];assert.equal(issue.rowNumber,27);assert.equal(issue.severity,"error");});
test("People Center states that training facts are not connected",async()=>{const source=await readFile(new URL("../app/people/page.tsx",import.meta.url),"utf8");assert.match(source,/培训数据尚未接入/);assert.doesNotMatch(source,/消防安全与应急响应/);});
test("Import Center exposes the controlled production workflow",async()=>{const source=await readFile(new URL("../app/import/page.tsx",import.meta.url),"utf8");for(const label of ["上传文件","文件检查","工作表识别","字段映射","部门标签处理","职位标签处理","数据校验","变更预览","最终确认","导入结果","导入历史","回滚预览"])assert.match(source,new RegExp(label));assert.match(source,/培训历史.*不导入/);});
