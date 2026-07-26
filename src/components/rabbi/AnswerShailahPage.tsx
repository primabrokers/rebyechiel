import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Mic, Phone, Square } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { isDemo } from '../../lib/demo';
import { fetchCategories, fetchProfilesByIds, fetchShailah } from '../../lib/rabbiData';
import type { Category, Profile, Shailah } from '../../types';
import { AFFILIATION_LABELS } from '../../types';
import { BigButton, Display, EmptyState, Pill, Spinner } from '../shared/ui';
import { fmtDue } from '../../lib/format';

// The answer screen: the question, one big box, Send. "Call them instead" reveals the number
// and marks the shailah in progress — for answers better given by voice.
export function AnswerShailahPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [shailah, setShailah] = useState<Shailah | null | undefined>(undefined);
  const [asker, setAsker] = useState<Profile | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPhone, setShowPhone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Voice-note dictation: record → transcribe server-side → text lands in the box to edit.
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

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
        if (blob.size < 1000) return; // accidental tap
        setTranscribing(true);
        try {
          if (isDemo()) {
            setAnswer((prev) => (prev.trim() ? prev.trimEnd() + '\n' : '') +
              'The soup is fine to eat. Put the spoon aside and bring it to me after Maariv.');
            return;
          }
          const buf = await blob.arrayBuffer();
          let binary = '';
          const bytes = new Uint8Array(buf);
          const CHUNK = 0x8000;
          for (let i = 0; i < bytes.length; i += CHUNK) {
            binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
          }
          const { data, error: fnErr } = await supabase.functions.invoke('rabbi-transcribe', {
            body: { audioBase64: btoa(binary), mimeType: blob.type },
          });
          if (fnErr || data?.error) throw new Error(data?.error ?? fnErr?.message ?? 'failed');
          const text = String(data.text ?? '').trim();
          if (text) setAnswer((prev) => (prev.trim() ? prev.trimEnd() + '\n' + text : text));
        } catch {
          setError('Could not turn the voice note into text — try again, or type the answer.');
        } finally {
          setTranscribing(false);
        }
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch {
      setError('Microphone not available — check the browser permission.');
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  };

  useEffect(() => {
    if (!id) return;
    Promise.all([fetchShailah(id), fetchCategories(true)]).then(async ([s, c]) => {
      setShailah(s); setCats(c);
      setAnswer(s?.answer ?? '');
      if (s?.profile_id) {
        const map = await fetchProfilesByIds([s.profile_id]);
        setAsker(map.get(s.profile_id) ?? null);
      }
    });
  }, [id]);

  if (shailah === undefined) return <Spinner />;
  if (!shailah) return <EmptyState title="Not found" />;

  const done = ['answered', 'closed'].includes(shailah.status);
  const phone = asker?.phone ?? shailah.contact_phone;
  const name = shailah.is_sensitive && !done ? 'Private matter'
    : asker?.full_name ?? shailah.contact_name ?? 'Text-in caller';
  const cat = cats.find((c) => c.id === shailah.category_id)?.name;
  const due = fmtDue(shailah.due_at);

  const save = async (status: 'answered' | 'in_progress' | 'closed', withAnswer: boolean) => {
    setBusy(true); setError(null);
    if (isDemo()) { setBusy(false); nav('/rabbi/questions'); return; }
    // Direct update under the admin RLS policy; the notify cron texts "answer ready".
    const { error: err } = await supabase.from('rabbi_shailos').update({
      ...(withAnswer ? { answer: answer.trim() || null } : {}),
      status,
      ...(status === 'answered' ? { answered_at: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString(),
    }).eq('id', shailah.id);
    setBusy(false);
    if (err) { setError(err.message); return; }
    nav('/rabbi/questions');
  };

  return (
    <div className="flex flex-col gap-4 px-4 md:px-8 lg:px-10 pt-8 md:max-w-4xl">
      <div className="flex items-center gap-2 px-1">
        <Link to="/rabbi/questions" className="p-2 -ml-2 text-ink-soft"><ArrowLeft size={24} /></Link>
        <div className="flex-1">
          <Display className="text-[23px]">{name}</Display>
          <p className="text-[13px] text-ink-muted mt-0.5">
            {shailah.ref}{cat ? ` · ${cat}` : ''}{asker?.affiliation ? ` · ${AFFILIATION_LABELS[asker.affiliation]}` : shailah.channel === 'sms' ? ' · asked by text' : ''}
          </p>
        </div>
        {!done && <Pill tone={due.tone === 'danger' ? 'bad' : due.tone === 'warning' ? 'warn' : 'info'}>{due.label}</Pill>}
      </div>

      <div className="bg-royal-100 rounded-xl p-4 text-[15.5px] leading-relaxed">
        <span className="block text-[11.5px] uppercase tracking-[0.12em] font-extrabold text-royal-600 mb-1.5">The question</span>
        {shailah.question}
      </div>

      {done ? (
        <div className="bg-surface rounded-xl shadow-card p-5">
          <div className="text-[11.5px] uppercase tracking-[0.12em] font-extrabold text-brass-500 mb-2">Your answer</div>
          <p className="font-display text-[18px] leading-relaxed whitespace-pre-wrap">{shailah.answer ?? 'Dealt with by phone.'}</p>
        </div>
      ) : (
        <>
          <textarea
            className="w-full rounded-xl border-0 bg-surface shadow-card px-4 py-4 text-[17px] min-h-[160px] focus:outline-none focus:ring-2 focus:ring-royal-500 resize-none"
            placeholder="Type your answer — or record it below and we'll write it out for you…"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
          {!recording && !transcribing && (
            <BigButton tone="quiet" onClick={startRecording}>
              <Mic size={20} /> Say your answer instead
            </BigButton>
          )}
          {recording && (
            <BigButton tone="danger" onClick={stopRecording}>
              <Square size={18} fill="currentColor" /> Recording… tap to finish
            </BigButton>
          )}
          {transcribing && (
            <BigButton tone="quiet" disabled>
              <Loader2 size={20} className="animate-spin" /> Writing it out for you…
            </BigButton>
          )}
          <BigButton busy={busy} disabled={answer.trim().length < 2} onClick={() => save('answered', true)}>
            Send answer
          </BigButton>
          {phone && !showPhone && (
            <BigButton tone="ghost" onClick={() => { setShowPhone(true); void save('in_progress', false); }}>
              <Phone size={20} /> Call them instead
            </BigButton>
          )}
          {phone && showPhone && (
            <a href={`tel:${phone}`} className="block">
              <BigButton tone="success"><Phone size={20} /> {phone} — tap to ring</BigButton>
            </a>
          )}
          {showPhone && (
            <BigButton tone="quiet" busy={busy} onClick={() => save('closed', false)}>
              Answered by phone — close it
            </BigButton>
          )}
          {!showPhone && (
            <BigButton tone="quiet" busy={busy} onClick={() => nav('/rabbi/questions')}>
              Finish later
            </BigButton>
          )}
          {error && <p className="text-danger-text text-sm font-bold text-center">{error}</p>}
        </>
      )}
    </div>
  );
}
