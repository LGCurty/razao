/* Build do Razão (Vite).
   - npm run dev      → servidor local com recarga automática
   - npm run build    → gera dist/ (é o que a Vercel publica, ver vercel.json)
   - npm run preview  → serve o dist/ localmente para conferir o build de produção

   A versão vem do package.json e a data do build entra junto; o service worker (sw.js) é gerado aqui a
   cada build, com a lista exata dos arquivos com hash — um deploy novo sempre troca o sw.js, e quem está
   com o app aberto recebe o aviso "versão nova". */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(raiz, "package.json"), "utf8"));

function serviceWorker({ version, buildId }) {
  return {
    name: "razao-service-worker",
    apply: "build",
    generateBundle(_opts, bundle) {
      const arquivos = Object.keys(bundle).filter((f) => /\.(js|css)$/.test(f));
      const modelo = fs.readFileSync(path.join(raiz, "src", "sw.js"), "utf8");
      const lista = JSON.stringify(["./", "./index.html", ...arquivos.map((f) => "./" + f)], null, 2);
      const codigo = modelo
        .replace(/^const CACHE_NAME = "__CACHE_NAME__";$/m, `const CACHE_NAME = "razao-${version}-${buildId}";`)
        .replace(/^const SHELL_FILES = __SHELL_FILES__;$/m, `const SHELL_FILES = ${lista};`);
      // se o modelo mudar e algum marcador sobrar, o build falha aqui em vez de publicar um sw.js quebrado
      if (/__CACHE_NAME__|__SHELL_FILES__/.test(codigo)) throw new Error("sw.js: marcador não substituído no modelo src/sw.js");
      this.emitFile({ type: "asset", fileName: "sw.js", source: codigo });
    },
  };
}

export default defineConfig(() => {
  const agora = new Date();
  const buildId = agora.toISOString().replace(/\D/g, "").slice(0, 14);
  // só para os testes automatizados: troca o cliente do Supabase por um simulado (nunca em produção)
  const mock = process.env.RAZAO_SUPABASE_MOCK;
  return {
    plugins: [react(), serviceWorker({ version: pkg.version, buildId })],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __APP_BUILD__: JSON.stringify(agora.toISOString().slice(0, 10)),
    },
    resolve: { alias: mock ? { "@supabase/supabase-js": path.resolve(mock) } : {} },
    build: { outDir: process.env.RAZAO_OUT_DIR || "dist", emptyOutDir: true, chunkSizeWarningLimit: 900 },
  };
});
