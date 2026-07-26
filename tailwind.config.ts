import type { Config } from 'tailwindcss';

// Design language v2 (see the approved mock-ups): warm paper ground, deep midnight blue, one
// brass accent, editorial serif display for headlines, borderless elevated cards. Larger-than-
// usual type throughout — many users (including the Rov) are not comfortable with small text.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        display: ['Iowan Old Style', 'Palatino Linotype', 'Palatino', 'Book Antiqua', 'Georgia', 'serif'],
      },
      fontSize: {
        base: ['16px', { lineHeight: '1.6' }],
      },
      colors: {
        paper: '#F6F3ED',
        surface: '#FFFFFF',
        hover: '#EFEBE2',
        separator: '#E2DDD0',
        midnight: {
          DEFAULT: '#0F1E33',
          2: '#1D3557',
          3: '#274B7E',
        },
        royal: {
          50: '#F1F4F9',
          100: '#EDF2F9', // "mist" fill for icon tiles and info chips
          200: '#B4C4DC',
          300: '#87A0C3',
          400: '#54749F',
          500: '#2E5382',
          600: '#24466E',
          700: '#1D3557',
          800: '#16294A',
          900: '#0F1E33',
        },
        brass: {
          100: '#F3E8CF',
          300: '#D8C289',
          500: '#B98A2F',
          600: '#9A7326',
          700: '#7B5C1E',
        },
        ink: {
          DEFAULT: '#1C2026',
          soft: '#4A5058',
          muted: '#7A818B',
          faint: '#A6ACB6',
        },
        success: { bg: '#E4F3EC', text: '#157A55' },
        warning: { bg: '#F9F0DA', text: '#8A6215' },
        danger: { bg: '#FAE9E5', text: '#A33224' },
        info: { bg: '#EDF2F9', text: '#24466E' },
      },
      borderRadius: {
        md: '10px',
        lg: '15px',
        xl: '20px',
        '2xl': '26px',
      },
      boxShadow: {
        card: '0 2px 10px rgba(15, 30, 51, 0.06)',
        raised: '0 16px 40px rgba(15, 30, 51, 0.10), 0 3px 8px rgba(15, 30, 51, 0.05)',
        cta: '0 10px 22px rgba(15, 30, 51, 0.25)',
        tabbar: '0 14px 34px rgba(10, 18, 32, 0.4)',
      },
    },
  },
  plugins: [],
} satisfies Config;
