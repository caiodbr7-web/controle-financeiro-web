// ============================================================================
//  Edge Function: email-lembrete
//
//  Lembrete SEMANAL por e-mail para todos os usuários cadastrados: "você tem
//  N lançamentos esperando classificação". Cada e-mail leva:
//    • o gasto do mês corrente até agora vs o esperado (média dos últimos
//      3 meses completos — mesmo conceito da "média 3m" dos dashboards);
//    • os maiores lançamentos pendentes de classificação;
//    • um botão que abre o app direto na aba Classificar (APP_URL + #classificar).
//  Usuário sem NENHUMA pendência não recebe e-mail (sem spam).
//
//  Disparo: pg_cron semanal (ver migração *_email_lembrete_cron.sql), com o
//  mesmo x-cron-secret do robô de sync. Também aceita body opcional p/ teste:
//    { userId?: string, to?: string, dryRun?: boolean }
//    - userId: só esse usuário;  - to: força o destinatário (teste);
//    - dryRun: calcula tudo e responde SEM enviar e-mail.
//
//  Envio: Resend (https://resend.com). Secrets necessários
//  (Supabase -> Project Settings -> Edge Functions -> Secrets):
//    CRON_SECRET       o MESMO do pluggy-cron (autoriza a chamada)
//    RESEND_API_KEY    chave da API do Resend
//    EMAIL_FROM        remetente verificado (ex.: "Controle Financeiro <lembrete@seudominio.com>");
//                      sem domínio verificado, use "onboarding@resend.dev" (só entrega
//                      para o e-mail do dono da conta Resend)
//    APP_URL           (opcional) URL do app; default abaixo
//
//  Deploy: automático no merge (functions.yml); verify_jwt=false no config.toml.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const APP_URL = Deno.env.get("APP_URL") ?? "https://legendary-bubblegum-6dc676.netlify.app";
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") ?? "Controle Financeiro <onboarding@resend.dev>";
const MAX_PENDENTES_NO_EMAIL = 12;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// comparação em tempo constante (=== vaza timing do prefixo do segredo)
function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let d = 0;
  for (let i = 0; i < ea.length; i++) d |= ea[i] ^ eb[i];
  return d === 0;
}

// ---------------------------------------------------------------------------
//  Datas no fuso do usuário (Brasília, UTC-3 fixo): o "mês corrente" do e-mail
//  deve ser o mês civil no Brasil, não o UTC.
// ---------------------------------------------------------------------------
const agoraBRT = () => new Date(Date.now() - 3 * 3600_000);
const mesKeyDe = (d: Date) => d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
const addMeses = (mk: string, n: number) => {
  let y = +mk.slice(0, 4), m = +mk.slice(5, 7) + n;
  y += Math.floor((m - 1) / 12);
  m = ((m - 1) % 12 + 12) % 12 + 1;
  return y + "-" + String(m).padStart(2, "0");
};
const MES_ABREV = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const rotuloMes = (mk: string) => MES_ABREV[+mk.slice(5, 7) - 1] + "/" + mk.slice(2, 4);

// ---------------------------------------------------------------------------
//  Espelhos do contrato de classes (src/lib/lancClasses.ts) — mantidos em
//  sincronia com o front: gasto = classe Gasto (+) / Estorno (−), nada interno;
//  pendente = sem categoria_manual e não-interno.
// ---------------------------------------------------------------------------
interface Linha { valor: number; classe: string | null; interna: boolean | null; competencia: string }
const valorGasto = (r: Linha): number => {
  if (r.interna === true) return 0;
  if (r.classe === "Gasto") return Math.abs(r.valor);
  if (r.classe === "Estorno/Credito") return -Math.abs(r.valor);
  return 0;
};

const BRL0 = (v: number) =>
  (v < 0 ? "-" : "") + "R$ " + Math.round(Math.abs(v || 0)).toLocaleString("pt-BR");

