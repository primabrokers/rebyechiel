import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { Loader2 } from 'lucide-react';

/**
 * Primitives for the Rov Console design system. Two grammars share one palette: the console is
 * dense and desktop-first, the kehillah's phone screens are roomy and tappable.
 */

// --- buttons -------------------------------------------------------------------------------
type Tone = 'dark' | 'indigo' | 'good' | 'outline' | 'quiet';

/** Console-scale button: 13px text, 9px radius, for toolbars and card footers. */
export function Btn({
  tone = 'outline', busy, className, children, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-ctl px-4 py-2.5 text-[13px] font-bold',
        'transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        tone === 'dark' && 'bg-graphite text-white hover:bg-graphite-deep',
        tone === 'indigo' && 'bg-indigo text-white hover:bg-indigo-deep',
        tone === 'good' && 'bg-good text-white hover:bg-good-deep',
        tone === 'outline' && 'border border-firm text-ink hover:bg-canvas',
        tone === 'quiet' && 'bg-canvas text-ink-soft hover:bg-chip',
        className,
      )}
    >
      {busy && <Loader2 size={15} className="animate-spin" />}
      {children}
    </button>
  );
}

/** Phone-scale button: full width, comfortably tappable. */
export function BigButton({
  tone = 'dark', busy, className, children, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={clsx(
        'w-full rounded-lg px-4 py-4 text-[15.5px] font-extrabold min-h-[54px]',
        'flex items-center justify-center gap-2 transition-colors disabled:opacity-40',
        tone === 'dark' && 'bg-graphite text-white',
        tone === 'indigo' && 'bg-indigo text-white',
        tone === 'good' && 'bg-good text-white',
        tone === 'outline' && 'border border-firm text-ink bg-transparent',
        tone === 'quiet' && 'bg-canvas text-ink-soft border border-hair',
        className,
      )}
    >
      {busy && <Loader2 size={18} className="animate-spin" />}
      {children}
    </button>
  );
}

// --- the kehillah's phone screens ----------------------------------------------------------
/**
 * Every community screen is a phone screen. On a tablet or a desktop it sits centred on the page
 * ground rather than stretching — the same app, not a different one.
 */
export function Phone({ tone = 'canvas', className, children }: {
  tone?: 'canvas' | 'surface' | 'graphite'; className?: string; children: ReactNode;
}) {
  return (
    <div className={clsx('min-h-screen flex justify-center',
      tone === 'graphite' ? 'bg-graphite' : tone === 'surface' ? 'bg-surface' : 'bg-page')}>
      <div className={clsx('w-full max-w-[440px] min-h-screen flex flex-col',
        tone === 'graphite' ? 'bg-graphite' : tone === 'surface' ? 'bg-surface' : 'bg-canvas',
        className)}>
        {children}
      </div>
    </div>
  );
}

/** Back chevron plus the step bars — the design's header for every multi-step screen. */
export function StepBar({ onBack, steps, at, right }: {
  onBack?: () => void; steps?: number; at?: number; right?: ReactNode;
}) {
  return (
    <div className="flex-none px-5 pt-3.5 flex items-center gap-3">
      {onBack && (
        <button onClick={onBack} aria-label="Back" className="text-[19px] leading-none text-ink-muted -ml-1 px-1">‹</button>
      )}
      {steps ? (
        <div className="flex-1 flex gap-1.5">
          {Array.from({ length: steps }, (_, i) => (
            <span key={i} className={clsx('flex-1 h-1 rounded-pill', i <= (at ?? 0) ? 'bg-graphite' : 'bg-[#e3e5e9]')} />
          ))}
        </div>
      ) : <div className="flex-1" />}
      {right}
    </div>
  );
}

/** The big question at the top of a phone screen, with its one line of explanation. */
export function Headline({ title, sub, className }: { title: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      <span className="text-[23px] font-extrabold leading-[1.25] tracking-tight">{title}</span>
      {sub && <span className="text-[13px] leading-relaxed text-ink-muted">{sub}</span>}
    </div>
  );
}

/**
 * A tappable choice — affiliation, category, urgency, a slot. Selected gets a graphite edge, and
 * may reveal a follow-up field: a div rather than a button, so an input can live inside one
 * without a click on it also re-picking the choice.
 */
export function Choice({ selected, title, sub, onClick, children }: {
  selected?: boolean; title: ReactNode; sub?: ReactNode; onClick?: () => void; children?: ReactNode;
}) {
  return (
    <div
      role="radio"
      aria-checked={Boolean(selected)}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } }}
      className={clsx('rounded-md px-3.5 py-3 border-[1.5px] cursor-pointer transition-colors flex flex-col gap-2.5',
        selected ? 'border-graphite bg-subtle' : 'border-[rgba(16,19,24,.11)] bg-surface')}>
      <div className="flex items-center gap-2.5">
        <div className="flex-1 flex flex-col gap-px min-w-0">
          <span className="text-[14px] font-extrabold">{title}</span>
          {sub && <span className="text-[11.5px] leading-snug text-ink-muted">{sub}</span>}
        </div>
        {selected && <span className="text-[15px] font-extrabold flex-none">✓</span>}
      </div>
      {selected && children}
    </div>
  );
}

