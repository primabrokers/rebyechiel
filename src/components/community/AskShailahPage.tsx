import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import type { Category, UrgencyTier } from '../../types';
import {
  BigButton, Choice, Headline, Note, PromisePanel, Screen, Spinner, StepBar, textareaCls,
} from '../shared/ui';

/**
 * Three steps: what it's about, how urgent, then the question itself. The last screen carries
 * the promise before they send — a real one, worked out from what is already in the Rov's queue,
 * so nobody is left wondering whether their shailah has fallen down a hole.
 */
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

  const category = useMemo(
    () => config?.categories.find((c) => c.id === categoryId) ?? null,
    [config, categoryId],
  );
  const tier = config?.urgencyTiers.find((t) => t.id === urgencyId) ?? null;

  // The promise shown before sending. Same shape as the server's answer, in the same words —
  // it is a preview of the real calculation, not a different one.
  const preview = category?.default_same_day
    ? 'by this evening'
    : tier?.promise_type === 'same_day' ? 'by this evening'
      : tier?.promise_type === 'hours' ? 'within a day or two'
        : 'in turn, once the Rov reaches it';

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

  // --- sent ---------------------------------------------------------------------------------
  if (done) {
    return (
      <Screen tone="surface">
        <div className="flex-1 px-6 md:px-7 pt-16 md:pt-12 flex flex-col gap-5">
          <div className="w-[62px] h-[62px] rounded-xl bg-indigo grid place-items-center text-[26px] text-white">✦</div>
          <Headline title={<>Your shailah is<br />with the Rov</>}
            sub="Only he reads it. We'll text you the moment there's an answer." />
          <PromisePanel
            eyebrow="You'll have an answer"
            headline={done.expected_reply_text.replace('The Rov expects to answer ', '').replace(/\.$/, '')}
            sub={<>
              {category?.default_same_day ? 'These questions are always answered the same day. ' : ''}
              Your reference is <b className="font-mono">{done.ref}</b>.
            </>}
          />
        </div>
        <div className="px-5 md:px-7 pb-7 md:pb-8 flex flex-col gap-2.5">
          <BigButton onClick={() => nav('/')}>Back to home</BigButton>
        </div>
      </Screen>
    );
  }

  if (!config) {
    return (
      <Screen tone="surface">
        {error ? <p className="pt-24 px-8 text-center text-[13.5px] font-bold text-late">{error}</p> : <Spinner />}
      </Screen>
    );
  }

  const back = () => {
    if (step === 0) { nav('/'); return; }
    setStep(step === 2 && category?.default_same_day ? 0 : step - 1);
  };

  return (
    <Screen tone="surface">
      <StepBar onBack={back} steps={3} at={step} />

      {step === 0 && (
        <div className="px-5 md:px-7 py-5 flex flex-col gap-3.5">
          <Headline title="What is it about?" sub="This only helps the Rov sort his queue — pick the closest." />
          <div className="flex flex-col gap-2">
            {config.categories.map((c) => (
              <Choice key={c.id} title={c.name} sub={c.description ?? undefined}
                selected={categoryId === c.id}
                onClick={() => { setCategoryId(c.id); setStep(c.default_same_day ? 2 : 1); }} />
            ))}
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="px-5 md:px-7 py-5 flex flex-col gap-3.5">
          <Headline title="How urgent is this?" sub="Be honest — urgent questions really do jump the queue." />
          <div className="flex flex-col gap-2">
            {config.urgencyTiers.map((t) => (
              <Choice key={t.id} title={t.name} sub={t.description ?? undefined}
                selected={urgencyId === t.id}
                onClick={() => { setUrgencyId(t.id); setStep(2); }} />
            ))}
          </div>
        </div>
      )}

      {step === 2 && (
        <>
          <div className="px-5 md:px-7 py-5 flex flex-col gap-3.5">
            <Headline title="Write your shailah"
              sub={category?.is_sensitive
                ? 'Write freely. This goes to the Rov alone — no helper of his can see it, in the app or anywhere else.'
                : 'As much detail as you can — it saves the Rov ringing you back for basics.'} />
            <textarea
              className={textareaCls + ' min-h-[150px] text-[14.5px]'}
              placeholder="Type your shailah here…"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
            <PromisePanel
              eyebrow="Before you send"
              headline={<>You'll have an answer<br />{preview}.</>}
              sub="A real promise based on what's already in his queue — not a guess."
            />

            {category?.is_sensitive && (
              <Note icon="🔒">
                Private shailos never appear in a text message, in a list, or on a helper's screen. If you would
                rather he rang you, say so in the question and he will.
              </Note>
            )}
          </div>

          <div className="mt-auto px-5 md:px-7 pt-4 pb-7 md:pb-8 flex flex-col gap-2.5">
            {error && <p className="text-[13px] font-bold text-late text-center">{error}</p>}
            <BigButton busy={busy} disabled={question.trim().length < 10} onClick={submit}>Send to the Rov</BigButton>
            <span className="text-[11.5px] text-center text-ink-muted">Nobody else sees this. Not the office, not a helper.</span>
          </div>
        </>
      )}
    </Screen>
  );
}
