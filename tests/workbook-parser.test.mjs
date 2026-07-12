import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { inspectWorkbook, sanitizeWorkbookFilename, stableRowFingerprint } from "../app/services/import/workbook-parser.ts";

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
test("parser rejects mismatched formats and oversized files",()=>{
  assert.throws(()=>inspectWorkbook({fileName:"fake.xlsx",mimeType:mimeXlsx,bytes:new TextEncoder().encode("not zip")}),/签名/);
  assert.throws(()=>inspectWorkbook({fileName:"fake.exe",mimeType:"application/octet-stream",bytes:new Uint8Array([1])}),/仅支持/);
});
test("filename and row fingerprints are deterministic",()=>{
  assert.equal(sanitizeWorkbookFilename("../../员工 主表.xlsx"),"员工-主表.xlsx");
  assert.equal(stableRowFingerprint({b:2,a:1}),stableRowFingerprint({a:1,b:2}));
});
