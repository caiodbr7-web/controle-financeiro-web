import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Panel, Legenda } from "../ui";
import { useCategorias, type Categoria, type Subcategoria, type TipoCategoria } from "../../lib/categorias";
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
        className="tap w-[18px] h-[18px] rounded-full border border-line cursor-pointer block"
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

/* ---------- setinhas de reordenar (cima/baixo) ---------- */
function Setas({ podeSubir, podeDescer, onSubir, onDescer }: {
  podeSubir: boolean; podeDescer: boolean; onSubir: () => void; onDescer: () => void;
}) {
  return (
    <div className="flex flex-col shrink-0">
      <button
        onClick={onSubir}
        disabled={!podeSubir}
        title="Mover para cima"
        className="w-[28px] h-[22px] md:w-[20px] md:h-[15px] flex items-center justify-center text-muted hover:text-txt disabled:opacity-25 disabled:cursor-default bg-transparent border-0 cursor-pointer p-0"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m6 15 6-6 6 6" /></svg>
      </button>
      <button
        onClick={onDescer}
        disabled={!podeDescer}
        title="Mover para baixo"
        className="w-[28px] h-[22px] md:w-[20px] md:h-[15px] flex items-center justify-center text-muted hover:text-txt disabled:opacity-25 disabled:cursor-default bg-transparent border-0 cursor-pointer p-0"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
      </button>
    </div>
  );
}

const IconeLixeira = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

