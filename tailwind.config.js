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
          burgundy: '#541D2B',
          'burgundy-dark': '#3D141F',
          'burgundy-light': '#6E2739',
          gold: '#E0A526',
          'gold-light': '#F7E7B4',
          'gold-dark': '#B88214',
          warm: '#F6F0EC',
          'warm-dark': '#EADBCE',
          card: '#FFFFFF',
          success: '#17623B',
          'success-light': '#D7F1E1',
          warning: '#8B5C0B',
          'warning-light': '#FCEFCF',
          danger: '#B4232F',
          'danger-light': '#FCDAD7',
          text: '#241D1B',
          muted: '#6D625E',
        }
      },
      fontFamily: {
        serif: ['"Playfair Display"', 'Georgia', 'serif'],
        sans: ['Outfit', 'Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'theatre': '0 10px 25px -5px rgba(84, 29, 43, 0.15), 0 8px 10px -6px rgba(84, 29, 43, 0.1)',
        'gold-glow': '0 0 15px rgba(224, 165, 38, 0.35)',
      }
    },
  },
  plugins: [],
}
