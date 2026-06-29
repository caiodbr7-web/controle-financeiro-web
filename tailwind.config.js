/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Hanken Grotesk"', "-apple-system", "BlinkMacSystemFont", '"Segoe UI"', "system-ui", "sans-serif"],
        display: ['"Schibsted Grotesk"', '"Hanken Grotesk"', "-apple-system", "system-ui", "sans-serif"],
      },
      colors: {
        bg: "rgb(var(--c-bg) / <alpha-value>)",
        card: "rgb(var(--c-card) / <alpha-value>)",
        card2: "rgb(var(--c-card2) / <alpha-value>)",
        line: "rgb(var(--c-line) / <alpha-value>)",
        txt: "rgb(var(--c-txt) / <alpha-value>)",
        muted: "rgb(var(--c-muted) / <alpha-value>)",
        fill: "rgb(var(--c-fill) / <alpha-value>)",
        soft: "rgb(var(--c-soft) / <alpha-value>)",
        input: "rgb(var(--c-input) / <alpha-value>)",
        accent: "rgb(var(--c-accent) / <alpha-value>)",
        accent2: "rgb(var(--c-accent2) / <alpha-value>)",
        onaccent: "rgb(var(--c-on-accent) / <alpha-value>)",
        green: "rgb(var(--c-green) / <alpha-value>)",
        red: "rgb(var(--c-red) / <alpha-value>)",
        amber: "rgb(var(--c-amber) / <alpha-value>)",
        violet: "rgb(var(--c-violet) / <alpha-value>)",
        heatpos: "rgb(var(--c-heatpos) / <alpha-value>)",
        heatneg: "rgb(var(--c-heatneg) / <alpha-value>)",
      },
      borderRadius: { xl2: "18px" },
      boxShadow: {
        card: "var(--cf-shadow-card)",
        "card-hover": "var(--cf-shadow-card-hover)",
        modal: "var(--cf-shadow-modal)",
        pop: "var(--cf-shadow-pop)",
      },
    },
  },
  plugins: [],
};
