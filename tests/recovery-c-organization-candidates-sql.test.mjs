import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migrationPath = "supabase/migrations/20260803120000_recovery_c_organization_candidate_initialization.sql";

test("organization candidate migration keeps candidates separate from employee facts and does not create a grade-level taxonomy", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.match(sql, /create table public\.import_organization_candidates/i);
  assert.match(sql, /create table public\.import_employee_attribution_candidates/i);
  assert.match(sql, /preview_employee_import_organization_candidates/i);
  assert.match(sql, /confirm_employee_import_organization_candidates/i);
  assert.doesNotMatch(sql, /create table public\.grade_levels/i);
  const previewSection = sql.split("create or replace function public.preview_employee_import_organization_candidates", 2)[1]?.split("create or replace function public.confirm_employee_import_organization_candidates", 2)[0] ?? "";
  assert.doesNotMatch(previewSection, /insert into public\.employee_fact_versions/i);
  assert.match(sql, /security definer/i);
  assert.match(sql, /assert_active_property_import_manager/i);
  assert.match(sql, /alter table public\.employees[\s\S]*add column if not exists gender text/i);
  assert.match(sql, /alter table public\.employees[\s\S]*add column if not exists employment_category text/i);
  assert.match(sql, /alter table public\.employee_fact_versions[\s\S]*add column if not exists employment_category text/i);
  assert.match(sql, /is_employee_import_excluded_key[\s\S]*gender/i);
  assert.match(sql, /employees_import_gender/i);
  assert.match(sql, /employee_fact_versions\([\s\S]*gender/i);
  assert.match(sql, /populate_employee_import_employment_category/i);
  assert.match(sql, /new\.grade_or_band := null/i);
  assert.match(sql, /new\.employment_category := 'Trainee'/i);
  const alignment = fs.readFileSync("supabase/migrations/20260803140000_recovery_c_candidate_commit_alignment.sql", "utf8");
  assert.match(alignment, /temporary per-row resolutions/i);
  assert.match(alignment, /prepare_employee_import_preview_base/i);
  assert.match(alignment, /candidate_position_/i);
  assert.match(sql, /assert_employee_import_staging_payload_allowed[\s\S]*allowed_targets[\s\S]*gender/i);
  const confirmSection = sql.split("create or replace function public.confirm_employee_import_organization_candidates", 2)[1] ?? "";
  assert.match(confirmSection, /for decision_payload in select \* from jsonb_array_elements\(p_decisions\)/i);
  assert.doesNotMatch(confirmSection, /for decision in select \* from jsonb_array_elements\(p_decisions\)/i);
});
