import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { otpRequest, otpVerify } from '../../lib/api';
import { BigButton, Field, Note, Screen, StepBar, inputCls } from '../shared/ui';

/**
 * Signing in is one thing: your number, then the code we text you. No password to remember and
 * nothing to choose. Email and password is kept behind a quiet link — it is how the Rov and his
 * helpers get in, not how the kehillah does.
 */

/**
 * The Rov's own address. rabbi.rebyechiel.org is the one he is given and the one he will type,
 * and what he needs there is his sign-in — email and password — not the kehillah's front door
 * asking for a mobile number he does not sign in with.
 */
export function isAdminHost(): boolean {
  if (typeof window === 'undefined') return false;
  return /^(rabbi|rov|admin)\./i.test(window.location.hostname);
}

/** Turns whatever they typed into E.164 — the field shows +44 already, so a leading 0 is theirs. */
function ukNumber(typed: string): string {
  const d = typed.replace(/\D/g, '');
  if (!d) return '';
  return d.startsWith('0') ? '+44' + d.slice(1) : '+44' + d;
}

/** Six boxes with one real input behind them — taps anywhere bring the keypad up. */
function CodeBoxes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="relative" onClick={() => ref.current?.focus()}>
      <input
        ref={ref}
        className="absolute inset-0 w-full h-full opacity-0"
        type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
        value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
        aria-label="The six-digit code we texted you"
      />
      <div className="flex gap-2 pointer-events-none">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i}
            className={'flex-1 aspect-[1/1.15] rounded-md grid place-items-center font-mono text-[24px] font-bold border-[1.5px] ' +
              (value[i] ? 'border-graphite'
                : i === value.length ? 'border-indigo bg-indigo-soft'
                : 'border-firm')}>
            {value[i] ?? ''}
          </div>
        ))}
      </div>
    </div>
  );
}

