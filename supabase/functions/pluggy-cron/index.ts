// ============================================================================
//  Edge Function: pluggy-cron
//
//  Sincronização AUTOMÁTICA (agendada) de TODAS as conexões Pluggy de TODOS os
//  usuários. É o "robô" que mantém a base atualizada sozinha, sem ninguém
//  precisar clicar em "Sincronizar".
//
//  O que ela atualiza (reaproveitando as funções já testadas, sem reimplementar
//  a lógica financeira):
//    • transações + saldos  ->  chama  pluggy-sync         (por conexão)
//    • investimentos        ->  chama  pluggy-investments  (por usuário)
//
//  Como roda sozinha: o pg_cron (ver db/migrations/2026-06-21-cron-sync.sql)
//  chama esta função em horários fixos. Esta função:
//    1. confere o segredo do cron (header x-cron-secret) -> só o agendador entra;
//    2. com a SERVICE ROLE, lista os pluggy_items de todos os donos (ignora RLS);
//    3. para cada usuário, gera um JWT curto (assinado com o JWT secret) e, com
//       ele, chama pluggy-sync e pluggy-investments -> a RLS continua isolando
//       cada usuário, exatamente como quando ele mesmo sincroniza pelo app.
//
//  Requer (Supabase -> Project Settings -> Edge Functions -> Secrets):
//    CRON_SECRET          segredo combinado com o agendador (qualquer string forte)
//    SUPABASE_JWT_SECRET  o "JWT Secret" do projeto (Project Settings -> API)
//    PLUGGY_CLIENT_ID / PLUGGY_CLIENT_SECRET   (já usados pelas outras funções)
//  SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY são injetados.
//
//  Deploy (precisa --no-verify-jwt: quem autoriza é o CRON_SECRET, não um JWT):
//    supabase functions deploy pluggy-cron --no-verify-jwt
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { create as createJwt } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// gera um JWT de usuário (curto) aceito pelas outras Edge Functions e pela RLS
async function userJwt(userId: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const now = Math.floor(Date.now() / 1000);
  return await createJwt(
    { alg: "HS256", typ: "JWT" },
    {
      sub: userId,
      role: "authenticated",
      aud: "authenticated",
      iat: now,
      exp: now + 600, // 10 min: tempo de sobra para a rodada do usuário
    },
    key,
  );
}

Deno.serve(async (req) => {
  try {
    // 1) só o agendador entra ------------------------------------------------
    const cronSecret = Deno.env.get("CRON_SECRET");
    if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
      return json({ error: "não autorizado" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const jwtSecret = Deno.env.get("SUPABASE_JWT_SECRET");
    if (!jwtSecret) return json({ error: "SUPABASE_JWT_SECRET ausente nos secrets" }, 500);

    const fnBase = `${supabaseUrl}/functions/v1`;

    // 2) todas as conexões, de todos os donos (service role ignora a RLS) ----
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: itens, error } = await admin
      .from("pluggy_items")
      .select("user_id, item_id, sync_from");
    if (error) return json({ error: error.message }, 500);
    if (!itens || itens.length === 0) return json({ ok: true, usuarios: 0, conexoes: 0 });

    // agrupa as conexões por usuário
    const porUsuario = new Map<string, { item_id: string; sync_from: string | null }[]>();
    for (const it of itens as any[]) {
      if (!it.user_id || !it.item_id) continue;
      const arr = porUsuario.get(it.user_id) ?? [];
      arr.push({ item_id: it.item_id, sync_from: it.sync_from ?? null });
      porUsuario.set(it.user_id, arr);
    }

    const resumo: Record<string, unknown> = {};
    let okSync = 0, erroSync = 0, okInvest = 0, erroInvest = 0;

    // 3) para cada usuário, atua como ele (JWT) e dispara as syncs -----------
    for (const [userId, conexoes] of porUsuario) {
      const jwt = await userJwt(userId, jwtSecret);
      const headers = {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${jwt}`,
      };

      // 3a) transações + saldos: uma chamada por conexão
      for (const c of conexoes) {
        try {
          const r = await fetch(`${fnBase}/pluggy-sync`, {
            method: "POST",
            headers,
            body: JSON.stringify({ itemId: c.item_id, from: c.sync_from ?? undefined }),
          });
          if (r.ok) okSync++; else erroSync++;
        } catch { erroSync++; }
      }

      // 3b) investimentos: uma chamada por usuário (a função varre os itens)
      try {
        const r = await fetch(`${fnBase}/pluggy-investments`, {
          method: "POST",
          headers,
          body: JSON.stringify({}),
        });
        if (r.ok) okInvest++; else erroInvest++;
      } catch { erroInvest++; }

      resumo[userId] = { conexoes: conexoes.length };
    }

    return json({
      ok: true,
      usuarios: porUsuario.size,
      conexoes: itens.length,
      sync: { ok: okSync, erro: erroSync },
      investimentos: { ok: okInvest, erro: erroInvest },
      resumo,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
