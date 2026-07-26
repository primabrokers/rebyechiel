import type { Config } from 'tailwindcss';

/**
 * Design system — "Rov Console" (source screens kept in design/).
 *
 * Cool graphite console with a single indigo accent. Manrope carries everything; JetBrains Mono
 * is reserved for things that should read as data — times, refs, phone numbers, dates. There is
 * no second accent: green means settled, amber means waiting on a person, red means promised
 * today.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Manrope', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        page: '#e9eaee',      // the shell around a console
        canvas: '#f4f5f7',    // working surface
        surface: '#ffffff',   // cards, tables, drawers
        subtle: '#fafbfc',    // table headers, hovered rows
        chip: '#f0f1f4',      // neutral chips and icon tiles
        graphite: {
          DEFAULT: '#12141a', // sidebar, member masthead, primary buttons
          deep: '#0b0d12',
          900: '#101318',
        },
        ink: {
          DEFAULT: '#101318',
          soft: '#4b5361',
          muted: '#79828f',
          faint: '#a7aeb8',
          ghost: '#c2c8d0',
        },
        indigo: {
          DEFAULT: '#5b4be8',
          deep: '#4536cc',
          ink: '#2f2861',   // indigo text on a light indigo ground
          soft: '#f4f2ff',  // light indigo panel
          softer: '#f8f7ff',
          tint: '#ece9ff',
          light: '#a99bff', // indigo on a dark ground
          mid: '#6f63c4',
        },
        good: { DEFAULT: '#12795a', deep: '#0d6247', bg: '#e6f5ef', dot: '#3fbb84' },
        warn: { DEFAULT: '#a9700f', ink: '#8a5c0d', bg: '#fbf2e0' },
        late: { DEFAULT: '#c93b2b', bg: '#fdeeec' },
      },
      borderColor: {
        DEFAULT: 'rgba(16,19,24,.09)',
        hair: 'rgba(16,19,24,.06)',
        firm: 'rgba(16,19,24,.14)',
        strong: 'rgba(16,19,24,.25)',
      },
      borderRadius: {
        chip: '6px',
        ctl: '9px',
        md: '11px',
        lg: '13px',
        xl: '16px',
        pill: '99px',
      },
      boxShadow: {
        drawer: '-20px 0 50px rgba(11,13,18,.22)',
        toast: '0 12px 30px rgba(11,13,18,.3)',
        phone: '0 20px 50px rgba(11,13,18,.2)',
        lift: '0 6px 18px rgba(11,13,18,.08)',
      },
      keyframes: {
        slideIn: { from: { transform: 'translateX(24px)', opacity: '0' }, to: { transform: 'none', opacity: '1' } },
        fadeUp: { from: { opacity: '0', transform: 'translateY(10px)' }, to: { opacity: '1', transform: 'none' } },
        toastIn: { from: { opacity: '0', transform: 'translate(-50%,14px)' }, to: { opacity: '1', transform: 'translate(-50%,0)' } },
        breathe: { '0%,100%': { opacity: '1' }, '50%': { opacity: '.4' } },
      },
      animation: {
        slideIn: 'slideIn .26s cubic-bezier(.22,.8,.3,1) both',
        fadeUp: 'fadeUp .3s ease both',
        toastIn: 'toastIn .25s ease both',
        breathe: 'breathe 2.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