const escapeHtml = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---------------------------------------------------------------------------
//  Monta o HTML do e-mail (estilos inline: é o que clientes de e-mail aceitam).
// ---------------------------------------------------------------------------
interface Pendente { descricao: string | null; valor: number; data_mov: string | null; origem: string | null; competencia: string }
function montarHtml(opts: {
  mesLabel: string; gasto: number; esperado: number | null;
  pendentes: Pendente[]; totalPendentes: number; link: string;
}): string {
  const { mesLabel, gasto, esperado, pendentes, totalPendentes, link } = opts;
  const pct = esperado && esperado > 0 ? Math.round((gasto / esperado) * 100) : null;
  const acima = pct != null && pct > 100;
  const corGasto = acima ? "#e0382b" : "#16a34a";
  const barra = pct != null
    ? `<div style="background:#ececf1;border-radius:6px;height:10px;margin:10px 0 4px;overflow:hidden">
         <div style="background:${corGasto};height:10px;width:${Math.min(100, pct)}%"></div>
       </div>
       <div style="font-size:12px;color:#6e6e73">${pct}% do esperado para o mês (média dos últimos 3 meses: <b>${BRL0(esperado!)}</b>)</div>`
    : `<div style="font-size:12px;color:#6e6e73">ainda sem meses anteriores suficientes para comparar</div>`;

  const linhas = pendentes.map((p) => `
    <tr>
      <td style="padding:7px 10px;border-bottom:1px solid #ececf1;font-size:13px;color:#6e6e73;white-space:nowrap">${escapeHtml(p.data_mov || "—")}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #ececf1;font-size:13px">${escapeHtml((p.descricao || "—").slice(0, 48))}
        <span style="color:#6e6e73;font-size:11.5px"> · ${escapeHtml(p.origem || "")}</span></td>
      <td style="padding:7px 10px;border-bottom:1px solid #ececf1;font-size:13px;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums">${BRL0(p.valor)}</td>
    </tr>`).join("");
  const mais = totalPendentes > pendentes.length
    ? `<div style="font-size:12px;color:#6e6e73;margin-top:6px">…e mais ${totalPendentes - pendentes.length} lançamento(s) no app.</div>`
    : "";

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1d1d1f">
  <div style="max-width:560px;margin:0 auto;padding:28px 16px">
    <div style="font-size:15px;font-weight:700;margin-bottom:14px">📊 Controle Financeiro</div>
    <div style="background:#ffffff;border-radius:16px;padding:24px;border:1px solid #e6e6eb">
      <h2 style="margin:0 0 4px;font-size:18px">Hora de classificar 🏷️</h2>
      <p style="margin:0 0 18px;font-size:13.5px;color:#6e6e73">Seu lembrete semanal: <b>${totalPendentes} lançamento${totalPendentes === 1 ? "" : "s"}</b> esperando classificação.</p>

      <div style="background:#f7f7fa;border-radius:12px;padding:16px;margin-bottom:18px">
        <div style="font-size:12px;color:#6e6e73;text-transform:uppercase;letter-spacing:.04em;font-weight:700">Gasto de ${mesLabel} até agora</div>
        <div style="font-size:26px;font-weight:700;margin-top:4px;color:${corGasto}">${BRL0(gasto)}</div>
        ${barra}
      </div>

      <div style="font-size:12px;color:#6e6e73;text-transform:uppercase;letter-spacing:.04em;font-weight:700;margin-bottom:6px">Pendentes de classificação</div>
      <table style="width:100%;border-collapse:collapse">${linhas}</table>
      ${mais}

      <a href="${link}" style="display:block;text-align:center;background:#6d28d9;color:#ffffff;text-decoration:none;border-radius:12px;padding:13px 16px;font-size:14.5px;font-weight:700;margin-top:20px">Classificar agora →</a>
    </div>
    <div style="font-size:11.5px;color:#98989d;text-align:center;margin-top:14px">
      Você recebe este lembrete toda semana enquanto houver lançamentos sem categoria.
    </div>
  </div>
</body></html>`;
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  try {
    const cronSecret = Deno.env.get("CRON_SECRET");
    if (!cronSecret || !safeEqual(req.headers.get("x-cron-secret") ?? "", cronSecret)) {
      return json({ error: "não autorizado" }, 401);
    }
    const resendKey = Deno.env.get("RESEND_API_KEY");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const dryRun: boolean = body?.dryRun === true;
    if (!resendKey && !dryRun) {
      return json({ error: "RESEND_API_KEY ausente nos secrets da função." }, 500);
    }

    // usuários cadastrados (auth) — poucos usuários: 1 página dá conta
    const { data: usersData, error: uErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (uErr) return json({ error: uErr.message }, 500);
    let users = (usersData?.users ?? []).filter((u: any) => !!u.email);
    if (body?.userId) users = users.filter((u: any) => u.id === body.userId);

    const mkAtual = mesKeyDe(agoraBRT());
    const mkDesde = addMeses(mkAtual, -3);      // início da janela da média 3m
    const mkProx = addMeses(mkAtual, 1);        // exclui competências futuras (parcelas)
    const link = `${APP_URL.replace(/\/$/, "")}/#classificar`;

    const resumo: Record<string, unknown> = {};
    let enviados = 0, pulados = 0;
    const erros: string[] = [];

    for (const u of users as any[]) {
      try {
        // gasto do mês + média 3m (janela única de 4 meses de competência)
        const { data: lanc, error: e1 } = await admin
          .from("lancamentos")
          .select("valor, classe, interna, competencia")
          .eq("user_id", u.id)
          .gte("competencia", mkDesde)
          .lt("competencia", mkProx);
        if (e1) throw new Error(e1.message);

        const porMes = new Map<string, number>();
        for (const r of (lanc ?? []) as Linha[]) {
          const mk = String(r.competencia || "").slice(0, 7);
          porMes.set(mk, (porMes.get(mk) || 0) + valorGasto(r));
        }
        const gasto = porMes.get(mkAtual) || 0;
        const anteriores = [-1, -2, -3].map((n) => addMeses(mkAtual, n)).filter((mk) => porMes.has(mk));
        const esperado = anteriores.length
          ? anteriores.reduce((s, mk) => s + (porMes.get(mk) || 0), 0) / anteriores.length
          : null;

        // pendências de classificação (histórico inteiro, como a aba Classificar)
        const pendFiltro = () => admin
          .from("lancamentos")
          .select("descricao, valor, data_mov, origem, competencia", { count: "exact" })
          .eq("user_id", u.id)
          .is("categoria_manual", null)
          .or("interna.is.null,interna.eq.false");
        const { data: pend, count, error: e2 } = await pendFiltro()
          .order("valor", { ascending: true }) // gasto é negativo: maiores despesas primeiro
          .limit(MAX_PENDENTES_NO_EMAIL);
        if (e2) throw new Error(e2.message);
        const totalPendentes = count ?? (pend?.length ?? 0);

        if (!totalPendentes) { pulados++; resumo[u.email] = { pendentes: 0, enviado: false }; continue; }

        const html = montarHtml({
          mesLabel: rotuloMes(mkAtual), gasto, esperado,
          pendentes: (pend ?? []) as Pendente[], totalPendentes, link,
        });
        const subject = `🏷️ ${totalPendentes} lançamento${totalPendentes === 1 ? "" : "s"} para classificar · gasto de ${rotuloMes(mkAtual)}: ${BRL0(gasto)}`;
        const to = body?.to || u.email;

        if (!dryRun) {
          const r = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html }),
          });
          if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
        }
        enviados++;
        resumo[u.email] = { pendentes: totalPendentes, gasto: Math.round(gasto), esperado: esperado != null ? Math.round(esperado) : null, enviado: !dryRun };
      } catch (e) {
        erros.push(`${u.email}: ${(e as Error).message}`);
      }
    }

    if (erros.length) console.error("email-lembrete erros:", erros);
    return json({ ok: erros.length === 0, usuarios: users.length, enviados, pulados, falhas: erros.length, dryRun, resumo });
  } catch (e) {
    console.error("email-lembrete:", e);
    return json({ error: "Falha interna" }, 500);
  }
});
