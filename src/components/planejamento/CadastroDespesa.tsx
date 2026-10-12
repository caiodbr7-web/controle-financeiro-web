import { useMemo, useState } from "react";
import { useCategorias } from "../../lib/categorias";
import { dvAddMes, dvLabel } from "../../lib/finance";
import { type Plano, type TipoPlano, mesAtual } from "../../lib/projecao";
import { FORMAS, LEMBRAR_OPCOES } from "../../lib/agenda";
import { useConfirm } from "../Confirm";
import { useToast } from "../Toast";
import { Dialog, inp, lbl, parseValorBR, valorStr } from "./comum";
import { MSG_MIGRACAO_LEMBRETES, type PlanejamentoApi } from "./usePlanejamento";

const TIPOS: { v: TipoPlano; label: string; ajuda: string }[] = [
  { v: "fixo", label: "Recorrente", ajuda: "Repete todo mês (aluguel, escola, assinatura). Deixe “até” vazio se não tem fim." },
  { v: "parcelamento", label: "Parcelado", ajuda: "Valor da parcela × número de parcelas, a partir do mês da 1ª." },
  { v: "pagamento", label: "Pagamento único", ajuda: "Acontece uma vez só (IPVA, seguro, viagem)." },
  { v: "meta", label: "Meta / caixinha", ajuda: "Valor total dividido igualmente até o mês-alvo." },
  { v: "receita", label: "Receita", ajuda: "Dinheiro que entra todo mês (salário, aluguel recebido)." },
];
const VALOR_LABEL: Record<TipoPlano, string> = {
  fixo: "Valor por mês", parcelamento: "Valor da parcela", pagamento: "Valor", meta: "Valor total", receita: "Valor por mês",
};
const MESES = (() => {
  const a = dvAddMes(mesAtual(), -24);
  return Array.from({ length: 61 }, (_, i) => dvAddMes(a, i));
})();

