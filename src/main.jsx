/* Ponto de entrada: estilos, o App e o service worker (abertura offline + aviso de versão nova). */
import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/variables.css";
import "./styles/theme.css";
import "./styles/components.css";
import "./styles/print.css";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);

// service worker: cache do "shell" (HTML/JS/CSS do build) para abrir mesmo sem internet (ver src/sw.js).
// Só em produção — no "npm run dev" ele atrapalharia a recarga automática. Se o registro falhar por
// qualquer motivo, o app continua funcionando normalmente.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      if (!reg) return;
      // uma versão nova já baixada e esperando: avisa quem está com o site aberto em vez de deixar a
      // pessoa usando a versão antiga até fechar todas as abas
      const avisar = () => window.__razaoNovaVersao && window.__razaoNovaVersao();
      const vigiar = (sw) => {
        if (!sw) return;
        sw.addEventListener("statechange", () => {
          if (sw.state === "installed" && navigator.serviceWorker.controller) avisar();
        });
      };
      if (reg.waiting && navigator.serviceWorker.controller) avisar();
      reg.addEventListener("updatefound", () => vigiar(reg.installing));
      // procura atualização ao voltar para a aba, não só no carregamento
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reg.update().catch(() => {});
      });
    }).catch(() => {});
  });
}
