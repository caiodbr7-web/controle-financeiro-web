import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { BRL0 } from "./finance";

/* ---------- tema claro/escuro (auto segue o sistema) ---------- */

export type ThemePref = "auto" | "light" | "dark";
const KEY = "cf-tema";

const ThemeCtx = createContext<{ dark: boolean; pref: ThemePref; cycle: () => void }>({
  dark: false,
  pref: "auto",
  cycle: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPref] = useState<ThemePref>(() => {
    try {
      const v = localStorage.getItem(KEY);
      return v === "light" || v === "dark" ? v : "auto";
    } catch {
      return "auto";
    }
  });
  const [sys, setSys] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const h = (e: MediaQueryListEvent) => setSys(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);

  const dark = pref === "auto" ? !!sys : pref === "dark";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#0D0B14" : "#F7F6FA");
  }, [dark]);

  const cycle = () =>
    setPref((p) => {
      const n: ThemePref = p === "auto" ? "light" : p === "light" ? "dark" : "auto";
      try { localStorage.setItem(KEY, n); } catch { /* sem storage */ }
      return n;
    });

  return <ThemeCtx.Provider value={{ dark, pref, cycle }}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);

/* ---------- cores p/ Recharts (SVG não resolve CSS vars em atributos) ---------- */

export function useChart() {
  const { dark } = useTheme();
  return useMemo(
    () => ({
      grid: dark ? "#2a2736" : "#eceaf2",
      tick: { fill: dark ? "#9d98ac" : "#6e6a7c", fontSize: 11 },
      tickSm: { fill: dark ? "#9d98ac" : "#6e6a7c", fontSize: 10 },
      tickStrong: { fill: dark ? "#f2f0f8" : "#1a1726", fontSize: 11 },
      cardStroke: dark ? "#171522" : "#ffffff",
      cursor: { fill: dark ? "rgba(255,255,255,.05)" : "rgba(0,0,0,.04)" },
      saldo: dark ? "#f2b65a" : "#e0a33a",
      receita: dark ? "#34d399" : "#047857",
      despesa: dark ? "#fb7185" : "#c2334a",
      media: dark ? "#f2b65a" : "#e0a33a",
      roxoLinha: (alpha: string) => (dark ? `rgba(167,139,250,${alpha})` : `rgba(109,40,217,${alpha})`),
    }),
    [dark]
  );
}

/* ---------- tooltip padrão dos gráficos ---------- */

export function ChartTip({
  active, payload, label, pct = false, pctOf, labelPrefix = "", keepZeros = false,
}: {
  active?: boolean;
  payload?: any[];
  label?: any;
  pct?: boolean;       // valores já são percentuais
  pctOf?: number;      // mostra "R$ X (y%)" relativo a este total
  labelPrefix?: string;
  keepZeros?: boolean; // mantém séries com valor 0 (útil p/ saldo, onde 0 é informativo)
}) {
  if (!active || !payload || !payload.length) return null;
  const rows = payload.filter((p) => p && p.value != null && (keepZeros || Number(p.value) !== 0));
  if (!rows.length) return null;
  return (
    <div className="rounded-[12px] border border-line bg-card/95 backdrop-blur-[8px] px-3 py-2 shadow-pop text-[12px] min-w-[150px]">
      {label != null && label !== "" && (
        <div className="text-muted mb-[3px]">{labelPrefix}{label}</div>
      )}
      {rows.map((p, i) => (
        <div key={i} className="flex items-center gap-2 py-[1.5px]">
          <span
            className="w-[8px] h-[8px] rounded-full shrink-0"
            style={{ background: p.color || (p.payload && p.payload.fill) || p.stroke || p.fill || "#9ca3af" }}
          />
          <span className="text-muted truncate max-w-[150px]">{p.name}</span>
          <span className="ml-auto font-medium tabular-nums pl-3">
            {pct
              ? Number(p.value).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%"
              : BRL0(Number(p.value)) + (pctOf ? ` (${((Number(p.value) / pctOf) * 100).toFixed(1)}%)` : "")}
          </span>
        </div>
      ))}
    </div>
  );
}
