-- =============================================================
-- SUPABASE AUTH + MULTI-TENANT (RLS) + PERFILES
-- =============================================================
-- IMPORTANTE:
-- 1) Reemplaza el UUID de legacy_owner_id() por un usuario REAL de auth.users
-- 2) Ejecuta este script en Supabase SQL Editor
-- 3) Si no quieres confirmación por email, desactívala en Auth > Providers > Email
-- 4) El usuario definido en legacy_owner_id() quedará marcado como MASTER
-- =============================================================

begin;

-- -----------------------------------------------------------------
-- 0) Usuario "dueño" por defecto para datos históricos
-- -----------------------------------------------------------------
create or replace function public.legacy_owner_id()
returns uuid
language sql
stable
as $$
  -- Reemplazar por un UUID real de auth.users
  select '2c81bdb8-4e00-498e-b98f-8401fe4c5e6a'::uuid;
$$;

-- -----------------------------------------------------------------
-- 1) Tabla perfiles + trigger de creación automática
-- -----------------------------------------------------------------
create table if not exists public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  nombre text,
  avatar_url text,
  provider text,
  rol text not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.perfiles
  add column if not exists rol text not null default 'user';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'perfiles_rol_check'
      and conrelid = 'public.perfiles'::regclass
  ) then
    alter table public.perfiles
      add constraint perfiles_rol_check
      check (rol in ('master', 'user'));
  end if;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_perfiles_updated_at on public.perfiles;
create trigger trg_perfiles_updated_at
before update on public.perfiles
for each row
execute function public.set_updated_at();

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meta jsonb;
  v_nombre text;
  v_avatar text;
  v_provider text;
  v_rol text;
begin
  v_meta := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_nombre := coalesce(v_meta->>'full_name', v_meta->>'name', v_meta->>'user_name', split_part(new.email, '@', 1));
  v_avatar := coalesce(v_meta->>'avatar_url', v_meta->>'picture');
  v_provider := coalesce(
    new.raw_app_meta_data->>'provider',
    new.raw_app_meta_data->'providers'->>0,
    'email'
  );
  v_rol := case when new.id = public.legacy_owner_id() then 'master' else 'user' end;

  insert into public.perfiles (id, email, nombre, avatar_url, provider, rol)
  values (new.id, new.email, v_nombre, v_avatar, v_provider, v_rol)
  on conflict (id) do update
    set email = excluded.email,
        nombre = excluded.nombre,
        avatar_url = excluded.avatar_url,
        provider = excluded.provider,
        rol = excluded.rol,
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row
execute function public.handle_new_user_profile();

insert into public.perfiles (id, email, nombre, provider, rol)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)),
  coalesce(
    u.raw_app_meta_data->>'provider',
    u.raw_app_meta_data->'providers'->>0,
    'email'
  ),
  case when u.id = public.legacy_owner_id() then 'master' else 'user' end
from auth.users u
where u.id = public.legacy_owner_id()
on conflict (id) do update
set email = excluded.email,
    nombre = excluded.nombre,
    provider = excluded.provider,
    rol = excluded.rol,
    updated_at = now();

update public.perfiles
set rol = case when id = public.legacy_owner_id() then 'master' else 'user' end
where rol is distinct from case when id = public.legacy_owner_id() then 'master' else 'user' end;

create or replace function public.is_master_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.perfiles p
    where p.id = auth.uid()
      and p.rol = 'master'
  );
$$;

alter table public.perfiles enable row level security;

drop policy if exists "perfiles_select_own" on public.perfiles;
create policy "perfiles_select_own"
  on public.perfiles
  for select
  to authenticated
  using (id = auth.uid() or public.is_master_user());

drop policy if exists "perfiles_insert_own" on public.perfiles;
create policy "perfiles_insert_own"
  on public.perfiles
  for insert
  to authenticated
  with check (id = auth.uid() or public.is_master_user());

drop policy if exists "perfiles_update_own" on public.perfiles;
create policy "perfiles_update_own"
  on public.perfiles
  for update
  to authenticated
  using (id = auth.uid() or public.is_master_user())
  with check (id = auth.uid() or public.is_master_user());

