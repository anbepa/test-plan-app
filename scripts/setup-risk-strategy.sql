-- Tabla para persistir "Riesgos Para la Estrategia de Pruebas"
-- Ejecutar en Supabase SQL Editor

create table if not exists public.test_plan_risk_strategies (
  id uuid primary key default gen_random_uuid(),
  test_plan_id uuid not null references public.test_plans(id) on delete cascade,
  risk_data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint test_plan_risk_strategies_test_plan_id_key unique (test_plan_id)
);

create index if not exists idx_test_plan_risk_strategies_test_plan_id
  on public.test_plan_risk_strategies(test_plan_id);

-- Trigger para updated_at
create or replace function public.set_timestamp_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_test_plan_risk_strategies_updated_at on public.test_plan_risk_strategies;
create trigger trg_test_plan_risk_strategies_updated_at
before update on public.test_plan_risk_strategies
for each row
execute function public.set_timestamp_updated_at();

-- Políticas RLS (ajustar según tu esquema de auth)
alter table public.test_plan_risk_strategies enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'test_plan_risk_strategies'
      and policyname = 'Allow anon read risk strategies'
  ) then
    create policy "Allow anon read risk strategies"
      on public.test_plan_risk_strategies
      for select
      to anon
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'test_plan_risk_strategies'
      and policyname = 'Allow anon write risk strategies'
  ) then
    create policy "Allow anon write risk strategies"
      on public.test_plan_risk_strategies
      for all
      to anon
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'test_plan_risk_strategies'
      and policyname = 'Allow authenticated read risk strategies'
  ) then
    create policy "Allow authenticated read risk strategies"
      on public.test_plan_risk_strategies
      for select
      to authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'test_plan_risk_strategies'
      and policyname = 'Allow authenticated write risk strategies'
  ) then
    create policy "Allow authenticated write risk strategies"
      on public.test_plan_risk_strategies
      for all
      to authenticated
      using (true)
      with check (true);
  end if;
end $$;