/** A row of pill options — the invitation screen's "what's the occasion?". */
export function PillPick<T extends string>({ value, options, onPick }: {
  value: T | null; options: { key: T; label: string }[]; onPick: (k: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={o.key} type="button" onClick={() => onPick(o.key)}
          className={clsx('rounded-pill px-3.5 py-2.5 text-[13px] transition-colors',
            value === o.key ? 'bg-graphite text-white font-bold' : 'border border-firm text-ink-soft font-semibold')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The indigo "before you send" panel: the promise, in the Rov's own terms. */
export function PromisePanel({ eyebrow, headline, sub }: { eyebrow: string; headline: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border border-indigo/30 bg-indigo-soft px-4 py-3.5 flex flex-col gap-1.5">
      <Eyebrow className="!text-indigo">{eyebrow}</Eyebrow>
      <span className="text-[18px] font-extrabold leading-tight text-indigo-ink text-pretty">{headline}</span>
      {sub && <span className="text-[12.5px] leading-relaxed text-ink-soft">{sub}</span>}
    </div>
  );
}

/** A quiet note on a canvas ground — the "no smartphone?" and clash-warning boxes. */
export function Note({ icon, children }: { icon?: string; children: ReactNode }) {
  return (
    <div className="rounded-md border bg-canvas px-3.5 py-3.5 flex gap-2.5 items-start">
      {icon && <span className="text-[14px] flex-none leading-snug">{icon}</span>}
      <span className="text-[12.5px] leading-relaxed text-ink-soft">{children}</span>
    </div>
  );
}

// --- surfaces ------------------------------------------------------------------------------
/** The console's workhorse: white, hairline border, 13px radius. */
export function Panel({ className, children, onClick, hover }: {
  className?: string; children: ReactNode; onClick?: () => void; hover?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className={clsx(
        'bg-surface border rounded-lg',
        (hover || onClick) && 'cursor-pointer transition-[border-color,transform] hover:border-strong hover:-translate-y-0.5',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SectionHead({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2.5 flex-wrap">
      <span className="text-[15px] font-extrabold tracking-tight">{title}</span>
      {sub && <span className="text-[12.5px] text-ink-muted">{sub}</span>}
      {action && <span className="ml-auto">{action}</span>}
    </div>
  );
}

/** Small uppercase label — the design's recurring way of naming a block. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={clsx('text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-ink-muted', className)}>
      {children}
    </span>
  );
}

// --- status --------------------------------------------------------------------------------
export type ChipTone = 'late' | 'warn' | 'good' | 'neutral' | 'indigo';

const CHIP: Record<ChipTone, string> = {
  late: 'bg-late-bg text-late',
  warn: 'bg-warn-bg text-warn',
  good: 'bg-good-bg text-good',
  neutral: 'bg-chip text-ink-soft',
  indigo: 'bg-indigo-tint text-indigo-deep',
};

export function Chip({ tone = 'neutral', children }: { tone?: ChipTone; children: ReactNode }) {
  return (
    <span className={clsx('inline-flex items-center rounded-chip px-2 py-[3px] text-[11px] font-bold whitespace-nowrap', CHIP[tone])}>
      {children}
    </span>
  );
}

export function Dot({ tone }: { tone: ChipTone }) {
  return (
    <span className={clsx('w-2 h-2 rounded-pill flex-none',
      tone === 'late' && 'bg-late', tone === 'warn' && 'bg-warn', tone === 'good' && 'bg-good-dot',
      tone === 'indigo' && 'bg-indigo', tone === 'neutral' && 'bg-ink-ghost')} />
  );
}

/** Data that should read as data: times, refs, phone numbers. */
export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={clsx('font-mono text-[11px] font-medium text-ink-faint', className)}>{children}</span>;
}

// --- feedback ------------------------------------------------------------------------------
/**
 * Anything pinned to the window — drawers, toasts — goes through here. Chromium keeps a
 * containing block on an element that has animated its transform, so a `fixed` child inside a
 * page that faded up would otherwise be measured against that page instead of the window, and
 * a drawer would open half height in the middle of the screen.
 */
export function Portal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}

export function Toast({ message }: { message: string }) {
  return (
    <Portal>
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] animate-toastIn flex items-center gap-2.5
        rounded-md bg-graphite px-5 py-3 text-[13.5px] font-semibold text-white shadow-toast">
        <span className="w-[7px] h-[7px] rounded-pill bg-good-dot flex-none" />
        {message}
      </div>
    </Portal>
  );
}

export function EmptyState({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="text-center py-12 px-6">
      <p className="font-bold text-ink-soft text-[14px]">{title}</p>
      {sub && <p className="text-[12.5px] text-ink-muted mt-1">{sub}</p>}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <Loader2 size={26} className="animate-spin text-ink-ghost" />
    </div>
  );
}

// --- forms ---------------------------------------------------------------------------------
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-bold text-ink-soft">{label}</span>
      {children}
      {hint && <span className="text-[12px] text-ink-muted leading-snug">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded-md border border-firm bg-surface px-3.5 py-3 text-[14.5px] text-ink ' +
  'placeholder:text-ink-faint focus:border-indigo focus:outline-none';

export const textareaCls = inputCls + ' resize-none leading-relaxed';

/** The design's toggle: 52×30 track, 24px knob. */
export function Toggle({ on, onFlip, label }: { on: boolean; onFlip: () => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onFlip}
      className={clsx('w-[52px] h-[30px] rounded-pill flex-none relative transition-colors',
        on ? 'bg-good' : 'bg-[#d6d9de]')}
    >
      <span className={clsx('absolute top-[3px] w-6 h-6 rounded-pill bg-white shadow-[0_1px_3px_rgba(0,0,0,.25)] transition-[left]',
        on ? 'left-[25px]' : 'left-[3px]')} />
    </button>
  );
}
