// ============================================================================
// Edge Function: pluggy-sync
// Busca contas + transacoes de um Item Pluggy, grava na camada CRUA
// (pluggy_contas_raw / pluggy_transacoes_raw) e dispara a traducao SQL que
// popula `lancamentos` (funcao public.pluggy_traduzir_lancamentos).
//
// Fluxo:  Pluggy API -> raw (upsert) -> RPC traduz -> lancamentos
//
// Idempotente: cru faz upsert por tx_id/account_id; a traducao faz upsert por
// hash_natural ('pluggy:<txId>') e PRESERVA categoria_manual editada no front.
//
// Body: { itemId: string, from?: "YYYY-MM-DD", refresh?: boolean,
//         translate?: boolean, translateOnly?: boolean }
//   - from: data de corte (modo hibrido). Se omitido, usa o sync_from salvo do
//     item; se tambem nao houver, importa os ultimos 12 meses (limite do Pluggy).
//   - refresh: se true, FORCA a Pluggy a buscar dados frescos no banco (PATCH
//     /items) e espera concluir antes de ler. Sem isso, le apenas o cache que a
//     Pluggy ja tinha (ex.: transacao recente de cartao pode nao ter chegado).
//   - translate (default true): se false, so baixa e grava na camada crua, SEM
//     rodar a traducao SQL nem os saldos. Usado pelo "Sincronizar tudo" para nao
//     disparar N traducoes em paralelo (evita statement timeout no banco).
//   - translateOnly: se true, NAO baixa nada; so roda a traducao + saldos UMA
//     vez. E o passo final do "Sincronizar tudo".
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import {
  pluggyAuth,
  getItem,
  triggerItemUpdate,
  getAccounts,
  getAllTransactions,
  mapContaRaw,
  mapTransacaoRaw,
  resolverBancoDaConta,
} from "../_shared/pluggy.ts";

function dozeMesesAtras(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 12);
  return d.toISOString().slice(0, 10);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// estados em que a Pluggy ainda esta trabalhando (devemos esperar)
const EM_ANDAMENTO = new Set(["UPDATING", "LOGIN_IN_PROGRESS", "CREATING", "CREATED"]);
// estados que exigem acao do usuario (MFA / credencial) -> nao adianta esperar
const PRECISA_USUARIO = new Set(["WAITING_USER_INPUT", "LOGIN_ERROR", "OUTDATED"]);

const REFRESH_TIMEOUT_MS = 75_000; // teto de espera pela atualizacao da Pluggy
const REFRESH_POLL_MS = 3_000; // intervalo entre verificacoes

