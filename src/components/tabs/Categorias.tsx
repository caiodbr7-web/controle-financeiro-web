import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Panel, Legenda } from "../ui";
import { ListaOrdenavel, AlcaArrastar, type AlcaProps } from "../ListaOrdenavel";
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

const IconeLixeira = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

const IconeMover = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 7h11M4 12h7M4 17h4" />
    <path d="m15 14 4 3-4 3" />
    <path d="M19 17h-6" />
  </svg>
);

/* ---------- popover "Mover…" (reestruturar a hierarquia) ----------
   Nas categorias: transformar em subcategoria de outra categoria.
   Nas subcategorias: promover a categoria ou mudar de categoria-mãe. */
function MenuMover({ titulo, promover, cabecalhoDestinos, destinos, disabled }: {
  titulo: string;
  promover?: { rotulo: string; onPick: () => void };
  cabecalhoDestinos: string;
  destinos: { id: number; nome: string; cor: string; onPick: () => void }[];
  disabled?: boolean;
}) {
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
        onClick={() => setAberto((o) => !o)}
        disabled={disabled}
        title={titulo}
        className="tap shrink-0 w-[30px] h-[30px] rounded-[8px] flex items-center justify-center text-muted hover:text-accent hover:bg-accent/10 bg-transparent border-0 cursor-pointer transition-colors disabled:opacity-40"
      >
        <IconeMover />
      </button>
      {aberto && (
        <div className="absolute z-[60] top-[34px] right-0 bg-card border border-line rounded-[12px] shadow-pop p-[6px] w-[230px] fade-in">
          {promover && (
            <>
              <button
                onClick={() => { setAberto(false); promover.onPick(); }}
                className="w-full flex items-center gap-[8px] px-2 py-[7px] rounded-[8px] text-left text-[13px] font-medium border-0 cursor-pointer bg-transparent hover:bg-fill transition-colors"
              >
                ↥ {promover.rotulo}
              </button>
              <div className="h-px bg-line my-[4px]" />
            </>
          )}
          <div className="text-[10.5px] text-muted uppercase tracking-[.05em] font-semibold px-2 py-[4px]">{cabecalhoDestinos}</div>
          <div className="max-h-[220px] overflow-auto scroll-thin">
            {destinos.length === 0 && <div className="text-muted text-[12.5px] px-2 py-2">Nenhuma categoria disponível</div>}
            {destinos.map((d) => (
              <button
                key={d.id}
                onClick={() => { setAberto(false); d.onPick(); }}
                className="w-full flex items-center gap-[8px] px-2 py-[7px] rounded-[8px] text-left text-[13px] border-0 cursor-pointer bg-transparent hover:bg-fill transition-colors"
              >
                <span className="w-[9px] h-[9px] rounded-full shrink-0" style={{ background: d.cor }} />
                <span className="truncate">{d.nome}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function Categorias({ reload }: Props) {
  const {
    categorias, pronto, adicionar, renomear, mudarCor, excluir, reordenar,
    adicionarSub, renomearSub, excluirSub, reordenarSub,
    converterEmSub, promoverSub, moverSubPara,
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

  // reordena uma seção (por arraste) e costura a ordem global (despesas antes de receitas)
  const reordenarSecao = (tipo: TipoCategoria, ids: number[]) => {
    const outraSecao = (tipo === "despesa" ? receitas : despesas).map((c) => c.id);
    const idsGlobais = tipo === "despesa" ? [...ids, ...outraSecao] : [...outraSecao, ...ids];
    reordenar(idsGlobais);
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

  /* ------------------- movimentos entre níveis da hierarquia ------------------- */
  const converterCatEmSub = async (c: Categoria, destino: Categoria) => {
    const n = contagem[c.nome] || 0;
    const ok = await confirm({
      title: `Transformar “${c.nome}” em subcategoria de “${destino.nome}”?`,
      confirmLabel: "Transformar",
      message: (
        <>
          {n > 0 && (
            <>
              As <b>{n}</b> {n === 1 ? "transação vira" : "transações viram"}{" "}
              <b>{destino.nome} › {c.nome}</b>.{" "}
            </>
          )}
          {c.subs.length > 0 && (
            <>
              As {c.subs.length} subcategorias de “{c.nome}” passam a ser subcategorias
              diretas de “{destino.nome}” (as de nome repetido são mescladas).{" "}
            </>
          )}
          Regras e vínculos do Planejamento passam a apontar para “{destino.nome}”.
        </>
      ),
    });
    if (!ok) return;
    setBusy(true);
    const r = await converterEmSub(c.id, destino.id);
    setBusy(false);
    if (!r.ok) { toast({ message: r.erro || "Não foi possível mover.", variant: "error" }); return; }
    toast({ message: `“${c.nome}” agora é subcategoria de “${destino.nome}”.`, variant: "success" });
    setAbertas((m) => ({ ...m, [destino.id]: true }));
    reload(); recarregarContagem();
  };

  const promoverSubCat = async (c: Categoria, s: Subcategoria) => {
    const n = contagemSub[`${c.nome}//${s.nome}`] || 0;
    const ok = await confirm({
      title: `Promover “${s.nome}” a categoria?`,
      confirmLabel: "Promover",
      message: (
        <>
          “{s.nome}” deixa de ser subcategoria de “{c.nome}” e vira uma categoria própria
          (herda a cor e o tipo).
          {n > 0 && <> As <b>{n}</b> {n === 1 ? "transação passa" : "transações passam"} a ser da categoria <b>{s.nome}</b>.</>}
        </>
      ),
    });
    if (!ok) return;
    setBusy(true);
    const r = await promoverSub(s.id);
    setBusy(false);
    if (!r.ok) { toast({ message: r.erro || "Não foi possível promover.", variant: "error" }); return; }
    toast({ message: `“${s.nome}” agora é uma categoria.`, variant: "success" });
    reload(); recarregarContagem();
  };

  const moverSubOutra = async (c: Categoria, s: Subcategoria, destino: Categoria) => {
    const n = contagemSub[`${c.nome}//${s.nome}`] || 0;
    const ok = await confirm({
      title: `Mover “${s.nome}” para “${destino.nome}”?`,
      confirmLabel: "Mover",
      message: (
        <>
          A subcategoria sai de “{c.nome}” e vai para “{destino.nome}”.
          {n > 0 && <> As <b>{n}</b> {n === 1 ? "transação vira" : "transações viram"} <b>{destino.nome} › {s.nome}</b>.</>}
        </>
      ),
    });
    if (!ok) return;
    setBusy(true);
    const r = await moverSubPara(s.id, destino.id);
    setBusy(false);
    if (!r.ok) { toast({ message: r.erro || "Não foi possível mover.", variant: "error" }); return; }
    toast({ message: `“${s.nome}” movida para “${destino.nome}”.`, variant: "success" });
    setAbertas((m) => ({ ...m, [destino.id]: true }));
    reload(); recarregarContagem();
  };

  /* --------------------------- render de uma categoria --------------------------- */
  const renderCategoria = (c: Categoria, alca: AlcaProps, arrastando: boolean, lista: Categoria[]) => {
    const n = contagem[c.nome] || 0;
    const editando = editId === c.id;
    const aberta = !!abertas[c.id];
    return (
      <div className={`py-[6px] rounded-[10px] transition-shadow ${arrastando ? "bg-card shadow-pop ring-1 ring-line" : ""}`}>
        <div className="flex items-center gap-2">
          <AlcaArrastar alca={alca} className="w-[28px] h-[30px] md:w-[24px]" />

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
            <>
              <MenuMover
                titulo="Transformar em subcategoria de…"
                cabecalhoDestinos="Virar subcategoria de:"
                disabled={busy}
                destinos={lista
                  .filter((d) => d.id !== c.id)
                  .map((d) => ({ id: d.id, nome: d.nome, cor: d.cor, onPick: () => converterCatEmSub(c, d) }))}
              />
              <button
                onClick={() => excluirCat(c)}
                disabled={busy}
                title="Apagar categoria"
                className="tap shrink-0 w-[30px] h-[30px] rounded-[8px] flex items-center justify-center text-muted hover:text-red hover:bg-red/10 bg-transparent border-0 cursor-pointer transition-colors"
              >
                <IconeLixeira />
              </button>
            </>
          )}
        </div>

        {/* subcategorias */}
        {aberta && (
          <div className="mt-[6px] ml-[40px] pl-3 border-l border-line">
            <ListaOrdenavel
              items={c.subs}
              getId={(s) => s.id}
              onReorder={(ids) => reordenarSub(c.id, ids)}
              className="flex flex-col gap-[4px]"
              render={(s, alcaSub, arrastandoSub) => {
              const edSub = editSubId === s.id;
              const nSub = contagemSub[`${c.nome}//${s.nome}`] || 0;
              return (
                <div className={`flex items-center gap-2 rounded-[8px] ${arrastandoSub ? "bg-card shadow-pop ring-1 ring-line" : ""}`}>
                  <AlcaArrastar alca={alcaSub} className="w-[24px] h-[26px]" />
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
                  <MenuMover
                    titulo="Mover subcategoria…"
                    cabecalhoDestinos="Mover para:"
                    disabled={busy}
                    promover={{ rotulo: "Promover a categoria", onPick: () => promoverSubCat(c, s) }}
                    destinos={lista
                      .filter((d) => d.id !== c.id)
                      .map((d) => ({ id: d.id, nome: d.nome, cor: d.cor, onPick: () => moverSubOutra(c, s, d) }))}
                  />
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
              }}
            />
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
            <b> arraste pela alça</b> (⠿) para definir a <b>ordem</b>. Abra uma categoria (seta ›) para criar <b>subcategorias</b> —
            elas são opcionais e qualquer categoria pode ter. Ao <b>apagar</b> uma categoria em uso, as transações
            dela voltam para “sem categoria”.
          </>
        }
        busy={busy}
        onAdd={(nome, cor, limpar) => adicionarCat(nome, cor, "despesa", limpar)}
        lista={despesas}
        renderCategoria={renderCategoria}
        onReorder={(ids) => reordenarSecao("despesa", ids)}
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
        onReorder={(ids) => reordenarSecao("receita", ids)}
        vazio="Nenhuma categoria de receita ainda. Adicione a primeira acima."
      />
    </div>
  );
}

/* ---------- uma seção (Despesas ou Receitas): form de adicionar + lista ---------- */
function SecaoCategorias({
  titulo, contador, descricao, busy, onAdd, lista, renderCategoria, onReorder, vazio,
}: {
  tipo: TipoCategoria;
  titulo: string;
  contador: number;
  descricao: ReactNode;
  busy: boolean;
  onAdd: (nome: string, cor: string, limpar: () => void) => void;
  lista: Categoria[];
  renderCategoria: (c: Categoria, alca: AlcaProps, arrastando: boolean, lista: Categoria[]) => ReactNode;
  onReorder: (ids: number[]) => void;
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

      {/* lista ordenável por arraste */}
      <ListaOrdenavel
        items={lista}
        getId={(c) => c.id}
        onReorder={onReorder}
        disabled={busy}
        className="divide-y divide-line"
        render={(c, alca, arrastando) => renderCategoria(c, alca, arrastando, lista)}
      />
      {lista.length === 0 && (
        <div className="text-muted text-[13.5px] py-4">{vazio}</div>
      )}

      {/* explicação de como usar — legenda discreta no rodapé */}
      <div className="mt-3">
        <Legenda>{descricao}</Legenda>
      </div>
    </Panel>
  );
}
