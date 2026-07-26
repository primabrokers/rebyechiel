import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import clsx from 'clsx';
import { supabase } from '../../lib/supabase';
import { api, otpRequest, otpVerify } from '../../lib/api';
import { AFFILIATION_LABELS, type Affiliation } from '../../types';
import { BigButton, Display, Field, inputCls } from '../shared/ui';
import { useAuth } from '../../lib/auth';

const AFFILIATIONS: { key: Affiliation; sub: string }[] = [
  { key: 'shul_member', sub: 'A member of the Rov’s kehillah' },
  { key: 'beis_hatalmud', sub: 'Parent, talmid or staff' },
  { key: 'mosdos', sub: 'Connected through the mosdos' },
  { key: 'other', sub: 'Everyone is welcome to ask' },
];

// Sign-up: name → affiliation (required — the Rov sees it on every request) → phone code OR
// email+password. The phone path verifies by SMS and creates the account server-side.
export function SignUpPage() {
  const nav = useNavigate();
  const location = useLocation();
  const { refreshProfile } = useAuth();
  // Arriving from LoginPage after verifying an unregistered number skips the code step.
  const preVerified = (location.state as { phone?: string; verified?: boolean } | null);

  const [fullName, setFullName] = useState('');
  const [affiliation, setAffiliation] = useState<Affiliation | null>(null);
  const [method, setMethod] = useState<'phone' | 'email'>('phone');
  const [phone, setPhone] = useState(preVerified?.phone ?? '');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detailsOk = fullName.trim().length >= 2 && affiliation !== null;

  const sendCode = async () => {
    setBusy(true); setError(null);
    try {
      await otpRequest(phone, 'signup');
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
      await otpVerify(phone, code, { fullName: fullName.trim(), affiliation });
      nav('/');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      setError(msg === 'invalid_code' ? 'That code is not right — check the text and try again.' : msg);
    } finally { setBusy(false); }
  };

  const emailSignUp = async () => {
    if (!affiliation) return;
    setBusy(true); setError(null);
    const { error: err } = await supabase.auth.signUp({ email, password });
    if (err) { setError(err.message); setBusy(false); return; }
    try {
      await api('bootstrap', { fullName: fullName.trim(), affiliation, phone: phone || undefined });
      await refreshProfile();
      nav('/');
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Something went wrong');
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen px-6 py-10 max-w-md mx-auto flex flex-col gap-6">
      <div>
        <Display className="text-[28px]">Create your account</Display>
        <p className="text-ink-muted text-sm mt-1">So the Rov knows who's asking, and we can let you know when he answers.</p>
      </div>

      <Field label="Your full name">
        <input className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Dovid Schwartz" />
      </Field>

      <div>
        <span className="block text-sm font-bold text-ink-soft mb-2">How are you connected to the Rov?</span>
        <div className="flex flex-col gap-2.5">
          {AFFILIATIONS.map((a) => (
            <button key={a.key} type="button" onClick={() => setAffiliation(a.key)}
              className={clsx(
                'flex items-center gap-3 rounded-xl bg-surface shadow-card px-4 py-3.5 text-left border-2 transition-colors',
                affiliation === a.key ? 'border-midnight bg-[#FDFCF9]' : 'border-transparent',
              )}>
              <div className="flex-1">
                <div className="font-extrabold text-[15.5px] tracking-tight">{AFFILIATION_LABELS[a.key]}</div>
                <div className="text-xs text-ink-muted">{a.sub}</div>
              </div>
              {affiliation === a.key && <Check size={20} className="text-midnight" strokeWidth={3} />}
            </button>
          ))}
        </div>
      </div>

      {method === 'phone' ? (
        <div className="flex flex-col gap-4">
          {!codeSent ? (
            <>
              <Field label="Your mobile number" hint="We'll text you a code to confirm it's you — and text you when the Rov answers.">
                <input className={inputCls} type="tel" inputMode="tel" placeholder="07123 456789"
                  value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
              <BigButton busy={busy} disabled={!detailsOk || phone.replace(/\D/g, '').length < 10} onClick={sendCode}>
                Text me a code
              </BigButton>
            </>
          ) : (
            <>
              <Field label={`Enter the code we texted to ${phone}`}>
                <input className={inputCls + ' text-center tracking-[0.4em] font-extrabold text-xl'} type="text"
                  inputMode="numeric" maxLength={6} placeholder="••••••"
                  value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              </Field>
              <BigButton busy={busy} disabled={code.length < 6 || !detailsOk} onClick={verifyAndCreate}>
                Create my account
              </BigButton>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="Email">
            <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Choose a password">
            <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Mobile number (optional)" hint="So we can text you when the Rov answers.">
            <input className={inputCls} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <BigButton busy={busy} disabled={!detailsOk || !email || password.length < 8} onClick={emailSignUp}>
            Create my account
          </BigButton>
        </div>
      )}

      {error && <p className="text-danger-text text-sm font-bold text-center">{error}</p>}

      <div className="text-center flex flex-col gap-3 pb-6">
        <button className="text-sm font-bold text-royal-600" onClick={() => setMethod(method === 'phone' ? 'email' : 'phone')}>
          {method === 'phone' ? 'Use email and password instead' : 'Use my mobile number instead'}
        </button>
        <p className="text-sm text-ink-muted">
          Already have an account? <Link to="/login" className="font-extrabold text-royal-600">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
