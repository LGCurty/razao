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
 */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const HTML_PATH = path.join(ROOT, "index.html");
const OUT_PATH = path.join(ROOT, "app.compiled.js");
const BABEL_PATH = path.join(ROOT, "vendor", "babel.min.js");

function fail(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}

if (!fs.existsSync(HTML_PATH)) fail(`Não encontrei ${HTML_PATH}. Rode este script na pasta do projeto.`);
if (!fs.existsSync(BABEL_PATH)) fail(`Não encontrei ${BABEL_PATH}. Baixe vendor/babel.min.js antes (veja o README/vendor).`);

const html = fs.readFileSync(HTML_PATH, "utf8");
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
  "   Compilado em: " + new Date().toISOString() + " */\n";
const footer = "\nwindow.__RAZAO_APP_LOADED__ = true;\n";

fs.writeFileSync(OUT_PATH, banner + compiled + footer, "utf8");
console.log(`✓ app.compiled.js gerado (${(compiled.length / 1024).toFixed(0)} KB).`);
console.log("  Suba este arquivo junto com index.html e a pasta vendor/ no próximo deploy.");
