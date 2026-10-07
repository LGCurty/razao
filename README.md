# Razão — finanças pessoais

App web (PWA) para registrar e entender o próprio dinheiro: movimentos, orçamento com alertas, metas,
investimentos, leitura de extratos com IA e sincronização com bancos via Open Finance (Pluggy).
React + Vite no front, funções serverless na Vercel (`api/`) e Supabase como banco e login.

## Rodando

```bash
npm install
npm run dev       # servidor local com recarga automática (http://localhost:5173)
npm test          # testes unitários (Vitest)
npm run build     # gera dist/ — é o que a Vercel publica
npm run preview   # serve o dist/ para conferir o build de produção
```

As funções de `api/` não rodam no `npm run dev` (lá a IA e o Open Finance respondem erro, e o resto do
app funciona normalmente). Para testá-las localmente use `vercel dev`.

## Estrutura

```
index.html              casca do app (Vite injeta o JS/CSS do build)
src/
  main.jsx              ponto de entrada + service worker
  App.jsx               estado, carregar/salvar, navegação, tempo real, provedores de contexto
  context/              AuthContext, DataContext, ThemeContext
  components/
    common/             Icon, Modal (Sheet), Feedback (avisos/confirmação), Charts, Input, Loading…
    navigation/         seções do menu, eventos de navegação, botão de tema
    home/               Dashboard (Home) e Panorama completo
    movements/          NewMovementForm, MovementList (Gastos), ImportStatement, OpenFinance
    budget/             Orçamento (tabela, edição, alertas, simulador)
    investments/        Carteira e Metas
    accounts/           Contas e bancos: Minhas contas (bancos conectados), contas e cartões, parcelamentos
    assistant/  auth/  help/
  services/             supabaseService, dataValidation (migrate), geminiService, pluggyService, pdfService, bcbService…
  hooks/                usePluggyAutoSync, useBudgetAlerts, useIsDesktop
  domain/               tipos, categorias, bancos, temas
  utils/                formatters, dates, calculations, validators
  styles/               variables.css, theme.css, components.css
  sw.js                 modelo do service worker (o build gera /sw.js com a lista de arquivos e a versão)
public/vendor/          pdf.js (carregado só quando um PDF precisa ser lido)
api/                    funções serverless da Vercel (arquivos com "_" são módulos internos, não rotas)
  pluggy.js             ações avulsas do Open Finance (abrir conexão, consultar, remover)
  sync.js               sincroniza uma conexão inteira (ver abaixo)
  gemini.js             IA · keepalive.js cron diário · monthly-summary.js resumo por e-mail
supabase/migrations/    SQL das tabelas relacionais
tests/                  testes das funções de api/ (com fetch simulado)
```

## Sincronização com os bancos (Open Finance)

`POST /api/sync { itemId, from?, to? }` busca, no servidor, o status da conexão, as contas e os
lançamentos de cada conta. Falhas passageiras (rede, 5xx, limite de chamadas) ganham até 3 tentativas
com espera crescente. A resposta diz `status`:

- `success` — tudo veio;
- `partial` — algumas contas falharam (`erros` diz quais); o que veio é salvo, a data da última
  sincronização não avança e o app tenta de novo em 5 minutos;
- `error` — nada veio; nova tentativa em 5 minutos, até 3 vezes, depois espera a próxima janela;
- `reconectar` — senha trocada, consentimento vencido ou MFA: o app para de tentar e mostra
  "Reconectar" em Configurações › Contas e bancos › Minhas contas.

No app, a sincronização roda ao abrir e a cada 6 horas. Não duplica: o id do lançamento no banco é a
chave, e um lançamento lançado à mão igual ao do banco (mesma conta, valor, data e tipo) é vinculado
em vez de repetido. Sem internet, espera a conexão voltar.

## Deploy (Vercel)

`vercel.json` já diz tudo: `npm install`, `npm run build`, publica `dist/` e agenda o cron diário
`/api/keepalive`. Não precisa mudar nada no painel.

### Variáveis de ambiente (Vercel → Settings → Environment Variables)

| Variável | Para quê | Obrigatória? |
|---|---|---|
| `GEMINI_API_KEY` | IA (leitura de extratos, sugestões, assistente) | sim, para a IA |
| `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET` | Open Finance | sim, para conectar bancos |
| `PLUGGY_ALLOWED_USERS` | e-mails/ids que podem usar o Open Finance | recomendado |
| `CRON_SECRET` | protege `/api/keepalive` e `/api/monthly-summary` | recomendado |
| `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `EMAIL_FROM` | resumo mensal por e-mail (dia 1) | só para o e-mail |
| `APP_URL` | link "Abrir o Razão" no e-mail | opcional |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | apontar para outro projeto Supabase | opcional (padrão: o de produção) |

### Supabase gratuito: contra a pausa por inatividade

O plano gratuito pausa o projeto depois de 7 dias sem atividade. Dois agendadores independentes gravam
um batimento no banco todo dia pela função `keepalive_ping`:

- o cron da Vercel em `/api/keepalive` (03:00 UTC), que responde 502 se o Supabase falhar (aparece em
  Vercel › Logs);
- o GitHub Actions `.github/workflows/keepalive.yml` (15:17 UTC), que fica vermelho e manda e-mail se
  falhar. Dá para rodar na mão em Actions › Supabase keepalive › Run workflow.

Se mesmo assim o projeto pausar: painel do Supabase › Resume project. Nenhum dado se perde.

### Banco de dados (uma vez)

Os arquivos de `supabase/migrations/` rodam em ordem no SQL Editor. Em produção, só o do keepalive
(`20261007010000_keepalive.sql`) está aplicado. O de tabelas relacionais (`20261007000000_…`) é opcional e cria
`bank_accounts`, `movements` e `budgets` com RLS (cada usuário só vê o que é seu) e liga o tempo real.
O registro principal continua em `finance_data`; o app mantém as tabelas sincronizadas sozinho. Antes de
rodar o SQL o app funciona normalmente — só sem as tabelas relacionais e sem o recarregamento instantâneo
entre aparelhos.
