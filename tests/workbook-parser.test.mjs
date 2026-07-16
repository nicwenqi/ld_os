import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { MAX_IMPORT_BYTES, inspectEmployeeMasterAggregate, inspectWorkbook, sanitizeWorkbookFilename, stableRowFingerprint } from "../app/services/import/workbook-parser.ts";

const mimeXlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
function syntheticWorkbook(bookType="xlsx") {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([["Synthetic employee master"],[],["Employee Number","Chinese Name","English Name","Department","Position","Hire Date","CTC Completion","Gender"],["0007","示例员工甲","Synthetic Associate A","Concierge","Guest Service Associate",new Date("2026-06-01"),1,"X"]]);
  sheet.G4 = { t:"n", f:"1+0", v:1 }; sheet["!merges"]=[XLSX.utils.decode_range("A1:B1")]; sheet["!rows"]=[{hidden:true}]; sheet["!cols"]=[null,{hidden:true}];
  XLSX.utils.book_append_sheet(workbook,sheet,"Employee Master");
  const hidden=XLSX.utils.aoa_to_sheet([["Notes"]]); XLSX.utils.book_append_sheet(workbook,hidden,"Hidden Notes"); workbook.Workbook={Sheets:[{}, {Hidden:1}]};
  return new Uint8Array(XLSX.write(workbook,{type:"array",bookType}));
}

