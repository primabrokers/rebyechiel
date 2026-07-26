import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { isDemo } from '../../lib/demo';
import { Btn, Panel, inputCls } from '../shared/ui';

/**
 * The accounts the app talks to, in one place: paste a key, save it, prove it works.
 *
 * Keys are written straight into the database vault by the rabbi-secrets function, which is the
 * only thing that can read them. Nothing here ever shows a key back — only whether one is set
 * and its last four characters, so he can tell one from another. Only the Rov sees this panel;
 * a helper can run the whole app without holding the keys to the account.
 */
type Status = Record<string, { set: boolean; hint: string | null }>;

const KEYS: { name: string; label: string; hint: string; placeholder: string }[] = [
  { name: 'TEXTMAGIC_USERNAME', label: 'TextMagic username', placeholder: 'your TextMagic login',
    hint: 'From textmagic.com → your account.' },
  { name: 'TEXTMAGIC_API_KEY', label: 'TextMagic API key', placeholder: 'xxxxxxxxxxxxxxxx',
    hint: 'TextMagic → Services → API → generate a new key.' },
  { name: 'TEXTMAGIC_SENDER', label: 'The number texts come from', placeholder: '+447700900000',
    hint: 'Your dedicated TextMagic number. Leave blank to use the account default.' },
  { name: 'OPENAI_API_KEY', label: 'OpenAI key', placeholder: 'sk-…',
    hint: 'Sorting questions, the text-in assistant, the morning briefing, voice notes.' },
];

