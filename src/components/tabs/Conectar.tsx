import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { PluggyConnect } from "react-pluggy-connect";
import { Panel } from "../ui";
import { resolverBanco } from "../../lib/bancos";
import {
  getConnectToken,
  syncItem,
  listItems,
  type PluggyItemRow,
  type SyncResult,
} from "../../lib/pluggy";

/* Nome do banco para exibir: resolvedor único (conector + nomes das contas). */
function nomeBanco(it: PluggyItemRow): string {
  return resolverBanco(it.connector_name, Object.keys(it.last_result?.por_conta ?? {}));
}

/* "2026-06-01" -> "01/06/2026" (sem passar por Date, evita fuso) */
function fmtCorte(s: string | null): string | null {
  if (!s) return null;
  const [y, m, d] = s.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : null;
}

/* nomes das contas sincronizadas, para distinguir conexões do mesmo banco */
function nomeContas(it: PluggyItemRow): string {
  return Object.keys(it.last_result?.por_conta ?? {}).join(" · ");
}

/* Aba "Conectar": conecta bancos via Open Finance (Pluggy) e importa as
   transacoes direto para a tabela `lancamentos`. Modo hibrido com PDFs:
   a "data de corte" evita contar a mesma transacao duas vezes. */
export function Conectar({ reload }: { reload: () => void }) {
  const hoje = new Date();
  const inicioMes = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;

  const [corte, setCorte] = useState(inicioMes);
  const [token, setToken] = useState<string | null>(null);
  const [itens, setItens] = useState<PluggyItemRow[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setItens(await listItems());
    } catch (e) {
      setMsg("Erro ao listar conexoes: " + (e as Error).message);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  // abre o widget pedindo um connect token ao backend
  const conectar = useCallback(async (itemId?: string) => {
    setMsg("");
    setBusy(true);
    try {
      setToken(await getConnectToken(itemId));
    } catch (e) {
      setMsg("Erro ao iniciar conexao: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  // sincroniza um item ja conectado
  const sincronizar = useCallback(async (itemId: string) => {
    setMsg("Sincronizando…");
    setBusy(true);
    try {
      const r: SyncResult = await syncItem(itemId, corte);
      setMsg(`✓ ${r.inseridos} lançamentos importados (${r.contas} conta(s), a partir de ${r.from}).`);
      await carregar();
      reload();
    } catch (e) {
      setMsg("Erro na sincronização: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [corte, carregar, reload]);

  // sincroniza TODOS os itens em paralelo
  const sincronizarTudo = useCallback(async () => {
    if (itens.length === 0) return;
    setBusy(true);
    setMsg(`Sincronizando 0 de ${itens.length}…`);
    let ok = 0, erros = 0;
    await Promise.all(itens.map(async (it) => {
      try {
        await syncItem(it.item_id, it.sync_from ?? corte);
        ok++;
      } catch {
        erros++;
      }
      setMsg(`Sincronizando ${ok + erros} de ${itens.length}…`);
    }));
    await carregar();
    reload();
    setMsg(`✓ ${itens.length} conexão(ões) sincronizada(s)${erros ? ` (${erros} com erro)` : ""}.`);
    setBusy(false);
  }, [itens, corte, carregar, reload]);

  // callback de sucesso do widget: pega o itemId e ja sincroniza
  const onSuccess = useCallback(async (data: { item: { id: string } }) => {
    setToken(null);
    const itemId = data?.item?.id;
    if (itemId) await sincronizar(itemId);
  }, [sincronizar]);

  return (
    <div>
      <Panel
        title="Conectar banco (Open Finance)"
        sub="via Pluggy"
      >
        <p className="text-[13.5px] text-muted leading-relaxed mb-4">
          Conecte suas contas e cartões pelo Open Finance para importar as transações
          automaticamente, sem precisar baixar PDFs. A conexão é feita no ambiente
          seguro do Pluggy — o app nunca vê sua senha do banco.
        </p>

        <div className="flex flex-wrap items-end gap-3 mb-2">
          <label className="text-[13px] text-muted">
            Importar a partir de
            <input
              type="date"
              value={corte}
              onChange={(e) => setCorte(e.target.value)}
              className="block mt-1 bg-card text-txt border border-line rounded-[10px] px-3 py-[8px] text-[13.5px] outline-none focus:border-muted"
            />
          </label>
          <button
            onClick={() => conectar()}
            disabled={busy}
            className="bg-accent text-white border-0 rounded-[10px] px-4 py-[10px] text-[13.5px] font-semibold cursor-pointer disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            + Conectar banco
          </button>
        </div>
        <p className="text-[12px] text-muted leading-relaxed">
          Dica (modo híbrido com PDFs): use como data de corte o dia seguinte ao
          último extrato/fatura que você já importou por PDF, para não duplicar
          lançamentos.
        </p>

        {msg && <div className="mt-4 text-[13px] text-txt bg-fill rounded-[10px] px-3 py-2">{msg}</div>}
      </Panel>

      {itens.length > 0 && (
        <Panel title="Bancos conectados">
          <div className="flex justify-end mb-3">
            <button
              onClick={sincronizarTudo}
              disabled={busy}
              className="bg-accent text-white border-0 rounded-[10px] px-4 py-[9px] text-[13px] font-semibold cursor-pointer disabled:opacity-50 hover:opacity-90 transition-opacity"
            >
              Sincronizar tudo
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {itens.map((it) => (
              <div
                key={it.item_id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-line rounded-[12px] px-3 py-[10px]"
              >
                <div className="flex flex-col min-w-0">
                  <span className="text-[14px] font-semibold">{nomeBanco(it)}</span>
                  {nomeContas(it) && (
                    <span className="text-[11.5px] text-muted truncate max-w-[280px]" title={nomeContas(it)}>
                      {nomeContas(it)}
                    </span>
                  )}
                </div>
                <span className={`text-[12px] ${it.status === "UPDATED" ? "text-green" : "text-amber"}`}>
                  {it.status || "—"}
                </span>
                <span className="text-[12px] text-muted">
                  {fmtCorte(it.sync_from) && <>importado a partir de {fmtCorte(it.sync_from)}</>}
                  {it.last_synced_at && (
                    <>
                      {fmtCorte(it.sync_from) && " · "}
                      última sync: {new Date(it.last_synced_at).toLocaleString("pt-BR")}
                    </>
                  )}
                  {it.last_result?.transacoes != null && ` · ${it.last_result.transacoes} transações`}
                </span>
                <div className="ml-auto flex gap-2">
                  <button
                    onClick={() => sincronizar(it.item_id)}
                    disabled={busy}
                    className="bg-fill text-txt border border-line rounded-[9px] px-3 py-[7px] text-[12.5px] font-medium cursor-pointer disabled:opacity-50 hover:border-muted transition-colors"
                  >
                    Sincronizar
                  </button>
                  <button
                    onClick={() => conectar(it.item_id)}
                    disabled={busy}
                    className="bg-transparent text-muted border border-line rounded-[9px] px-3 py-[7px] text-[12.5px] font-medium cursor-pointer disabled:opacity-50 hover:text-txt transition-colors"
                  >
                    Reconectar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {token && createPortal(
        <PluggyConnect
          connectToken={token}
          onSuccess={onSuccess}
          onError={() => { setToken(null); setMsg("Conexão cancelada ou com erro."); }}
          onClose={() => setToken(null)}
        />,
        document.body
      )}
    </div>
  );
}