test("XLSX inspection detects sheets, blank leading rows, formulas, merges and hidden structures",()=>{
  const result=inspectWorkbook({fileName:"../synthetic employees.xlsx",mimeType:mimeXlsx,bytes:syntheticWorkbook()});
  assert.equal(result.sanitizedFilename,"synthetic-employees.xlsx"); assert.equal(result.sheets.length,2);
  assert.equal(result.sheets[0].likelyHeaderRow,3); assert.equal(result.sheets[0].mergedCellCount,1); assert.equal(result.sheets[1].hidden,true);
  assert.ok(result.sheets[0].formulaColumns.includes("CTC Completion"));
  assert.equal(result.sheets[0].suggestedMappings.find(x=>x.sourceColumn==="Employee Number")?.targetField,"employee_number");
  assert.equal(result.sheets[0].suggestedMappings.find(x=>x.sourceColumn==="CTC Completion")?.excluded,true);
  assert.equal(result.sheets[0].suggestedMappings.find(x=>x.sourceColumn==="Gender")?.excluded,true);
});
test("XLS and CSV are inspected while employee numbers remain strings",()=>{
  const xls=inspectWorkbook({fileName:"synthetic.xls",mimeType:"application/vnd.ms-excel",bytes:syntheticWorkbook("biff8")}); assert.equal(xls.extension,"xls");
  const csv=new TextEncoder().encode("Employee Number,Chinese Name,Department,Position\n0007,示例员工甲,Concierge,Associate\n");
  const result=inspectWorkbook({fileName:"synthetic.csv",mimeType:"text/csv",bytes:csv}); assert.equal(result.sheets[0].likelyHeaderRow,1); assert.equal(result.sheets[0].rowCount,2);
});
test("legacy abbreviated employee-master headers map without using workbook-specific data",()=>{
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([["Workbook title"], [], ["Empid", "CName", "EName", "Department", "Position", "JoinDate", "Probation"], ["0007", "示例员工甲", "Synthetic Associate A", "Synthetic Department", "Synthetic Position", new Date("2026-06-01"), new Date("2026-09-01")]]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Legacy Master");
  const bytes = new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "biff8" }));
  const result = inspectWorkbook({fileName:"legacy.xls",mimeType:"application/vnd.ms-excel",bytes});
  const mappings = Object.fromEntries(result.sheets[0].suggestedMappings.map(item => [item.sourceColumn, item.targetField]));
  assert.equal(result.sheets[0].likelyHeaderRow, 3);
  assert.equal(mappings.Empid, "employee_number");
  assert.equal(mappings.CName, "name_zh");
  assert.equal(mappings.EName, "name_en");
  assert.equal(mappings.JoinDate, "hire_date");
});
test("course-history-style columns are excluded from employee master mapping",()=>{
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([["Employee Number", "Hotel Orientation", "Onboarding Checklist", "Leadership Journey", "First Aid"], ["0007", "Completed", "Completed", "Assigned", "Completed"]]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Employee Master");
  const bytes = new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
  const result = inspectWorkbook({fileName:"history.xlsx",mimeType:mimeXlsx,bytes});
  const excluded = Object.fromEntries(result.sheets[0].suggestedMappings.map(item => [item.sourceColumn, item.excluded]));
  assert.equal(excluded["Hotel Orientation"], true);
  assert.equal(excluded["Onboarding Checklist"], true);
  assert.equal(excluded["Leadership Journey"], true);
  assert.equal(excluded["First Aid"], true);
});
test("parser rejects mismatched formats",()=>{
  assert.throws(()=>inspectWorkbook({fileName:"fake.xlsx",mimeType:mimeXlsx,bytes:new TextEncoder().encode("not zip")}),/签名/);
  assert.throws(()=>inspectWorkbook({fileName:"fake.exe",mimeType:"application/octet-stream",bytes:new Uint8Array([1])}),/仅支持/);
});
test("parser rejects an actual payload larger than 25 MB before workbook parsing",()=>{
  assert.throws(
    ()=>inspectWorkbook({fileName:"oversized.xlsx",mimeType:mimeXlsx,bytes:new Uint8Array(MAX_IMPORT_BYTES+1)}),
    /1 字节与 25 MB/,
  );
});
test("CSV extension and MIME type must align",()=>{
  const csv=new TextEncoder().encode("Employee Number,Chinese Name,Department,Position\n0007,示例员工甲,Concierge,Associate\n");
  for(const mimeType of ["text/csv","application/csv","text/plain"]){
    assert.equal(inspectWorkbook({fileName:"synthetic.csv",mimeType,bytes:csv}).extension,"csv");
  }
  assert.throws(
    ()=>inspectWorkbook({fileName:"synthetic.csv",mimeType:mimeXlsx,bytes:csv}),
    /MIME 类型不一致/,
  );
});
test("filename and row fingerprints are deterministic",()=>{
  assert.equal(sanitizeWorkbookFilename("../../员工 主表.xlsx"),"员工-主表.xlsx");
  assert.equal(stableRowFingerprint({b:2,a:1}),stableRowFingerprint({a:1,b:2}));
});
test("employee master aggregate treats absent and whitespace-only departments as missing without exposing rows",()=>{
  const workbook=XLSX.utils.book_new();
  const sheet=XLSX.utils.aoa_to_sheet([["Synthetic workbook"],[],["Empid","CName","EName","Department","Position","JoinDate","Probation"],["0007","示例员工甲","Synthetic A",undefined,"Associate",new Date("2026-01-01"),new Date("2026-04-01")],["0008","示例员工乙","Synthetic B","   ","Associate",new Date("2026-01-02"),new Date("2026-04-02")],["0009","示例员工丙","Synthetic C","Front Office","Associate",new Date("2026-01-03"),new Date("2026-04-03")]]);
  XLSX.utils.book_append_sheet(workbook,sheet,"Employee Master");
  const bytes=new Uint8Array(XLSX.write(workbook,{type:"array",bookType:"biff8"}));
  const result=inspectEmployeeMasterAggregate({fileName:"synthetic.xls",mimeType:"application/vnd.ms-excel",bytes});
  assert.equal(result.employeeMaster.sourceRows,3);
  assert.equal(result.employeeMaster.missingDepartments,2);
  assert.equal(result.employeeMaster.structurallyValid,1);
  assert.equal(result.employeeMaster.leadingZeroPreserved,true);
  assert.equal(result.mapping.uniqueDepartmentLabels,1);
  assert.equal(result.mapping.uniquePositionLabels,1);
  assert.equal(JSON.stringify(result).includes("0007"),false);
  assert.equal(JSON.stringify(result).includes("示例员工甲"),false);
});
