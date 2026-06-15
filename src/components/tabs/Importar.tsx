import { useMemo, useRef, useState } from "react";
import { Panel, Select, Seg, Kpi } from "../ui";
import { BRL } from "../../lib/finance";
import {
  parseFile, guessMap, buildAll, importarRows,
  type ParsedFile, type MapConfig, type BuildOpts, type ImportResult,
} from "../../lib/import";

const BANCOS = ["Nubank", "PicPay", "Itau"];

export function Importar({ reload }: { reload: () => void }) {
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [fileName, setFileName] = useState("");
  const [erro, setErro] = useState("");
  const [drag, setDrag] = useState(false);

  const [banco, setBanco] = useState("Nubank");
  const [tipo, setTipo] = useState<"Cartao" | "Conta">("Conta");
  const [inverter, setInverter] = useState(false);
  const [map, setMap] = useState<MapConfig>({ data: "", descricao: "", valor: "" });

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function abrir(file: File) {
    setErro(""); setResult(null);
    try {
      const p = await parseFile(file);
      if (!p.rows.length) { setErro("Não encontrei linhas de transação neste arquivo."); return; }
      setParsed(p);
      setFileName(file.name);
      setMap(guessMap(p.columns));
    } catch (e: any) {
      setErro("Falha ao ler o arquivo: " + (e?.message || e));
    }
  }

  const opts: BuildOpts = { banco: banco.trim() || "Outro", tipo, inverterSinal: inverter };
  const build = useMemo(
    () => (parsed ? buildAll(parsed, map, opts) : null),
    [parsed, map, banco, tipo, inverter]
  );

  async function confirmar() {
    if (!build || !build.rows.length) return;
    setBusy(true); setErro("");
    const r = await importarRows(build.rows);
    setBusy(false);
    if (r.erro) { setErro("Erro ao salvar: " + r.erro); return; }
    setResult(r);
    if (r.inseridos > 0) reload();
  }

  function resetar() {
    setParsed(null); setFileName(""); setResult(null); setErro("");
    if (inputRef.current) inputRef.current.value = "";
  }

  // ---------- tela de upload ----------
  if (!parsed) {
    return (
      <div className="max-w-[760px]">
        <Panel title="Importar lançamentos" sub="planilha CSV/Excel ou extrato OFX">
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) abrir(f); }}
            onClick={() => inputRef.current?.click()}
            className={`rounded-[16px] border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
              drag ? "border-accent bg-accent/5" : "border-line hover:border-muted/60"
            }`}
          >
            <div className="text-[15px] font-medium mb-1">Arraste um arquivo aqui ou clique para escolher</div>
            <div className="text-muted text-[12.5px]">Formatos: CSV, Excel (.xlsx/.xls) e OFX</div>
            <input
              ref={inputRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.ofx,.qfx" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) abrir(f); }}
            />
          </div>
          {erro && <div className="text-red text-[13px] mt-3">{erro}</div>}
          <div className="text-muted text-[12px] mt-4 leading-relaxed">
            Exporte o extrato/fatura do seu banco em <b>CSV</b>, <b>Excel</b> ou <b>OFX</b> e solte aqui.
            Você confere tudo num preview antes de salvar, e lançamentos repetidos são ignorados
            automaticamente. A categorização fica na aba <b>Classificar</b>.
          </div>
        </Panel>
      </div>
    );
  }

  // ---------- tela de resultado ----------
  if (result) {
    return (
      <div className="max-w-[760px]">
        <Panel title="Importação concluída" sub={fileName}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            <Kpi title="Inseridos" value={result.inseridos} color="text-green" />
            <Kpi title="Duplicados ignorados" value={result.duplicados} />
            <Kpi title="Linhas inválidas" value={build?.invalidas ?? 0} />
          </div>
          <div className="flex gap-2">
            <button onClick={resetar} className="btn-ghost !py-[9px] !px-4">Importar outro arquivo</button>
          </div>
        </Panel>
      </div>
    );
  }

  // ---------- tela de configuração + preview ----------
  const previa = build ? build.rows.slice(0, 8) : [];
  const precisaMapa = parsed.kind !== "ofx";

  return (
    <div className="max-w-[920px]">
      <Panel
        title="Conferir e importar"
        sub={`${fileName} · ${parsed.rows.length} linhas`}
        right={<button onClick={resetar} className="btn-ghost !py-[7px] !px-3 !text-[12.5px]">Trocar arquivo</button>}
      >
        <div className="flex flex-wrap gap-x-5 gap-y-3 items-center mb-4">
          <label className="flex items-center gap-2 text-[13px]">
            <span className="text-muted">Banco</span>
            <input
              list="bancos-list" value={banco} onChange={(e) => setBanco(e.target.value)}
              className="input !py-[8px] !px-3 !text-[13.5px] w-[140px]"
            />
            <datalist id="bancos-list">{BANCOS.map((b) => <option key={b} value={b} />)}</datalist>
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            <span className="text-muted">Origem</span>
            <Seg value={tipo} onChange={(v) => setTipo(v)} size="sm"
              options={[{ v: "Conta", label: "Conta/Extrato" }, { v: "Cartao", label: "Cartão/Fatura" }]} />
          </label>
          <label className="flex items-center gap-2 text-[13px] cursor-pointer">
            <input type="checkbox" checked={inverter} onChange={(e) => setInverter(e.target.checked)} />
            <span>Gastos vêm como positivo (inverter sinal)</span>
          </label>
        </div>

        {precisaMapa && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            {(["data", "descricao", "valor"] as const).map((campo) => (
              <label key={campo} className="text-[12.5px]">
                <span className="text-muted capitalize">{campo === "descricao" ? "Descrição" : campo}</span>
                <Select value={map[campo]} onChange={(v) => setMap((m) => ({ ...m, [campo]: v }))} className="w-full mt-1">
                  <option value="">— selecione —</option>
                  {parsed.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </label>
            ))}
          </div>
        )}

        {build && (
          <div className="text-[12.5px] text-muted mb-2">
            {build.validas} linhas válidas
            {build.invalidas > 0 && <span className="text-amber"> · {build.invalidas} ignoradas (data/valor não reconhecidos)</span>}
          </div>
        )}

        <div className="overflow-x-auto border border-line rounded-[12px]">
          <table className="w-full text-[12.5px]">
            <thead className="text-muted">
              <tr className="border-b border-line">
                <th className="text-left font-medium p-2">Data</th>
                <th className="text-left font-medium p-2">Descrição</th>
                <th className="text-left font-medium p-2">Classe</th>
                <th className="text-right font-medium p-2">Valor</th>
              </tr>
            </thead>
            <tbody>
              {previa.map((r, i) => (
                <tr key={i} className="border-b border-line/60 last:border-0">
                  <td className="p-2 tabular-nums whitespace-nowrap">{r.data_mov}</td>
                  <td className="p-2 truncate max-w-[360px]">{r.descricao}</td>
                  <td className="p-2 text-muted">{r.classe}</td>
                  <td className={`p-2 text-right tabular-nums whitespace-nowrap ${r.valor < 0 ? "text-red" : "text-green"}`}>{BRL(r.valor)}</td>
                </tr>
              ))}
              {!previa.length && (
                <tr><td colSpan={4} className="p-3 text-center text-muted">Nenhuma linha válida — confira o mapeamento das colunas.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {previa.length > 0 && build && build.validas > previa.length && (
          <div className="text-muted text-[11.5px] mt-2">Mostrando 8 de {build.validas} linhas.</div>
        )}

        {erro && <div className="text-red text-[13px] mt-3">{erro}</div>}

        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={confirmar}
            disabled={busy || !build || !build.rows.length}
            className="btn-primary !py-[10px] !px-5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? "Importando…" : `Importar ${build?.validas ?? 0} lançamentos`}
          </button>
          <span className="text-muted text-[12px]">Repetidos são ignorados na hora de salvar.</span>
        </div>
      </Panel>
    </div>
  );
}
