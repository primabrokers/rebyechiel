import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import clsx from 'clsx';
import { Loader2 } from 'lucide-react';

// Design v2 primitives: borderless elevated cards on warm paper, one primary action per card,
// 56px tap targets. The rabbi shell layers larger type on top via .rabbi-shell.

type Tone = 'primary' | 'ghost' | 'success' | 'danger' | 'quiet';

export function BigButton({
  tone = 'primary', busy, className, children, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={clsx(
        'w-full rounded-lg px-4 py-4 text-[16.5px] font-extrabold tracking-tight transition-all disabled:opacity-50',
        'min-h-[56px] flex items-center justify-center gap-2 active:scale-[0.99]',
        tone === 'primary' && 'bg-midnight text-white shadow-cta',
        tone === 'success' && 'bg-success-text text-white',
        tone === 'danger' && 'bg-danger-text text-white',
        tone === 'ghost' && 'bg-transparent text-midnight shadow-[inset_0_0_0_2px_rgba(15,30,51,0.18)]',
        tone === 'quiet' && 'bg-royal-100 text-royal-600 font-bold shadow-none',
        className,
      )}
    >
      {busy && <Loader2 size={20} className="animate-spin" />}
      {children}
    </button>
  );
}

export function Card({ className, children, onClick, priority }: {
  className?: string; children: ReactNode; onClick?: () => void; priority?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className={clsx(
        'bg-surface rounded-xl shadow-card p-4',
        priority && 'priority-spine',
        onClick && 'cursor-pointer active:bg-hover transition-colors',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'info' | 'brass'; children: ReactNode }) {
  return (
    <span className={clsx(
      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-extrabold whitespace-nowrap',
      tone === 'ok' && 'bg-success-bg text-success-text',
      tone === 'warn' && 'bg-warning-bg text-warning-text',
      tone === 'bad' && 'bg-danger-bg text-danger-text',
      tone === 'info' && 'bg-info-bg text-info-text',
      tone === 'brass' && 'bg-brass-100 text-brass-600',
    )}>
      {(tone === 'bad' || tone === 'warn') && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** Serif display heading — the app's editorial voice (greetings, questions, promises). */
export function Display({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={clsx('font-display font-semibold tracking-tight leading-[1.12] text-ink', className ?? 'text-[26px]')}>
      {children}
    </h2>
  );
}

/** Uppercase section label with optional trailing action. */
export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between px-2 pt-2">
      <span className="text-[13px] font-extrabold tracking-[0.08em] uppercase text-ink-soft">{children}</span>
      {action}
    </div>
  );
}

export function EmptyState({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="text-center py-10 px-6">
      <p className="font-bold text-ink-soft">{title}</p>
      {sub && <p className="text-sm text-ink-muted mt-1">{sub}</p>}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <Loader2 size={32} className="animate-spin text-royal-400" />
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-sm font-bold text-ink-soft mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-xs text-ink-muted mt-1">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded-lg border-0 bg-surface shadow-card px-4 py-3.5 text-[16px] focus:outline-none focus:ring-2 focus:ring-royal-500';
