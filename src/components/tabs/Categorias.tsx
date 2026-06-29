import { useEffect, useMemo, useRef, useState } from "react";
import { Panel } from "../ui";
import { useCategorias, type Categoria } from "../../lib/categorias";
import { useToast } from "../Toast";
import { useConfirm } from "../Confirm";
import { PALETA_CORES } from "../../lib/finance";
import { sb } from "../../lib/supabase";

interface Props { reload: () => void }

/* ---------- popover de cores (swatches da paleta) ---------- */
function SeletorCor({ cor, onPick }: { cor: string; onPick: (c: string) => void }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [aberto]);
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setAberto((o) => !o)}
        title="Mudar cor"
        className="w-[18px] h-[18px] rounded-full border border-line cursor-pointer block"
        style={{ background: cor }}
      />
      {aberto && (
        <div className="absolute z-[60] top-[24px] left-0 bg-card border border-line rounded-[12px] shadow-pop p-[8px] grid grid-cols-5 gap-[6px] w-[164px] fade-in">
          {PALETA_CORES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => { onPick(c); setAberto(false); }}
              className={`w-[22px] h-[22px] rounded-full cursor-pointer border ${c === cor ? "border-txt" : "border-line"}`}
              style={{ background: c }}
              title={c}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function Categorias({ reload }: Props) {
  const { categorias, pronto, adicionar, renomear, mudarCor, excluir, reordenar } = useCategorias();
  const { toast } = useToast();
  const confirm = useConfirm();

  // nº de lançamentos por categoria (categoria_manual) — tally direto do banco
  const [contagem, setContagem] = useState<Record<string, number>>({});
  const recarregarContagem = useMemo(() => async () => {
    const PAG = 1000;
    const tally: Record<string, number> = {};
    let de = 0;
    while (true) {
      const { data, error } = await sb
        .from("lancamentos").select("categoria_manual").not("categoria_manual", "is", null)
        .range(de, de + PAG - 1);
      if (error || !data) break;
      for (const r of data as { categoria_manual: string | null }[]) {
        const c = r.categoria_manual;
        if (c) tally[c] = (tally[c] || 0) + 1;
      }
      if (data.length < PAG) break;
      de += PAG;
    }
    setContagem(tally);
  }, []);
  useEffect(() => { recarregarContagem(); }, [recarregarContagem, categorias.length]);

  // form de adicionar
  const [novoNome, setNovoNome] = useState("");
  const [novaCor, setNovaCor] = useState(PALETA_CORES[0]);
  const [busy, setBusy] = useState(false);

  // edição de nome inline
  const [editId, setEditId] = useState<number | null>(null);
  const [editNome, setEditNome] = useState("");

  const adicionarCat = async () => {
    if (busy) return;
    setBusy(true);
    const r = await adicionar(novoNome, novaCor);
    setBusy(false);
    if (!r.ok) { toast({ message: r.erro || "Não foi possível adicionar.", variant: "error" }); return; }
    toast({ message: `Categoria “${novoNome.trim()}” criada.`, variant: "success" });
    setNovoNome("");
    setNovaCor(PALETA_CORES[(PALETA_CORES.indexOf(novaCor) + 1) % PALETA_CORES.length]);
  };

  const iniciarEdicao = (c: Categoria) => { setEditId(c.id); setEditNome(c.nome); };
  const salvarEdicao = async () => {
    if (editId == null || busy) return;
    const alvo = categorias.find((c) => c.id === editId);
    setBusy(true);
    const r = await renomear(editId, editNome);
    setBusy(false);
    if (!r.ok) { toast({ message: r.erro || "Não foi possível renomear.", variant: "error" }); return; }
    setEditId(null);
    if (alvo && editNome.trim() !== alvo.nome) {
      toast({
        message: r.afetadas
          ? `Renomeada — ${r.afetadas} ${r.afetadas === 1 ? "transação atualizada" : "transações atualizadas"}.`
          : "Categoria renomeada.",
        variant: "success",
      });
      if (r.afetadas) { reload(); recarregarContagem(); }
    }
  };

  const excluirCat = async (c: Categoria) => {
    const n = contagem[c.nome] || 0;
    const ok = await confirm({
      title: `Apagar “${c.nome}”?`,
      danger: true,
      confirmLabel: "Apagar",
      message: n > 0 ? (
        <>
          <b>{n}</b> {n === 1 ? "transação está classificada" : "transações estão classificadas"} nesta categoria.
          {" "}Ao apagar, {n === 1 ? "ela voltará" : "elas voltarão"} para <b>sem categoria</b>.
          <br />Essa ação não pode ser desfeita.
        </>
      ) : (
        <>Nenhuma transação usa esta categoria. Deseja apagá-la?</>
      ),
    });
    if (!ok) return;
    setBusy(true);
    await excluir(c.id);
    setBusy(false);
    toast({ message: `Categoria “${c.nome}” apagada.`, variant: "info" });
    if (n > 0) { reload(); recarregarContagem(); }
  };

  const mover = async (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= categorias.length || busy) return;
    const ids = categorias.map((c) => c.id);
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    await reordenar(ids);
  };

  if (!pronto && categorias.length === 0) {
    return (
      <Panel title="Categorias">
        <div className="text-muted text-[13.5px] leading-relaxed">
          Não foi possível carregar as categorias. Se esta é a primeira vez, rode a migração{" "}
          <code className="bg-fill px-[5px] py-[1px] rounded">db/migrations/2026-06-29-categorias.sql</code>{" "}
          no Supabase e recarregue a página.
        </div>
      </Panel>
    );
  }

  return (
    <div>
      <Panel
        title="Categorias"
        sub={`(${categorias.length})`}
      >
        <div className="text-muted text-[12.5px] mb-4 leading-relaxed">
          Gerencie as categorias usadas para classificar gastos. Edite o <b>nome</b>, escolha a <b>cor</b> e
          use as setas para definir a <b>ordem</b> em que aparecem nos seletores. Ao <b>apagar</b> uma categoria
          em uso, as transações dela voltam para “sem categoria”.
        </div>

        {/* adicionar nova categoria */}
        <div className="flex flex-wrap items-center gap-2 mb-4 pb-4 border-b border-line">
          <SeletorCor cor={novaCor} onPick={setNovaCor} />
          <input
            value={novoNome}
            onChange={(e) => setNovoNome(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") adicionarCat(); }}
            placeholder="Nova categoria…"
            className="input !py-[8px] !text-[13.5px] flex-1 min-w-[160px]"
          />
          <button
            disabled={busy || !novoNome.trim()}
            onClick={adicionarCat}
            className="btn-primary !py-[8px] !px-4 disabled:opacity-40"
          >
            Adicionar
          </button>
        </div>

        {/* lista ordenável */}
        <div className="divide-y divide-line">
          {categorias.map((c, i) => {
            const n = contagem[c.nome] || 0;
            const editando = editId === c.id;
            return (
              <div key={c.id} className="flex items-center gap-2 py-[10px]">
                {/* reordenar */}
                <div className="flex flex-col shrink-0">
                  <button
                    onClick={() => mover(i, -1)}
                    disabled={i === 0 || busy}
                    title="Mover para cima"
                    className="w-[20px] h-[15px] flex items-center justify-center text-muted hover:text-txt disabled:opacity-25 disabled:cursor-default bg-transparent border-0 cursor-pointer p-0"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m6 15 6-6 6 6" /></svg>
                  </button>
                  <button
                    onClick={() => mover(i, 1)}
                    disabled={i === categorias.length - 1 || busy}
                    title="Mover para baixo"
                    className="w-[20px] h-[15px] flex items-center justify-center text-muted hover:text-txt disabled:opacity-25 disabled:cursor-default bg-transparent border-0 cursor-pointer p-0"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                  </button>
                </div>

                <SeletorCor cor={c.cor} onPick={(cor) => mudarCor(c.id, cor)} />

                {/* nome (edição inline) */}
                {editando ? (
                  <input
                    autoFocus
                    value={editNome}
                    onChange={(e) => setEditNome(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") salvarEdicao();
                      if (e.key === "Escape") setEditId(null);
                    }}
                    onBlur={salvarEdicao}
                    className="input !py-[6px] !text-[13.5px] flex-1 min-w-0"
                  />
                ) : (
                  <button
                    onClick={() => iniciarEdicao(c)}
                    title="Renomear"
                    className="flex-1 min-w-0 text-left bg-transparent border-0 p-0 cursor-pointer text-[14px] font-medium truncate hover:text-accent transition-colors"
                  >
                    {c.nome}
                  </button>
                )}

                {/* contagem */}
                <span className="shrink-0 text-[11.5px] text-muted tabular-nums px-[8px] py-[2px] rounded-full bg-fill">
                  {n} {n === 1 ? "transação" : "transações"}
                </span>

                {/* ações */}
                {editando ? (
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={salvarEdicao}
                    className="shrink-0 btn bg-accent hover:bg-accent2 text-onaccent text-[12px] rounded-[8px] px-3 py-[6px] border-0"
                  >
                    Salvar
                  </button>
                ) : (
                  <button
                    onClick={() => excluirCat(c)}
                    disabled={busy}
                    title="Apagar categoria"
                    className="shrink-0 w-[30px] h-[30px] rounded-[8px] flex items-center justify-center text-muted hover:text-red hover:bg-red/10 bg-transparent border-0 cursor-pointer transition-colors"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                      <path d="M10 11v6M14 11v6" />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
          {categorias.length === 0 && (
            <div className="text-muted text-[13.5px] py-4">Nenhuma categoria ainda. Adicione a primeira acima.</div>
          )}
        </div>
      </Panel>
    </div>
  );
}
