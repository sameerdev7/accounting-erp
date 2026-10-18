/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // Theme is driven by a `dark` class on <html>, so the user can override the
  // OS preference and the choice survives a reload.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#dae6ff',
          200: '#bcd2ff',
          300: '#8eb4ff',
          400: '#598bff',
          500: '#3366f2',
          600: '#2049db',
          700: '#1a39b0',
          800: '#1a338c',
          900: '#1b3072',
          950: '#111c47',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 23 42 / 0.05), 0 1px 3px 0 rgb(15 23 42 / 0.06)',
        'card-lg': '0 4px 12px -2px rgb(15 23 42 / 0.10), 0 2px 6px -2px rgb(15 23 42 / 0.06)',
        glow: '0 0 0 1px rgb(51 102 242 / 0.30), 0 10px 30px -10px rgb(51 102 242 / 0.55)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'none' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.98)' },
          '100%': { opacity: '1', transform: 'none' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.18s ease-out',
        'scale-in': 'scale-in 0.14s ease-out',
      },
    },
  },
  plugins: [],
}
