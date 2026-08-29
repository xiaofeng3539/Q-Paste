/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        zinc: {
          50: 'rgb(var(--zc-50) / <alpha-value>)',
          100: 'rgb(var(--zc-100) / <alpha-value>)',
          200: 'rgb(var(--zc-200) / <alpha-value>)',
          300: 'rgb(var(--zc-300) / <alpha-value>)',
          400: 'rgb(var(--zc-400) / <alpha-value>)',
          500: 'rgb(var(--zc-500) / <alpha-value>)',
          600: 'rgb(var(--zc-600) / <alpha-value>)',
          700: 'rgb(var(--zc-700) / <alpha-value>)',
          800: 'rgb(var(--zc-800) / <alpha-value>)',
          900: 'rgb(var(--zc-900) / <alpha-value>)',
          950: 'rgb(var(--zc-950) / <alpha-value>)',
        },
        border: 'hsl(240 3.7% 15.9%)',
        input: 'hsl(240 3.7% 15.9%)',
        ring: 'hsl(240 4.9% 83.9%)',
        background: 'hsl(240 10% 3.9%)',
        foreground: 'hsl(0 0% 98%)',
        primary: {
          DEFAULT: 'hsl(0 0% 98%)',
          foreground: 'hsl(240 5.9% 10%)',
        },
        secondary: {
          DEFAULT: 'hsl(240 3.7% 15.9%)',
          foreground: 'hsl(0 0% 98%)',
        },
        muted: {
          DEFAULT: 'hsl(240 3.7% 15.9%)',
          foreground: 'hsl(240 5% 64.9%)',
        },
        accent: {
          DEFAULT: 'hsl(240 3.7% 15.9%)',
          foreground: 'hsl(0 0% 98%)',
        },
        destructive: {
          DEFAULT: 'hsl(0 62.8% 30.6%)',
          foreground: 'hsl(0 0% 98%)',
        },
      },
      borderRadius: {
        lg: '0.5rem',
        md: 'calc(0.5rem - 2px)',
        sm: 'calc(0.5rem - 4px)',
      },
    },
  },
  plugins: [],
}
