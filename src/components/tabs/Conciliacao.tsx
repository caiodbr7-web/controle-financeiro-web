import { useCallback, useEffect, useMemo, useState } from "react";
import type { Lancamento } from "../../types";
import { Kpi, Seg, Select } from "../ui";
import { sb } from "../../lib/supabase";
import { BRL, fmtMoeda, dicaMoedaOrigem, bankOf, dvDataReal } from "../../lib/finance";
import { conciliar, type Conf, type Par } from "../../lib/conciliacao";

/* ============================================================================
   Aba "Conciliação" — PDF × Open Finance.
   Cruza o que foi importado por arquivo com o que o Open Finance puxou e mostra:
   duplicatas prováveis (com confiança), só-Open-Finance e só-PDF na sobreposição.
   NÃO altera nada no banco: é uma superfície de diagnóstico.
   ============================================================================ */

type Vista = "dup" | "soOF" | "soPDF" | "estr";

const fmtData = (d: Lancamento) => {
  const r = dvDataReal(d);
  return r ? `${String(r.d).padStart(2, "0")}/${r.k.slice(5, 7)}/${r.k.slice(2, 4)}` : d.data_mov || "—";
};
const fmtJanela = (ms: number) => new Date(ms).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });

const CONF_LABEL: Record<Conf, string> = { alta: "Alta", media: "Média", baixa: "Baixa" };
const CONF_CLS: Record<Conf, string> = { alta: "text-red", media: "text-amber", baixa: "text-muted" };

