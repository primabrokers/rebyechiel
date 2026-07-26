-- Bootstrap for a standalone Supabase project: extensions, the vault-backed secret reader, and
-- the cron → edge-function trigger. (In the Prima CRM project these already existed; this app
-- runs on its own project, so it carries its own copies.)

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Read a named secret from Supabase Vault. Used by edge functions (service role) as a fallback
-- when the secret is not set as a function env var.
CREATE OR REPLACE FUNCTION public.get_secret(secret_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE v text;
BEGIN
  SELECT decrypted_secret INTO v FROM vault.decrypted_secrets WHERE name = secret_name LIMIT 1;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.get_secret(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_secret(text) TO service_role;

-- Fire an edge function from pg_cron. Authenticates with the x-cron-secret header — the
-- functions it calls are verify_jwt=false and check the same secret from the vault.
CREATE OR REPLACE FUNCTION public.trigger_edge_function(fn_name text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $$
DECLARE
  v_url text;
  v_cron_secret text;
  v_request_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE lower(name) = 'project_url' LIMIT 1;
  SELECT decrypted_secret INTO v_cron_secret FROM vault.decrypted_secrets WHERE lower(name) = 'cron_internal_secret' LIMIT 1;
  IF v_url IS NULL OR v_cron_secret IS NULL THEN
    RAISE NOTICE 'trigger_edge_function: missing project_url or cron_internal_secret in vault';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := v_url || '/functions/v1/' || fn_name,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_cron_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.trigger_edge_function(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trigger_edge_function(text) TO service_role, postgres;
