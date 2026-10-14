-- Apply once through Supabase migrations. Existing Sites/D1 data is not touched.
create table public.pc_workspaces (
  owner uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);
create table public.pc_photo_assets (
  owner uuid not null references auth.users(id) on delete cascade,
  id text not null check (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$'),
  key text not null unique,
  mime text not null check (mime in ('image/jpeg','image/png','image/webp')),
  name text not null check (char_length(name) between 1 and 180),
  size bigint not null check (size > 0 and size <= 12582912),
  status text not null default 'pending' check (status in ('pending','ready')),
  created_at timestamptz not null default now(),
  primary key (owner, id),
  check (split_part(key, '/', 1) = owner::text)
);
alter table public.pc_workspaces enable row level security;
alter table public.pc_photo_assets enable row level security;
create policy pc_workspace_owner on public.pc_workspaces for all to authenticated
  using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);
create policy pc_photo_owner on public.pc_photo_assets for all to authenticated
  using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);
revoke all on public.pc_workspaces, public.pc_photo_assets from anon;
grant select, insert, update, delete on public.pc_workspaces, public.pc_photo_assets to authenticated;

create function public.pc_save_workspace(new_state jsonb, expected_revision bigint)
returns table(revision bigint) language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if expected_revision < 0 or expected_revision >= 9007199254740991 or jsonb_typeof(new_state) <> 'object'
    or octet_length(new_state::text) > 2097152 then raise exception 'Invalid workspace'; end if;
  if expected_revision = 0 then
    return query insert into public.pc_workspaces (owner, state) values (auth.uid(), new_state)
      on conflict(owner) do nothing returning pc_workspaces.revision;
  else
    return query update public.pc_workspaces w set state = new_state, revision = w.revision + 1, updated_at = now()
      where w.owner = auth.uid() and w.revision = expected_revision returning w.revision;
  end if;
end $$;
revoke all on function public.pc_save_workspace(jsonb,bigint) from public, anon;
grant execute on function public.pc_save_workspace(jsonb,bigint) to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('progresscheck-photos', 'progresscheck-photos', false, 12582912, array['image/jpeg','image/png','image/webp']);
create policy pc_storage_read on storage.objects for select to authenticated
using (bucket_id = 'progresscheck-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy pc_storage_insert on storage.objects for insert to authenticated
with check (bucket_id = 'progresscheck-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy pc_storage_delete on storage.objects for delete to authenticated
using (bucket_id = 'progresscheck-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