export function Conciliacao() {
  const [rows, setRows] = useState<Lancamento[]>([]);
  const [status, setStatus] = useState("carregando…");
  const [erro, setErro] = useState("");
  const [tol, setTol] = useState(3);
  const [vista, setVista] = useState<Vista>("dup");
  const [confFiltro, setConfFiltro] = useState<"" | Conf>("");

  // filtros da tabela
  const [busca, setBusca] = useState("");
  const [fBanco, setFBanco] = useState("");
  const [fOrigem, setFOrigem] = useState("");
  const [fClasse, setFClasse] = useState("");

  // consulta própria: TODOS os lançamentos (pdf + pluggy), paginada
  const carregar = useCallback(async () => {
    setStatus("carregando…");
    setErro("");
    const PAGINA = 1000;
    let todos: Lancamento[] = [], de = 0;
    while (true) {
      const { data, error } = await sb
        .from("lancamentos").select("*")
        .order("id", { ascending: false })
        .range(de, de + PAGINA - 1);
      if (error) { setErro(error.message); setStatus(""); return; }
      todos = todos.concat((data || []) as Lancamento[]);
      if (!data || data.length < PAGINA) break;
      de += PAGINA;
    }
    setRows(todos);
    setStatus("");
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const totOF = useMemo(() => rows.filter((d) => d.fonte_dados === "pluggy").length, [rows]);
  const totPDF = useMemo(() => rows.filter((d) => d.fonte_dados !== "pluggy").length, [rows]);

  // Sandbox? Open Finance cujo banco não casa com Itaú/Nubank/PicPay → conector de teste
  const sandbox = useMemo(() => {
    const of = rows.filter((d) => d.fonte_dados === "pluggy");
    if (!of.length) return false;
    return of.filter((d) => bankOf(d.banco) === "outro").length > of.length / 2;
  }, [rows]);

  const res = useMemo(() => conciliar(rows, tol), [rows, tol]);

  // opções dos selects (derivadas de todos os lançamentos carregados)
  const bancos = useMemo(() => [...new Set(rows.map((d) => d.banco).filter(Boolean))].sort(), [rows]);
  const origens = useMemo(
    () => [...new Set(rows.filter((d) => !fBanco || d.banco === fBanco).map((d) => d.origem).filter(Boolean))].sort(),
    [rows, fBanco]
  );
  const classes = useMemo(() => [...new Set(rows.map((d) => d.classe).filter(Boolean))].sort() as string[], [rows]);

  // predicado de filtro aplicado a um lançamento
  const matchLanc = useCallback((d: Lancamento) => {
    const q = busca.toLowerCase().trim();
    const tem = (s: unknown) => String(s ?? "").toLowerCase().includes(q);
    return (
      (!fBanco || d.banco === fBanco) &&
      (!fOrigem || d.origem === fOrigem) &&
      (!fClasse || d.classe === fClasse) &&
      (!q || tem(d.descricao) || tem(d.origem) || tem(d.banco) || tem(d.categoria_auto) || tem(d.categoria_manual))
    );
  }, [busca, fBanco, fOrigem, fClasse]);

  // baldes filtrados (um par casa se QUALQUER lado bater o filtro)
  const paresBuscaF = useMemo(() => res.pares.filter((p) => matchLanc(p.of) || matchLanc(p.pdf)), [res.pares, matchLanc]);
  const soOFF = useMemo(() => res.soOF.filter(matchLanc), [res.soOF, matchLanc]);
  const soPDFF = useMemo(() => res.soPDF.filter(matchLanc), [res.soPDF, matchLanc]);
  const estrF = useMemo(() => res.ofEstrangeiro.filter(matchLanc), [res.ofEstrangeiro, matchLanc]);

  const paresFiltrados = useMemo(
    () => (confFiltro ? paresBuscaF.filter((p) => p.conf === confFiltro) : paresBuscaF),
    [paresBuscaF, confFiltro]
  );
  const totalDupReais = useMemo(() => paresBuscaF.reduce((s, p) => s + Math.abs(p.of.valor), 0), [paresBuscaF]);
  const contagemConf = useMemo(() => {
    const c = { alta: 0, media: 0, baixa: 0 } as Record<Conf, number>;
    for (const p of paresBuscaF) c[p.conf]++;
    return c;
  }, [paresBuscaF]);

  const filtroAtivo = !!(busca || fBanco || fOrigem || fClasse);
  const limparFiltros = () => { setBusca(""); setFBanco(""); setFOrigem(""); setFClasse(""); };

  if (!status && !erro && totOF === 0) {
    return (
      <div className="bg-card border border-line rounded-[18px] p-6 sm:p-8 shadow-card text-center">
        <h2 className="text-[16px] font-semibold tracking-tight mb-2">Nada do Open Finance para conciliar ainda</h2>
        <p className="text-[13.5px] text-muted leading-relaxed max-w-[560px] mx-auto">
          Esta aba cruza o que você importou por <strong>PDF</strong> com o que o <strong>Open Finance</strong> puxou,
          para achar duplicatas e divergências. Conecte um banco na aba <strong>Conectar</strong> e sincronize;
          depois volte aqui.
        </p>
        <button onClick={carregar} className="mt-4 bg-fill text-txt border border-line rounded-[10px] px-4 py-[9px] text-[13.5px] font-medium cursor-pointer hover:border-muted transition-colors">
          Atualizar
        </button>
      </div>
    );
  }

  return (
    <div>
      {sandbox && (
        <div className="text-[12.5px] text-amber bg-amber/10 border border-amber/30 rounded-[12px] px-3.5 py-2.5 mb-4 leading-relaxed">
          <strong>Atenção:</strong> os dados do Open Finance parecem vir do <strong>Sandbox do Pluggy</strong> (banco não reconhecido como Itaú/Nubank/PicPay).
          São transações de teste fictícias — os "pares" abaixo tendem a ser coincidências de valor+data, não duplicatas reais.
          A conciliação só fica confiável depois de conectar um banco de verdade.
        </div>
      )}

      {res.ofEstrangeiro.length > 0 && (
        <div className="text-[12.5px] text-amber bg-amber/10 border border-amber/30 rounded-[12px] px-3.5 py-2.5 mb-4 leading-relaxed">
          <strong>{res.ofEstrangeiro.length}</strong> lançamento(s) do Open Finance estão em <strong>moeda estrangeira sem conversão</strong> do
          Pluggy e ficam <strong>fora do cruzamento</strong> (não dá para casar um valor em dólar contra um PDF em real). Veja-os na aba
          "Moeda estrangeira". Com banco de verdade o Pluggy costuma enviar o valor já convertido em BRL, e eles voltam a conciliar normalmente.
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center mb-3">
        <Seg<Vista>
          value={vista}
          onChange={setVista}
          options={[
            { v: "dup", label: `Duplicatas prováveis (${paresBuscaF.length})` },
            { v: "soOF", label: `Só Open Finance (${soOFF.length})` },
            { v: "soPDF", label: `Só PDF na janela (${soPDFF.length})` },
            ...(res.ofEstrangeiro.length ? [{ v: "estr" as const, label: `Moeda estrangeira (${estrF.length})` }] : []),
          ]}
        />
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[12.5px] text-muted">Tolerância de data</span>
          <Select value={String(tol)} onChange={(v) => setTol(+v)} className="pr-2">
            <option value="1">± 1 dia</option>
            <option value="3">± 3 dias</option>
            <option value="7">± 7 dias</option>
            <option value="15">± 15 dias</option>
          </Select>
          <button className="bg-fill text-txt border border-line rounded-[10px] px-3 py-[8px] text-[13px] font-medium cursor-pointer hover:border-muted transition-colors" onClick={carregar}>
            Atualizar
          </button>
        </div>
      </div>

      {/* filtros da tabela (valem para as quatro vistas) */}
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <input
          className="input min-w-[220px] flex-1"
          placeholder="Buscar (descrição, origem, banco, categoria)…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <Select value={fBanco} onChange={(v) => { setFBanco(v); setFOrigem(""); }}>
          <option value="">Todos os bancos</option>
          {bancos.map((b) => <option key={b}>{b}</option>)}
        </Select>
        <Select value={fOrigem} onChange={setFOrigem}>
          <option value="">Todas as origens</option>
          {origens.map((o) => <option key={o}>{o}</option>)}
        </Select>
        <Select value={fClasse} onChange={setFClasse}>
          <option value="">Todas as classes</option>
          {classes.map((c) => <option key={c}>{c}</option>)}
        </Select>
        <button
          className="bg-fill text-txt border border-line rounded-[10px] px-3 py-[8px] text-[13px] font-medium cursor-pointer hover:border-muted transition-colors disabled:opacity-40"
          onClick={limparFiltros}
          disabled={!filtroAtivo}
        >
          Limpar
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-[14px] mb-[18px]">
        <Kpi title="Lançamentos PDF" value={totPDF.toLocaleString("pt-BR")} />
        <Kpi title="Lançamentos Open Finance" value={totOF.toLocaleString("pt-BR")} />
        <Kpi title={filtroAtivo ? "Duplicatas (filtro)" : "Duplicatas prováveis"} value={paresBuscaF.length.toLocaleString("pt-BR")} sub={BRL(totalDupReais)} color={paresBuscaF.length ? "text-amber" : ""} />
        <Kpi title="Confiança Alta" value={contagemConf.alta.toLocaleString("pt-BR")} sub="valor+data+banco+descrição" color={contagemConf.alta ? "text-red" : ""} />
        <Kpi title="Só Open Finance" value={soOFF.length.toLocaleString("pt-BR")} sub="OF trouxe, PDF não" />
        <Kpi
          title="Janela de sobreposição"
          value={res.janela ? `${fmtJanela(res.janela.ini)} – ${fmtJanela(res.janela.fim)}` : "—"}
          sub="onde duplicatas podem existir"
        />
      </div>

      {erro && <div className="text-[13px] text-red bg-fill rounded-[10px] px-3 py-2 mb-3">Erro: {erro}</div>}
      {status && <div className="text-muted text-[12.5px] mb-3">{status}</div>}

      <div className="bg-card border border-line rounded-[18px] shadow-card overflow-hidden">
        <div className="max-h-[600px] overflow-auto scroll-thin">
          {vista === "dup" ? (
            <TabelaPares pares={paresFiltrados} confFiltro={confFiltro} setConfFiltro={setConfFiltro} contagem={contagemConf} />
          ) : (
            <TabelaSimples rows={vista === "soOF" ? soOFF : vista === "estr" ? estrF : soPDFF} />
          )}
        </div>
      </div>

      <p className="text-[12px] text-muted mt-2 leading-relaxed">
        Diagnóstico apenas — nada é alterado no banco. <strong>Duplicata provável</strong> = mesma transação nas duas fontes
        (casada por valor + data ± tolerância + tipo; <strong>Alta</strong> exige também banco e descrição iguais).
        <strong> Só PDF na janela</strong> considera só o período coberto pelas duas fontes; antes da janela o "só PDF" é esperado.
      </p>
    </div>
  );
}

function TabelaPares({
  pares, confFiltro, setConfFiltro, contagem,
}: {
  pares: Par[]; confFiltro: "" | Conf; setConfFiltro: (c: "" | Conf) => void; contagem: Record<Conf, number>;
}) {
  return (
    <table className="tbl min-w-[1000px] text-[12.5px]">
      <thead>
        <tr>
          <th className="sticky top-0 bg-card z-[1]">
            <Select value={confFiltro} onChange={(v) => setConfFiltro(v as "" | Conf)} className="!py-[3px] !text-[12px]">
              <option value="">Conf. (todas)</option>
              <option value="alta">Alta ({contagem.alta})</option>
              <option value="media">Média ({contagem.media})</option>
              <option value="baixa">Baixa ({contagem.baixa})</option>
            </Select>
          </th>
          <th className="sticky top-0 bg-card z-[1] text-right">Valor</th>
          <th className="sticky top-0 bg-card z-[1]">Open Finance</th>
          <th className="sticky top-0 bg-card z-[1]">PDF</th>
          <th className="sticky top-0 bg-card z-[1] text-right">Δ dias</th>
        </tr>
      </thead>
      <tbody>
        {pares.map((p) => (
          <tr key={p.of.id}>
            <td><span className={`font-semibold ${CONF_CLS[p.conf]}`}>{CONF_LABEL[p.conf]}</span></td>
            <td className="num font-medium">{BRL(Math.abs(p.of.valor))}</td>
            <td>
              <div className="font-medium truncate max-w-[320px]" title={p.of.descricao}>{p.of.descricao}</div>
              <div className="text-muted text-[11.5px]">{fmtData(p.of)} · {p.of.origem}</div>
            </td>
            <td>
              <div className="font-medium truncate max-w-[320px]" title={p.pdf.descricao}>{p.pdf.descricao}</div>
              <div className="text-muted text-[11.5px]">{fmtData(p.pdf)} · {p.pdf.origem}</div>
            </td>
            <td className="num">{p.dias}</td>
          </tr>
        ))}
        {!pares.length && (
          <tr><td colSpan={5} className="text-center text-muted py-6">Nenhum par nesse filtro.</td></tr>
        )}
      </tbody>
    </table>
  );
}

function TabelaSimples({ rows }: { rows: Lancamento[] }) {
  return (
    <table className="tbl min-w-[760px] text-[12.5px]">
      <thead>
        <tr>
          <th className="sticky top-0 bg-card z-[1]">Data</th>
          <th className="sticky top-0 bg-card z-[1]">Banco</th>
          <th className="sticky top-0 bg-card z-[1]">Origem</th>
          <th className="sticky top-0 bg-card z-[1]">Descrição</th>
          <th className="sticky top-0 bg-card z-[1]">Classe</th>
          <th className="sticky top-0 bg-card z-[1] text-right">Valor</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((d) => (
          <tr key={d.id}>
            <td className="whitespace-nowrap">{fmtData(d)}</td>
            <td>{d.banco}</td>
            <td className="whitespace-nowrap">{d.origem}</td>
            <td className="max-w-[360px] truncate" title={d.descricao}>{d.descricao}</td>
            <td>{d.classe}</td>
            <td className={`num ${d.valor < 0 ? "text-red" : "text-green"}`}>
              {fmtMoeda(d.valor, d.moeda)}
              {dicaMoedaOrigem(d) && <span className="text-muted text-[11px] ml-1">({dicaMoedaOrigem(d)})</span>}
            </td>
          </tr>
        ))}
        {!rows.length && (
          <tr><td colSpan={6} className="text-center text-muted py-6">Nada aqui.</td></tr>
        )}
      </tbody>
    </table>
  );
}
