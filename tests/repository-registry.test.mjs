import assert from "node:assert/strict";
import test from "node:test";
import { dataSourceForModule } from "../app/repositories/registry.ts";

test("training operation modules are unavailable until repositories exist",()=>{
  for (const mode of ["mock","hybrid","supabase"]) {
    for (const moduleName of ["executive-dashboard","organization-dashboard","calendar","sessions","qr-check-in","qr-feedback","risk","course-effectiveness","kpi"]) {
      assert.equal(dataSourceForModule(moduleName,mode),"unavailable",`${mode}: ${moduleName}`);
    }
  }
});

test("local foundation modules use clearly labelled mock repositories",()=>{
  for (const moduleName of ["hotel-settings","organization-management","position-management","people","import"]) assert.equal(dataSourceForModule(moduleName,"mock"),"mock");
});

test("hybrid and Supabase modes use real repositories only for validated foundations",()=>{
  for (const mode of ["hybrid","supabase"]) {
    for (const moduleName of ["hotel-settings","organization-management","position-management","people","import"]) assert.equal(dataSourceForModule(moduleName,mode),"supabase");
  }
});
