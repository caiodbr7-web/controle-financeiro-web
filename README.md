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

Pré-requisito: **Node 18+** instalado.

```bash
git clone https://github.com/caiodbr7-web/controle-financeiro-web.git
cd controle-financeiro-web
npm install
npm run dev      # abre em http://localhost:5173
```

Não precisa configurar nada: a URL e a *publishable key* do Supabase já vêm no
código (`src/lib/supabase.ts`) e o RLS só libera dados depois do login — você
enxerga os **seus próprios dados**, os mesmos do site publicado.

### Testar uma branch antes de mergear (sem gastar deploy do Netlify)

Toda PR pode ser conferida localmente antes do merge, então não é preciso
depender do deploy preview:

```bash
git fetch origin
git switch nome-da-branch   # ex.: claude/unificar-planejamento-orcamento
npm install                 # só se as dependências mudaram
npm run dev
```

Validou? Aí sim faça o merge — o Netlify builda apenas a versão final.

### Abrir no celular (mesma rede Wi-Fi)

```bash
npm run dev -- --host
```

O Vite mostra uma URL **Network** (ex.: `http://192.168.0.x:5173`); abra essa
no navegador do celular.

> ⚠️ O modo local usa o **mesmo banco** do site publicado. Para ver dados e
> testar telas é ideal; só lembre que itens criados/editados em teste alteram
> seus dados reais.

## Build de produção

```bash
npm run build    # gera dist/ (estático)
```

## Link de teste grátis (GitHub Pages)

Um ambiente publicado **grátis e separado do Netlify** (não consome o limite
dele). O workflow `.github/workflows/pages.yml` builda e publica a `main` a cada
push, no endereço:

```
https://caiodbr7-web.github.io/controle-financeiro-web/
```

**Configuração única** (uma vez só):

1. No GitHub do repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Para o **login com Google** funcionar nessa URL, adicione-a no OAuth:
   - **Supabase → Authentication → URL Configuration → Redirect URLs**:
     `https://caiodbr7-web.github.io/controle-financeiro-web/`
   - **Google Cloud → Credentials → OAuth Client → Authorized JavaScript origins**:
     `https://caiodbr7-web.github.io`
   > O login por **e-mail/senha** já funciona sem nenhum desses passos.
3. Pronto: cada push na `main` republica o link. Também dá para disparar à mão em
   **Actions → Deploy to GitHub Pages → Run workflow**.

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
