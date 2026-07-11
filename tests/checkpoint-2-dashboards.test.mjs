import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("organization dashboard supports hierarchy-led management questions", async () => {
  const page = await read("../app/organization/page.tsx");
  for (const token of ["部门下钻","哪个部门落后","departmentId","部门健康度对比","员工培训状态","下一步建议"]) assert.match(page,new RegExp(token));
});

test("course effectiveness dashboard is analytical and actionable", async () => {
  const page = await read("../app/effectiveness/page.tsx");
  for (const token of ["哪门课程需要关注","成效矩阵","满意度趋势","反馈回收率","课程投入产出","departmentId"]) assert.match(page,new RegExp(token));
});

test("risk dashboard separates operational accountability", async () => {
  const page = await read("../app/risk/page.tsx");
  for (const token of ["哪项风险需要立即行动","严重程度","负责人","到期日","影响人数","下一步行动","departmentId"]) assert.match(page,new RegExp(token));
});

test("shell links to all checkpoint 2 dashboards", async () => {
  const shell = await read("../app/components/shell/AppShell.tsx");
  for (const href of ["/organization","/effectiveness","/risk"]) assert.match(shell,new RegExp(`href:\"${href}`));
});
