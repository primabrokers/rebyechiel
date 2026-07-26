import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { otpRequest, otpVerify } from '../../lib/api';
import { BigButton, Display, Field, inputCls } from '../shared/ui';

// Phone-first login: most community members find a texted code far easier than a password.
// Email+password stays available behind a toggle (and is how the Rov signs in).
export function LoginPage() {
  const nav = useNavigate();
  const [mode, setMode] = useState<'phone' | 'email'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async () => {
    setBusy(true); setError(null);
    try {
      await otpRequest(phone, 'login');
      setCodeSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally { setBusy(false); }
  };

  const verifyCode = async () => {
    setBusy(true); setError(null);
    try {
      const res = await otpVerify(phone, code);
      if (res.needsSignup) {
        nav('/signup', { state: { phone, verified: true } });
        return;
      }
      nav('/');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      setError(msg === 'invalid_code' ? 'That code is not right — check the text and try again.'
        : msg === 'expired' ? 'That code has expired. Send a new one.' : msg);
    } finally { setBusy(false); }
  };

  const emailLogin = async () => {
    setBusy(true); setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) setError('Email or password not recognised.');
    else nav('/');
    setBusy(false);
  };

  return (
    <div className="min-h-screen flex flex-col justify-center px-6 py-10 max-w-md mx-auto">
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-2xl bg-midnight text-brass-100 font-display text-3xl flex items-center justify-center mx-auto mb-4 shadow-raised">ע</div>
        <Display className="text-[30px]">Rabbi Emanuel's<br />Assistant</Display>
        <p className="text-ink-muted text-sm mt-2">Ask a shailah, book a call, arrange a meeting</p>
      </div>

      {mode === 'phone' ? (
        <div className="flex flex-col gap-4">
          {!codeSent ? (
            <>
              <Field label="Your mobile number" hint="We'll text you a sign-in code — no password needed.">
                <input className={inputCls} type="tel" inputMode="tel" placeholder="07123 456789"
                  value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
              <BigButton busy={busy} disabled={phone.replace(/\D/g, '').length < 10} onClick={sendCode}>
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
              <BigButton busy={busy} disabled={code.length < 6} onClick={verifyCode}>Sign in</BigButton>
              <button className="text-sm font-bold text-royal-600" onClick={() => { setCodeSent(false); setCode(''); }}>
                Send a different code
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="Email">
            <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password">
            <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <BigButton busy={busy} disabled={!email || !password} onClick={emailLogin}>Sign in</BigButton>
        </div>
      )}

      {error && <p className="text-danger-text text-sm font-bold text-center mt-4">{error}</p>}

      <div className="text-center mt-8 flex flex-col gap-3">
        <button className="text-sm font-bold text-royal-600"
          onClick={() => { setMode(mode === 'phone' ? 'email' : 'phone'); setError(null); }}>
          {mode === 'phone' ? 'Use email and password instead' : 'Use my mobile number instead'}
        </button>
        <p className="text-sm text-ink-muted">
          First time here? <Link to="/signup" className="font-extrabold text-royal-600">Create an account</Link>
        </p>
      </div>
    </div>
  );
}
