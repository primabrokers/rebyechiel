import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { api, otpRequest, otpVerify } from '../../lib/api';
import type { Affiliation } from '../../types';
import { BigButton, Choice, Field, Headline, Phone, StepBar, inputCls } from '../shared/ui';
import { useAuth } from '../../lib/auth';

/**
 * Two steps and no more: who you are, then your number. Affiliation is required because the Rov
 * sees it on every single request — a shailah from a Beis Hatalmud parent reads differently from
 * one from a stranger. Picking a mosad opens a box for its name, since "Jewish High" tells him
 * far more than "mosdos" ever could.
 */
const AFFILIATIONS: { key: Affiliation; label: string; sub: string }[] = [
  { key: 'shul_member', label: 'Shul member', sub: "A member of the Rov's kehillah" },
  { key: 'beis_hatalmud', label: 'Beis Hatalmud', sub: 'Parent, talmid or staff' },
  { key: 'mosdos', label: 'A Moisod or organisation', sub: 'e.g. Jewish High, a yeshiva, chesed or kollel' },
  { key: 'other', label: 'Other', sub: 'Everyone is welcome to ask' },
];

function ukNumber(typed: string): string {
  if (typed.startsWith('+')) return typed.replace(/[^\d+]/g, '');
  const d = typed.replace(/\D/g, '');
  if (!d) return '';
  return d.startsWith('0') ? '+44' + d.slice(1) : '+44' + d;
}

