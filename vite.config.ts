import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// No GitHub Pages o app fica sob /controle-financeiro-web/; no Netlify (e local), na raiz.
// O workflow de Pages define GH_PAGES=true; qualquer outro build mantém a raiz.
const base = process.env.GH_PAGES === "true" ? "/controle-financeiro-web/" : "/";

export default defineConfig({
  base,
  plugins: [react()],
});
