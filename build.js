#!/usr/bin/env node
/*
 * build.js — pré-compila o JSX do Razão para app.compiled.js.
 *
 * Por quê: sem isso, o navegador de quem abre o site baixa o Babel (~2,4 MB) e recompila o JSX
 * do zero a cada visita. Rodando este script uma vez após editar o index.html, o resultado já
 * compilado é servido direto — abertura mais rápida, e o app continua funcionando mesmo se o
 * CDN do Babel estiver fora do ar (a compilação em tempo de execução continua existindo, mas só
 * como alternativa, usada automaticamente se app.compiled.js não existir ou falhar ao carregar).
 *
 * Como usar:
 *   1. Precisa só do Node.js instalado (nenhum "npm install" é necessário — o compilador usado
 *      é o próprio vendor/babel.min.js que já está no projeto).
 *   2. Sempre que mexer no JSX dentro de index.html, rode:  node build.js
 *   3. Isso gera/atualiza o arquivo app.compiled.js ao lado do index.html.
 *   4. Suba os dois arquivos (index.html e app.compiled.js) no deploy, junto com a pasta vendor/.
 *
 * Não rodar este passo não quebra nada: o index.html sempre funciona sozinho (ele detecta que
 * app.compiled.js está ausente e cai de volta para compilar no navegador, como sempre fez).
 *
 * VERSÃO — este script também é quem cuida do número de versão, para que ele nunca fique
 * desatualizado por esquecimento:
 *   · a cada execução, o último número sobe em 1 (1.5.0 → 1.5.1) e a data do build é gravada;
 *   · o novo número é escrito de volta no index.html (APP_VERSION) e no sw.js (nome do cache),
 *     então cada build invalida o cache antigo sozinho e quem já tem o site aberto recebe o
 *     aviso de "nova versão disponível";
 *   · para subir a versão menor ou maior (mudança grande), rode:
 *         node build.js --minor     (1.5.3 → 1.6.0)
 *         node build.js --major     (1.6.2 → 2.0.0)
 *     ou fixe um número exato com:  node build.js --set 2.1.0
 */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const HTML_PATH = path.join(ROOT, "index.html");
const OUT_PATH = path.join(ROOT, "app.compiled.js");
const SW_PATH = path.join(ROOT, "sw.js");
const BABEL_PATH = path.join(ROOT, "vendor", "babel.min.js");

const VERSION_RE = /const APP_VERSION = "(\d+)\.(\d+)\.(\d+)";/;

function fail(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}

if (!fs.existsSync(HTML_PATH)) fail(`Não encontrei ${HTML_PATH}. Rode este script na pasta do projeto.`);
if (!fs.existsSync(BABEL_PATH)) fail(`Não encontrei ${BABEL_PATH}. Baixe vendor/babel.min.js antes (veja o README/vendor).`);

let html = fs.readFileSync(HTML_PATH, "utf8");

/* ---- número de versão: calculado antes de compilar, para entrar no bundle já atualizado ---- */
const vMatch = html.match(VERSION_RE);
if (!vMatch) fail('Não encontrei a linha `const APP_VERSION = "x.y.z";` dentro do index.html.');

const args = process.argv.slice(2);
const setArg = args.indexOf("--set") !== -1 ? args[args.indexOf("--set") + 1] : null;
let [maior, menor, correcao] = vMatch.slice(1).map(Number);
if (setArg) {
  const partes = String(setArg).match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!partes) fail(`--set precisa de um número no formato x.y.z (recebi "${setArg}").`);
  [maior, menor, correcao] = partes.slice(1).map(Number);
} else if (args.includes("--major")) {
  maior += 1; menor = 0; correcao = 0;
} else if (args.includes("--minor")) {
  menor += 1; correcao = 0;
} else {
  correcao += 1;
}
const versao = `${maior}.${menor}.${correcao}`;
const dataBuild = new Date().toISOString().slice(0, 10);

html = html
  .replace(VERSION_RE, `const APP_VERSION = "${versao}";`)
  .replace(/const APP_BUILD = "[^"]*";/, `const APP_BUILD = "${dataBuild}";`);
fs.writeFileSync(HTML_PATH, html, "utf8");

// o nome do cache do service worker carrega a versão: cada build invalida o cache anterior sozinho,
// em vez de depender de alguém lembrar de trocar o número na mão
if (fs.existsSync(SW_PATH)) {
  const sw = fs.readFileSync(SW_PATH, "utf8");
  const swNovo = sw.replace(/const CACHE_NAME = "razao-shell-v[^"]*";/, `const CACHE_NAME = "razao-shell-v${versao}";`);
  if (swNovo === sw) console.warn("! Não encontrei o CACHE_NAME dentro do sw.js — o cache antigo pode sobreviver ao deploy.");
  else fs.writeFileSync(SW_PATH, swNovo, "utf8");
}

const match = html.match(/<script id="app-jsx" type="text\/plain">([\s\S]*?)<\/script>/);
if (!match) fail('Não encontrei o bloco <script id="app-jsx" type="text/plain"> dentro do index.html.');

const jsxSource = match[1];

let Babel;
try {
  Babel = require(BABEL_PATH);
} catch (e) {
  fail("Não consegui carregar o vendor/babel.min.js como compilador: " + e.message);
}

let compiled;
try {
  compiled = Babel.transform(jsxSource, {
    presets: ["react"],
    plugins: [["transform-react-jsx", { runtime: "classic" }]],
  }).code;
} catch (e) {
  fail("Erro ao compilar o JSX (provavelmente um erro de sintaxe no index.html): " + e.message);
}

const banner =
  "/* Gerado automaticamente por build.js — não edite este arquivo à mão.\n" +
  "   Para atualizar, edite o JSX dentro de index.html e rode: node build.js\n" +
  `   Versão ${versao} · compilado em ` + new Date().toISOString() + " */\n";
const footer = "\nwindow.__RAZAO_APP_LOADED__ = true;\n";

fs.writeFileSync(OUT_PATH, banner + compiled + footer, "utf8");
console.log(`✓ versão ${versao} (${dataBuild}) — app.compiled.js gerado (${(compiled.length / 1024).toFixed(0)} KB).`);
console.log("  Atualizados: index.html (APP_VERSION), sw.js (nome do cache) e app.compiled.js.");
console.log("  Suba os três junto com a pasta vendor/ no próximo deploy.");
