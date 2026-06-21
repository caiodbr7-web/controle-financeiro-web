// ============================================================================
//  Edge Function: pluggy-investments
//
//  Sincroniza as POSIÇÕES de investimento (endpoint /investments da Pluggy) das
//  conexões (pluggy_items) do usuário logado e grava em public.pluggy_investments.
//
//  Por que uma função nova (e não dentro de pluggy-sync): a sync de transações
//  já é pesada e estável; investimentos são um produto à parte da Pluggy e podem
//  ser sincronizados sob demanda, sem mexer no fluxo de lançamentos.
//
//  Requer (Supabase -> Project Settings -> Edge Functions -> Secrets):
//    PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET   (as MESMAS já usadas por pluggy-sync;
//                                              aceita também CLIENT_ID/CLIENT_SECRET)
//  SUPABASE_URL e SUPABASE_ANON_KEY já são injetadas automaticamente.
//
//  Deploy:
//    supabase functions deploy pluggy-investments
//
//  Chamada (frontend, src/lib/pluggy.ts -> syncInvestments):
//    POST /functions/v1/pluggy-investments
//    Authorization: Bearer <jwt do usuário>
//    body (opcional): { "itemId": "..." }  -> sincroniza só essa conexão
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PLUGGY_BASE = "https://api.pluggy.ai";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// autentica na Pluggy e devolve um apiKey de curta duração
async function pluggyApiKey(): Promise<string> {
  const clientId = Deno.env.get("PLUGGY_CLIENT_ID") ?? Deno.env.get("CLIENT_ID");
  const clientSecret = Deno.env.get("PLUGGY_CLIENT_SECRET") ?? Deno.env.get("CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("PLUGGY_CLIENT_ID/PLUGGY_CLIENT_SECRET ausentes nos secrets da função");
  }
  const r = await fetch(`${PLUGGY_BASE}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.message || "Falha ao autenticar na Pluggy");
  return data.apiKey as string;
}

// busca TODOS os investimentos de um item (paginado)
async function fetchInvestments(apiKey: string, itemId: string): Promise<any[]> {
  const out: any[] = [];
  let page = 1;
  while (true) {
    const url = `${PLUGGY_BASE}/investments?itemId=${encodeURIComponent(itemId)}&page=${page}&pageSize=200`;
    const r = await fetch(url, { headers: { "X-API-KEY": apiKey } });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.message || `Falha ao buscar investimentos (item ${itemId})`);
    const results: any[] = data.results ?? [];
    out.push(...results);
    const totalPages = data.totalPages ?? 1;
    if (page >= totalPages || results.length === 0) break;
    page++;
  }
  return out;
}

// monta a taxa legível ("110 CDI", "13.5% a.a.") a partir dos campos da Pluggy
function fmtTaxa(inv: any): string | null {
  if (inv.rate != null) return `${inv.rate}${inv.rateType ? " " + inv.rateType : ""}`;
  return inv.rateType ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authorization = req.headers.get("Authorization") ?? "";
    if (!authorization) return json({ error: "Sem token de autenticação" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    // cliente com o JWT do usuário -> RLS aplica e os inserts ficam isolados por dono
    const sb = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    });

    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Usuário inválido" }, 401);
    const userId = userData.user.id;

    // body opcional: { itemId } para sincronizar só uma conexão
    let only: string | undefined;
    try {
      const body = await req.json();
      only = body?.itemId;
    } catch { /* sem body — sincroniza todas as conexões */ }

    // conexões do usuário (RLS já filtra por dono)
    let q = sb.from("pluggy_items").select("item_id, connector_name");
    if (only) q = q.eq("item_id", only);
    const { data: itens, error: itensErr } = await q;
    if (itensErr) return json({ error: itensErr.message }, 500);
    if (!itens || itens.length === 0) {
      return json({ ok: true, itens: 0, investimentos: 0, inseridos: 0, por_item: {} });
    }

    const apiKey = await pluggyApiKey();

    const linhas: any[] = [];
    const por_item: Record<string, number> = {};
    const agora = new Date().toISOString();

    for (const it of itens) {
      const invs = await fetchInvestments(apiKey, it.item_id);
      por_item[it.connector_name ?? it.item_id] = invs.length;
      for (const inv of invs) {
        if (inv.id == null) continue; // sem id não há chave para upsert
        linhas.push({
          investment_id: inv.id,
          user_id: userId,
          item_id: it.item_id,
          banco: it.connector_name ?? null,
          tipo: inv.type ?? null,
          subtipo: inv.subtype ?? null,
          nome: inv.name ?? null,
          emissor: inv.issuer ?? null,
          saldo: inv.balance ?? null,
          valor_aplicado: inv.amount ?? inv.amountOriginal ?? null,
          lucro: inv.amountProfit ?? null,
          quantidade: inv.quantity ?? null,
          moeda: inv.currencyCode ?? "BRL",
          vencimento: inv.dueDate ? String(inv.dueDate).slice(0, 10) : null,
          taxa: fmtTaxa(inv),
          status: inv.status ?? null,
          raw: inv,
          atualizado_em: agora,
        });
      }
    }

    // dedup por investment_id: a Pluggy pode repetir um ativo (entre páginas ou
    // conexões) e o upsert do Postgres recusa a mesma chave duas vezes no mesmo
    // lote ("ON CONFLICT DO UPDATE command cannot affect row a second time").
    const porId = new Map<string, any>();
    for (const l of linhas) porId.set(l.investment_id, l);
    const unicos = [...porId.values()];

    let inseridos = 0;
    if (unicos.length) {
      const { error: upErr, count } = await sb
        .from("pluggy_investments")
        .upsert(unicos, { onConflict: "investment_id", count: "exact" });
      if (upErr) return json({ error: upErr.message }, 500);
      inseridos = count ?? unicos.length;
    }

    return json({ ok: true, itens: itens.length, investimentos: unicos.length, inseridos, por_item });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
