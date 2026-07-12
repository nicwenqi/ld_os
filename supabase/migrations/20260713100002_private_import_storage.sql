insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('property-import-files','property-import-files',false,26214400,array['application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv','application/csv'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create or replace function app_private.can_manage_property_import_object(p_name text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare parts text[]; t uuid; p uuid; b uuid;
begin
  parts:=storage.foldername(p_name);
  if cardinality(parts)<>4 or parts[3]<>'imports' or nullif(parts[4],'') is null then return false; end if;
  begin t:=parts[1]::uuid; p:=parts[2]::uuid; b:=parts[4]::uuid; exception when others then return false; end;
  return app_private.can_manage_property(p) and exists(select 1 from public.import_batches x where x.id=b and x.tenant_id=t and x.property_id=p and x.storage_object_path=p_name);
end $$;
revoke execute on function app_private.can_manage_property_import_object(text) from public,anon;
grant execute on function app_private.can_manage_property_import_object(text) to authenticated;

create policy import_files_manager_select on storage.objects for select to authenticated
using(bucket_id='property-import-files' and (select app_private.can_manage_property_import_object(name)));
create policy import_files_manager_insert on storage.objects for insert to authenticated
with check(bucket_id='property-import-files' and (select app_private.can_manage_property_import_object(name)));
create policy import_files_manager_update on storage.objects for update to authenticated
using(bucket_id='property-import-files' and (select app_private.can_manage_property_import_object(name)))
with check(bucket_id='property-import-files' and (select app_private.can_manage_property_import_object(name)));
create policy import_files_manager_delete on storage.objects for delete to authenticated
using(bucket_id='property-import-files' and (select app_private.can_manage_property_import_object(name)));
