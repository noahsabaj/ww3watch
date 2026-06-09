-- public.rls_auto_enable() is an event-trigger function that auto-enables RLS on
-- new public tables (a good default — keep it). But as a SECURITY DEFINER
-- function it was also EXECUTE-able by anon via /rest/v1/rpc/rls_auto_enable,
-- which Supabase's security advisor flags. Event triggers fire from the DDL
-- system regardless of EXECUTE grants, so revoking EXECUTE closes the RPC
-- surface without disabling the trigger.

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
