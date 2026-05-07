alter table public.positions
  add column if not exists claimed_at timestamptz,
  add column if not exists claim_tx_signature text;

alter table public.markets
  add column if not exists chain_synced_at timestamptz,
  add column if not exists last_indexed_signature text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'positions_market_id_user_wallet_key'
  ) then
    alter table public.positions
      add constraint positions_market_id_user_wallet_key unique (market_id, user_wallet);
  end if;
end
$$;

create index if not exists positions_claim_tx_signature_idx on public.positions(claim_tx_signature);
create index if not exists markets_chain_synced_at_idx on public.markets(chain_synced_at desc);
