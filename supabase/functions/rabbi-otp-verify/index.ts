import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { preflight, json } from "../_shared/cors.ts";
import { computeSha256 } from "../_shared/sha256.ts";
import { normalizePhone } from "../_shared/textmagic.ts";

/**
 * Rabbi app phone login — step 2 (ANON). Verify the code; mint a session.
 *
 * First-time phone users have no auth account: when the request carries signup details
 * (fullName + affiliation) we create one with a synthetic email — Supabase native phone auth
 * needs a Twilio hookup this project doesn't have, and the synthetic-email convention is the
 * same one the staff passwordless flow proved out. The client exchanges the returned token_hash
 * via supabase.auth.verifyOtp({ token_hash, type }).
 */
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const MAX_ATTEMPTS = 5;

function syntheticEmail(phone: string): string {
  return `p${phone.replace(/\D/g, "")}@members.rabbi-emanuel.app`;
}

/** Create the auth account, or recover it if an interrupted earlier signup already made one. */
async function ensureAuthUser(email: string, phone: string): Promise<string | null> {
  const { data: created, error } = await admin.auth.admin.createUser({
    email, email_confirm: true, user_metadata: { rabbi_app: true, phone },
  });
  if (!error) return created.user.id;
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  return list?.users?.find((u) => u.email === email)?.id ?? null;
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const { phone, code, signup } = await req.json().catch(() => ({}));
    if (!phone || !code) return json({ error: "phone and code required" }, 400);
    const dest = normalizePhone(String(phone));

    const { data: rec } = await admin.from("rabbi_otp_codes")
      .select("id, code_hash, salt, expires_at, attempts")
      .eq("phone", dest).is("consumed_at", null)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!rec) return json({ verified: false, error: "no_code" }, 400);
    if (new Date(rec.expires_at).getTime() < Date.now()) return json({ verified: false, error: "expired" }, 400);
    if (rec.attempts >= MAX_ATTEMPTS) return json({ verified: false, error: "too_many_attempts" }, 400);

    const hash = await computeSha256(`${String(code).trim()}:${rec.salt}`);
    if (hash !== rec.code_hash) {
      await admin.from("rabbi_otp_codes").update({ attempts: rec.attempts + 1 }).eq("id", rec.id);
      return json({ verified: false, error: "invalid_code", attemptsLeft: Math.max(0, MAX_ATTEMPTS - rec.attempts - 1) }, 400);
    }
    // Existing member, or a contact who has only ever texted in?
    const { data: profile } = await admin.from("rabbi_profiles")
      .select("id, auth_user_id, is_active").eq("phone", dest).maybeSingle();

    let email: string;
    if (profile && !profile.auth_user_id) {
      // Known to the Rov from a text, but no account yet. Sign them up onto the record he already
      // has, so their earlier shailos stay theirs instead of landing on a second, emptier person.
      if (!profile.is_active) return json({ verified: false, error: "account_disabled" }, 403);
      const fullName = String(signup?.fullName ?? "").trim();
      const affiliation = String(signup?.affiliation ?? "");
      if (!fullName || !["shul_member", "beis_hatalmud", "mosdos", "other"].includes(affiliation)) {
        // The code is deliberately NOT consumed here: nothing has been created yet, and burning it
        // would make the sign-up screen text a second code for a number that is already proven —
        // two codes to join, which is how this felt broken. It still expires, and still counts
        // attempts, so nothing is weakened by letting it finish the job it was sent for.
        return json({ verified: true, needsSignup: true });
      }
      email = syntheticEmail(dest);
      const authUserId = await ensureAuthUser(email, dest);
      if (!authUserId) return json({ verified: false, error: "signup_failed" }, 500);
      const organisation = String(signup?.organisation ?? "").trim().slice(0, 120) || null;
      const { error: linkErr2 } = await admin.from("rabbi_profiles").update({
        auth_user_id: authUserId, full_name: fullName, affiliation,
        organisation: affiliation === "mosdos" ? organisation : null,
        phone_verified_at: new Date().toISOString(), role: "community",
      }).eq("id", profile.id);
      if (linkErr2) return json({ verified: false, error: linkErr2.message }, 500);
    } else if (profile) {
      if (!profile.is_active) return json({ verified: false, error: "account_disabled" }, 403);
      const { data: authUser, error } = await admin.auth.admin.getUserById(profile.auth_user_id);
      if (error || !authUser?.user?.email) return json({ verified: false, error: "session_failed" }, 500);
      email = authUser.user.email;
      if (!signup) {
        await admin.from("rabbi_profiles").update({ phone_verified_at: new Date().toISOString() }).eq("id", profile.id);
      }
    } else {
      const fullName = String(signup?.fullName ?? "").trim();
      const affiliation = String(signup?.affiliation ?? "");
      if (!fullName || !["shul_member", "beis_hatalmud", "mosdos", "other"].includes(affiliation)) {
        // Verified an unregistered number without signup details — tell the app to collect them.
        // The code is deliberately NOT consumed here: nothing has been created yet, and burning it
        // would make the sign-up screen text a second code for a number that is already proven —
        // two codes to join, which is how this felt broken. It still expires, and still counts
        // attempts, so nothing is weakened by letting it finish the job it was sent for.
        return json({ verified: true, needsSignup: true });
      }
      email = syntheticEmail(dest);
      const authUserId = await ensureAuthUser(email, dest);
      if (!authUserId) return json({ verified: false, error: "signup_failed" }, 500);
      // "Jewish High" tells the Rov far more than "mosdos" does, so the name is kept alongside.
      const organisation = String(signup?.organisation ?? "").trim().slice(0, 120) || null;
      const { error: profErr } = await admin.from("rabbi_profiles").insert({
        auth_user_id: authUserId, full_name: fullName, affiliation,
        organisation: affiliation === "mosdos" ? organisation : null,
        phone: dest, phone_verified_at: new Date().toISOString(), role: "community",
      });
      if (profErr && !profErr.message.includes("duplicate")) {
        return json({ verified: false, error: profErr.message }, 500);
      }
    }

    // Spent only now that it has actually done something.
    await admin.from("rabbi_otp_codes").update({ consumed_at: new Date().toISOString() }).eq("id", rec.id);

    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const props = (link as { properties?: { hashed_token?: string; verification_type?: string } } | null)?.properties;
    if (linkErr || !props?.hashed_token) return json({ verified: false, error: "session_failed" }, 500);

    return json({ verified: true, email, tokenHash: props.hashed_token, verificationType: props.verification_type ?? "magiclink" });
  } catch (err) {
    return json({ verified: false, error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});
