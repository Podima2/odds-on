create extension if not exists "pgcrypto";

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null unique,
  display_name text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.markets (
  id uuid primary key default gen_random_uuid(),
  onchain_market_id bigint unique,
  creator_wallet text not null,
  title text not null,
  market_type text not null default 'heart_rate_threshold',
  structured_rule jsonb not null,
  status text not null,
  prediction_cutoff timestamptz not null,
  event_start_time timestamptz,
  event_end_time timestamptz,
  evidence_type text,
  metadata_hash text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint markets_status_check
    check (status in ('draft', 'open', 'locked', 'resolving', 'resolved', 'settled', 'cancelled'))
);

create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id) on delete cascade,
  user_wallet text not null,
  side text not null,
  amount bigint not null,
  tx_signature text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint positions_side_check check (side in ('YES', 'NO')),
  constraint positions_amount_check check (amount > 0)
);

create table if not exists public.evidence (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id) on delete cascade,
  evidence_type text not null,
  source text not null,
  raw_storage_url text,
  normalized_storage_url text,
  evidence_hash text,
  submitted_by text,
  submitted_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.heart_rate_readings (
  id uuid primary key default gen_random_uuid(),
  evidence_id uuid not null references public.evidence(id) on delete cascade,
  market_id uuid not null references public.markets(id) on delete cascade,
  timestamp_offset integer not null,
  bpm integer not null,
  sequence_index integer not null,
  constraint heart_rate_readings_timestamp_offset_check check (timestamp_offset >= 0),
  constraint heart_rate_readings_bpm_check check (bpm > 0),
  constraint heart_rate_readings_sequence_index_check check (sequence_index >= 0),
  constraint heart_rate_readings_unique_sequence unique (evidence_id, sequence_index)
);

create table if not exists public.resolutions (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null unique references public.markets(id) on delete cascade,
  outcome text not null,
  confidence numeric(3, 2),
  reasoning_summary text,
  evidence_hash text,
  analysis_hash text,
  resolution_hash text,
  resolver_signature text,
  settlement_tx text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint resolutions_outcome_check check (outcome in ('YES', 'NO', 'INVALID'))
);

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id) on delete cascade,
  evidence_id uuid references public.evidence(id) on delete set null,
  agent_version text not null,
  input_hash text,
  output_hash text,
  status text not null,
  started_at timestamptz,
  completed_at timestamptz,
  constraint agent_runs_status_check check (status in ('queued', 'running', 'completed', 'failed'))
);

create index if not exists markets_status_idx on public.markets(status, prediction_cutoff desc);
create index if not exists markets_creator_wallet_idx on public.markets(creator_wallet);
create index if not exists positions_market_id_idx on public.positions(market_id, created_at desc);
create index if not exists positions_user_wallet_idx on public.positions(user_wallet, created_at desc);
create index if not exists evidence_market_id_idx on public.evidence(market_id, submitted_at desc);
create index if not exists heart_rate_readings_market_id_idx on public.heart_rate_readings(market_id, sequence_index);
create index if not exists resolutions_market_id_idx on public.resolutions(market_id, created_at desc);
create index if not exists agent_runs_market_id_idx on public.agent_runs(market_id, started_at desc);

alter table public.users enable row level security;
alter table public.markets enable row level security;
alter table public.positions enable row level security;
alter table public.evidence enable row level security;
alter table public.heart_rate_readings enable row level security;
alter table public.resolutions enable row level security;
alter table public.agent_runs enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'markets'
      and policyname = 'public read markets'
  ) then
    create policy "public read markets"
      on public.markets for select
      using (true);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'positions'
      and policyname = 'public read positions'
  ) then
    create policy "public read positions"
      on public.positions for select
      using (true);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'evidence'
      and policyname = 'public read evidence'
  ) then
    create policy "public read evidence"
      on public.evidence for select
      using (true);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'heart_rate_readings'
      and policyname = 'public read heart rate readings'
  ) then
    create policy "public read heart rate readings"
      on public.heart_rate_readings for select
      using (true);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'resolutions'
      and policyname = 'public read resolutions'
  ) then
    create policy "public read resolutions"
      on public.resolutions for select
      using (true);
  end if;
end
$$;

insert into storage.buckets (id, name, public)
values ('evidence', 'evidence', false)
on conflict (id) do nothing;
