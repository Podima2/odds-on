alter table public.agent_runs
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists stage text,
  add column if not exists error_message text,
  add column if not exists error_details jsonb,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists resolution_payload jsonb,
  add column if not exists settlement_tx text;

create index if not exists agent_runs_status_created_at_idx on public.agent_runs(status, created_at asc);
create index if not exists agent_runs_market_status_idx on public.agent_runs(market_id, status, created_at desc);
