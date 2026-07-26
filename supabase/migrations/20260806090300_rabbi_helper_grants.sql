-- Advisor follow-up: the rabbi RLS helpers are SECURITY DEFINER and were executable by anon via
-- PostgREST RPC. They leak nothing sensitive (booleans / own profile id), but anon has no
-- business calling them — RLS policies only ever run them for signed-in users. authenticated
-- keeps EXECUTE because policy expressions evaluate with the querying user's privileges.
REVOKE EXECUTE ON FUNCTION public.rabbi_current_profile_id() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rabbi_is_admin() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rabbi_is_rabbi() FROM anon, public;
-- The trigger guard is never a legitimate RPC target for anyone.
REVOKE EXECUTE ON FUNCTION public.rabbi_profiles_guard() FROM anon, authenticated, public;
