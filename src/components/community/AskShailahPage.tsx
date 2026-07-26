import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, ScrollText } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../../lib/api';
import type { Category, UrgencyTier } from '../../types';
import { BigButton, Display, Spinner } from '../shared/ui';

// Three steps, one screen at a time: category → urgency → the question itself, ending on the
// promise screen. Wording stays plain — no system jargon anywhere.
export function AskShailahPage() {
  const nav = useNavigate();
  const [config, setConfig] = useState<{ categories: Category[]; urgencyTiers: UrgencyTier[] } | null>(null);
  const [step, setStep] = useState(0);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [urgencyId, setUrgencyId] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ ref: string; expected_reply_text: string } | null>(null);

  useEffect(() => {
    api<{ categories: Category[]; urgencyTiers: UrgencyTier[] }>('public_config')
      .then(setConfig)
      .catch(() => setError('Could not load — check your connection and try again.'));
  }, []);

  const selectedCategory = useMemo(
    () => config?.categories.find((c) => c.id === categoryId) ?? null,
    [config, categoryId],
  );

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const res = await api<{ shailah: { ref: string; expected_reply_text: string } }>('submit_shailah', {
        categoryId, urgencyTierId: urgencyId, question: question.trim(),
      });
      setDone(res.shailah);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong — please try again.');
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="min-h-screen max-w-md mx-auto px-6 pt-16 pb-10 flex flex-col gap-5 text-center">
        <div className="w-[92px] h-[92px] rounded-full mx-auto flex items-center justify-center text-brass-100 shadow-raised relative"
          style={{ background: 'radial-gradient(circle at 32% 28%, #2C4E7E, #0F1E33)' }}>
          <span className="absolute inset-1.5 rounded-full border border-brass-100/40" />
          <ScrollText size={38} />
        </div>
        <Display className="text-[27px]">Your shailah is<br />with the Rov</Display>
        <p className="text-sm text-ink-soft max-w-[30ch] mx-auto">
          Only the Rov sees it. We'll text you the moment there's an answer.
        </p>
        <div className="bg-surface rounded-xl shadow-card p-4 text-left">
          <div className="text-[11.5px] uppercase tracking-[0.12em] font-extrabold text-ink-muted">Expected answer</div>
          <div className="font-display font-semibold text-[21px] text-midnight mt-0.5">
            {done.expected_reply_text.replace('The Rov expects to answer ', '').replace(/\.$/, '')}
          </div>
          <div className="text-[12.5px] text-ink-muted mt-1">
            {selectedCategory?.default_same_day ? 'These questions are always answered the same day · ' : ''}Ref {done.ref}
          </div>
        </div>
        <BigButton tone="ghost" onClick={() => nav('/')}>Back to home</BigButton>
      </div>
    );
  }

  if (!config) return error ? <p className="text-center pt-20 text-danger-text font-bold px-8">{error}</p> : <Spinner />;

  return (
    <div className="min-h-screen max-w-md mx-auto px-5 pt-6 pb-10 flex flex-col gap-4">
      <div className="flex items-center gap-3 px-1">
        <Link to="/" className="p-2 -ml-2 text-ink-soft"><ArrowLeft size={22} /></Link>
        <div className="flex gap-1.5 flex-1">
          {[0, 1, 2].map((i) => (
            <span key={i} className={clsx('h-1 rounded-full flex-1', i <= step ? 'bg-midnight' : 'bg-separator')} />
          ))}
        </div>
      </div>

      {step === 0 && (
        <>
          <div className="px-1.5">
            <Display className="text-[25px]">What is it about?</Display>
            <p className="text-[13.5px] text-ink-muted mt-1">This only helps the Rov sort his queue — pick the closest.</p>
          </div>
          <div className="flex flex-col gap-2.5">
            {config.categories.map((c) => (
              <button key={c.id} type="button"
                onClick={() => { setCategoryId(c.id); setStep(c.default_same_day ? 2 : 1); }}
                className={clsx(
                  'flex items-center gap-3.5 rounded-xl bg-surface shadow-card px-4 py-4 text-left border-2 transition-colors',
                  categoryId === c.id ? 'border-midnight bg-[#FDFCF9]' : 'border-transparent',
                )}>
                <div className={clsx('w-10 h-10 rounded-lg flex items-center justify-center flex-none',
                  categoryId === c.id ? 'bg-midnight text-white' : 'bg-royal-100 text-royal-600')}>
                  <ScrollText size={19} />
                </div>
                <div className="flex-1">
                  <div className="font-extrabold text-[15.5px] tracking-tight">{c.name}</div>
                  {c.description && <div className="text-[12px] text-ink-muted">{c.description}</div>}
                </div>
                {categoryId === c.id && <Check size={20} className="text-midnight flex-none" strokeWidth={3} />}
              </button>
            ))}
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <div className="px-1.5">
            <Display className="text-[25px]">How urgent is this?</Display>
            <p className="text-[13.5px] text-ink-muted mt-1">Be honest — urgent questions really do jump the queue.</p>
          </div>
          <div className="flex flex-col gap-2.5">
            {config.urgencyTiers.map((t) => (
              <button key={t.id} type="button" onClick={() => { setUrgencyId(t.id); setStep(2); }}
                className={clsx(
                  'rounded-xl bg-surface shadow-card px-4 py-4 text-left border-2 transition-colors',
                  urgencyId === t.id ? 'border-brass-500 bg-[#FDFAF2]' : 'border-transparent',
                )}>
                <div className="font-extrabold text-[15.5px] tracking-tight">{t.name}</div>
                {t.description && <div className="text-[12.5px] text-ink-muted mt-0.5">{t.description}</div>}
              </button>
            ))}
          </div>
          <button className="text-sm font-bold text-royal-600 text-center" onClick={() => setStep(0)}>Back</button>
        </>
      )}

      {step === 2 && (
        <>
          <div className="px-1.5">
            <Display className="text-[25px]">Your question</Display>
            <p className="text-[13.5px] text-ink-muted mt-1">
              {selectedCategory?.is_sensitive
                ? 'Write freely — this goes only to the Rov, and is never shown to anyone else.'
                : 'As much detail as you can — it saves the Rov ringing you back for basics.'}
            </p>
          </div>
          <textarea
            className="w-full rounded-xl border-0 bg-surface shadow-card px-4 py-4 text-[16px] min-h-[180px] focus:outline-none focus:ring-2 focus:ring-royal-500 resize-none"
            placeholder="Type your shailah here…"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <BigButton busy={busy} disabled={question.trim().length < 10} onClick={submit}>
            Send to the Rov
          </BigButton>
          {error && <p className="text-danger-text text-sm font-bold text-center">{error}</p>}
          <button className="text-sm font-bold text-royal-600 text-center"
            onClick={() => setStep(selectedCategory?.default_same_day ? 0 : 1)}>Back</button>
        </>
      )}
    </div>
  );
}
