import { useEffect, useMemo, useState } from "react";
import { Panel, Select, Seg } from "./ui";
import { BRL0 } from "../lib/finance";
import { listAlvos, saveAlvos } from "../lib/pluggy";
import { labelTipo, CLASSES_ALVO, PALETA } from "../lib/investclasses";

/* ============================================================================
   Sub-aba "Balanceamento" — alocação-alvo por classe.

   Você define só o ALVO em % de cada classe; o resto é derivado: o app converte
   o alvo para reais sobre a carteira de hoje, compara com a posição atual e
   devolve a ordem. O caixa entra como uma classe normal, dentro dos 100%.

   Dois modos de ordem:
     • "Só aportar"       — nada é vendido; o aporte do mês é rateado entre as
                            classes abaixo do alvo, proporcional ao buraco de
                            cada uma. Não realiza lucro nem gera imposto.
     • "Comprar e vender" — rebalanceamento cheio: vende o que passou do alvo
                            para comprar o que ficou atrás.

   Só o alvo é persistido (tabela alocacao_alvo); a posição continua vindo de
   pluggy_investments + saldos das contas.
   ============================================================================ */

/** Uma classe com a posição de HOJE (já inclui o Caixa). */
export interface CatAtual {
  tipo: string;
  label: string;
  total: number;
  cor: string;
}

type Modo = "aporte" | "total";

const MODO_OPTS: { v: Modo; label: string }[] = [
  { v: "aporte", label: "Só aportar" },
  { v: "total", label: "Comprar e vender" },
];

