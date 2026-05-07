create table if not exists public.feeds (
  id uuid primary key default gen_random_uuid(),
  owner_wallet text not null,
  feed_type text not null,
  verification_mode text not null,
  title text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint feeds_feed_type_check check (
    feed_type in ('ble_heart_rate', 'livestream_video', 'phone_camera', 'gps', 'step_counter')
  ),
  constraint feeds_verification_mode_check check (
    verification_mode in ('structured_attested', 'structured_oracle_verified', 'media_agentic')
  )
);

create table if not exists public.feed_sessions (
  id uuid primary key default gen_random_uuid(),
  feed_id uuid not null references public.feeds(id) on delete cascade,
  status text not null,
  started_at timestamptz,
  ended_at timestamptz,
  session_metadata jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint feed_sessions_status_check check (status in ('planned', 'live', 'ended'))
);

alter table public.markets
  add column if not exists feed_id uuid references public.feeds(id) on delete set null,
  add column if not exists feed_session_id uuid references public.feed_sessions(id) on delete set null,
  add column if not exists resolution_lane text not null default 'deterministic',
  add column if not exists verification_mode text;

alter table public.evidence
  add column if not exists feed_id uuid references public.feeds(id) on delete set null,
  add column if not exists feed_session_id uuid references public.feed_sessions(id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'markets_resolution_lane_check'
  ) then
    alter table public.markets
      add constraint markets_resolution_lane_check
      check (resolution_lane in ('deterministic', 'agentic', 'hybrid'));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'markets_verification_mode_check'
  ) then
    alter table public.markets
      add constraint markets_verification_mode_check
      check (
        verification_mode is null
        or verification_mode in ('structured_attested', 'structured_oracle_verified', 'media_agentic')
      );
  end if;
end
$$;

create index if not exists feeds_owner_wallet_idx on public.feeds(owner_wallet, created_at desc);
create index if not exists feed_sessions_feed_id_idx on public.feed_sessions(feed_id, created_at desc);
create index if not exists markets_feed_id_idx on public.markets(feed_id, created_at desc);
create index if not exists markets_feed_session_id_idx on public.markets(feed_session_id, created_at desc);
create index if not exists markets_resolution_lane_idx on public.markets(resolution_lane, created_at desc);
create index if not exists evidence_feed_id_idx on public.evidence(feed_id, submitted_at desc);
create index if not exists evidence_feed_session_id_idx on public.evidence(feed_session_id, submitted_at desc);

alter table public.feeds enable row level security;
alter table public.feed_sessions enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'feeds'
      and policyname = 'public read feeds'
  ) then
    create policy "public read feeds"
      on public.feeds for select
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
      and tablename = 'feed_sessions'
      and policyname = 'public read feed sessions'
  ) then
    create policy "public read feed sessions"
      on public.feed_sessions for select
      using (true);
  end if;
end
$$;