export function SignUpPage() {
  const nav = useNavigate();
  const location = useLocation();
  const { refreshProfile } = useAuth();
  // Arriving from the sign-in screen after verifying an unregistered number: the number is
  // already proven, so all that is left is who they are.
  const preVerified = location.state as { phone?: string; verified?: boolean } | null;

  const [step, setStep] = useState(0);
  const [fullName, setFullName] = useState('');
  const [affiliation, setAffiliation] = useState<Affiliation | null>(null);
  const [organisation, setOrganisation] = useState('');
  const [method, setMethod] = useState<'phone' | 'email'>('phone');
  const [phone, setPhone] = useState(preVerified?.phone ?? '');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const orgRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (affiliation === 'mosdos') orgRef.current?.focus(); }, [affiliation]);

  const detailsOk = fullName.trim().length >= 2 && affiliation !== null
    && (affiliation !== 'mosdos' || organisation.trim().length >= 2);
  const signupDetails = () => ({
    fullName: fullName.trim(),
    affiliation: affiliation!,
    organisation: affiliation === 'mosdos' ? organisation.trim() : undefined,
  });

  const sendCode = async () => {
    setBusy(true); setError(null);
    try {
      await otpRequest(ukNumber(phone), 'signup');
      setCodeSent(true);
    } catch (err) {
      setError(err instanceof Error && err.message === 'too_many_requests'
        ? 'Too many codes requested — wait a few minutes and try again.'
        : err instanceof Error ? err.message : 'Something went wrong');
    } finally { setBusy(false); }
  };

  const verifyAndCreate = async () => {
    if (!affiliation) return;
    setBusy(true); setError(null);
    try {
      await otpVerify(ukNumber(phone), code, signupDetails());
      nav('/');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      setError(msg === 'invalid_code' ? 'That code is not right — check the text and try again.' : msg);
    } finally { setBusy(false); }
  };

  const emailSignUp = async () => {
    if (!affiliation) return;
    setBusy(true); setError(null);
    const { error: err } = await supabase.auth.signUp({ email: email.trim(), password });
    if (err) { setError(err.message); setBusy(false); return; }
    try {
      await api('bootstrap', { ...signupDetails(), phone: phone ? ukNumber(phone) : undefined });
      await refreshProfile();
      nav('/');
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Something went wrong');
    } finally { setBusy(false); }
  };

  // --- step 1: who are you? -----------------------------------------------------------------
  if (step === 0) {
    return (
      <Phone tone="surface">
        <StepBar onBack={() => nav('/login')} steps={2} at={0} />
        <div className="px-5 py-4 flex flex-col gap-3.5">
          <Headline title="Who are you?" sub="The Rov sees this on every question, so he knows who he's answering." />

          <Field label="Your full name">
            <input className={inputCls} autoComplete="name" placeholder="e.g. Dovid Schwartz"
              value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </Field>

          <div className="flex flex-col gap-2">
            <span className="text-[12.5px] font-bold text-ink-soft">How are you connected to the Rov?</span>
            {AFFILIATIONS.map((a) => (
              <Choice key={a.key} title={a.label} sub={a.sub}
                selected={affiliation === a.key} onClick={() => setAffiliation(a.key)}>
                {a.key === 'mosdos' && (
                  <div className="flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <span className="text-[11.5px] font-bold text-ink-soft">Which one?</span>
                    <input ref={orgRef}
                      className="w-full rounded-ctl border border-indigo bg-surface px-3 py-2.5 text-[14px] focus:outline-none"
                      placeholder="e.g. Jewish High"
                      value={organisation} onChange={(e) => setOrganisation(e.target.value)} />
                  </div>
                )}
              </Choice>
            ))}
          </div>
        </div>

        <div className="mt-auto px-5 pt-3 pb-6 flex flex-col gap-2">
          <BigButton disabled={!detailsOk} onClick={() => setStep(1)}>Carry on</BigButton>
          <div className="text-center text-[12px] text-ink-muted">
            Already have one? <Link to="/login" className="font-extrabold text-indigo">Sign in</Link>
          </div>
        </div>
      </Phone>
    );
  }

  // --- step 2: how we reach you --------------------------------------------------------------
  return (
    <Phone tone="surface">
      <StepBar onBack={() => setStep(0)} steps={2} at={1} />
      <div className="px-5 py-4 flex flex-col gap-4">
        <Headline
          title={method === 'phone' ? 'Your mobile number' : 'Email and password'}
          sub={method === 'phone'
            ? "We text you a code to confirm it's you — and text you again when the Rov answers."
            : 'You can add a mobile number too, so we can text you when the Rov answers.'}
        />

        {method === 'phone' ? (
          !codeSent ? (
            <>
              <div className="flex items-center gap-2.5 border border-firm rounded-lg px-4 py-3.5 focus-within:border-indigo">
                <span className="font-mono text-[15px] font-bold text-ink-muted">+44</span>
                <span className="w-px h-[18px] bg-[rgba(16,19,24,.12)]" />
                <input
                  className="flex-1 min-w-0 bg-transparent font-mono text-[15px] tracking-[0.04em] placeholder:text-ink-ghost focus:outline-none"
                  type="tel" inputMode="tel" autoComplete="tel" placeholder="7700 900123"
                  value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <BigButton busy={busy} disabled={!detailsOk || phone.replace(/\D/g, '').length < 9} onClick={sendCode}>
                Text me a code
              </BigButton>
            </>
          ) : (
            <>
              <Field label={`Enter the code we texted to ${ukNumber(phone)}`}>
                <input className={inputCls + ' text-center font-mono text-[22px] font-bold tracking-[0.35em]'}
                  type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="——————"
                  value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              </Field>
              <BigButton busy={busy} disabled={code.length < 6 || !detailsOk} onClick={verifyAndCreate}>
                Create my account
              </BigButton>
              <button className="text-[13px] font-bold text-indigo" onClick={() => { setCodeSent(false); setCode(''); }}>
                Use a different number
              </button>
            </>
          )
        ) : (
          <>
            <Field label="Email">
              <input className={inputCls} type="email" autoComplete="username"
                value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Choose a password" hint="At least eight characters.">
              <input className={inputCls} type="password" autoComplete="new-password"
                value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field label="Mobile number (optional)">
              <input className={inputCls} type="tel" placeholder="07700 900123"
                value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <BigButton busy={busy} disabled={!detailsOk || !email || password.length < 8} onClick={emailSignUp}>
              Create my account
            </BigButton>
          </>
        )}

        {error && <p className="text-[13px] font-bold text-late text-center">{error}</p>}
      </div>

      <div className="mt-auto px-5 pb-7 flex flex-col gap-2.5 text-center">
        <button className="text-[12.5px] font-bold text-ink-muted"
          onClick={() => { setMethod(method === 'phone' ? 'email' : 'phone'); setCodeSent(false); setError(null); }}>
          {method === 'phone' ? 'Use email and a password instead' : 'Use my mobile number instead'}
        </button>
      </div>
    </Phone>
  );
}
