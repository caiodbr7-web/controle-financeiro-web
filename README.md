# Controle Financeiro — Web (React)

Dashboard em **React + Vite + TypeScript + Tailwind + Recharts**, lendo do Supabase.
Substitui o `app/index.html` (que pode ser mantido como legado).

## Estrutura

```
web/
├─ index.html              # entrada do Vite
├─ package.json            # deps e scripts
├─ vite.config.ts
├─ tailwind.config.js / postcss.config.js
├─ netlify.toml            # build + headers no-cache (deploy automático)
└─ src/
   ├─ main.tsx             # bootstrap React
   ├─ index.css            # Tailwind + base
   ├─ types.ts             # tipos (Lancamento, Visao, Modo)
   ├─ lib/
   │  ├─ supabase.ts       # cliente Supabase (URL + publishable key)
   │  └─ finance.ts        # TODA a lógica financeira (portada e validada)
   └─ components/
      ├─ ui.tsx            # Panel, Kpi, Seg, Select
      ├─ Login.tsx         # login Google + e-mail/senha
      ├─ Modal.tsx         # detalhamento de transações
      ├─ App? (em src/App.tsx)
      └─ tabs/             # VisaoGeral, EvolucaoDiaria, ResumoMensal, Arquivos, Lancamentos
```

## Rodar localmente (no seu PC)

```bash
cd web
npm install
npm run dev      # abre em http://localhost:5173
```

## Build de produção

```bash
npm run build    # gera web/dist (estático)
```

## Publicar — GitHub + Netlify (deploy automático)

1. **Crie um repositório** vazio no GitHub (ex.: `controle-financeiro-web`), pode ser **privado**.
2. No seu PC, dentro da pasta `web/`:
   ```bash
   cd "controle_financeiro/web"
   git init
   git add .
   git commit -m "Dashboard React"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/controle-financeiro-web.git
   git push -u origin main
   ```
   > Só sobe o código-fonte; `node_modules` e `dist` ficam de fora (.gitignore).
3. No **Netlify**: *Add new site → Import an existing project → GitHub →* escolha o repo.
   As configurações já vêm do `netlify.toml` (build `npm run build`, publish `dist`).
4. A cada `git push`, o Netlify builda e publica sozinho. Fim do deploy manual.

> Dica: depois, em *Site configuration → Domain*, dá para apontar o site
> `legendary-bubblegum-6dc676` (ou criar um novo) para este repositório.

## Observações

- A *publishable key* no `lib/supabase.ts` é pública de propósito; o RLS do
  Supabase só libera dados após login.
- A lógica de `finance.ts` é a mesma já validada no dashboard anterior
  (gasto por data real, meses completos, média móvel 3m, split cartão×conta).