export function ConnectionsPanel({ rabbiPhone, say }: { rabbiPhone: string | null; say: (m: string) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [testTo, setTestTo] = useState(rabbiPhone ?? '');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [hook, setHook] = useState<{ url: string; everReceived: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  const call = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke('rabbi-secrets', { body });
    if (error) throw new Error(error.message);
    return data as Record<string, unknown>;
  };

  const load = async () => {
    if (isDemo()) {
      setStatus({
        TEXTMAGIC_USERNAME: { set: true, hint: 'ller' }, TEXTMAGIC_API_KEY: { set: true, hint: '9f2a' },
        TEXTMAGIC_SENDER: { set: true, hint: '0000' }, OPENAI_API_KEY: { set: false, hint: null },
      });
      return;
    }
    try { setStatus(((await call({ action: 'status' })).secrets as Status) ?? {}); } catch { setStatus({}); }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (isDemo()) { setHook({ url: 'https://…/functions/v1/rabbi-sms-inbound?secret=…', everReceived: false }); return; }
    call({ action: 'webhook_url' })
      .then((d) => setHook({ url: String(d.url), everReceived: Boolean(d.everReceived) }))
      .catch(() => setHook(null));
  }, []);
  useEffect(() => { if (rabbiPhone && !testTo) setTestTo(rabbiPhone); }, [rabbiPhone]);

  const save = async (name: string) => {
    const value = (drafts[name] ?? '').trim();
    if (!value) return;
    setBusy(name);
    try {
      if (!isDemo()) await call({ action: 'save', name, value });
      setDrafts((d) => ({ ...d, [name]: '' }));
      await load();
      say('Saved. It is stored encrypted — nobody can read it back, including this screen.');
    } catch (e) {
      say(e instanceof Error ? e.message : 'Could not save that.');
    } finally { setBusy(null); }
  };

  const testSms = async () => {
    setBusy('sms'); setResult(null);
    try {
      const r = isDemo() ? { ok: true, sentTo: testTo } : await call({ action: 'test_sms', to: testTo });
      setResult(r.ok
        ? { ok: true, text: `Sent. If a text arrives at ${r.sentTo ?? testTo}, TextMagic is working.` }
        : { ok: false, text: String(r.reason ?? 'TextMagic would not send it.') });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : 'Could not reach TextMagic.' });
    } finally { setBusy(null); }
  };

  const testAi = async () => {
    setBusy('ai'); setResult(null);
    try {
      const r = isDemo() ? { ok: true, model: 'gpt-5.4-nano' } : await call({ action: 'test_openai' });
      setResult(r.ok
        ? { ok: true, text: `Working — ${r.model} answered.` }
        : { ok: false, text: String(r.reason ?? 'OpenAI would not answer.') });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : 'Could not reach OpenAI.' });
    } finally { setBusy(null); }
  };

  return (
    <Panel className="p-5 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-[15px] font-extrabold tracking-tight">Texts and AI</span>
        <span className="text-[12.5px] leading-snug text-ink-muted">
          The accounts the app uses. Paste a key in and it is stored encrypted — this screen can
          never show it back, only the last four characters so you can tell one from another.
        </span>
      </div>

      <div className="flex flex-col gap-3.5">
        {KEYS.map((k) => {
          const st = status?.[k.name];
          return (
            <div key={k.name} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13px] font-bold text-ink-soft">{k.label}</span>
                {st && (
                  <span className={'rounded-chip px-2 py-[2px] text-[10.5px] font-bold ' +
                    (st.set ? 'bg-good-bg text-good' : 'bg-chip text-ink-muted')}>
                    {st.set ? `set · ends ${st.hint}` : 'not set'}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  className={inputCls + ' flex-1 font-mono !text-[13.5px]'}
                  type={k.name === 'TEXTMAGIC_SENDER' ? 'tel' : 'password'}
                  autoComplete="off" spellCheck={false}
                  placeholder={st?.set ? '•••••••• (leave blank to keep)' : k.placeholder}
                  value={drafts[k.name] ?? ''}
                  onChange={(e) => setDrafts((d) => ({ ...d, [k.name]: e.target.value }))}
                />
                <Btn tone="dark" busy={busy === k.name} disabled={!(drafts[k.name] ?? '').trim()}
                  onClick={() => save(k.name)}>Save</Btn>
              </div>
              <span className="text-[11.5px] leading-snug text-ink-muted">{k.hint}</span>
            </div>
          );
        })}
      </div>

      {hook && (
        <div className={'rounded-md border p-4 flex flex-col gap-2.5 '
          + (hook.everReceived ? 'bg-canvas' : 'border-warn/40 bg-warn-bg')}>
          <span className="text-[13px] font-bold">
            {hook.everReceived ? 'Texting in is working' : 'Texting in is not switched on yet'}
          </span>
          <span className="text-[12.5px] leading-relaxed text-ink-soft">
            {hook.everReceived
              ? 'Texts to your TextMagic number reach the app. Nothing to do.'
              : 'Nobody has ever texted in successfully. TextMagic needs to be told where to send '
                + 'messages: open TextMagic → Services → API → Callbacks (or your number\u2019s settings) '
                + 'and paste this address in as the inbound webhook.'}
          </span>
          <div className="flex gap-2">
            <input readOnly value={hook.url} onFocus={(e) => e.currentTarget.select()}
              className={inputCls + ' flex-1 font-mono !text-[12px]'} />
            <Btn onClick={() => { void navigator.clipboard.writeText(hook.url); setCopied(true); say('Address copied.'); }}>
              {copied ? 'Copied' : 'Copy'}
            </Btn>
          </div>
          <span className="text-[11.5px] leading-snug text-ink-muted">
            Treat this like a password — it is what proves a message really came from TextMagic.
            The number must also be reply-capable; a sender-ID-only number cannot receive texts.
          </span>
        </div>
      )}

      <div className="rounded-md bg-canvas border p-4 flex flex-col gap-2.5">
        <span className="text-[13px] font-bold">Check they work</span>
        <div className="flex gap-2 flex-wrap items-center">
          <input className={inputCls + ' flex-1 min-w-[180px] font-mono !text-[13.5px]'} type="tel"
            placeholder="Number to text" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          <Btn busy={busy === 'sms'} disabled={testTo.replace(/\D/g, '').length < 9} onClick={testSms}>
            Send a test text
          </Btn>
          <Btn busy={busy === 'ai'} onClick={testAi}>Check the AI</Btn>
        </div>
        <span className="text-[11.5px] text-ink-muted">
          The test text is a real message and costs what any text costs.
        </span>
        {result && (
          <span className={'text-[12.5px] font-semibold leading-snug ' + (result.ok ? 'text-good' : 'text-late')}>
            {result.ok ? '✓ ' : '✕ '}{result.text}
          </span>
        )}
      </div>
    </Panel>
  );
}