-- -----------------------------------------------------------------
-- 2) Agregar user_id a tablas existentes (si no existe)
-- -----------------------------------------------------------------
do $$
begin
  if to_regclass('public.test_plans') is not null then
    alter table public.test_plans add column if not exists user_id uuid;
  end if;

  if to_regclass('public.user_stories') is not null then
    alter table public.user_stories add column if not exists user_id uuid;
  end if;

  if to_regclass('public.test_cases') is not null then
    alter table public.test_cases add column if not exists user_id uuid;
  end if;

  if to_regclass('public.test_case_steps') is not null then
    alter table public.test_case_steps add column if not exists user_id uuid;
  end if;

  if to_regclass('public.images') is not null then
    alter table public.images add column if not exists user_id uuid;
  end if;

  if to_regclass('public.test_plan_risk_strategies') is not null then
    alter table public.test_plan_risk_strategies add column if not exists user_id uuid;
  end if;
end $$;

-- -----------------------------------------------------------------
-- 3) Backfill de dueños
--    3.1 Heredar user_id desde la jerarquía
--    3.2 Asignar legacy_owner_id() para filas huérfanas
-- -----------------------------------------------------------------
-- test_plans
update public.test_plans
set user_id = public.legacy_owner_id()
where user_id is null;

-- user_stories
update public.user_stories us
set user_id = tp.user_id
from public.test_plans tp
where us.test_plan_id = tp.id
  and us.user_id is null;

update public.user_stories
set user_id = public.legacy_owner_id()
where user_id is null;

-- test_cases
update public.test_cases tc
set user_id = us.user_id
from public.user_stories us
where tc.user_story_id = us.id
  and tc.user_id is null;

update public.test_cases
set user_id = public.legacy_owner_id()
where user_id is null;

-- test_case_steps
update public.test_case_steps tcs
set user_id = tc.user_id
from public.test_cases tc
where tcs.test_case_id = tc.id
  and tcs.user_id is null;

update public.test_case_steps
set user_id = public.legacy_owner_id()
where user_id is null;

-- images
update public.images i
set user_id = us.user_id
from public.user_stories us
where i.user_story_id = us.id
  and i.user_id is null;

update public.images
set user_id = public.legacy_owner_id()
where user_id is null;

-- test_plan_risk_strategies
update public.test_plan_risk_strategies rs
set user_id = tp.user_id
from public.test_plans tp
where rs.test_plan_id = tp.id
  and rs.user_id is null;

update public.test_plan_risk_strategies
set user_id = public.legacy_owner_id()
where user_id is null;

-- -----------------------------------------------------------------
-- 4) FK + default auth.uid() para nuevos datos
-- -----------------------------------------------------------------
do $$
begin
  -- test_plans
  if not exists (
    select 1 from pg_constraint where conname = 'test_plans_user_id_fkey'
  ) then
    alter table public.test_plans
      add constraint test_plans_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete restrict;
  end if;

  alter table public.test_plans
    alter column user_id set default auth.uid(),
    alter column user_id set not null;

  -- user_stories
  if not exists (
    select 1 from pg_constraint where conname = 'user_stories_user_id_fkey'
  ) then
    alter table public.user_stories
      add constraint user_stories_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete restrict;
  end if;

  alter table public.user_stories
    alter column user_id set default auth.uid(),
    alter column user_id set not null;

  -- test_cases
  if not exists (
    select 1 from pg_constraint where conname = 'test_cases_user_id_fkey'
  ) then
    alter table public.test_cases
      add constraint test_cases_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete restrict;
  end if;

  alter table public.test_cases
    alter column user_id set default auth.uid(),
    alter column user_id set not null;

  -- test_case_steps
  if not exists (
    select 1 from pg_constraint where conname = 'test_case_steps_user_id_fkey'
  ) then
    alter table public.test_case_steps
      add constraint test_case_steps_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete restrict;
  end if;

  alter table public.test_case_steps
    alter column user_id set default auth.uid(),
    alter column user_id set not null;

  -- images
  if to_regclass('public.images') is not null then
    if not exists (
      select 1 from pg_constraint where conname = 'images_user_id_fkey'
    ) then
      alter table public.images
        add constraint images_user_id_fkey
        foreign key (user_id) references auth.users(id) on delete restrict;
    end if;

    alter table public.images
      alter column user_id set default auth.uid(),
      alter column user_id set not null;
  end if;

  -- test_plan_risk_strategies
  if to_regclass('public.test_plan_risk_strategies') is not null then
    if not exists (
      select 1 from pg_constraint where conname = 'test_plan_risk_strategies_user_id_fkey'
    ) then
      alter table public.test_plan_risk_strategies
        add constraint test_plan_risk_strategies_user_id_fkey
        foreign key (user_id) references auth.users(id) on delete restrict;
    end if;

    alter table public.test_plan_risk_strategies
      alter column user_id set default auth.uid(),
      alter column user_id set not null;
  end if;