// Forca a Pluggy a reconsultar o banco e espera o item ficar pronto. Retorna o
// item atualizado (ou o melhor que conseguiu, em caso de timeout/MFA).
async function forcarAtualizacao(apiKey: string, itemId: string, item: any) {
  // se ja precisa de acao do usuario, disparar nao resolve: avisa e segue
  if (PRECISA_USUARIO.has(item?.status ?? "")) return item;

  const lastBefore: string | null = item?.lastUpdatedAt ?? null;
  const patched = await triggerItemUpdate(apiKey, itemId);
  if (!patched) return item; // nao deu pra disparar: le o cache atual

  const deadline = Date.now() + REFRESH_TIMEOUT_MS;
  let atual = patched;
  while (Date.now() < deadline) {
    const st: string = atual?.status ?? "";
    if (PRECISA_USUARIO.has(st)) return atual; // MFA/credencial: para por aqui
    // pronto: saiu do "em andamento" E o lastUpdatedAt mudou (dados novos)
    if (!EM_ANDAMENTO.has(st) && atual?.lastUpdatedAt && atual.lastUpdatedAt !== lastBefore) {
      return atual;
    }
    await sleep(REFRESH_POLL_MS);
    atual = await getItem(apiKey, itemId);
  }
  return atual; // timeout: segue com o que houver
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData.user) return json({ error: "Nao autorizado" }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const refresh: boolean = body?.refresh === true;
    // translate=false: só baixa e grava na camada crua, SEM traduzir/saldos
    // (usado pelo "Sincronizar tudo" para não rodar a tradução N vezes em paralelo).
    const traduzir: boolean = body?.translate !== false;

    // translateOnly=true: NÃO baixa nada; só roda a tradução CRU->lancamentos e a
    // reconstrução de saldos UMA vez. É o passo final do "Sincronizar tudo".
    if (body?.translateOnly === true) {
      const { data: inseridos, error: rpcErr } = await admin.rpc(
        "pluggy_traduzir_lancamentos",
        { p_user_id: userId },
      );
      if (rpcErr) return json({ error: "traduzir lancamentos: " + rpcErr.message }, 500);
      let saldosDias: number | null = null;
      try {
        const { data: nSaldos, error: saldosErr } = await admin.rpc(
          "pluggy_reconstruir_saldos_diarios",
          { p_user_id: userId, p_meses: 24 },
        );
        if (saldosErr) throw saldosErr;
        saldosDias = nSaldos ?? 0;
      } catch (e) {
        console.error("reconstruir saldos diarios falhou (ignorado):", e);
      }
      return json({ ok: true, translateOnly: true, inseridos: inseridos ?? 0, saldos_dias: saldosDias });
    }

    const itemId: string | undefined = body?.itemId;
    if (!itemId) return json({ error: "Falta itemId" }, 400);

    // SEGURANCA: esta funcao roda com service role (ignora RLS), entao a posse
    // do item PRECISA ser checada na mao, senao um usuario poderia sincronizar
    // o banco de outro passando o itemId alheio.
    // data de corte tambem sai daqui: body.from > sync_from salvo > 12 meses.
    const { data: itemRow } = await admin
      .from("pluggy_items")
      .select("user_id, sync_from")
      .eq("item_id", itemId)
      .maybeSingle();

    // (a) item ja conhecido: o dono registrado tem que ser quem esta chamando.
    if (itemRow && itemRow.user_id && itemRow.user_id !== userId) {
      return json({ error: "Este item nao pertence ao usuario atual." }, 403);
    }
    const from: string = body?.from ?? itemRow?.sync_from ?? dozeMesesAtras();

    // 1) Pluggy
    const apiKey = await pluggyAuth();
    let item = await getItem(apiKey, itemId);

    // (b) item novo (ainda nao registrado): valida via Pluggy que o item foi
    //     criado para ESTE usuario. O connect-token grava clientUserId =
    //     email ?? id; conferimos o mesmo valor aqui. Itens antigos ja
    //     registrados passam pela checagem (a) e nao caem neste ramo.
    if (!itemRow) {
      const esperado = userData.user.email ?? userData.user.id;
      if (item?.clientUserId !== esperado) {
        return json(
          { error: "Item nao associado a este usuario (clientUserId divergente)." },
          403,
        );
      }
    }

    // 1b) (opcional) FORCA a Pluggy a reconsultar o banco e espera concluir,
    //     para trazer transacoes recentes que ainda nao estavam no cache.
    if (refresh) {
      item = await forcarAtualizacao(apiKey, itemId, item);
    }
    const itemStatus: string | null = item?.status ?? null;

    const connRaw: string | null = item?.connector?.name ?? null;
    const accounts = await getAccounts(apiKey, itemId);
    // Banco resolvido POR CONTA: conectores agregadores (ex.: "MeuPluggy",
    // connector_id 200) trazem contas de bancos diferentes numa só conexão. O
    // banco real está no nome de CADA conta — resolver no nível do item rotularia
    // tudo com um banco só (e sem nome de conta cairíamos no genérico "Banco").
    const bancoDaConta = (acc: typeof accounts[number]) => resolverBancoDaConta(connRaw, acc);

    // 2) coleta + mapeia para o CRU (sem normalizar nada)
    const contasRaw = accounts.map((acc) =>
      mapContaRaw(acc, itemId, bancoDaConta(acc), userId)
    );
    let txRaw: Record<string, unknown>[] = [];
    const porConta: Record<string, number> = {};
    for (const acc of accounts) {
      const txs = await getAllTransactions(apiKey, acc.id, from);
      porConta[acc.name ?? acc.id] = txs.length;
      txRaw = txRaw.concat(
        txs.map((t) => mapTransacaoRaw(t, acc, bancoDaConta(acc), itemId, userId)),
      );
    }

    // dedup dentro do lote (mesmo tx_id nao pode repetir no upsert)
    const vistos = new Set<string>();
    txRaw = txRaw.filter((r) => {
      const h = r.tx_id as string;
      if (vistos.has(h)) return false;
      vistos.add(h);
      return true;
    });

    // 3) UPSERT na camada crua: contas e transacoes
    if (contasRaw.length) {
      const { error } = await admin
        .from("pluggy_contas_raw")
        .upsert(contasRaw, { onConflict: "account_id", ignoreDuplicates: false });
      if (error) throw new Error("upsert pluggy_contas_raw: " + error.message);
    }

    const LOTE = 500;
    for (let i = 0; i < txRaw.length; i += LOTE) {
      const bloco = txRaw.slice(i, i + LOTE);
      const { error } = await admin
        .from("pluggy_transacoes_raw")
        .upsert(bloco, { onConflict: "tx_id", ignoreDuplicates: false });
      if (error) throw new Error("upsert pluggy_transacoes_raw: " + error.message);
    }

    // 3b) traduz CRU -> lancamentos (funcao SQL; preenche user_id, preserva
    //      categoria_manual). Passa o user_id pois a service role nao tem auth.uid().
    //      Pulado quando traduzir=false: o chamador roda a traducao UMA vez ao final.
    let inseridos: number | null = null;
    let saldosDias: number | null = null;
    if (traduzir) {
      const { data: nIns, error: rpcErr } = await admin.rpc(
        "pluggy_traduzir_lancamentos",
        { p_user_id: userId },
      );
      if (rpcErr) throw new Error("traduzir lancamentos: " + rpcErr.message);
      inseridos = nIns ?? 0;

      // 3c) reconstroi o historico DIARIO de saldos (so contas BANK, 24 meses).
      //      Secundario: se falhar, NAO derruba o sync (os lancamentos ja entraram).
      try {
        const { data: nSaldos, error: saldosErr } = await admin.rpc(
          "pluggy_reconstruir_saldos_diarios",
          { p_user_id: userId, p_meses: 24 },
        );
        if (saldosErr) throw saldosErr;
        saldosDias = nSaldos ?? 0;
      } catch (e) {
        console.error("reconstruir saldos diarios falhou (ignorado):", e);
      }
    }

    // 4) registra o estado da conexao
    const resultado = {
      contas: accounts.length,
      por_conta: porConta,
      transacoes: txRaw.length,
      lancamentos: inseridos ?? 0,
      saldos_dias: saldosDias,
      from,
      status: itemStatus, // status do item apos o refresh (UPDATED / WAITING_USER_INPUT / ...)
    };
    await admin.from("pluggy_items").upsert(
      {
        item_id: itemId,
        user_id: userId, // service role nao tem auth.uid() -> grava o dono na mao
        connector_id: item?.connector?.id ?? null,
        // conexão: guarda o conector cru (a UI re-resolve p/ exibir). Em
        // agregadores ("MeuPluggy") não há um banco único — o banco real é
        // por conta, gravado em pluggy_contas_raw/transacoes_raw.
        connector_name: connRaw ?? "Banco",
        status: item?.status ?? null,
        sync_from: from,
        last_synced_at: new Date().toISOString(),
        last_result: resultado,
      },
      { onConflict: "item_id" },
    );

    return json({ ok: true, ...resultado, inseridos });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
