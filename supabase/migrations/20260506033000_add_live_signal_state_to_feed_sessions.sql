alter table public.feed_sessions
  add column if not exists latest_bpm integer,
  add column if not exists peak_bpm integer,
  add column if not exists sample_count integer not null default 0,
  add column if not exists last_sequence bigint,
  add column if not exists telemetry_updated_at timestamptz,
  add column if not exists live_signal_state jsonb not null default '{}'::jsonb;

create index if not exists feed_sessions_live_status_idx
  on public.feed_sessions(status, telemetry_updated_at desc);

create index if not exists feed_sessions_feed_live_idx
  on public.feed_sessions(feed_id, status, telemetry_updated_at desc);
