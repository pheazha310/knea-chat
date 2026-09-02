/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./client/src/**/*.{js,jsx,ts,tsx}', './public/index.html'],
  theme: {
    extend: {
      colors: {
        lavender: '#635bdb',
        ink: '#1e2433',
        muted: '#687084',
        soft: '#f7f7fb',
        line: '#e9ebf1',
      },
    },
  },
  plugins: [],
};
