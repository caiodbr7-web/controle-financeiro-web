# Controle Financeiro — notas para o Claude

App React + Vite + TS + Tailwind + Supabase. A lógica financeira vive em
`src/lib/` e a UI em `src/components/`. Migrações de banco ficam em
`db/migrations/` e são rodadas à mão no Supabase (SQL Editor).

## Política de deploy (IMPORTANTE)

Há dois ambientes publicados:

- **GitHub Pages** (`https://caiodbr7-web.github.io/controle-financeiro-web/`)
  — link grátis de **teste**. É sempre o **PRIMEIRO** deploy.
- **Netlify** (`legendary-bubblegum-6dc676`) — **produção**, sai do `main`.

Regra: **toda mudança deve ir para o GitHub Pages antes da produção.** Por
isso o workflow `.github/workflows/pages.yml` publica automaticamente nos
pushes das branches de trabalho (`claude/**`) e do `main`. Ao trabalhar numa
branch, o link do github.io reflete a versão em teste; só depois de validada
ali é que se faz o merge no `main` (que dispara o Netlify de produção).

> Pré-requisito (uma vez, no GitHub): em **Settings → Environments →
> github-pages → Deployment branches**, permitir as branches `claude/**`
> (ou "All branches"); senão o deploy do Pages a partir dessas branches é
> bloqueado pela proteção do ambiente.

## Build / checagens

- Build de produção: `npm run build` (é o que Netlify e Pages usam).
- `npx tsc --noEmit` faz checagem de tipos estrita (não faz parte do build;
  pode haver erros pré-existentes fora do escopo da mudança atual).
