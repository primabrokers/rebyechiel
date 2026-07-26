import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarCheck } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../../lib/api';
import type { Slot } from '../../types';
import { BigButton, Display, EmptyState, Spinner } from '../shared/ui';
import { fmtSlot } from '../../lib/format';

// Pick a released slot; meetings collect a short purpose so the Rov can decide.
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
      <div className="min-h-screen max-w-md mx-auto px-6 pt-16 pb-10 flex flex-col gap-5 text-center">
        <div className="w-[92px] h-[92px] rounded-full mx-auto flex items-center justify-center text-brass-100 shadow-raised"
          style={{ background: 'radial-gradient(circle at 32% 28%, #2C4E7E, #0F1E33)' }}>
          <CalendarCheck size={38} />
        </div>
        <Display className="text-[27px]">{confirmed ? 'Booked' : 'Request sent to the Rov'}</Display>
        <div className="bg-surface rounded-xl shadow-card p-4">
          <div className="font-display font-semibold text-[21px] text-midnight">{chosen && fmtSlot(chosen.startsAt)}</div>
          <p className="text-[13px] text-ink-muted mt-1">
            {confirmed
              ? `The Rov will ${type === 'call' ? 'call you' : 'see you'} then · Ref ${done.ref}`
              : `We'll text you as soon as the Rov confirms · Ref ${done.ref}`}
          </p>
        </div>
        <BigButton tone="ghost" onClick={() => nav('/')}>Back to home</BigButton>
      </div>
    );
  }

  return (
    <div className="min-h-screen max-w-md mx-auto px-5 pt-6 pb-10 flex flex-col gap-4">
      <div className="flex items-center gap-3 px-1">
        <Link to="/" className="p-2 -ml-2 text-ink-soft"><ArrowLeft size={22} /></Link>
      </div>
      <div className="px-1.5">
        <Display className="text-[25px]">{type === 'call' ? 'Book a phone call' : 'Request a meeting'}</Display>
        <p className="text-[13.5px] text-ink-muted mt-1">
          {type === 'call'
            ? 'Times the Rov has set aside for calls. He rings you.'
            : 'Pick a time — the Rov confirms meeting requests himself.'}
        </p>
      </div>

      {!slots && !error && <Spinner />}
      {error && <p className="text-danger-text text-sm font-bold text-center">{error}</p>}
      {slots && slots.length === 0 && (
        <EmptyState title={`No ${type} times are open right now`}
          sub="The Rov releases new times regularly — check back soon, or send a shailah instead." />
      )}

      {slots && slots.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {slots.map((s) => (
            <button key={s.releaseId + s.startsAt} type="button" onClick={() => setChosen(s)}
              className={clsx(
                'rounded-xl bg-surface shadow-card px-4 py-4 text-left border-2 transition-colors',
                chosen?.startsAt === s.startsAt && chosen?.releaseId === s.releaseId
                  ? 'border-brass-500 bg-[#FDFAF2]' : 'border-transparent',
              )}>
              <div className="font-extrabold text-[15.5px] tracking-tight">{fmtSlot(s.startsAt)}</div>
              <div className="text-[12.5px] text-ink-muted mt-0.5">
                {Math.round((Date.parse(s.endsAt) - Date.parse(s.startsAt)) / 60000)}-minute {type === 'call' ? 'phone call' : 'meeting'}
                {s.location ? ` · ${s.location}` : ''}
              </div>
            </button>
          ))}
        </div>
      )}

      {chosen && type === 'meeting' && (
        <textarea
          className="w-full rounded-xl border-0 bg-surface shadow-card px-4 py-3.5 text-[15px] min-h-[90px] focus:outline-none focus:ring-2 focus:ring-royal-500 resize-none"
          placeholder="What is the meeting about? (a line is enough)"
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
        />
      )}

      {chosen && (
        <BigButton busy={busy} onClick={book}>
          {type === 'call' ? `Book ${fmtSlot(chosen.startsAt)}` : `Request ${fmtSlot(chosen.startsAt)}`}
        </BigButton>
      )}
    </div>
  );
}
