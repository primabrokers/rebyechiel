import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { demoBookings, demoInvitations, demoMyShailos, isDemo } from '../../lib/demo';
import { api } from '../../lib/api';
import { OCCASION_LABELS, type Booking, type Invitation, type Shailah } from '../../types';
import {
  BigButton, Chip, EmptyState, Eyebrow, Headline, Mono, Phone, PromisePanel, Spinner, StepBar,
  type ChipTone,
} from '../shared/ui';
import { fmtDate, fmtSlot } from '../../lib/format';

const SHAILAH_STATE: Record<string, { tone: ChipTone; label: string }> = {
  new: { tone: 'warn', label: 'With the Rov' },
  triaged: { tone: 'warn', label: 'With the Rov' },
  in_progress: { tone: 'warn', label: 'Being looked at' },
  answered: { tone: 'good', label: 'Answered' },
  closed: { tone: 'neutral', label: 'Closed' },
  withdrawn: { tone: 'neutral', label: 'Withdrawn' },
};
const BOOKING_STATE: Record<string, { tone: ChipTone; label: string }> = {
  requested: { tone: 'warn', label: 'With the Rov' },
  confirmed: { tone: 'good', label: 'Confirmed' },
  declined: { tone: 'late', label: 'Not possible' },
  rescheduled: { tone: 'warn', label: 'Moved' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
  completed: { tone: 'neutral', label: 'Done' },
};
const INVITATION_STATE: Record<string, { tone: ChipTone; label: string }> = {
  requested: { tone: 'warn', label: 'With the Rov' },
  accepted: { tone: 'good', label: 'He said yes' },
  declined: { tone: 'late', label: 'Not this time' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
};

/** Everything you have ever asked of the Rov, newest first. */
export function MyRequestsPage() {
  const nav = useNavigate();
  const [shailos, setShailos] = useState<Shailah[] | null>(null);
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);

  useEffect(() => {
    if (isDemo()) {
      setShailos(demoMyShailos); setBookings(demoBookings); setInvitations(demoInvitations);
      return;
    }
    supabase.from('rabbi_shailos').select('*').order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => setShailos((data as Shailah[]) ?? []));
    supabase.from('rabbi_bookings').select('*').order('starts_at', { ascending: false }).limit(50)
      .then(({ data }) => setBookings((data as Booking[]) ?? []));
    supabase.from('rabbi_invitations').select('*').order('starts_at', { ascending: false }).limit(50)
      .then(({ data }) => setInvitations((data as Invitation[]) ?? []));
  }, []);

  if (!shailos || !bookings || !invitations) return <Phone><Spinner /></Phone>;

  const nothing = !shailos.length && !bookings.length && !invitations.length;

  return (
    <Phone>
      <StepBar onBack={() => nav('/')} />
      <div className="px-5 py-4 flex flex-col gap-3">
        <Headline title="Where things stand" />

        {nothing && (
          <EmptyState title="Nothing here yet" sub="Ask a shailah or book a call from the home screen." />
        )}

        {shailos.length > 0 && <Eyebrow className="pt-1">Questions</Eyebrow>}
        {shailos.map((s) => {
          const state = SHAILAH_STATE[s.status] ?? { tone: 'neutral' as ChipTone, label: s.status };
          return (
            <Link key={s.id} to={`/requests/${s.id}`} className="bg-surface border rounded-lg p-3.5 flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Mono className="text-[11.5px]">{s.ref}</Mono>
                <span className="ml-auto"><Chip tone={state.tone}>{state.label}</Chip></span>
              </div>
              <span className="text-[13.5px] leading-snug line-clamp-2">{s.question}</span>
              <span className="text-[12px] text-ink-faint">Asked {fmtDate(s.created_at)}</span>
            </Link>
          );
        })}

        {bookings.length > 0 && <Eyebrow className="pt-1">Calls and meetings</Eyebrow>}
        {bookings.map((b) => {
          const state = BOOKING_STATE[b.status] ?? { tone: 'neutral' as ChipTone, label: b.status };
          return (
            <div key={b.id} className="bg-surface border rounded-lg p-3.5 flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[13.5px] font-extrabold">
                  {b.slot_type === 'call' ? 'Phone call' : 'Meeting'} · {fmtSlot(b.starts_at)}
                </span>
                <span className="ml-auto"><Chip tone={state.tone}>{state.label}</Chip></span>
              </div>
              {b.status === 'declined' && (
                <span className="text-[12.5px] leading-snug text-ink-soft">
                  {b.decline_reason ? `The Rov: “${b.decline_reason}”` : 'The Rov could not make this time.'} You're
                  welcome to pick another.
                </span>
              )}
              <Mono className="text-[11.5px]">{b.ref}</Mono>
            </div>
          );
        })}

        {invitations.length > 0 && <Eyebrow className="pt-1">Invitations to speak</Eyebrow>}
        {invitations.map((i) => {
          const state = INVITATION_STATE[i.status] ?? { tone: 'neutral' as ChipTone, label: i.status };
          return (
            <div key={i.id} className="bg-surface border rounded-lg p-3.5 flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[13.5px] font-extrabold truncate">
                  {OCCASION_LABELS[i.occasion]} · {fmtSlot(i.starts_at)}
                </span>
                <span className="ml-auto flex-none"><Chip tone={state.tone}>{state.label}</Chip></span>
              </div>
              <span className="text-[12.5px] text-ink-soft">
                {i.duration_minutes} minutes{i.location ? ` · ${i.location}` : ''}
              </span>
              {i.status === 'declined' && i.decline_reason && (
                <span className="text-[12.5px] leading-snug text-ink-soft">The Rov: “{i.decline_reason}”</span>
              )}
              <Mono className="text-[11.5px]">{i.ref}</Mono>
            </div>
          );
        })}
      </div>
    </Phone>
  );
}

