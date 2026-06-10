/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#f5f5f7",
        card: "#ffffff",
        line: "#e6e6eb",
        txt: "#1d1d1f",
        muted: "#86868b",
        accent: "#820ad1",
        accent2: "#6d08b0",
        green: "#34a853",
        red: "#e0382b",
        amber: "#c4791f",
        violet: "#5e5ce6",
      },
      borderRadius: { xl2: "18px" },
      boxShadow: { card: "0 1px 2px rgba(0,0,0,.04), 0 6px 20px rgba(0,0,0,.05)" },
    },
  },
  plugins: [],
};
