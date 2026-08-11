-- Public functions receive EXECUTE from PostgreSQL's PUBLIC role by default.
-- Remove the inherited anonymous path before granting the narrow authenticated API.
revoke execute on function public.commit_employee_import(uuid, bigint)
  from public, anon, authenticated;
revoke execute on function public.preview_employee_import_revert(uuid)
  from public, anon, authenticated;
revoke execute on function public.revert_employee_import(uuid)
  from public, anon, authenticated;

grant execute on function public.commit_employee_import(uuid, bigint)
  to authenticated;
grant execute on function public.preview_employee_import_revert(uuid)
  to authenticated;
grant execute on function public.revert_employee_import(uuid)
  to authenticated;
