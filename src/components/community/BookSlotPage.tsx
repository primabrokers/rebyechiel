import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import type { Slot } from '../../types';
import {
  BigButton, Choice, EmptyState, Headline, Note, PromisePanel, Screen, Spinner, StepBar, textareaCls,
} from '../shared/ui';
import { fmtSlot } from '../../lib/format';

/**
 * Booking a call or asking to meet. Calls take a time the Rov has already opened and are simply
 * his — a meeting is a request, and the screen never pretends otherwise.
 */
export function BookSlotPage() {
  const nav = useNavigate();
  const { slotType = 'call' } = useParams();
  const type = slotType === 'meeting' ? 'meeting' : 'call';
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [chosen, setChosen] = useState<Slot | null>(null);
  const [purpose, setPurpose] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ ref: string; status: string } | null>(null);

  const load = () => {
    setSlots(null);
    api<{ slots: Slot[] }>('slots', { slotType: type })
      .then((r) => setSlots(r.slots))
      .catch(() => setError('Could not load times — try again shortly.'));
  };
  useEffect(load, [type]);

  const book = async () => {
    if (!chosen) return;
    setBusy(true); setError(null);
    try {
      const res = await api<{ booking: { ref: string; status: string } }>('book', {
        slotType: type, releaseId: chosen.releaseId, startsAt: chosen.startsAt,
        purpose: purpose.trim() || undefined,
      });
      setDone(res.booking);
    } catch (err) {
      if (err instanceof Error && err.message === 'slot_taken') {
        setError('That time has just been taken — pick another.');
        setChosen(null);
        load();
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    } finally { setBusy(false); }
  };

  if (done) {
    const confirmed = done.status === 'confirmed';
    return (
      <Screen tone="surface">
        <div className="flex-1 px-6 md:px-7 pt-16 md:pt-12 flex flex-col gap-5">
          <div className={'w-[62px] h-[62px] rounded-xl grid place-items-center text-[26px] text-white ' +
            (confirmed ? 'bg-good' : 'bg-graphite')}>
            {type === 'call' ? '☎︎' : '◍'}
          </div>
          <Headline
            title={confirmed ? <>That's booked<br />in his diary</> : <>Your request is<br />with the Rov</>}
            sub={confirmed
              ? (type === 'call' ? 'He rings you then. We text you an hour before.' : "He'll see you then.")
              : "He confirms meetings himself. We'll text you as soon as he answers."}
          />
          <PromisePanel
            eyebrow={confirmed ? 'When' : 'You asked for'}
            headline={chosen ? fmtSlot(chosen.startsAt) : ''}
            sub={<>Your reference is <b className="font-mono">{done.ref}</b>.</>}
          />
        </div>
        <div className="px-5 md:px-7 pb-7 md:pb-8">
          <BigButton onClick={() => nav('/')}>Back to home</BigButton>
        </div>
      </Screen>
    );
  }

  return (
    <Screen tone="surface">
      <StepBar onBack={() => nav('/')} />

      <div className="px-5 md:px-7 py-4 flex flex-col gap-3.5">
        <Headline
          title={type === 'call' ? 'Book a phone call' : 'Ask to meet'}
          sub={type === 'call'
            ? 'These are times the Rov has set aside for calls. He rings you.'
            : 'Pick a time that suits — he confirms meetings himself.'}
        />

        {!slots && !error && <Spinner />}
        {error && <p className="text-[13px] font-bold text-late text-center">{error}</p>}

        {slots && slots.length === 0 && (
          <>
            <EmptyState title={`No ${type === 'call' ? 'call' : 'meeting'} times are open right now`}
              sub="The Rov opens new times regularly." />
            <Note icon="✦">
              If it can be answered in writing, a shailah reaches him sooner than a call does.
            </Note>
            <BigButton tone="outline" onClick={() => nav('/ask')}>Ask a shailah instead</BigButton>
          </>
        )}

        {slots && slots.length > 0 && (
          <div className="flex flex-col gap-2">
            {slots.map((s) => (
              <Choice key={s.releaseId + s.startsAt}
                selected={chosen?.startsAt === s.startsAt && chosen?.releaseId === s.releaseId}
                onClick={() => setChosen(s)}
                title={fmtSlot(s.startsAt)}
                sub={`${Math.round((Date.parse(s.endsAt) - Date.parse(s.startsAt)) / 60000)}-minute ${
                  type === 'call' ? 'phone call' : 'meeting'}${s.location ? ` · ${s.location}` : ''}`}
              />
            ))}
          </div>
        )}

        {chosen && type === 'meeting' && (
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-ink-soft">What is it about?</span>
            <textarea className={textareaCls + ' min-h-[84px] text-[13.5px]'}
              placeholder="A line is enough — it helps him come prepared."
              value={purpose} onChange={(e) => setPurpose(e.target.value)} />
          </label>
        )}
      </div>

      {chosen && (
        <div className="mt-auto px-5 md:px-7 pt-3 pb-7 md:pb-8 flex flex-col gap-2">
          <BigButton busy={busy} onClick={book}>
            {type === 'call' ? `Book ${fmtSlot(chosen.startsAt)}` : `Ask for ${fmtSlot(chosen.startsAt)}`}
          </BigButton>
          <span className="text-[11.5px] text-center text-ink-muted">
            {type === 'call' ? 'The Rov rings you — no need to ring him.' : 'Nothing goes in his diary until he says yes.'}
          </span>
        </div>
      )}
    </Screen>
  );
}
