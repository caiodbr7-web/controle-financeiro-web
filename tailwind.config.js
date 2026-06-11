/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--c-bg) / <alpha-value>)",
        card: "rgb(var(--c-card) / <alpha-value>)",
        card2: "rgb(var(--c-card2) / <alpha-value>)",
        line: "rgb(var(--c-line) / <alpha-value>)",
        txt: "rgb(var(--c-txt) / <alpha-value>)",
        muted: "rgb(var(--c-muted) / <alpha-value>)",
        fill: "rgb(var(--c-fill) / <alpha-value>)",
        accent: "rgb(var(--c-accent) / <alpha-value>)",
        accent2: "rgb(var(--c-accent2) / <alpha-value>)",
        green: "rgb(var(--c-green) / <alpha-value>)",
        red: "rgb(var(--c-red) / <alpha-value>)",
        amber: "rgb(var(--c-amber) / <alpha-value>)",
        violet: "rgb(var(--c-violet) / <alpha-value>)",
      },
      borderRadius: { xl2: "18px" },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,.04), 0 6px 20px rgba(0,0,0,.05)",
        pop: "0 8px 30px rgba(0,0,0,.14)",
      },
    },
  },
  plugins: [],
};
