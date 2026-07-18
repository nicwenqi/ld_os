create or replace function app_private.is_employee_import_excluded_key(
  p_key text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  -- Keep every parser branch in parity with
  -- app/services/import/workbook-parser.ts excludedPattern. The final
  -- attendance/feedback/risk/KPI group is database-only defense in depth.
  select coalesce(p_key, '') ~* (
    'gender|性别|ctc|gtc|course|课程|training|培训|' ||
    'completion|完成|orientation|入职引导|onboarding|' ||
    'checklist|清单|journey|旅程|first\s*aid|急救|' ||
    'problem\s*handling|问题处理|attendance|出勤|考勤|' ||
    'feedback|反馈|risk|风险|kpi|绩效'
  );
$$;

revoke all on function
  app_private.is_employee_import_excluded_key(text)
from public, anon, authenticated;
