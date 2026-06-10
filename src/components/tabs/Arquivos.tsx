import { useMemo } from "react";
import type { Lancamento } from "../../types";
import { Panel, Kpi } from "../ui";
import { mesCurto } from "../../lib/finance";

interface Props { allDados: Lancamento[]; }

export function Arquivos({ allDados }: Props) {
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
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[14px] mb-5">
        <Kpi title="Recebidos" value={rec} sub={`de ${tot} esperados`} color="text-green" />
        <Kpi title="Pendentes" value={pend} sub="faltam subir" color={pend ? "text-red" : "text-green"} />
        <Kpi title="Bancos" value={bancos.length} sub={bancos.join(", ")} />
        <Kpi title="Cobertura" value={`${tot ? Math.round((rec / tot) * 100) : 0}%`} sub="do esperado" color="text-amber" />
      </div>
      <Panel title="Status por mês e banco" sub="— fatura do cartão e extrato da conta">
        <div className="overflow-x-auto mt-3">
          <table className="w-full border-collapse text-[13.5px]">
            <thead><tr className="text-muted text-[11px] uppercase">
              <th className="text-left p-2 border-b border-line">Mês</th>
              {bancos.map((b) => <th key={b} className="text-center p-2 border-b border-line">{b}<br /><span className="font-normal normal-case">Extrato · Fatura</span></th>)}
            </tr></thead>
            <tbody>
              {comps.map((m) => (
                <tr key={m}>
                  <td className="text-left p-2 border-b border-line">{mesCurto(m)}</td>
                  {bancos.map((b) => {
                    const e = tem(m, b, "Extrato"), f = tem(m, b, "Fatura");
                    return (
                      <td key={b} className="text-center p-2 border-b border-line">
                        <span className={e ? "text-green font-semibold" : "text-[#c7c7cc]"}>{e ? "✓" : "•"}</span>
                        &nbsp;&nbsp;
                        <span className={f ? "text-green font-semibold" : "text-[#c7c7cc]"}>{f ? "✓" : "•"}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-muted text-[12.5px] mt-3">✓ recebido · • pendente. Derivado dos lançamentos no banco.</div>
      </Panel>
    </div>
  );
}
