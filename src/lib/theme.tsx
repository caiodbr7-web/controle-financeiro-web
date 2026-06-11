import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { BRL } from "./finance";

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
    if (meta) meta.setAttribute("content", dark ? "#0d0d0f" : "#f5f5f7");
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
      grid: dark ? "#2a2a2e" : "#ececf0",
      tick: { fill: dark ? "#98989d" : "#86868b", fontSize: 11 },
      tickSm: { fill: dark ? "#98989d" : "#86868b", fontSize: 10 },
      tickStrong: { fill: dark ? "#f5f5f7" : "#1d1d1f", fontSize: 11 },
      cardStroke: dark ? "#1c1c1e" : "#ffffff",
      cursor: { fill: dark ? "rgba(255,255,255,.05)" : "rgba(0,0,0,.04)" },
      saldo: dark ? "#ffd60a" : "#f2b84b",
      receita: dark ? "#30d158" : "#34c98a",
      despesa: dark ? "#ff6961" : "#f06a6a",
      media: dark ? "#ffb340" : "#f0a818",
      roxoLinha: (alpha: string) => (dark ? `rgba(191,138,255,${alpha})` : `rgba(130,10,209,${alpha})`),
    }),
    [dark]
  );
}

/* ---------- tooltip padrão dos gráficos ---------- */

export function ChartTip({
  active, payload, label, pct = false, pctOf, labelPrefix = "",
}: {
  active?: boolean;
  payload?: any[];
  label?: any;
  pct?: boolean;       // valores já são percentuais
  pctOf?: number;      // mostra "R$ X (y%)" relativo a este total
  labelPrefix?: string;
}) {
  if (!active || !payload || !payload.length) return null;
  const rows = payload.filter((p) => p && p.value != null && Number(p.value) !== 0);
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
              : BRL(Number(p.value)) + (pctOf ? ` (${((Number(p.value) / pctOf) * 100).toFixed(1)}%)` : "")}
          </span>
        </div>
      ))}
    </div>
  );
}
