import { useMemo, useState } from "react";
import type { Lancamento } from "../../types";
import { mesCurto } from "../../lib/finance";

/* Painel compacto e colapsável com o status de faturas/extratos por mês × banco.
   Vive no topo da aba Adicionar (ponto de entrada de dados). */
export function ArquivosPanel({ allDados }: { allDados: Lancamento[] }) {
  const [aberto, setAberto] = useState(false);

  const { bancos, comps, tem, tot, rec } = useMemo(() => {
    const bancos = ["Nubank", "PicPay", "Itau"].filter((b) => allDados.some((d) => d.banco === b));
    const comps = [...new Set(allDados.map((d) => d.competencia))].sort().reverse();
    const tem = (m: string, b: string, tipo: "Fatura" | "Extrato") =>
      allDados.some((d) => d.competencia === m && d.banco === b && String(d.origem || "").startsWith(tipo === "Fatura" ? "Cartao" : "Conta"));
    let tot = 0, rec = 0;
    comps.forEach((m) => bancos.forEach((b) => { tot += 2; rec += (tem(m, b, "Extrato") ? 1 : 0) + (tem(m, b, "Fatura") ? 1 : 0); }));
    return { bancos, comps, tem, tot, rec };
  }, [allDados]);

  const pend = tot - rec;

  return (
    <div className="bg-card border border-line rounded-[18px] shadow-card mb-[18px] overflow-hidden">
      <button
        onClick={() => setAberto((s) => !s)}
        className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-4 sm:px-5 py-[13px] bg-transparent border-0 cursor-pointer text-left"
      >
        <span className="text-[14px] font-semibold tracking-tight">Arquivos importados</span>
        <span className={`text-[12px] font-medium ${pend ? "text-amber" : "text-green"}`}>
          {pend ? `${pend} pendentes` : "tudo recebido"}
        </span>
        <span className="text-[12px] text-muted">{rec} de {tot} · {tot ? Math.round((rec / tot) * 100) : 0}%</span>
        <span className={`ml-auto text-muted text-[16px] leading-none transition-transform duration-200 ${aberto ? "rotate-90" : ""}`} aria-hidden>›</span>
      </button>

      {aberto && (
        <div className="px-4 sm:px-5 pb-4 border-t border-line">
          <div className="overflow-x-auto scroll-thin mt-3">
            <table className="tbl">
              <thead><tr>
                <th>Mês</th>
                {bancos.map((b) => (
                  <th key={b} className="!text-center">{b}<br /><span className="font-normal normal-case">Extrato · Fatura</span></th>
                ))}
              </tr></thead>
              <tbody>
                {comps.map((m) => (
                  <tr key={m}>
                    <td>{mesCurto(m)}</td>
                    {bancos.map((b) => {
                      const e = tem(m, b, "Extrato"), f = tem(m, b, "Fatura");
                      return (
                        <td key={b} className="!text-center">
                          <span className={e ? "text-green font-semibold" : "text-muted/50"}>{e ? "✓" : "•"}</span>
                          &nbsp;&nbsp;
                          <span className={f ? "text-green font-semibold" : "text-muted/50"}>{f ? "✓" : "•"}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-muted text-[12px] mt-3">✓ recebido · • pendente. Derivado dos lançamentos no banco.</div>
        </div>
      )}
    </div>
  );
}