export function LoginPage() {
  const nav = useNavigate();
  const admin = isAdminHost();
  const [screen, setScreen] = useState<'welcome' | 'code' | 'email'>(admin ? 'email' : 'welcome');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  // Counts down so "send it again" is never the first thing they try.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const sendCode = async () => {
    setBusy(true); setError(null);
    try {
      await otpRequest(ukNumber(phone), 'login');
      setScreen('code'); setResendIn(30); setCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong — try again in a moment.');
    } finally { setBusy(false); }
  };

  const verifyCode = async () => {
    setBusy(true); setError(null);
    try {
      const res = await otpVerify(ukNumber(phone), code);
      // The number is proven and the code is still good — carry both across so joining doesn't
      // mean sitting through a second text.
      if (res.needsSignup) { nav('/signup', { state: { phone: ukNumber(phone), verified: true, code } }); return; }
      nav('/');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      setError(msg === 'invalid_code' ? 'That code is not right — check the text and try again.'
        : msg === 'expired' ? 'That code has run out. Send yourself a new one.' : msg);
    } finally { setBusy(false); }
  };

  const emailLogin = async () => {
    setBusy(true); setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (err) { setError('Email or password not recognised.'); setBusy(false); return; }
    setBusy(false);
    nav('/');
  };

  // --- the code screen ----------------------------------------------------------------------
  if (screen === 'code') {
    return (
      <Screen tone="surface">
        <StepBar onBack={() => { setScreen('welcome'); setError(null); }} />
        <div className="px-5 md:px-7 py-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-[24px] font-extrabold leading-tight tracking-tight">Check your texts</span>
            <span className="text-[13.5px] leading-relaxed text-ink-muted">
              We sent a code to <b className="text-ink">{ukNumber(phone)}</b>. It's good for ten minutes.
            </span>
          </div>
          <CodeBoxes value={code} onChange={setCode} />
          <BigButton busy={busy} disabled={code.length < 6} onClick={verifyCode}>Sign in</BigButton>
          {error && <p className="text-[13px] font-bold text-late text-center">{error}</p>}
          <div className="text-center text-[13px] text-ink-muted">
            Nothing arrived?{' '}
            {resendIn > 0
              ? <span>Send it again · in {resendIn}s</span>
              : <button className="font-bold text-indigo" onClick={sendCode}>Send it again</button>}
          </div>
        </div>
        <div className="mt-auto px-5 md:px-7 pb-7 md:pb-8">
          <Note icon="☎︎">
            No smartphone? Text the Rov's number instead and the assistant takes your shailah by text.
          </Note>
        </div>
      </Screen>
    );
  }

  // --- email and password, for the Rov and his helpers ---------------------------------------
  // On his own address this IS the sign-in, so it gets the full two-column treatment rather than
  // looking like a page he ended up on by accident.
  if (screen === 'email') {
    const form = (
      <>
        <Field label="Email">
          <input className={inputCls} type="email" autoComplete="username" autoFocus={admin}
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <input className={inputCls} type="password" autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && email && password) emailLogin(); }} />
        </Field>
        <BigButton busy={busy} disabled={!email || !password} onClick={emailLogin}>Sign in</BigButton>
        {error && <p className="text-[13px] font-bold text-late text-center">{error}</p>}
      </>
    );

    if (!admin) {
      return (
        <Screen tone="surface">
          <StepBar onBack={() => { setScreen('welcome'); setError(null); }} />
          <div className="px-5 md:px-7 py-6 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-[24px] font-extrabold leading-tight tracking-tight">Sign in with email</span>
              <span className="text-[13.5px] leading-relaxed text-ink-muted">This is how the Rov and his helpers get in.</span>
            </div>
            {form}
          </div>
        </Screen>
      );
    }

    return (
      <div className="min-h-screen flex flex-col bg-graphite md:bg-page md:items-center md:justify-center md:px-6 md:py-10">
        <div className="w-full flex-1 flex flex-col md:flex-none md:max-w-[940px] md:min-h-[560px]
          md:grid md:grid-cols-2 md:rounded-2xl md:overflow-hidden md:shadow-lift">
          <div className="flex-1 bg-graphite px-6 pt-10 pb-8 md:px-9 md:py-10 flex flex-col justify-center gap-6">
            <div className="w-[54px] h-[54px] rounded-xl bg-indigo grid place-items-center text-[24px] font-extrabold text-white">ר</div>
            <div className="flex flex-col gap-2.5">
              <span className="text-[30px] font-extrabold leading-[1.18] text-white text-balance">
                The Rov's<br />console
              </span>
              <span className="text-[14.5px] leading-relaxed text-white/[.62]">
                Today at a glance, the questions waiting, the diary, and who is asking to see you.
              </span>
            </div>
            <div className="flex flex-col gap-3">
              {['Answer a shailah and it texts them for you', 'Open times without touching a calendar', 'Private questions only you can read'].map((t) => (
                <div key={t} className="flex items-center gap-3">
                  <span className="w-[5px] h-[5px] rounded-pill bg-indigo flex-none" />
                  <span className="text-[13.5px] text-white/[.72]">{t}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-surface rounded-t-[26px] md:rounded-none px-5 pt-6 pb-7 md:px-9 md:py-10
            flex flex-col justify-center gap-3.5">
            <span className="text-[20px] font-extrabold tracking-tight">Sign in</span>
            {form}
            <button className="text-[12.5px] font-bold text-ink-muted hover:text-ink transition-colors"
              onClick={() => { setScreen('welcome'); setError(null); }}>
              Not the Rov? Sign in with a mobile number
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- the welcome screen -------------------------------------------------------------------
  // On a phone this is the hero with the sign-in sheet pulled up over it. On a laptop the two
  // stop stacking and sit side by side, so the form is at eye level instead of a thousand
  // pixels down an empty dark page.
  return (
    <div className="min-h-screen flex flex-col bg-graphite md:bg-page md:items-center md:justify-center md:px-6 md:py-10">
      <div className="w-full flex-1 flex flex-col md:flex-none md:max-w-[940px] md:min-h-[560px]
        md:grid md:grid-cols-2 md:rounded-2xl md:overflow-hidden md:shadow-lift">
        <div className="flex-1 bg-graphite px-6 pt-10 pb-8 md:px-9 md:py-10 flex flex-col justify-center gap-6">
          <div className="w-[54px] h-[54px] rounded-xl bg-indigo grid place-items-center text-[24px] font-extrabold text-white">ר</div>
          <div className="flex flex-col gap-2.5">
            <span className="text-[30px] font-extrabold leading-[1.18] text-white text-balance">
              Contact Rabbi<br />Yechiel Emanuel
            </span>
            <span className="text-[14.5px] leading-relaxed text-white/[.62]">
              Ask a shailah, book a call, invite the Rov to speak. Straight to him — nobody else reads it.
            </span>
          </div>
          <div className="flex flex-col gap-3">
            {['No password to remember', "You're told when to expect an answer", 'Private questions stay private'].map((t) => (
              <div key={t} className="flex items-center gap-3">
                <span className="w-[5px] h-[5px] rounded-pill bg-indigo flex-none" />
                <span className="text-[13.5px] text-white/[.72]">{t}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-surface rounded-t-[26px] md:rounded-none px-5 pt-6 pb-7 md:px-9 md:py-10
          flex flex-col justify-center gap-3.5">
          <span className="hidden md:block text-[20px] font-extrabold tracking-tight">Sign in</span>
          <div className="flex flex-col gap-2">
            <span className="text-[13.5px] font-bold text-ink-soft">Your mobile number</span>
            <div className="flex items-center gap-2.5 border border-firm rounded-lg px-4 py-3.5 focus-within:border-indigo">
              <span className="font-mono text-[15px] font-bold text-ink-muted">+44</span>
              <span className="w-px h-[18px] bg-[rgba(16,19,24,.12)]" />
              <input
                className="flex-1 min-w-0 bg-transparent font-mono text-[15px] tracking-[0.04em] text-ink placeholder:text-ink-ghost focus:outline-none"
                type="tel" inputMode="tel" autoComplete="tel" placeholder="7700 900123"
                value={phone} onChange={(e) => setPhone(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && phone.replace(/\D/g, '').length >= 9) sendCode(); }}
              />
            </div>
            <span className="text-[12.5px] leading-snug text-ink-muted">We text you a six-digit code. That's the whole sign-in.</span>
          </div>
          <BigButton busy={busy} disabled={phone.replace(/\D/g, '').length < 9} onClick={sendCode}>Text me a code</BigButton>
          {error && <p className="text-[13px] font-bold text-late text-center">{error}</p>}
          <div className="text-center text-[13px] text-ink-muted">
            First time here? <Link to="/signup" className="font-extrabold text-indigo">Create an account</Link>
          </div>
          <button className="text-[12.5px] font-bold text-ink-muted hover:text-ink transition-colors"
            onClick={() => { setScreen('email'); setError(null); }}>
            Sign in with email instead
          </button>
        </div>
      </div>
    </div>
  );
}
