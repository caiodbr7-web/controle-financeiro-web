import { createClient } from "@supabase/supabase-js";
import { createDemoClient } from "./demo/demoClient";

// A publishable key pode ficar no front: o RLS exige login para ler/editar.
export const SUPABASE_URL = "https://qjotxjunuurfezqgtugr.supabase.co";
export const SUPABASE_ANON = "sb_publishable_uAYhGJThgMK4S2NV0B32wA_-m9huQH8";

const real = createClient(SUPABASE_URL, SUPABASE_ANON);
const demo = createDemoClient();

// ---------------------------------------------------------------------------
// Modo demo ("Acesso teste"): com ele ligado, TODO acesso a dados (auth + from)
// passa a vir do cliente fake em memória (src/lib/demo) em vez do Supabase real.
// Assim dá para mostrar o produto inteiro a outras pessoas sem expor dados reais
// e sem tocar a rede. A flag fica em sessionStorage para sobreviver a um reload.
// ---------------------------------------------------------------------------
const DEMO_KEY = "cf_demo";
let demoMode = (() => {
  try { return sessionStorage.getItem(DEMO_KEY) === "1"; } catch { return false; }
})();

export const isDemo = () => demoMode;
export function enterDemo() {
  demoMode = true;
  try { sessionStorage.setItem(DEMO_KEY, "1"); } catch { /* ignore */ }
}
export function exitDemo() {
  demoMode = false;
  try { sessionStorage.removeItem(DEMO_KEY); } catch { /* ignore */ }
}

const ativo = () => (demoMode ? demo : real);

// `sb` é um Proxy: cada acesso (sb.from, sb.auth, ...) é resolvido no cliente
// ATIVO no momento (real ou demo). Mantém o tipo do client real p/ o resto do
// app, que segue usando `sb` exatamente como antes.
export const sb = new Proxy(real, {
  get(_t, prop) {
    const c = ativo() as unknown as Record<string | symbol, unknown>;
    const v = c[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(c) : v;
  },
}) as typeof real;
