import { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Phone, Square, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { isDemo } from '../../lib/demo';
import { api } from '../../lib/api';
import { fetchProfilesByIds } from '../../lib/rabbiData';
import type { Category, Profile, Shailah, UrgencyTier } from '../../types';
import { Btn, Chip, Eyebrow, Mono, Portal, textareaCls } from '../shared/ui';
import { affiliationOf, dueChip, whoOf } from '../../lib/present';

/**
 * Answering happens in a drawer over the queue, not on a separate page: he keeps his place in
 * the list, and closing it puts him back where he was. The order is deliberate — what they
 * asked, why it was sorted that way, then the box to write in.
 */
export function AnswerDrawer({ shailah, categories, tiers, onClose, onDone }: {
  shailah: Shailah;
  categories: Category[];
  tiers: UrgencyTier[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [answer, setAnswer] = useState(shailah.answer ?? '');
  const [busy, setBusy] = useState(false);
  const [asker, setAsker] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPhone, setShowPhone] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (shailah.profile_id) fetchProfilesByIds([shailah.profile_id]).then((m) => setAsker(m.get(shailah.profile_id!) ?? null));
  }, [shailah.profile_id]);

  // Escape closes the drawer, as it would in any desktop app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const cat = categories.find((c) => c.id === shailah.category_id);
  const tier = tiers.find((t) => t.id === shailah.urgency_tier_id);
  const suggestedCat = categories.find((c) => c.id === shailah.ai_suggested_category_id);
  const due = dueChip(shailah.due_at);
  const phone = asker?.phone ?? shailah.contact_phone;
  const done = ['answered', 'closed'].includes(shailah.status);
  const profiles = new Map(asker ? [[asker.id, asker]] : []);

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        if (blob.size < 1000) return; // an accidental tap
        setTranscribing(true);
        try {
          if (isDemo()) {
            setAnswer((p) => (p.trim() ? p.trimEnd() + '\n' : '') + 'The soup is fine to eat. Put the spoon aside and bring it to me after Maariv.');
            return;
          }
          const buf = await blob.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = '';
          const CHUNK = 0x8000;
          for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
          const { data, error: fnErr } = await supabase.functions.invoke('rabbi-transcribe', {
            body: { audioBase64: btoa(binary), mimeType: blob.type },
          });
          if (fnErr || data?.error) throw new Error(data?.error ?? fnErr?.message ?? 'failed');
          const text = String(data.text ?? '').trim();
          if (text) setAnswer((p) => (p.trim() ? p.trimEnd() + '\n' + text : text));
        } catch {
          setError("Couldn't turn that into text — try again, or type it.");
        } finally { setTranscribing(false); }
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch {
      setError('Microphone not available — check the browser permission.');
    }
  };

  const stopRecording = () => { recorderRef.current?.stop(); recorderRef.current = null; setRecording(false); };

  const save = async (status: 'answered' | 'in_progress' | 'closed', withAnswer: boolean) => {
    setBusy(true); setError(null);
    if (isDemo()) { setBusy(false); onDone(status === 'answered' ? 'Answer sent — they have been texted.' : 'Saved.'); return; }
    const { error: err } = await supabase.from('rabbi_shailos').update({
      ...(withAnswer ? { answer: answer.trim() || null } : {}),
      status,
      ...(status === 'answered' ? { answered_at: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString(),
    }).eq('id', shailah.id);
    setBusy(false);
    if (err) { setError(err.message); return; }
    onDone(status === 'answered'
      ? `Answer sent — ${whoOf(shailah, profiles)} has been texted.`
      : 'Saved. It stays in your list.');
  };

  const confirmTriage = async () => {
    setBusy(true);
    try {
      await api('confirm_triage', {
        shailahId: shailah.id,
        categoryId: shailah.ai_suggested_category_id ?? shailah.category_id,
        urgencyTierId: shailah.ai_suggested_urgency_id ?? shailah.urgency_tier_id,
      });
      onDone('Sorted — the promise has been recalculated.');
    } finally { setBusy(false); }
  };

  return (
    <Portal>
      <div onClick={onClose} className="fixed inset-0 z-40 bg-graphite-deep/40" />
      <aside className="fixed top-0 right-0 bottom-0 z-50 w-full sm:w-[560px] bg-surface flex flex-col shadow-drawer animate-slideIn">
        <header className="px-6 py-5 border-b flex items-start gap-3">
          <div className="flex-1 flex flex-col gap-1.5 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="text-[18px] font-extrabold tracking-tight">
                {shailah.is_sensitive && !done ? 'Private matter' : whoOf(shailah, profiles)}
              </span>
              {done ? <Chip tone="good">Answered</Chip> : <Chip tone={due.tone}>{due.label}</Chip>}
            </div>
            <Mono className="text-[11.5px]">
              {shailah.ref} · {cat?.name ?? 'not sorted'} · {shailah.channel === 'sms' ? 'texted in' : 'in the app'}
              {affiliationOf(shailah, profiles) ? ` · ${affiliationOf(shailah, profiles)}` : ''}
            </Mono>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="w-8 h-8 rounded-ctl grid place-items-center text-ink-muted hover:bg-canvas flex-none">
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-auto px-6 py-5 flex flex-col gap-4">
          <div className="bg-canvas rounded-md p-4 flex flex-col gap-2">
            <Eyebrow>What they asked</Eyebrow>
            <p className="text-[15px] leading-relaxed text-ink text-pretty whitespace-pre-wrap">{shailah.question}</p>
          </div>

          {!done && (suggestedCat || tier) && (
            <div className="rounded-md border border-indigo/[.28] bg-indigo-soft px-4 py-3.5 flex gap-3 items-start">
              <span className="text-[14px] text-indigo flex-none">◈</span>
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] leading-snug text-indigo-ink">
                  <b>Sorted as {(suggestedCat ?? cat)?.name ?? 'unsorted'}{tier ? `, ${tier.name.split(' — ')[0].toLowerCase()}` : ''}.</b>{' '}
                  {shailah.ai_summary ?? ''}
                </span>
                {!shailah.triage_confirmed_at && (
                  <button onClick={confirmTriage} disabled={busy} className="text-[12.5px] font-bold text-indigo text-left">
                    Confirm how it's sorted
                  </button>
                )}
              </div>
            </div>
          )}

          {done ? (
            <div className="flex flex-col gap-2">
              <Eyebrow>Your answer</Eyebrow>
              <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{shailah.answer ?? 'Dealt with by phone.'}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              <Eyebrow>Your answer</Eyebrow>
              <textarea
                className={textareaCls + ' min-h-[150px] text-[15px]'}
                placeholder="Type it, or press Say it and we'll write it out for you…"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
              />
              <div className="flex gap-2 flex-wrap">
                {!recording && !transcribing && (
                  <Btn onClick={startRecording}><Mic size={15} /> Say it instead</Btn>
                )}
                {recording && (
                  <Btn tone="dark" onClick={stopRecording}><Square size={13} fill="currentColor" /> Recording — tap to finish</Btn>
                )}
                {transcribing && (
                  <Btn disabled><Loader2 size={15} className="animate-spin" /> Writing it out…</Btn>
                )}
                {phone && (
                  showPhone
                    ? <a href={`tel:${phone}`}><Btn tone="good"><Phone size={15} /> {phone}</Btn></a>
                    : <Btn onClick={() => { setShowPhone(true); void save('in_progress', false); }}><Phone size={15} /> Ring them</Btn>
                )}
              </div>
              {error && <p className="text-[12.5px] font-bold text-late">{error}</p>}
            </div>
          )}
        </div>

        {!done && (
          <footer className="px-6 pt-4 pb-5 border-t flex flex-col gap-2.5 bg-surface">
            <span className="text-[12.5px] text-ink-muted">
              {shailah.channel === 'sms'
                ? 'They have no smartphone — they get a text saying the answer is ready.'
                : "They'll be texted that the answer is ready, and read it in the app."}
            </span>
            <div className="flex gap-2.5">
              <Btn tone="dark" busy={busy} disabled={answer.trim().length < 2}
                className="flex-1 py-3.5 text-[14.5px]" onClick={() => save('answered', true)}>
                Send the answer
              </Btn>
              {showPhone && (
                <Btn busy={busy} className="py-3.5 text-[14.5px]" onClick={() => save('closed', false)}>Answered by phone</Btn>
              )}
            </div>
          </footer>
        )}
      </aside>
    </Portal>
  );
}