export function CadastroDespesa({ plano, inicial, api, onClose }: {
  plano?: Plano | null;
  inicial?: Partial<Plano>;
  api: PlanejamentoApi;
  onClose: () => void;
}) {
  const { categorias } = useCategorias();
  const confirm = useConfirm();
  const { toast } = useToast();
  const base: Partial<Plano> = plano || { tipo: "fixo", mes_inicio: mesAtual(), parcelas: 10, lembrar_dias: 3, ...inicial };
  const [f, setF] = useState({
    tipo: (base.tipo || "fixo") as TipoPlano,
    nome: base.nome || "",
    favorecido: base.favorecido || "",
    categoria: base.categoria || "",
    valor: valorStr(base.valor ?? null),
    variavel: !!base.variavel,
    dia_venc: base.dia_venc ? String(base.dia_venc) : "",
    mes_inicio: base.mes_inicio || mesAtual(),
    mes_fim: base.mes_fim || "",
    parcelas: String(base.parcelas || 10),
    forma_pagamento: base.forma_pagamento || (base.no_cartao ? "Cartão de crédito" : ""),
    dados_pagamento: base.dados_pagamento || "",
    lembrar_dias: String(base.lembrar_dias ?? 3),
    observacoes: base.observacoes || "",
    link_categoria: base.link_categoria || "",
    link_texto: base.link_texto || "",
  });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const t = f.tipo;
  const ehRec = t === "receita";
  const catOpcoes = useMemo(() => categorias.map((c) => c.nome), [categorias]);

  async function salvar() {
    const nome = f.nome.trim();
    const valor = parseValorBR(f.valor);
    if (!nome) { setErro("Dê um nome à despesa."); return; }
    if (valor == null) { setErro("Informe o valor."); return; }
    if (t === "meta" && !f.mes_fim) { setErro("Uma meta precisa de um mês-alvo."); return; }
    const dia = parseInt(f.dia_venc);
    const payload: Record<string, unknown> = {
      tipo: t, nome, valor,
      categoria: ehRec ? null : f.categoria || null,
      mes_inicio: f.mes_inicio,
      mes_fim: t === "fixo" || t === "receita" || t === "meta" ? f.mes_fim || null : null,
      parcelas: t === "parcelamento" ? Math.max(1, parseInt(f.parcelas) || 1) : null,
      no_cartao: !ehRec && f.forma_pagamento === "Cartão de crédito",
      link_categoria: f.link_categoria || null,
      link_texto: f.link_texto.trim() || null,
      favorecido: f.favorecido.trim() || null,
      dia_venc: dia >= 1 && dia <= 31 ? dia : null,
      forma_pagamento: f.forma_pagamento || null,
      dados_pagamento: f.dados_pagamento.trim() || null,
      lembrar_dias: ehRec ? null : parseInt(f.lembrar_dias) || 0,
      observacoes: f.observacoes.trim() || null,
      variavel: t === "fixo" && f.variavel,
    };
    if (!plano) payload.ativo = true;
    setSalvando(true); setErro("");
    try {
      await api.salvarPlano(payload, plano?.id);
      toast({ message: plano ? `“${nome}” atualizada.` : `“${nome}” adicionada ao planejamento.`, variant: "success" });
      onClose();
    } catch (e: any) {
      setErro(e?.message || String(e));
    } finally {
      setSalvando(false);
    }
  }

  async function remover() {
    if (!plano) return;
    if (!(await confirm({ title: `Remover “${plano.nome}”?`, message: "A despesa e o histórico de pagamentos dela saem do planejamento. Não dá para desfazer.", confirmLabel: "Remover", danger: true }))) return;
    try {
      await api.removerPlano(plano.id);
      toast({ message: `“${plano.nome}” removida.`, variant: "success" });
      onClose();
    } catch (e: any) { setErro(e?.message || String(e)); }
  }

  const mesSelect = (k: "mes_inicio" | "mes_fim", vazio?: string) => (
    <select className={`select-chev ${inp} cursor-pointer`} value={f[k]} onChange={set(k)}>
      {vazio != null && <option value="">{vazio}</option>}
      {MESES.map((m) => <option key={m} value={m}>{dvLabel(m)}</option>)}
    </select>
  );

  return (
    <Dialog
      title={plano ? "Editar" : "Nova despesa ou receita"}
      sub="Tudo o que você precisa para lembrar de pagar, e para a planilha projetar."
      onClose={onClose}
      width={640}
      footer={<>
        {plano && <button onClick={remover} className="btn-ghost !text-red hover:!border-red mr-auto">Remover</button>}
        <button onClick={onClose} className="btn-ghost">Cancelar</button>
        <button onClick={salvar} disabled={salvando} className="btn-primary">{salvando ? "Salvando…" : plano ? "Salvar" : "Adicionar"}</button>
      </>}
    >
      <div className="flex flex-wrap gap-[2px] bg-soft p-[3px] rounded-[10px] w-fit max-w-full">
        {TIPOS.map((o) => (
          <button key={o.v} type="button" onClick={() => setF((x) => ({ ...x, tipo: o.v }))}
            className={`border-0 px-[11px] py-[6px] text-[12.5px] cursor-pointer rounded-[8px] transition-all ${t === o.v ? "bg-card text-accent font-bold shadow-card" : "bg-transparent text-muted hover:text-txt font-medium"}`}>
            {o.label}
          </button>
        ))}
      </div>
      <div className="text-muted text-[12px] mt-2">{TIPOS.find((o) => o.v === t)?.ajuda}</div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
        <label className={lbl}>Nome *<input autoFocus className={inp} value={f.nome} onChange={set("nome")} placeholder={ehRec ? "Salário, Freela…" : "Aluguel, IPVA, Notebook…"} /></label>
        <label className={lbl}>{ehRec ? "De quem" : "Para quem (favorecido)"}<input className={inp} value={f.favorecido} onChange={set("favorecido")} placeholder={ehRec ? "Empresa, cliente…" : "Imobiliária, Maria, Cemig…"} /></label>
        {!ehRec && (
          <label className={lbl}>Categoria
            <select className={`select-chev ${inp} cursor-pointer`} value={f.categoria} onChange={set("categoria")}>
              <option value="">—</option>
              {catOpcoes.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        )}
        <label className={lbl}>{VALOR_LABEL[t]}<input className={`${inp} text-right`} inputMode="decimal" value={f.valor} onChange={set("valor")} placeholder="0,00" /></label>

        {t === "pagamento" ? (
          <>
            <label className={lbl}>Mês do pagamento{mesSelect("mes_inicio")}</label>
            <label className={lbl}>Dia<input className={inp} type="number" min={1} max={31} value={f.dia_venc} onChange={set("dia_venc")} placeholder="ex.: 20" /></label>
          </>
        ) : (
          <>
            <label className={lbl}>{ehRec ? "Dia em que cai" : "Dia do vencimento"}<input className={inp} type="number" min={1} max={31} value={f.dia_venc} onChange={set("dia_venc")} placeholder="ex.: 10" /></label>
            <label className={lbl}>{t === "parcelamento" ? "1ª parcela em" : "Começa em"}{mesSelect("mes_inicio")}</label>
          </>
        )}
        {t === "parcelamento" && <label className={lbl}>Nº de parcelas<input className={inp} type="number" min={1} value={f.parcelas} onChange={set("parcelas")} /></label>}
        {(t === "fixo" || t === "receita") && <label className={lbl}>Até <span className="font-normal">(vazio = sem fim)</span>{mesSelect("mes_fim", "sem fim")}</label>}
        {t === "meta" && <label className={lbl}>Mês-alvo *{mesSelect("mes_fim", "—")}</label>}
        {t === "fixo" && (
          <label className="flex items-center gap-2 text-[12.5px] sm:col-span-2 cursor-pointer">
            <input type="checkbox" checked={f.variavel} onChange={(e) => setF((x) => ({ ...x, variavel: e.target.checked }))} />
            O valor muda todo mês (luz, água…): o previsto é uma estimativa
          </label>
        )}

        {!ehRec && (
          <>
            <label className={lbl}>Forma de pagamento
              <select className={`select-chev ${inp} cursor-pointer`} value={f.forma_pagamento} onChange={set("forma_pagamento")}>
                <option value="">—</option>
                {FORMAS.map((x) => <option key={x}>{x}</option>)}
              </select>
            </label>
            <label className={lbl}>Me lembrar
              <select className={`select-chev ${inp} cursor-pointer`} value={f.lembrar_dias} onChange={set("lembrar_dias")}>
                {LEMBRAR_OPCOES.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
            </label>
            <label className={`${lbl} sm:col-span-2`}>Dados para pagar <span className="font-normal">(chave Pix, código do boleto, conta, cartão…)</span>
              <input className={inp} value={f.dados_pagamento} onChange={set("dados_pagamento")} placeholder="ex.: Pix CPF 123.456.789-00" />
            </label>
          </>
        )}
        <label className={`${lbl} sm:col-span-2`}>Observações
          <textarea className={`${inp} min-h-[70px] resize-y`} value={f.observacoes} onChange={set("observacoes")}
            placeholder="Reajustes, contrato, desconto à vista, quem combinou o quê…" />
        </label>
      </div>

      <details className="mt-4 text-[12.5px]" open={!!(f.link_categoria || f.link_texto)}>
        <summary className="cursor-pointer text-muted font-medium">Baixa automática pelos lançamentos</summary>
        <div className="text-muted text-[12px] mt-2 mb-2">
          Quando aparecer um lançamento com esta categoria e/ou descrição, o mês é marcado como pago com o valor lançado.
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className={lbl}>Categoria do lançamento
            <select className={`select-chev ${inp} cursor-pointer`} value={f.link_categoria} onChange={set("link_categoria")}>
              <option value="">(qualquer)</option>
              {catOpcoes.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className={lbl}>Descrição contém<input className={inp} value={f.link_texto} onChange={set("link_texto")} placeholder="ex.: imobiliaria" /></label>
        </div>
      </details>

      {!api.temNovas && <div className="text-amber text-[12px] mt-3 leading-relaxed">{MSG_MIGRACAO_LEMBRETES}</div>}
      {erro && <div className="text-red text-[12.5px] mt-3">{erro}</div>}
    </Dialog>
  );
}
