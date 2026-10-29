/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: '#0B1B3A', 700: '#1B2E55', 500: '#4A5B7F', 400: '#6B7A99' },
        sky: { DEFAULT: '#38BDF8' },
        blush: { DEFAULT: '#F472B6' },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body: ['"DM Sans"', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
