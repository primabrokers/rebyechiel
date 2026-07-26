-- Cron jobs for Rabbi Emanuel's Assistant (reuses public.trigger_edge_function, which calls the
-- edge function with the service-role key from the vault). Times are UTC.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN RETURN; END IF;

  -- Morning briefing at 05:45 UTC ~= 06:45 BST / 05:45 GMT (the function is idempotent per
  -- local day, so the seasonal drift only shifts delivery time, never doubles it).
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rabbi-daily-brief-morning') THEN
    PERFORM cron.unschedule('rabbi-daily-brief-morning');
  END IF;
  PERFORM cron.schedule(
    'rabbi-daily-brief-morning',
    '45 5 * * *',
    $cmd$ SELECT public.trigger_edge_function('rabbi-daily-brief'); $cmd$
  );

  -- Notification engine (booking reminders, answer-ready texts, overdue nudges, conversation
  -- timeouts) every 5 minutes; every send is deduped inside the function.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rabbi-notify-5min') THEN
    PERFORM cron.unschedule('rabbi-notify-5min');
  END IF;
  PERFORM cron.schedule(
    'rabbi-notify-5min',
    '*/5 * * * *',
    $cmd$ SELECT public.trigger_edge_function('rabbi-notify'); $cmd$
  );
END $$;