// aceita "30", "30,5" e "30.5"; fora de 0–100 é cortado nas bordas
const parsePct = (s: string): number => {
  const n = Number(String(s).replace(",", "."));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
};
const fmtPct = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
const fmtPP = (v: number) =>
  (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
// só lê dígitos: o campo de aporte aceita o que o usuário digitar
const parseBRL = (s: string) => Number(String(s).replace(/\D/g, "")) || 0;

export function Balanceamento({ atuais, total }: { atuais: CatAtual[]; total: number }) {
  const [alvos, setAlvos] = useState<Record<string, string>>({});
  const [salvos, setSalvos] = useState<Record<string, number>>({});
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [modo, setModo] = useState<Modo>("aporte");
  const [aporteTxt, setAporteTxt] = useState("");
  const [addTipo, setAddTipo] = useState("");

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const lista = await listAlvos();
        if (!vivo) return;
        const mapa: Record<string, number> = {};
        lista.forEach((a) => { mapa[a.tipo] = a.alvo_pct; });
        setSalvos(mapa);
        const txt: Record<string, string> = {};
        Object.entries(mapa).forEach(([k, v]) => { txt[k] = String(v).replace(".", ","); });
        setAlvos(txt);
      } catch (e) {
        if (vivo) setErro((e as Error).message);
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => { vivo = false; };
  }, []);

  // as linhas são a UNIÃO do que você tem hoje com o que você definiu como alvo:
  // uma classe com alvo e sem posição é uma ordem de compra, não uma linha a esconder.
  const linhas = useMemo(() => {
    const porTipo = new Map(atuais.map((c) => [c.tipo, c]));
    const tipos = new Set<string>([...porTipo.keys(), ...Object.keys(alvos)]);
    const arr = [...tipos].map((tipo, i) => {
      const at = porTipo.get(tipo);
      const atual = at?.total ?? 0;
      const alvoPct = parsePct(alvos[tipo] ?? "");
      return {
        tipo,
        label: at?.label ?? labelTipo(tipo),
        cor: at?.cor ?? PALETA[i % PALETA.length],
        atual,
        hojePct: total > 0 ? (atual / total) * 100 : 0,
        alvoPct,
      };
    });
    return arr.sort((a, b) => b.atual - a.atual || b.alvoPct - a.alvoPct);
  }, [atuais, alvos, total]);

  const somaAlvo = useMemo(() => linhas.reduce((s, l) => s + l.alvoPct, 0), [linhas]);
  const fechou100 = Math.abs(somaAlvo - 100) < 0.05;
  const aporte = modo === "aporte" ? parseBRL(aporteTxt) : 0;

  // ordem por classe: em "Só aportar" rateia o aporte entre quem está atrás do
  // alvo; em "Comprar e vender" a ordem é a diferença cheia até o alvo.
  const ordens = useMemo(() => {
    const base = total + aporte;
    const comAlvo = linhas.map((l) => {
      const alvoRS = base * (l.alvoPct / 100);
      return { ...l, alvoRS, delta: alvoRS - l.atual, buraco: Math.max(0, alvoRS - l.atual) };
    });
    if (modo === "total") return comAlvo.map((l) => ({ ...l, ordem: l.delta }));
    const somaBuracos = comAlvo.reduce((s, l) => s + l.buraco, 0);
    return comAlvo.map((l) => ({ ...l, ordem: somaBuracos > 0 ? aporte * (l.buraco / somaBuracos) : 0 }));
  }, [linhas, modo, aporte, total]);

  const foraDoAlvo = ordens.filter((l) => Math.abs(l.hojePct - l.alvoPct) >= 1).length;
  // quanto precisa MUDAR de lugar no rebalanceamento cheio (a soma das vendas,
  // que por construção é a soma das compras)
  const giro = useMemo(
    () => ordens.reduce((s, l) => s + (l.ordem < 0 ? -l.ordem : 0), 0),
    [ordens],
  );
  const maiorDesvio = ordens.reduce(
    (a, b) => (Math.abs(b.hojePct - b.alvoPct) > Math.abs(a.hojePct - a.alvoPct) ? b : a),
    ordens[0],
  );

  const mudou = useMemo(() => {
    const atual: Record<string, number> = {};
    linhas.forEach((l) => { if (l.alvoPct > 0) atual[l.tipo] = l.alvoPct; });
    const ks = new Set([...Object.keys(atual), ...Object.keys(salvos)]);
    return [...ks].some((k) => Math.abs((atual[k] ?? 0) - (salvos[k] ?? 0)) > 0.005);
  }, [linhas, salvos]);

  /**
   * Semeia os alvos com a composição de hoje. Arredondar cada fatia para 1 casa
   * sozinho não fecha 100% (sobra ou falta 0,1), e o usuário ficaria caçando a
   * diferença na mão — então o resto é devolvido às classes com maior parte
   * fracionária, pelo método do maior resto.
   */
  const usarAtual = () => {
    if (total <= 0) return;
    const base = atuais.map((c) => {
      const exato = (c.total / total) * 100;
      return { tipo: c.tipo, exato, v: Math.floor(exato * 10) / 10 };
    });
    let sobra = Math.round((100 - base.reduce((s, b) => s + b.v, 0)) * 10); // em décimos
    [...base]
      .sort((a, b) => b.exato - b.v - (a.exato - a.v))
      .forEach((b) => { if (sobra > 0) { b.v = Math.round((b.v + 0.1) * 10) / 10; sobra--; } });
    const txt: Record<string, string> = {};
    base.forEach((b) => { txt[b.tipo] = b.v.toFixed(1).replace(".", ","); });
    setAlvos(txt);
  };

  const salvar = async () => {
    setSalvando(true);
    setErro("");
    try {
      const payload = linhas.map((l) => ({ tipo: l.tipo, alvo_pct: Math.round(l.alvoPct * 100) / 100 }));
      await saveAlvos(payload);
      const mapa: Record<string, number> = {};
      payload.filter((p) => p.alvo_pct > 0).forEach((p) => { mapa[p.tipo] = p.alvo_pct; });
      setSalvos(mapa);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  };

  // classes conhecidas que ainda não estão na tabela (nem posição, nem alvo)
  const faltantes = CLASSES_ALVO.filter((c) => !linhas.some((l) => l.tipo === c.v));

  if (carregando) return <Panel title="Balanceamento"><div className="text-muted text-[13px]">Carregando alvos…</div></Panel>;

  return (
    <>
      <Panel
        title="Balanceamento da carteira"
        sub="alvo por classe · o caixa entra nos 100%"
        right={
          <div className="flex items-center gap-2 flex-wrap">
            <Seg size="sm" value={modo} onChange={(v) => setModo(v)} options={MODO_OPTS} />
            <button
              onClick={usarAtual}
              className="tap border border-line bg-card text-txt rounded-[10px] px-3 py-[7px] text-[12.5px] font-semibold cursor-pointer hover:border-accent/50 transition-colors"
            >
              Usar composição atual
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-[minmax(220px,260px)_1fr] gap-[14px] items-start">
          <div className="bg-card2 border border-line rounded-[14px] p-4">
            <div className="text-muted text-[11.5px] font-semibold uppercase tracking-[0.04em]">
              {modo === "aporte" ? "Vou aportar este mês" : "Rebalanceamento cheio"}
            </div>
            {modo === "aporte" && (
              <div className="flex items-baseline gap-[6px] mt-[6px]">
                <span className="text-muted text-[16px]">R$</span>
                <input
                  className="font-display text-[28px] font-bold w-full bg-transparent border-0 p-0 text-txt tracking-tight tabular-nums outline-none focus:ring-2 focus:ring-accent rounded"
                  value={aporteTxt}
                  onChange={(e) => setAporteTxt(e.target.value)}
                  inputMode="numeric"
                  placeholder="0"
                  aria-label="Valor do aporte"
                />
              </div>
            )}
            <p className="text-muted text-[11.5px] mt-[10px] leading-snug">
              {modo === "aporte"
                ? "Nada é vendido. O aporte é dividido entre as classes abaixo do alvo, proporcional ao tamanho do buraco."
                : "Rebalanceamento cheio: vende quem passou do alvo para comprar quem ficou atrás. Vender pode gerar imposto sobre o lucro."}
            </p>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-[10px]">
            <Tile k="Carteira hoje" v={BRL0(total)} />
            {modo === "aporte" ? (
              <Tile k="Depois do aporte" v={BRL0(total + aporte)} />
            ) : (
              <Tile k="Giro necessário" v={fechou100 ? BRL0(giro) : "—"} extra="sai de uma classe e entra na outra" />
            )}
            <Tile k="Fora do alvo" v={`${foraDoAlvo} ${foraDoAlvo === 1 ? "classe" : "classes"}`} />
            <Tile
              k="Maior desvio"
              v={maiorDesvio ? maiorDesvio.label : "—"}
              extra={maiorDesvio ? `${fmtPP(maiorDesvio.hojePct - maiorDesvio.alvoPct)} pp` : undefined}
            />
          </div>
        </div>
      </Panel>

      <Panel
        title="Alvo por classe"
        sub="digite o % que você quer em cada uma"
        right={
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`text-[13px] font-bold tabular-nums ${fechou100 ? "text-green" : "text-red"}`}>
              Soma: {fmtPct(somaAlvo)}
            </span>
            <button
              onClick={salvar}
              disabled={!mudou || salvando}
              className="tap border-0 rounded-[10px] px-4 py-[9px] text-[13px] font-bold cursor-pointer bg-accent text-onaccent disabled:opacity-45 disabled:cursor-not-allowed transition-opacity"
            >
              {salvando ? "Salvando…" : "Salvar alvo"}
            </button>
          </div>
        }
      >
        {erro && <div className="text-red text-[12.5px] mb-2">{erro}</div>}
        {!fechou100 && (
          <div className="text-[12.5px] mb-3 px-3 py-2 rounded-[10px] bg-fill text-muted">
            A soma dos alvos precisa fechar <b>100%</b> para as ordens fazerem sentido.
            {somaAlvo > 100 ? ` Está ${fmtPct(somaAlvo - 100)} acima.` : ` Faltam ${fmtPct(100 - somaAlvo)}.`}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="tbl min-w-[720px]">
            <thead>
              <tr>
                <th>Classe</th>
                <th className="num">Hoje</th>
                <th className="num">Hoje %</th>
                <th className="num">Alvo %</th>
                <th className="num" title="diferença entre o % de hoje e o alvo, em pontos percentuais">Δ pp</th>
                <th className="num">Ordem</th>
              </tr>
            </thead>
            <tbody>
              {ordens.map((l) => {
                const drift = l.hojePct - l.alvoPct;
                const emLinha = Math.abs(drift) < 0.05;
                return (
                  <tr key={l.tipo} className="hover:bg-card2">
                    <td>
                      <div className="flex items-center gap-[9px] font-semibold">
                        <span className="w-[9px] h-[9px] rounded-[3px] shrink-0" style={{ background: l.cor }} />
                        {l.label}
                      </div>
                    </td>
                    <td className="num">{BRL0(l.atual)}</td>
                    <td className="num text-muted">{fmtPct(l.hojePct)}</td>
                    <td className="num">
                      <input
                        className="w-[74px] text-right font-semibold text-[13.5px] tabular-nums px-[7px] py-[5px] rounded-[8px] border border-line bg-input text-txt outline-none focus:ring-2 focus:ring-accent"
                        value={alvos[l.tipo] ?? ""}
                        onChange={(e) => setAlvos((a) => ({ ...a, [l.tipo]: e.target.value }))}
                        inputMode="decimal"
                        placeholder="0"
                        aria-label={`Alvo de ${l.label} em %`}
                      />
                    </td>
                    <td className={`num font-bold ${emLinha ? "text-muted" : drift > 0 ? "text-red" : "text-green"}`}>
                      {emLinha ? "—" : fmtPP(drift)}
                    </td>
                    <td className="num">
                      <Ordem valor={l.ordem} ok={fechou100} acimaSemVenda={modo === "aporte" && drift > 0.05} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-bold border-t-2 border-line">
                <td>Total</td>
                <td className="num">{BRL0(total)}</td>
                <td className="num">100,0%</td>
                <td className={`num ${fechou100 ? "" : "text-red"}`}>{fmtPct(somaAlvo)}</td>
                <td></td>
                <td className="num">{modo === "aporte" ? BRL0(aporte) : "—"}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {faltantes.length > 0 && (
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <span className="text-muted text-[12.5px]">Quer um alvo para uma classe que ainda não tem:</span>
            <Select
              value={addTipo}
              onChange={(v) => {
                if (!v) return;
                setAlvos((a) => ({ ...a, [v]: "0" }));
                setAddTipo("");
              }}
              className="!py-[6px] text-[12.5px]"
            >
              <option value="">Adicionar classe…</option>
              {faltantes.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
            </Select>
          </div>
        )}

        <div className="text-muted text-[12px] mt-3 leading-relaxed">
          Você define só o <b>alvo em %</b>. O app converte para reais sobre a carteira de hoje, compara com a posição
          atual e devolve a ordem. Em <b>Só aportar</b>, o dinheiro novo é rateado entre as classes abaixo do alvo —
          rebalanceia sem vender nada e sem realizar lucro. O <b>Caixa</b> entra como uma classe: se você quer manter
          reserva, dê um alvo a ele em vez de deixá-lo de fora.
        </div>
      </Panel>
    </>
  );
}

function Tile({ k, v, extra }: { k: string; v: string; extra?: string }) {
  return (
    <div className="bg-card2 border border-line rounded-[14px] p-[12px_14px]">
      <div className="text-muted text-[11.5px] font-semibold">{k}</div>
      <div className="font-display text-[20px] font-bold mt-[3px] tracking-tight tabular-nums truncate">{v}</div>
      {extra && <div className="text-muted text-[11.5px] mt-[2px] tabular-nums">{extra}</div>}
    </div>
  );
}

function Ordem({ valor, ok, acimaSemVenda }: { valor: number; ok: boolean; acimaSemVenda: boolean }) {
  if (!ok) return <span className="text-muted">—</span>;
  const v = Math.round(valor);
  if (v === 0) {
    // sem ordem tem dois motivos bem diferentes: ou a classe está no alvo, ou
    // ela passou do alvo e o modo "Só aportar" não vende — dizer "em linha" nesse
    // segundo caso seria mentira, já que o desvio continua lá.
    return acimaSemVenda ? (
      <span className="inline-block px-[9px] py-[3px] rounded-full text-[11.5px] font-bold bg-amber/15 text-amber" title="Acima do alvo, mas o modo “Só aportar” não vende — ela se dilui conforme você aporta nas outras.">
        acima · não aporta
      </span>
    ) : (
      <span className="inline-block px-[9px] py-[3px] rounded-full text-[11.5px] font-bold bg-fill text-muted">em linha</span>
    );
  }
  const compra = v > 0;
  return (
    <span
      className={`inline-block px-[9px] py-[3px] rounded-full text-[11.5px] font-bold ${
        compra ? "bg-green/15 text-green" : "bg-red/15 text-red"
      }`}
    >
      {compra ? "comprar " : "vender "}
      {BRL0(Math.abs(v))}
    </span>
  );
}
