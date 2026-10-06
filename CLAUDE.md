# Razão — instruções do projeto

Idioma: Português (Brasil) em respostas, commits e comentários.

## 1. Padrões do projeto
- App financeiro "Razão": SPA em `index.html` (React via JSX), pré-compilada por `node build.js` para `app.compiled.js`. Rodar o build após editar o JSX.
- Backend serverless em `api/` (Vercel): `pluggy.js` (Open Finance), `gemini.js`, `keepalive.js`. Banco: Supabase.
- Stack geral do usuário: React, Node.js, Power BI, Excel, API Claude, MCP servers, Git.
- Fluxo: entregar uma fase por vez e confirmar antes de avançar (ver memória).

## 2. Otimização de tokens
- Docs de bibliotecas: usar o MCP context7 (`use context7`), nunca colar docs manualmente.
- Planilhas, dashboards e relatórios: Google Drive MCP em vez de copiar/colar.
- Não reler arquivos já lidos na sessão; `index.html` tem >6000 linhas — ler só o trecho necessário (Grep + offset/limit).
- Nunca ler `app.compiled.js` nem `vendor/` (gerados/minificados).

## 3. Projetos e contexto
- OTAMERICA (Porto do Açu): manutenção, Titan, Power BI, TOCICA, equipamentos.
- Apps pessoais: App Financeiro (este repo), App Treino (ABCDE), Análise de Ativos, Plataforma CRM para autônomos.
- Curso ISO: auditor interno 9001/14001/45001.

## 4. Evitar
- `node_modules/`, `.git/`, `vendor/`, `app.compiled.js`, caches, logs e qualquer arquivo >1MB sem necessidade.

## 5. Boas práticas
- Prompt curto e direto: problema → ação → resultado.
- Skills para fluxos repetidos: `/atas-reuniao`, `/relatorio-tocica`, `/analise-dashboard`.
- Incrementos pequenos com feedback; comando que falhou: investigar a causa, não repetir.
