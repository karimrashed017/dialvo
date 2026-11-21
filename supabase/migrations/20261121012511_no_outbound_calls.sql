-- No outbound calls of any kind (founder decision, 21 Nov 2026): the phone
-- agent only answers calls people make to the business. The batch, claim and
-- call-task objects from phone_and_sms and sequence_channel_steps stay (those
-- migrations are applied), but nothing can make an outbound call again:
--   * calls rows can only be inbound;
--   * no sequence step or run can be a call task;
--   * making or approving a call batch is refused, and the claim the
--     scheduler asks for always comes back empty.
-- Live data had no outbound calls, batches or call tasks, so the checks are
-- validated now.

alter table public.calls
  add constraint calls_inbound_only check (direction = 'inbound');

alter table public.sequence_channel_steps
  add constraint sequence_channel_steps_no_calls check (channel <> 'call_task');
alter table public.sequence_channel_runs
  add constraint sequence_channel_runs_no_calls check (channel <> 'call_task');

alter table public.call_batches
  add constraint call_batches_none check (false) not valid;

create or replace function public.call_batch_create(
  p_workspace_id uuid, p_name text, p_purpose text, p_lead_ids uuid[], p_max_leads integer, p_max_open integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Dialvo does not make outbound calls.' using errcode = 'DV403';
end;
$$;

create or replace function public.call_batch_decide(p_batch_id uuid, p_approve boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  return false;
end;
$$;

create or replace function public.call_claim(p_limit integer, p_rest_min_calls integer, p_rest_min_rate numeric)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select '[]'::jsonb;
$$;