export function Categorias({ reload }: Props) {
  const {
    categorias, pronto, adicionar, renomear, mudarCor, excluir, reordenar,
    adicionarSub, renomearSub, excluirSub, reordenarSub,
  } = useCategorias();
  const { toast } = useToast();
  const confirm = useConfirm();

  // nº de lançamentos por categoria (categoria_manual) e por sub — tally direto do banco
  const [contagem, setContagem] = useState<Record<string, number>>({});
  const [contagemSub, setContagemSub] = useState<Record<string, number>>({}); // chave "cat//sub"
  const recarregarContagem = useMemo(() => async () => {
    const PAG = 1000;
    const tally: Record<string, number> = {};
    const tallySub: Record<string, number> = {};
    let de = 0;
    while (true) {
      const { data, error } = await sb
        .from("lancamentos").select("categoria_manual,subcategoria_manual").not("categoria_manual", "is", null)
        .range(de, de + PAG - 1);
      if (error || !data) break;
      for (const r of data as { categoria_manual: string | null; subcategoria_manual?: string | null }[]) {
        const c = r.categoria_manual;
        if (!c) continue;
        tally[c] = (tally[c] || 0) + 1;
        if (r.subcategoria_manual) {
          const k = `${c}//${r.subcategoria_manual}`;
          tallySub[k] = (tallySub[k] || 0) + 1;
        }
      }
      if (data.length < PAG) break;
      de += PAG;
    }
    setContagem(tally);
    setContagemSub(tallySub);
  }, []);
  useEffect(() => { recarregarContagem(); }, [recarregarContagem, categorias.length]);

  // form de adicionar (um por seção: despesa / receita)
  const [busy, setBusy] = useState(false);

  // edição de nome inline (categoria e subcategoria compartilham o mesmo modo)
  const [editId, setEditId] = useState<number | null>(null);
  const [editNome, setEditNome] = useState("");
  const [editSubId, setEditSubId] = useState<number | null>(null);
  const [editSubNome, setEditSubNome] = useState("");

  // quais categorias estão expandidas (mostrando subcategorias)
  const [abertas, setAbertas] = useState<Record<number, boolean>>({});
  // input de "nova subcategoria" por categoria
  const [novaSub, setNovaSub] = useState<Record<number, string>>({});

  const despesas = categorias.filter((c) => c.tipo !== "receita");
  const receitas = categorias.filter((c) => c.tipo === "receita");

  /* --------------------------- categorias --------------------------- */
  const adicionarCat = async (nome: string, cor: string, tipo: TipoCategoria, limpar: () => void) => {
    if (busy) return;
    setBusy(true);
    const r = await adicionar(nome, cor, tipo);
    setBusy(false);
    if (!r.ok) { toast({ message: r.erro || "Não foi possível adicionar.", variant: "error" }); return; }
    toast({ message: `Categoria “${nome.trim()}” criada.`, variant: "success" });
    limpar();
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
    const nSubs = c.subs.length;
    const ok = await confirm({
      title: `Apagar “${c.nome}”?`,
      danger: true,
      confirmLabel: "Apagar",
      message: (
        <>
          {n > 0 ? (
            <>
              <b>{n}</b> {n === 1 ? "transação está classificada" : "transações estão classificadas"} nesta categoria.
              {" "}Ao apagar, {n === 1 ? "ela voltará" : "elas voltarão"} para <b>sem categoria</b>.
            </>
          ) : (
            <>Nenhuma transação usa esta categoria.</>
          )}
          {nSubs > 0 && (
            <>
              {" "}As <b>{nSubs}</b> {nSubs === 1 ? "subcategoria" : "subcategorias"} também {nSubs === 1 ? "será removida" : "serão removidas"}.
            </>
          )}
          <br />Essa ação não pode ser desfeita.
        </>
      ),
    });
    if (!ok) return;
    setBusy(true);
    await excluir(c.id);
    setBusy(false);
    toast({ message: `Categoria “${c.nome}” apagada.`, variant: "info" });
    if (n > 0) { reload(); recarregarContagem(); }
  };

  const moverCat = async (lista: Categoria[], idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= lista.length || busy) return;
    // reordena dentro da seção e depois costura a ordem global (despesas antes de receitas)
    const nova = lista.slice();
    [nova[idx], nova[j]] = [nova[j], nova[idx]];
    const outraSecao = lista === despesas ? receitas : despesas;
    const idsGlobais = (lista === despesas ? [...nova, ...outraSecao] : [...outraSecao, ...nova]).map((c) => c.id);
    await reordenar(idsGlobais);
  };

  /* --------------------------- subcategorias --------------------------- */
  const adicionarSubCat = async (categoriaId: number) => {
    const nome = (novaSub[categoriaId] || "").trim();
    if (!nome || busy) return;
    setBusy(true);
    const r = await adicionarSub(categoriaId, nome);
    setBusy(false);
    if (!r.ok) { toast({ message: r.erro || "Não foi possível adicionar.", variant: "error" }); return; }
    setNovaSub((m) => ({ ...m, [categoriaId]: "" }));
  };

  const salvarEdicaoSub = async () => {
    if (editSubId == null || busy) return;
    setBusy(true);
    const r = await renomearSub(editSubId, editSubNome);
    setBusy(false);
    if (!r.ok) { toast({ message: r.erro || "Não foi possível renomear.", variant: "error" }); return; }
    setEditSubId(null);
  };

  const excluirSubCat = async (c: Categoria, s: Subcategoria) => {
    const n = contagemSub[`${c.nome}//${s.nome}`] || 0;
    const ok = await confirm({
      title: `Apagar subcategoria “${s.nome}”?`,
      danger: true,
      confirmLabel: "Apagar",
      message: n > 0 ? (
        <>
          <b>{n}</b> {n === 1 ? "transação usa" : "transações usam"} esta subcategoria.
          {" "}Ao apagar, {n === 1 ? "ela volta" : "elas voltam"} a ter só a categoria <b>{c.nome}</b>.
          <br />Essa ação não pode ser desfeita.
        </>
      ) : (
        <>Essa ação não pode ser desfeita.</>
      ),
    });
    if (!ok) return;
    setBusy(true);
    await excluirSub(s.id);
    setBusy(false);
    toast({ message: `Subcategoria “${s.nome}” apagada.`, variant: "info" });
    if (n > 0) { reload(); recarregarContagem(); }
  };

  const moverSub = async (c: Categoria, idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= c.subs.length || busy) return;
    const ids = c.subs.map((s) => s.id);
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    await reordenarSub(c.id, ids);
  };

  /* --------------------------- render de uma categoria --------------------------- */
  const renderCategoria = (c: Categoria, i: number, lista: Categoria[]) => {
    const n = contagem[c.nome] || 0;
    const editando = editId === c.id;
    const aberta = !!abertas[c.id];
    return (
      <div key={c.id} className="py-[6px]">
        <div className="flex items-center gap-2">
          <Setas
            podeSubir={i > 0} podeDescer={i < lista.length - 1}
            onSubir={() => moverCat(lista, i, -1)} onDescer={() => moverCat(lista, i, 1)}
          />

          {/* expandir subcategorias */}
          <button
            onClick={() => setAbertas((m) => ({ ...m, [c.id]: !aberta }))}
            title={aberta ? "Ocultar subcategorias" : "Ver subcategorias"}
            className="shrink-0 w-[20px] h-[20px] flex items-center justify-center text-muted hover:text-txt bg-transparent border-0 cursor-pointer p-0"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${aberta ? "rotate-90" : ""}`}><path d="m9 18 6-6-6-6" /></svg>
          </button>

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
              {c.subs.length > 0 && (
                <span className="ml-2 text-[11px] text-muted font-normal">
                  {c.subs.length} {c.subs.length === 1 ? "subcategoria" : "subcategorias"}
                </span>
              )}
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
              className="tap shrink-0 w-[30px] h-[30px] rounded-[8px] flex items-center justify-center text-muted hover:text-red hover:bg-red/10 bg-transparent border-0 cursor-pointer transition-colors"
            >
              <IconeLixeira />
            </button>
          )}
        </div>

        {/* subcategorias */}
        {aberta && (
          <div className="mt-[6px] ml-[48px] pl-3 border-l border-line flex flex-col gap-[4px]">
            {c.subs.map((s, si) => {
              const edSub = editSubId === s.id;
              const nSub = contagemSub[`${c.nome}//${s.nome}`] || 0;
              return (
                <div key={s.id} className="flex items-center gap-2">
                  <Setas
                    podeSubir={si > 0} podeDescer={si < c.subs.length - 1}
                    onSubir={() => moverSub(c, si, -1)} onDescer={() => moverSub(c, si, 1)}
                  />
                  <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ background: c.cor }} />
                  {edSub ? (
                    <input
                      autoFocus
                      value={editSubNome}
                      onChange={(e) => setEditSubNome(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") salvarEdicaoSub();
                        if (e.key === "Escape") setEditSubId(null);
                      }}
                      onBlur={salvarEdicaoSub}
                      className="input !py-[5px] !text-[13px] flex-1 min-w-0"
                    />
                  ) : (
                    <button
                      onClick={() => { setEditSubId(s.id); setEditSubNome(s.nome); }}
                      title="Renomear subcategoria"
                      className="flex-1 min-w-0 text-left bg-transparent border-0 p-0 cursor-pointer text-[13px] truncate hover:text-accent transition-colors"
                    >
                      {s.nome}
                    </button>
                  )}
                  {nSub > 0 && (
                    <span className="shrink-0 text-[10.5px] text-muted tabular-nums px-[7px] py-[1px] rounded-full bg-fill">
                      {nSub} {nSub === 1 ? "transação" : "transações"}
                    </span>
                  )}
                  <button
                    onClick={() => excluirSubCat(c, s)}
                    disabled={busy}
                    title="Apagar subcategoria"
                    className="tap shrink-0 w-[26px] h-[26px] rounded-[8px] flex items-center justify-center text-muted hover:text-red hover:bg-red/10 bg-transparent border-0 cursor-pointer transition-colors"
                  >
                    <IconeLixeira />
                  </button>
                </div>
              );
            })}
            {/* nova subcategoria */}
            <div className="flex items-center gap-2 pt-[2px]">
              <span className="w-[6px] h-[6px] rounded-full shrink-0 border border-line" />
              <input
                value={novaSub[c.id] || ""}
                onChange={(e) => setNovaSub((m) => ({ ...m, [c.id]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") adicionarSubCat(c.id); }}
                placeholder="Nova subcategoria…"
                className="input !py-[5px] !text-[13px] flex-1 min-w-0"
              />
              <button
                disabled={busy || !(novaSub[c.id] || "").trim()}
                onClick={() => adicionarSubCat(c.id)}
                className="shrink-0 btn bg-fill hover:bg-line text-txt text-[12px] rounded-[8px] px-3 py-[5px] border border-line disabled:opacity-40"
              >
                Adicionar
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  if (!pronto && categorias.length === 0) {
    return (
      <Panel title="Categorias">
        <div className="text-muted text-[13.5px] leading-relaxed">
          Não foi possível carregar as categorias. Se esta é a primeira vez, aplique as migrações em{" "}
          <code className="bg-fill px-[5px] py-[1px] rounded">supabase/migrations/</code>{" "}
          (aplicadas automaticamente no merge para <b>main</b>; os arquivos são{" "}
          <code className="bg-fill px-[5px] py-[1px] rounded">*_categorias.sql</code>{" "}
          e{" "}
          <code className="bg-fill px-[5px] py-[1px] rounded">*_subcategorias.sql</code>) e recarregue a página.
        </div>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <SecaoCategorias
        tipo="despesa"
        titulo="Categorias de Despesa"
        contador={despesas.length}
        descricao={
          <>
            Gerencie as categorias usadas para classificar <b>gastos</b>. Edite o <b>nome</b>, escolha a <b>cor</b> e
            use as setas para definir a <b>ordem</b>. Abra uma categoria (seta ›) para criar <b>subcategorias</b> —
            elas são opcionais e qualquer categoria pode ter. Ao <b>apagar</b> uma categoria em uso, as transações
            dela voltam para “sem categoria”.
          </>
        }
        busy={busy}
        onAdd={(nome, cor, limpar) => adicionarCat(nome, cor, "despesa", limpar)}
        lista={despesas}
        renderCategoria={renderCategoria}
        vazio="Nenhuma categoria de despesa ainda. Adicione a primeira acima."
      />

      <SecaoCategorias
        tipo="receita"
        titulo="Categorias de Receita"
        contador={receitas.length}
        descricao={
          <>
            Categorias para classificar suas <b>receitas</b> (salário, rendimentos, reembolsos etc.). Também podem
            ter <b>subcategorias</b> opcionais.
          </>
        }
        busy={busy}
        onAdd={(nome, cor, limpar) => adicionarCat(nome, cor, "receita", limpar)}
        lista={receitas}
        renderCategoria={renderCategoria}
        vazio="Nenhuma categoria de receita ainda. Adicione a primeira acima."
      />
    </div>
  );
}

/* ---------- uma seção (Despesas ou Receitas): form de adicionar + lista ---------- */
function SecaoCategorias({
  titulo, contador, descricao, busy, onAdd, lista, renderCategoria, vazio,
}: {
  tipo: TipoCategoria;
  titulo: string;
  contador: number;
  descricao: ReactNode;
  busy: boolean;
  onAdd: (nome: string, cor: string, limpar: () => void) => void;
  lista: Categoria[];
  renderCategoria: (c: Categoria, i: number, lista: Categoria[]) => ReactNode;
  vazio: string;
}) {
  const [nome, setNome] = useState("");
  const [cor, setCor] = useState(PALETA_CORES[0]);

  const limpar = () => {
    setNome("");
    setCor(PALETA_CORES[(PALETA_CORES.indexOf(cor) + 1) % PALETA_CORES.length]);
  };

  return (
    <Panel title={titulo} sub={`(${contador})`}>
      {/* adicionar nova categoria */}
      <div className="flex flex-wrap items-center gap-2 mb-4 pb-4 border-b border-line">
        <SeletorCor cor={cor} onPick={setCor} />
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onAdd(nome, cor, limpar); }}
          placeholder="Nova categoria…"
          className="input !py-[8px] !text-[13.5px] flex-1 min-w-[160px]"
        />
        <button
          disabled={busy || !nome.trim()}
          onClick={() => onAdd(nome, cor, limpar)}
          className="btn-primary !py-[8px] !px-4 disabled:opacity-40"
        >
          Adicionar
        </button>
      </div>

      {/* lista ordenável */}
      <div className="divide-y divide-line">
        {lista.map((c, i) => renderCategoria(c, i, lista))}
        {lista.length === 0 && (
          <div className="text-muted text-[13.5px] py-4">{vazio}</div>
        )}
      </div>

      {/* explicação de como usar — legenda discreta no rodapé */}
      <div className="mt-3">
        <Legenda>{descricao}</Legenda>
      </div>
    </Panel>
  );
}