end $$;

-- -----------------------------------------------------------------
-- 5) RLS multi-tenant:
--    - SELECT: dueño actual + owner legacy
--    - INSERT/UPDATE/DELETE: solo dueño actual
-- -----------------------------------------------------------------

-- test_plans
alter table public.test_plans enable row level security;

drop policy if exists "test_plans_select_owner_or_legacy" on public.test_plans;
create policy "test_plans_select_owner_or_legacy"
  on public.test_plans
  for select
  to authenticated
  using (user_id = auth.uid() or user_id = public.legacy_owner_id() or public.is_master_user());

drop policy if exists "test_plans_insert_owner" on public.test_plans;
create policy "test_plans_insert_owner"
  on public.test_plans
  for insert
  to authenticated
  with check (user_id = auth.uid() or public.is_master_user());

drop policy if exists "test_plans_update_owner" on public.test_plans;
create policy "test_plans_update_owner"
  on public.test_plans
  for update
  to authenticated
  using (user_id = auth.uid() or public.is_master_user())
  with check (user_id = auth.uid() or public.is_master_user());

drop policy if exists "test_plans_delete_owner" on public.test_plans;
create policy "test_plans_delete_owner"
  on public.test_plans
  for delete
  to authenticated
  using (user_id = auth.uid() or public.is_master_user());

-- user_stories
alter table public.user_stories enable row level security;

drop policy if exists "user_stories_select_owner_or_legacy" on public.user_stories;
create policy "user_stories_select_owner_or_legacy"
  on public.user_stories
  for select
  to authenticated
  using (user_id = auth.uid() or user_id = public.legacy_owner_id() or public.is_master_user());

drop policy if exists "user_stories_insert_owner" on public.user_stories;
create policy "user_stories_insert_owner"
  on public.user_stories
  for insert
  to authenticated
  with check (user_id = auth.uid() or public.is_master_user());

drop policy if exists "user_stories_update_owner" on public.user_stories;
create policy "user_stories_update_owner"
  on public.user_stories
  for update
  to authenticated
  using (user_id = auth.uid() or public.is_master_user())
  with check (user_id = auth.uid() or public.is_master_user());

drop policy if exists "user_stories_delete_owner" on public.user_stories;
create policy "user_stories_delete_owner"
  on public.user_stories
  for delete
  to authenticated
  using (user_id = auth.uid() or public.is_master_user());

-- test_cases
alter table public.test_cases enable row level security;

drop policy if exists "test_cases_select_owner_or_legacy" on public.test_cases;
create policy "test_cases_select_owner_or_legacy"
  on public.test_cases
  for select
  to authenticated
  using (user_id = auth.uid() or user_id = public.legacy_owner_id() or public.is_master_user());

drop policy if exists "test_cases_insert_owner" on public.test_cases;
create policy "test_cases_insert_owner"
  on public.test_cases
  for insert
  to authenticated
  with check (user_id = auth.uid() or public.is_master_user());

drop policy if exists "test_cases_update_owner" on public.test_cases;
create policy "test_cases_update_owner"
  on public.test_cases
  for update
  to authenticated
  using (user_id = auth.uid() or public.is_master_user())
  with check (user_id = auth.uid() or public.is_master_user());

