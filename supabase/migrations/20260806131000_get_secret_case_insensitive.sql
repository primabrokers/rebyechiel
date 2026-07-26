-- Fix: public.get_secret() matched the vault name case-sensitively, so every cron was 403ing.
--
-- The vault holds Supabase's own bootstrap rows in lower case (`project_url`,
-- `cron_internal_secret`) and our application secrets in upper case (`TEXTMAGIC_API_KEY`, …).
-- _shared/getSecret.ts asks for "CRON_INTERNAL_SECRET", which never matched the lower-case row,
-- so isCronAuthorised() saw no secret and rejected the call. public.trigger_edge_function
-- already compares with lower(name) for exactly this reason; get_secret simply never did.
--
-- Effect of the bug: rabbi-daily-brief (morning briefing) and rabbi-notify (booking reminders,
-- "your answer is ready" texts, overdue nudges) have been returning 403 to pg_cron on every
-- run since they were scheduled. Nothing was lost — those functions are idempotent and simply
-- never executed — but nothing was sent either.
CREATE OR REPLACE FUNCTION public.get_secret(secret_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'vault'
AS $function$
DECLARE v text;
BEGIN
  -- Exact match first, so a deliberately case-distinct pair of names can never collide.
  SELECT decrypted_secret INTO v FROM vault.decrypted_secrets WHERE name = secret_name LIMIT 1;
  IF v IS NULL THEN
    SELECT decrypted_secret INTO v FROM vault.decrypted_secrets
    WHERE lower(name) = lower(secret_name) LIMIT 1;
  END IF;
  RETURN v;
END;
$function$;