/** One question: the Rov's answer if it has come, the promise if it hasn't. */
export function RequestDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [shailah, setShailah] = useState<Shailah | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isDemo()) { setShailah(demoMyShailos.find((x) => x.id === id) ?? null); return; }
    supabase.from('rabbi_shailos').select('*').eq('id', id).maybeSingle()
      .then(({ data }) => setShailah((data as Shailah | null) ?? null));
  }, [id]);

  if (shailah === undefined) return <Phone><Spinner /></Phone>;
  if (shailah === null) return <Phone><EmptyState title="Not found" /></Phone>;

  const withdraw = async () => {
    setBusy(true);
    try {
      await api('withdraw', { shailahId: shailah.id });
      nav('/requests');
    } finally { setBusy(false); }
  };

  const answered = shailah.status === 'answered' || shailah.status === 'closed';

  return (
    <Phone>
      <StepBar onBack={() => nav('/requests')} right={<Mono className="text-[11.5px]">{shailah.ref}</Mono>} />

      <div className="px-5 py-4 flex flex-col gap-3.5">
        {answered && (
          <div className="flex items-center gap-2.5">
            <span className="w-[9px] h-[9px] rounded-pill bg-good flex-none" />
            <Eyebrow className="!text-good">
              Answered{shailah.answered_at ? ` · ${formatDistanceToNow(new Date(shailah.answered_at))} ago` : ''}
            </Eyebrow>
          </div>
        )}

        {answered && (
          <div className="bg-surface border rounded-xl p-5 flex flex-col gap-2.5">
            <Eyebrow>The Rov's answer</Eyebrow>
            {shailah.answer ? (
              <p className="text-[15.5px] leading-[1.65] text-pretty whitespace-pre-wrap">{shailah.answer}</p>
            ) : (
              <p className="text-[14.5px] leading-relaxed text-ink-soft">
                The Rov has dealt with this — he'll speak to you directly rather than answer in writing.
              </p>
            )}
            <div className="h-px bg-[rgba(16,19,24,.08)] my-0.5" />
            <div className="flex gap-2.5">
              <button onClick={() => nav('/ask')}
                className="flex-1 rounded-ctl bg-canvas py-2.5 text-[13px] font-bold">Ask a follow-up</button>
            </div>
          </div>
        )}

        <div className="bg-surface border rounded-xl p-4 flex flex-col gap-1.5">
          <Eyebrow>What you asked</Eyebrow>
          <p className="text-[13.5px] leading-relaxed text-ink-soft whitespace-pre-wrap">{shailah.question}</p>
          <span className="text-[12px] text-ink-faint">Asked {fmtDate(shailah.created_at)}</span>
        </div>

        {!answered && shailah.status === 'withdrawn' && (
          <p className="text-[13.5px] text-ink-muted text-center">You withdrew this question.</p>
        )}

        {!answered && shailah.status !== 'withdrawn' && (
          <>
            <PromisePanel
              eyebrow="You'll have an answer"
              headline={(shailah.expected_reply_text ?? 'As soon as the Rov reaches it.')
                .replace('The Rov expects to answer ', '').replace(/\.$/, '')}
              sub="We'll text you the moment it's ready."
            />
            <BigButton tone="quiet" busy={busy} onClick={withdraw}>Withdraw this question</BigButton>
          </>
        )}
      </div>
    </Phone>
  );
}
