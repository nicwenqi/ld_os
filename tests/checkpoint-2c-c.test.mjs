import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createMockEmployeeRepository } from "../app/repositories/mock/employee-repository.ts";
import { createMockImportRepository } from "../app/repositories/mock/import-repository.ts";

test("employee repository preserves leading-zero identifiers and truthful master fields",async()=>{const repo=createMockEmployeeRepository();const employee=await repo.findByEmployeeNumber("synthetic-property-a1","0007");assert.equal(employee?.employeeNumber,"0007");assert.equal(employee?.departmentName,"房务部 › 前厅部 › 礼宾部");assert.ok(employee?.externalIdentifierTypes.includes("LMS"));});
test("import repository separates unresolved rows and excludes training history",async()=>{const repo=createMockImportRepository();const batch=(await repo.listImportHistory("synthetic-property-a1"))[0];assert.equal(batch.summary.unresolved,2);const sheets=await repo.listSheets(batch.id);assert.match(JSON.stringify(sheets),/不导入培训历史/);const issue=(await repo.listIssues(batch.id))[0];assert.equal(issue.rowNumber,27);assert.equal(issue.severity,"error");});
test("People Center states that training facts are not connected",async()=>{const source=await readFile(new URL("../app/people/page.tsx",import.meta.url),"utf8");assert.match(source,/培训数据尚未接入/);assert.doesNotMatch(source,/消防安全与应急响应/);});
test("Employee Data Update exposes real inspection and defers commit to Recovery C",async()=>{const source=await readFile(new URL("../app/import/page.tsx",import.meta.url),"utf8");for(const label of ["员工资料更新","文件检查","私有暂存区","员工更新尚未提交","更新记录","Recovery C"])assert.match(source,new RegExp(label));assert.match(source,/培训历史/);assert.doesNotMatch(source,/commitBatch|确认导入/);});
