import { useEffect, useState } from 'react';
import {
  fetchConversationMessages, fetchConversations, fetchProfilesByIds,
  type ConversationMessage, type ConversationRow,
} from '../../lib/rabbiData';
import type { Profile } from '../../types';
import { Panel, Spinner } from '../shared/ui';

/**
 * Every text the assistant has ever exchanged, in full.
 *
 * A shailah only exists once somebody replies YES; a booking only once they pick a time. Anyone
 * who stopped short of that — thought better of it, was interrupted, ran out of patience with the
 * assistant — left no trace the Rov could see, and a question he never knew was asked is the one
 * failure this whole app exists to prevent. So the conversation itself is the record, and the
 * ones that produced nothing are marked, at the top, in amber.
 */
const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const CLOCK = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });

/** What the Rov needs to know at a glance: did anything come of this, and is it still going? */
function verdict(c: ConversationRow): { label: string; tone: 'open' | 'lost' | 'done' } {
  const d = (c.draft ?? {}) as Record<string, unknown>;
  const hasSubject = Boolean(d.question || d.purpose || d.slot_index);
  if (c.state === 'handed_off') return { label: 'Needs you to ring', tone: 'lost' };
  if (c.state === 'confirming') return { label: 'Waiting on their YES', tone: 'lost' };
  if (c.state === 'done') return { label: 'Finished', tone: 'done' };
  if (hasSubject) return { label: 'Stopped part-way', tone: 'lost' };
  return { label: 'In progress', tone: 'open' };
}

const TONE = {
  open: 'bg-chip text-ink-muted',
  lost: 'bg-warn-bg text-warn',
  done: 'bg-good-bg text-good',
} as const;

export function TextsPage() {
  const [rows, setRows] = useState<ConversationRow[] | null>(null);
  const [people, setPeople] = useState<Map<string, Profile>>(new Map());
  const [openId, setOpenId] = useState<string | null>(null);
  const [thread, setThread] = useState<ConversationMessage[] | null>(null);

  useEffect(() => {
    fetchConversations().then(async (cs) => {
      setRows(cs);
      const ids = [...new Set(cs.map((c) => c.profile_id).filter(Boolean) as string[])];
      if (ids.length) setPeople(await fetchProfilesByIds(ids));
    });
  }, []);

  useEffect(() => {
    if (!openId) { setThread(null); return; }
    setThread(null);
    fetchConversationMessages(openId).then(setThread);
  }, [openId]);

  if (!rows) return <Spinner />;

  if (!rows.length) {
    return (
      <Panel className="p-8 text-center">
        <p className="text-[13.5px] text-ink-muted">
          Nobody has texted the line yet. When they do, every message appears here — including the
          conversations that never turn into anything.
        </p>
      </Panel>
    );
  }

  const unfinished = rows.filter((c) => verdict(c).tone === 'lost').length;

  return (
    <div className="flex flex-col gap-3">
      {unfinished > 0 && (
        <div className="rounded-md border border-warn/40 bg-warn-bg px-4 py-3">
          <span className="text-[13px] font-bold text-warn">
            {unfinished === 1 ? 'One conversation' : `${unfinished} conversations`} stopped before
            anything was created
          </span>
          <p className="text-[12.5px] leading-snug text-ink-soft mt-1">
            Somebody may have asked you something and given up. Open it and see — if it is a real
            shailah, ring them or answer it yourself.
          </p>
        </div>
      )}

      {rows.map((c) => {
        const v = verdict(c);
        const who = c.profile_id ? people.get(c.profile_id)?.full_name : null;
        const open = openId === c.id;
        const d = (c.draft ?? {}) as Record<string, unknown>;
        return (
          <Panel key={c.id} className="overflow-hidden">
            <button
              className="w-full text-left px-4 py-3.5 flex items-start gap-3 hover:bg-canvas transition-colors"
              onClick={() => setOpenId(open ? null : c.id)}
            >
              <div className="flex-1 min-w-0 flex flex-col gap-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[14px] font-extrabold tracking-tight">
                    {who ?? c.phone}
                  </span>
                  {who && <span className="font-mono text-[11.5px] text-ink-muted">{c.phone}</span>}
                  <span className={'rounded-chip px-2 py-[2px] text-[10.5px] font-bold ' + TONE[v.tone]}>
                    {v.label}
                  </span>
                  {c.intent && (
                    <span className="rounded-chip px-2 py-[2px] text-[10.5px] font-bold bg-chip text-ink-muted">
                      {c.intent === 'shailah' ? 'question' : c.intent}
                    </span>
                  )}
                </div>
                {typeof d.question === 'string' && (
                  <span className="text-[12.5px] leading-snug text-ink-soft line-clamp-2">
                    “{d.question}”
                  </span>
                )}
                <span className="font-mono text-[11px] text-ink-muted">
                  {DAY.format(new Date(c.updated_at))} · {CLOCK.format(new Date(c.updated_at))}
                </span>
              </div>
              <span className="text-[13px] text-ink-muted flex-none pt-1">{open ? '▴' : '▾'}</span>
            </button>

            {open && (
              <div className="border-t bg-canvas px-4 py-4 flex flex-col gap-2.5">
                {!thread ? <Spinner /> : thread.length === 0 ? (
                  <span className="text-[12.5px] text-ink-muted">No messages recorded.</span>
                ) : thread.map((m) => (
                  <div key={m.id} className={'flex ' + (m.direction === 'in' ? 'justify-start' : 'justify-end')}>
                    <div className={'max-w-[78%] rounded-lg px-3.5 py-2.5 flex flex-col gap-1 '
                      + (m.direction === 'in' ? 'bg-surface border' : 'bg-graphite text-white')}>
                      <span className="text-[13px] leading-relaxed whitespace-pre-wrap">{m.body}</span>
                      <span className={'font-mono text-[10px] ' + (m.direction === 'in' ? 'text-ink-muted' : 'text-white/45')}>
                        {CLOCK.format(new Date(m.created_at))}
                        {m.direction === 'out' && m.status && m.status !== 'sent' ? ` · ${m.status}` : ''}
                      </span>
                      {m.error && <span className="text-[11px] font-bold text-late">{m.error}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        );
      })}
    </div>
  );
}