drop policy if exists "test_cases_delete_owner" on public.test_cases;
create policy "test_cases_delete_owner"
  on public.test_cases
  for delete
  to authenticated
  using (user_id = auth.uid() or public.is_master_user());

-- test_case_steps
alter table public.test_case_steps enable row level security;

drop policy if exists "test_case_steps_select_owner_or_legacy" on public.test_case_steps;
create policy "test_case_steps_select_owner_or_legacy"
  on public.test_case_steps
  for select
  to authenticated
  using (user_id = auth.uid() or user_id = public.legacy_owner_id() or public.is_master_user());

drop policy if exists "test_case_steps_insert_owner" on public.test_case_steps;
create policy "test_case_steps_insert_owner"
  on public.test_case_steps
  for insert
  to authenticated
  with check (user_id = auth.uid() or public.is_master_user());

drop policy if exists "test_case_steps_update_owner" on public.test_case_steps;
create policy "test_case_steps_update_owner"
  on public.test_case_steps
  for update
  to authenticated
  using (user_id = auth.uid() or public.is_master_user())
  with check (user_id = auth.uid() or public.is_master_user());

drop policy if exists "test_case_steps_delete_owner" on public.test_case_steps;
create policy "test_case_steps_delete_owner"
  on public.test_case_steps
  for delete
  to authenticated
  using (user_id = auth.uid() or public.is_master_user());

-- images (si existe)
do $$
begin
  if to_regclass('public.images') is not null then
    execute 'alter table public.images enable row level security';

    execute 'drop policy if exists "images_select_owner_or_legacy" on public.images';
    execute 'create policy "images_select_owner_or_legacy" on public.images for select to authenticated using (user_id = auth.uid() or user_id = public.legacy_owner_id() or public.is_master_user())';

    execute 'drop policy if exists "images_insert_owner" on public.images';
    execute 'create policy "images_insert_owner" on public.images for insert to authenticated with check (user_id = auth.uid() or public.is_master_user())';

    execute 'drop policy if exists "images_update_owner" on public.images';
    execute 'create policy "images_update_owner" on public.images for update to authenticated using (user_id = auth.uid() or public.is_master_user()) with check (user_id = auth.uid() or public.is_master_user())';

    execute 'drop policy if exists "images_delete_owner" on public.images';
    execute 'create policy "images_delete_owner" on public.images for delete to authenticated using (user_id = auth.uid() or public.is_master_user())';
  end if;
end $$;

-- test_plan_risk_strategies (si existe)
do $$
begin
  if to_regclass('public.test_plan_risk_strategies') is not null then
    execute 'alter table public.test_plan_risk_strategies enable row level security';

    execute 'drop policy if exists "risk_select_owner_or_legacy" on public.test_plan_risk_strategies';
    execute 'create policy "risk_select_owner_or_legacy" on public.test_plan_risk_strategies for select to authenticated using (user_id = auth.uid() or user_id = public.legacy_owner_id() or public.is_master_user())';

    execute 'drop policy if exists "risk_insert_owner" on public.test_plan_risk_strategies';
    execute 'create policy "risk_insert_owner" on public.test_plan_risk_strategies for insert to authenticated with check (user_id = auth.uid() or public.is_master_user())';

    execute 'drop policy if exists "risk_update_owner" on public.test_plan_risk_strategies';
    execute 'create policy "risk_update_owner" on public.test_plan_risk_strategies for update to authenticated using (user_id = auth.uid() or public.is_master_user()) with check (user_id = auth.uid() or public.is_master_user())';

    execute 'drop policy if exists "risk_delete_owner" on public.test_plan_risk_strategies';
    execute 'create policy "risk_delete_owner" on public.test_plan_risk_strategies for delete to authenticated using (user_id = auth.uid() or public.is_master_user())';
  end if;
end $$;

-- Índices recomendados
create index if not exists idx_test_plans_user_id on public.test_plans(user_id);
create index if not exists idx_user_stories_user_id on public.user_stories(user_id);
create index if not exists idx_test_cases_user_id on public.test_cases(user_id);
create index if not exists idx_test_case_steps_user_id on public.test_case_steps(user_id);

commit;
