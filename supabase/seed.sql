insert into public.markets (
  id,
  creator_wallet,
  title,
  market_type,
  structured_rule,
  status,
  prediction_cutoff,
  event_start_time,
  event_end_time,
  evidence_type,
  metadata_hash
)
values (
  '11111111-1111-1111-1111-111111111111',
  'DemoCreatorWallet1111111111111111111111111111',
  'Will I exceed 150 BPM in 90 seconds?',
  'heart_rate_threshold',
  '{"metric":"heart_rate_bpm","operator":">","threshold":150,"timeWindowSeconds":90}'::jsonb,
  'open',
  timezone('utc', now()) + interval '1 hour',
  timezone('utc', now()) + interval '2 hours',
  timezone('utc', now()) + interval '2 hours 90 seconds',
  'heart_rate_demo_feed',
  'demo-market-metadata-hash'
)
on conflict (id) do nothing;
