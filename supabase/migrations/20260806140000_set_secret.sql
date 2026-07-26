-- Lets the Rov paste his own API keys in from Settings rather than needing the Supabase console.
--
-- Writing a secret is deliberately NOT reachable from PostgREST: only the service role can
-- execute this, and the only caller is the rabbi-secrets edge function, which checks that the
-- caller is the Rov before it goes anywhere near the vault. Values are never read back out to a
-- browser — rabbi-secrets reports "set" or "not set" and the last four characters, nothing more.
CREATE OR REPLACE FUNCTION public.set_secret(secret_name text, secret_value text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'vault'
AS $function$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM vault.secrets WHERE name = secret_name LIMIT 1;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM vault.secrets WHERE lower(name) = lower(secret_name) LIMIT 1;
  END IF;

  IF v_id IS NULL THEN
    PERFORM vault.create_secret(secret_value, secret_name, 'Set from the app by the Rov');
  ELSE
    PERFORM vault.update_secret(v_id, secret_value);
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_secret(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_secret(text, text) TO service_role;

-- Same for reading back only what is safe to show: whether a value exists, and its last four
-- characters, so the Rov can tell one key from another without the key ever leaving the server.
CREATE OR REPLACE FUNCTION public.secret_hint(secret_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'vault'
AS $function$
DECLARE v text;
BEGIN
  SELECT decrypted_secret INTO v FROM vault.decrypted_secrets
  WHERE name = secret_name OR lower(name) = lower(secret_name) LIMIT 1;
  IF v IS NULL OR v = '' THEN
    RETURN jsonb_build_object('set', false, 'hint', NULL);
  END IF;
  RETURN jsonb_build_object('set', true, 'hint', right(v, 4), 'length', length(v));
END;
$function$;

REVOKE ALL ON FUNCTION public.secret_hint(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.secret_hint(text) TO service_role;
