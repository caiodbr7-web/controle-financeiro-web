import { useState } from "react";
import { BRL, dvLabel } from "../../lib/finance";
import { mesAtual } from "../../lib/projecao";
import { DIAS_SEM, TIPO_LABEL, type Ocorrencia } from "../../lib/agenda";
import { useToast } from "../Toast";
import { Copiar, Dialog, StatusBadge, inp, parseValorBR, valorStr } from "./comum";
import type { PlanejamentoApi } from "./usePlanejamento";

/** Um pagamento (item × mês): valor, pago, nota do mês e os dados para pagar. */
export function DetalhePagamento({ o, api, onEditar, onClose }: {
  o: Ocorrencia; api: PlanejamentoApi; onEditar: () => void; onClose: () => void;
}) {
  const { toast } = useToast();
  const p = o.p;
  const futuro = o.k > mesAtual();
  const reg = api.mensal[o.k]?.[p.id];
  const [valor, setValor] = useState(valorStr(reg?.valor_real ?? null));
  const [nota, setNota] = useState(reg?.nota || "");
  const [erro, setErro] = useState("");

  async function salvar(pago?: boolean) {
    const v = parseValorBR(valor);
    try {
      await api.salvarMensal(p.id, o.k, {
        valor_real: v,
        pago: pago ?? (reg?.pago || false),
        nota: nota.trim() || null,
      });
      toast({ message: pago === true ? `${p.nome} marcado como pago.` : pago === false ? `${p.nome} desmarcado.` : "Salvo.", variant: "success" });
      onClose();
    } catch (e: any) { setErro(e?.message || String(e)); }
  }

  return (
    <Dialog
      title={<>{p.nome} <span className="text-muted font-normal">· {dvLabel(o.k)}</span></>}
      sub={<span className="inline-flex flex-wrap items-center gap-2"><StatusBadge o={o} /><span>{TIPO_LABEL[p.tipo]}{o.parcela ? ` · parcela ${o.parcela}` : ""}{p.categoria ? ` · ${p.categoria}` : ""}</span></span>}
      onClose={onClose}
      width={520}
      footer={<>
        <button onClick={onEditar} className="btn-ghost mr-auto">Editar despesa</button>
        <button onClick={() => salvar()} className="btn-ghost">Salvar</button>
        {!futuro && (o.pago
          ? <button onClick={() => salvar(false)} className="btn-ghost">Desmarcar pago</button>
          : <button onClick={() => salvar(true)} className="btn-primary">✓ Marcar como pago</button>)}
      </>}
    >
      <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-[10px] text-[13px] items-center">
        <dt className="text-muted">Para quem</dt><dd className="font-medium">{p.favorecido || "—"}</dd>
        <dt className="text-muted">Vencimento</dt>
        <dd>{o.venc ? `${DIAS_SEM[o.venc.getDay()]}, ${o.venc.toLocaleDateString("pt-BR")}` : <span className="text-muted">sem dia definido — edite a despesa</span>}</dd>
        <dt className="text-muted">Previsto</dt>
        <dd className="tabular-nums">{BRL(o.previsto)}{p.variavel && <span className="text-muted"> (estimado)</span>}</dd>
        {o.auto != null && (<>
          <dt className="text-muted">Lançado</dt>
          <dd className="tabular-nums">{BRL(o.auto)} <span className="text-muted text-[12px]">· pelos lançamentos vinculados</span>
            {!futuro && reg?.valor_real == null && <button onClick={() => setValor(valorStr(o.auto))} className="ml-2 bg-transparent border-0 p-0 text-accent underline cursor-pointer text-[12px]">usar</button>}
          </dd>
        </>)}
        <dt className="text-muted">{futuro ? "Valor deste mês" : "Valor pago"}</dt>
        <dd>
          <input className={`${inp} !w-[150px] text-right`} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)}
            placeholder={valorStr(Math.round(o.previsto * 100) / 100)} />
          {futuro && <div className="text-muted text-[11.5px] mt-1">Ajusta o previsto só deste mês. Vazio = segue a regra.</div>}
        </dd>
        <dt className="text-muted">Forma</dt><dd>{p.forma_pagamento || "—"}</dd>
        <dt className="text-muted">Dados p/ pagar</dt>
        <dd>{p.dados_pagamento
          ? <span className="inline-flex flex-wrap items-center gap-2"><code className="bg-fill rounded-[6px] px-[6px] py-[1px] text-[12px] break-all">{p.dados_pagamento}</code><Copiar texto={p.dados_pagamento} onCopiado={() => toast({ message: "Copiado.", variant: "success" })} /></span>
          : <span className="text-muted">—</span>}</dd>
        {p.observacoes && (<>
          <dt className="text-muted self-start">Obs. da despesa</dt>
          <dd className="bg-amber/10 rounded-[8px] px-[10px] py-[7px] text-[12.5px] whitespace-pre-wrap">{p.observacoes}</dd>
        </>)}
        <dt className="text-muted self-start pt-[6px]">Nota deste mês</dt>
        <dd>
          {api.temNota
            ? <textarea className={`${inp} min-h-[64px] resize-y`} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="ex.: paguei com desconto, boleto atrasou, comprovante no e-mail…" />
            : <span className="text-muted text-[12px]">disponível após aplicar a migração *_planejamento_lembretes.sql</span>}
        </dd>
      </dl>
      {erro && <div className="text-red text-[12.5px] mt-3">{erro}</div>}
    </Dialog>
  );
}
