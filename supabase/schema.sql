-- NijiDocs: family document vault — run this whole file once in Supabase SQL editor.
-- Sign-in is by email code; the mobile number is saved on the profile so family can add you by number.
-- Everything sensitive (document files, names, OCR text, IDs, keys) arrives
-- here already encrypted by the browser. Folder and group names are plaintext.

create extension if not exists pgcrypto;

-- ───────────────────────── tables
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  phone text unique check (phone ~ '^[0-9]{8,15}$'),  -- entered by the user, used to find people
  display_name text,
  public_key text,            -- RSA-OAEP public key (spki, base64)
  vault jsonb,                -- private secrets encrypted with passphrase
  vault_recovery jsonb,       -- same secrets encrypted with recovery key
  created_at timestamptz default now()
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  is_default boolean not null default false,
  created_at timestamptz default now()
);

create table public.group_members (
  group_id uuid references public.groups(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  wrapped_key text not null,  -- group key encrypted to this member's public key
  added_at timestamptz default now(),
  primary key (group_id, user_id)
);

create table public.documents (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  slug_hmac text not null,    -- keyed hash of the permanent ID (uniqueness only)
  content_hmac text not null, -- keyed hash of file contents (duplicate check)
  enc_meta text not null,     -- name, ID, OCR text... encrypted with document key
  owner_wrapped_key text not null,
  page_count int not null check (page_count between 1 and 30),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (owner_id, slug_hmac)
);

create table public.document_groups (
  document_id uuid references public.documents(id) on delete cascade,
  group_id uuid references public.groups(id) on delete cascade,
  wrapped_key text not null,  -- document key encrypted with group key
  added_at timestamptz default now(),
  primary key (document_id, group_id)
);

create table public.folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete cascade,
  group_id uuid references public.groups(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  created_at timestamptz default now(),
  check ((owner_id is null) <> (group_id is null))
);

create table public.folder_items (
  folder_id uuid references public.folders(id) on delete cascade,
  document_id uuid references public.documents(id) on delete cascade,
  added_at timestamptz default now(),
  primary key (folder_id, document_id)
);

create table public.print_shares (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'active' check (status in ('active','requested','revoked')),
  expires_at timestamptz not null default now() + interval '15 minutes',
  request_count int not null default 0,
  last_opened_at timestamptz,
  created_at timestamptz default now()
);

create table public.activity (
  id bigserial primary key,
  document_id uuid not null references public.documents(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event text not null,
  detail text,
  created_at timestamptz default now()
);
create index on public.activity (document_id, created_at desc);

-- ───────────────────────── helpers
-- kept as is_aal2() so every policy/function below needs no change;
-- there's no second factor anymore, so this just checks for a signed-in session.
create or replace function public.is_aal2() returns boolean
language sql stable as $$ select auth.uid() is not null $$;

create or replace function public.is_group_member(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from group_members where group_id = g and user_id = auth.uid())
$$;

create or replace function public.is_group_owner(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from groups where id = g and owner_id = auth.uid())
$$;

create or replace function public.is_doc_owner(d uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from documents where id = d and owner_id = auth.uid())
$$;

create or replace function public.can_access_doc(d uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from documents where id = d and owner_id = auth.uid())
      or exists (select 1 from document_groups dg join group_members gm on gm.group_id = dg.group_id
                 where dg.document_id = d and gm.user_id = auth.uid())
$$;

create or replace function public.can_use_folder(f uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from folders where id = f and
    (owner_id = auth.uid() or (group_id is not null and public.is_group_member(group_id))))
$$;

create or replace function public.folder_accepts(f uuid, d uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_use_folder(f) and public.can_access_doc(d) and exists (
    select 1 from folders fo where fo.id = f and (fo.group_id is null or exists (
      select 1 from document_groups dg where dg.document_id = d and dg.group_id = fo.group_id)))
$$;

-- new auth user → profile (one account per email is enforced by Supabase Auth;
-- one account per mobile number is enforced by the unique constraint on profiles.phone)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email) values (new.id, new.email);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- look up a person by phone to add to a group (exact match only)
create or replace function public.find_user_by_phone(p text)
returns table (id uuid, display_name text, public_key text)
language sql stable security definer set search_path = public as $$
  select id, display_name, public_key from profiles
  where public.is_aal2() and public_key is not null
    and regexp_replace(phone, '\D', '', 'g') = regexp_replace(p, '\D', '', 'g')
$$;

create or replace function public.group_member_profiles(g uuid)
returns table (user_id uuid, display_name text, phone text, role text)
language sql stable security definer set search_path = public as $$
  select gm.user_id, p.display_name, p.phone, gm.role
  from group_members gm join profiles p on p.id = gm.user_id
  where gm.group_id = g and public.is_aal2() and public.is_group_member(g)
  order by gm.role desc, gm.added_at
$$;

create or replace function public.extend_print_share(s uuid) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare r timestamptz;
begin
  if not public.is_aal2() then raise exception 'not allowed'; end if;
  update print_shares ps set expires_at = now() + interval '15 minutes', status = 'active'
  where ps.id = s and ps.status <> 'revoked'
    and (ps.created_by = auth.uid() or public.is_doc_owner(ps.document_id))
  returning expires_at into r;
  if r is null then raise exception 'not allowed'; end if;
  insert into activity (document_id, actor_id, event)
    select document_id, auth.uid(), 'print_access_approved' from print_shares where id = s;
  return r;
end $$;

create or replace function public.revoke_print_share(s uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_aal2() then raise exception 'not allowed'; end if;
  update print_shares ps set status = 'revoked', expires_at = now()
  where ps.id = s and (ps.created_by = auth.uid() or public.is_doc_owner(ps.document_id));
  insert into activity (document_id, actor_id, event)
    select document_id, auth.uid(), 'print_link_revoked' from print_shares where id = s;
end $$;

-- ───────────────────────── row level security (every policy also requires a signed-in session)
alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.documents enable row level security;
alter table public.document_groups enable row level security;
alter table public.folders enable row level security;
alter table public.folder_items enable row level security;
alter table public.print_shares enable row level security;
alter table public.activity enable row level security;

create policy "own profile" on public.profiles for select to authenticated
  using (id = auth.uid() and public.is_aal2());
create policy "update own profile" on public.profiles for update to authenticated
  using (id = auth.uid() and public.is_aal2());
revoke insert, update, delete on public.profiles from authenticated, anon;
grant update (display_name, phone, public_key, vault, vault_recovery) on public.profiles to authenticated;

create policy "groups: members read" on public.groups for select to authenticated
  using (public.is_aal2() and (owner_id = auth.uid() or public.is_group_member(id)));
create policy "groups: create own" on public.groups for insert to authenticated
  with check (public.is_aal2() and owner_id = auth.uid());
create policy "groups: owner renames" on public.groups for update to authenticated
  using (public.is_aal2() and owner_id = auth.uid());
create policy "groups: owner deletes" on public.groups for delete to authenticated
  using (public.is_aal2() and owner_id = auth.uid() and not is_default);

create policy "members: read" on public.group_members for select to authenticated
  using (public.is_aal2() and public.is_group_member(group_id));
create policy "members: owner adds" on public.group_members for insert to authenticated
  with check (public.is_aal2() and public.is_group_owner(group_id));
create policy "members: owner removes or self leaves" on public.group_members for delete to authenticated
  using (public.is_aal2() and ((public.is_group_owner(group_id) and user_id <> auth.uid())
                               or (user_id = auth.uid() and role <> 'owner')));

create policy "docs: read accessible" on public.documents for select to authenticated
  using (public.is_aal2() and public.can_access_doc(id));
create policy "docs: create own" on public.documents for insert to authenticated
  with check (public.is_aal2() and owner_id = auth.uid());
create policy "docs: owner edits" on public.documents for update to authenticated
  using (public.is_aal2() and owner_id = auth.uid());
create policy "docs: owner deletes" on public.documents for delete to authenticated
  using (public.is_aal2() and owner_id = auth.uid());
revoke update on public.documents from authenticated;
grant update (enc_meta, updated_at) on public.documents to authenticated;

create policy "docgroups: read" on public.document_groups for select to authenticated
  using (public.is_aal2() and (public.is_group_member(group_id) or public.is_doc_owner(document_id)));
create policy "docgroups: owner shares" on public.document_groups for insert to authenticated
  with check (public.is_aal2() and public.is_doc_owner(document_id) and public.is_group_member(group_id));
create policy "docgroups: owner unshares" on public.document_groups for delete to authenticated
  using (public.is_aal2() and public.is_doc_owner(document_id));

create policy "folders: read" on public.folders for select to authenticated
  using (public.is_aal2() and public.can_use_folder(id));
create policy "folders: create" on public.folders for insert to authenticated
  with check (public.is_aal2() and ((owner_id = auth.uid() and group_id is null)
                                    or (owner_id is null and public.is_group_member(group_id))));
create policy "folders: rename" on public.folders for update to authenticated
  using (public.is_aal2() and public.can_use_folder(id));
create policy "folders: delete" on public.folders for delete to authenticated
  using (public.is_aal2() and public.can_use_folder(id));

create policy "items: read" on public.folder_items for select to authenticated
  using (public.is_aal2() and public.can_use_folder(folder_id));
create policy "items: add" on public.folder_items for insert to authenticated
  with check (public.is_aal2() and public.folder_accepts(folder_id, document_id));
create policy "items: remove" on public.folder_items for delete to authenticated
  using (public.is_aal2() and (public.can_use_folder(folder_id) or public.is_doc_owner(document_id)));

create policy "shares: read" on public.print_shares for select to authenticated
  using (public.is_aal2() and (created_by = auth.uid() or public.is_doc_owner(document_id)));
create policy "shares: create" on public.print_shares for insert to authenticated
  with check (public.is_aal2() and created_by = auth.uid() and public.can_access_doc(document_id));
create policy "shares: delete" on public.print_shares for delete to authenticated
  using (public.is_aal2() and (created_by = auth.uid() or public.is_doc_owner(document_id)));
revoke insert, update on public.print_shares from authenticated;
grant insert (document_id, created_by) on public.print_shares to authenticated;

create policy "activity: owner reads" on public.activity for select to authenticated
  using (public.is_aal2() and public.is_doc_owner(document_id));
create policy "activity: log" on public.activity for insert to authenticated
  with check (public.is_aal2() and actor_id = auth.uid() and public.can_access_doc(document_id));
revoke update, delete on public.activity from authenticated;

-- nothing is readable without logging in
revoke all on all tables in schema public from anon;

-- ───────────────────────── storage: private bucket, path = owner_id/document_id/page
insert into storage.buckets (id, name, public, file_size_limit)
values ('vault', 'vault', false, 26214400) on conflict (id) do nothing;

create policy "vault: read accessible" on storage.objects for select to authenticated
  using (bucket_id = 'vault' and public.is_aal2()
         and public.can_access_doc(((storage.foldername(name))[2])::uuid));
create policy "vault: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'vault' and public.is_aal2()
              and (storage.foldername(name))[1] = auth.uid()::text);
create policy "vault: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'vault' and public.is_aal2()
         and (storage.foldername(name))[1] = auth.uid()::text);
