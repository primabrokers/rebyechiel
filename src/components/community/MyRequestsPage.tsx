import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { api } from '../../lib/api';
import type { Booking, Shailah } from '../../types';
import { BigButton, Display, EmptyState, Pill, SectionLabel, Spinner } from '../shared/ui';
import { fmtDate, fmtSlot } from '../../lib/format';

const SHAILAH_PILL: Record<string, { tone: 'ok' | 'warn' | 'bad' | 'info'; label: string }> = {
  new: { tone: 'warn', label: 'With the Rov' },
  triaged: { tone: 'warn', label: 'With the Rov' },
  in_progress: { tone: 'warn', label: 'Being looked at' },
  answered: { tone: 'ok', label: 'Answered' },
  closed: { tone: 'info', label: 'Closed' },
  withdrawn: { tone: 'info', label: 'Withdrawn' },
};
const BOOKING_PILL: Record<string, { tone: 'ok' | 'warn' | 'bad' | 'info'; label: string }> = {
  requested: { tone: 'warn', label: 'Awaiting the Rov' },
  confirmed: { tone: 'ok', label: 'Confirmed' },
  declined: { tone: 'bad', label: 'Not possible' },
  rescheduled: { tone: 'warn', label: 'Rescheduled' },
  cancelled: { tone: 'info', label: 'Cancelled' },
  completed: { tone: 'info', label: 'Done' },
};

export function MyRequestsPage() {
  const [shailos, setShailos] = useState<Shailah[] | null>(null);
  const [bookings, setBookings] = useState<Booking[] | null>(null);

  useEffect(() => {
    supabase.from('rabbi_shailos').select('*').order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => setShailos((data as Shailah[]) ?? []));
    supabase.from('rabbi_bookings').select('*').order('starts_at', { ascending: false }).limit(50)
      .then(({ data }) => setBookings((data as Booking[]) ?? []));
  }, []);

  if (!shailos || !bookings) return <Spinner />;

  return (
    <div className="min-h-screen max-w-md mx-auto px-5 pt-6 pb-10 flex flex-col gap-3">
      <div className="flex items-center gap-3 px-1">
        <Link to="/" className="p-2 -ml-2 text-ink-soft"><ArrowLeft size={22} /></Link>
        <Display className="text-[24px]">My requests</Display>
      </div>

      {shailos.length === 0 && bookings.length === 0 && (
        <EmptyState title="Nothing here yet" sub="Ask a shailah or book a call from the home screen." />
      )}

      {bookings.length > 0 && <SectionLabel>Calls & meetings</SectionLabel>}
      {bookings.map((b) => (
        <div key={b.id} className="bg-surface rounded-xl shadow-card p-4 flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-extrabold text-[15.5px] tracking-tight">
              {b.slot_type === 'call' ? 'Phone call' : 'Meeting'} · {fmtSlot(b.starts_at)}
            </span>
            <Pill tone={BOOKING_PILL[b.status]?.tone ?? 'info'}>{BOOKING_PILL[b.status]?.label ?? b.status}</Pill>
          </div>
          {b.status === 'declined' && (
            <p className="text-[13px] text-ink-soft">
              {b.decline_reason ? `The Rov: "${b.decline_reason}"` : 'The Rov could not make this time.'} You're welcome to book another.
            </p>
          )}
          <p className="text-[12px] text-ink-faint">Ref {b.ref}</p>
        </div>
      ))}

      {shailos.length > 0 && <SectionLabel>Questions</SectionLabel>}
      {shailos.map((s) => (
        <Link key={s.id} to={`/requests/${s.id}`} className="bg-surface rounded-xl shadow-card p-4 flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-extrabold text-[15.5px] tracking-tight">Question {s.ref}</span>
            <Pill tone={SHAILAH_PILL[s.status]?.tone ?? 'info'}>{SHAILAH_PILL[s.status]?.label ?? s.status}</Pill>
          </div>
          <p className="text-[13px] text-ink-muted line-clamp-1">{s.question}</p>
          <p className="text-[12px] text-ink-faint">Asked {fmtDate(s.created_at)}</p>
        </Link>
      ))}
    </div>
  );
}

export function RequestDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [shailah, setShailah] = useState<Shailah | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from('rabbi_shailos').select('*').eq('id', id).maybeSingle()
      .then(({ data }) => setShailah((data as Shailah | null) ?? null));
  }, [id]);

  if (shailah === undefined) return <Spinner />;
  if (shailah === null) return <EmptyState title="Not found" />;

  const withdraw = async () => {
    setBusy(true);
    try {
      await api('withdraw', { shailahId: shailah.id });
      nav('/requests');
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen max-w-md mx-auto px-5 pt-6 pb-10 flex flex-col gap-4">
      <div className="flex items-center gap-3 px-1">
        <Link to="/requests" className="p-2 -ml-2 text-ink-soft"><ArrowLeft size={22} /></Link>
        <Display className="text-[24px]">Question {shailah.ref}</Display>
      </div>

      <div className="bg-royal-100 rounded-xl p-4 text-[14.5px] text-ink-soft leading-relaxed">
        <span className="font-extrabold text-ink block mb-1">Your question</span>
        {shailah.question}
      </div>

      {shailah.status === 'answered' || shailah.status === 'closed' ? (
        shailah.answer ? (
          <div className="bg-surface rounded-xl shadow-card p-5">
            <div className="text-[11.5px] uppercase tracking-[0.12em] font-extrabold text-brass-500 mb-2">The Rov's answer</div>
            <p className="font-display text-[18px] leading-relaxed whitespace-pre-wrap">{shailah.answer}</p>
            {shailah.answered_at && <p className="text-[12px] text-ink-faint mt-3">Answered {fmtDate(shailah.answered_at)}</p>}
          </div>
        ) : (
          <div className="bg-surface rounded-xl shadow-card p-5 text-[14.5px] text-ink-soft">
            The Rov has dealt with this — he will speak to you directly rather than answer in writing.
          </div>
        )
      ) : shailah.status === 'withdrawn' ? (
        <p className="text-[14px] text-ink-muted text-center">You withdrew this question.</p>
      ) : (
        <>
          <div className="bg-surface rounded-xl shadow-card p-4">
            <div className="text-[11.5px] uppercase tracking-[0.12em] font-extrabold text-ink-muted">Expected answer</div>
            <div className="font-display font-semibold text-[20px] text-midnight mt-0.5">
              {(shailah.expected_reply_text ?? 'As soon as the Rov can.').replace('The Rov expects to answer ', '').replace(/\.$/, '')}
            </div>
            <p className="text-[12.5px] text-ink-muted mt-1">We'll text you the moment it's ready.</p>
          </div>
          <BigButton tone="quiet" busy={busy} onClick={withdraw}>Withdraw this question</BigButton>
        </>
      )}
    </div>
  );
}
