/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        hoh: {
          curtain: '#3b0811',
          wine: '#5c0d1b',
          crimson: '#881326',
          velvet: '#200408',
          stage: '#0d0204',
          'stage-dark': '#070102',
          gold: '#f59e0b',
          'gold-bright': '#fbbf24',
          'gold-light': '#fef3c7',
          'gold-dark': '#b45309',
          brass: '#d97706',
          warm: '#F6F0EC',
          'warm-dark': '#EADBCE',
          card: '#1a0509',
          success: '#10b981',
          'success-dark': '#064e3b',
          warning: '#f59e0b',
          danger: '#ef4444',
          'danger-dark': '#7f1d1d',
          text: '#fffbeb',
          muted: '#a89a94',
        }
      },
      fontFamily: {
        bebas: ['"Bebas Neue"', 'sans-serif'],
        cinzel: ['"Cinzel"', 'serif'],
        outfit: ['"Outfit"', 'sans-serif'],
        serif: ['"Playfair Display"', 'Georgia', 'serif'],
        sans: ['"Outfit"', 'Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'theatre': '0 15px 35px -5px rgba(66, 7, 15, 0.6), 0 8px 15px -6px rgba(0, 0, 0, 0.8)',
        'curtain': '0 0 35px rgba(136, 19, 38, 0.45)',
        'gold-glow': '0 0 20px rgba(245, 158, 11, 0.35)',
        'marquee': '0 0 25px rgba(251, 191, 36, 0.4), inset 0 0 15px rgba(245, 158, 11, 0.2)',
      }
    },
  },
  plugins: [],
}
