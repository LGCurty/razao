/* config.js — versão e data do build (preenchidas pelo Vite a partir do package.json). */
/* =======================================================================
   CONFIGURAÇÃO DO BANCO DE DADOS (Supabase)
   Preencha os dois valores abaixo com os dados do seu projeto Supabase.
   (Project Settings > API > "Project URL" e "anon public key".)
   Enquanto não preencher, o app roda em MODO LOCAL (só neste aparelho).
   ======================================================================= */
/* =======================================================================
   VERSÃO — os dois valores abaixo são reescritos automaticamente pelo
   build.js a cada "node build.js"; não precisa (nem adianta) editar à mão.
   O mesmo número vai para o nome do cache do service worker, então todo
   build novo invalida o anterior e quem está com o site aberto recebe o
   aviso de atualização.
   ======================================================================= */
const APP_VERSION = __APP_VERSION__;
const APP_BUILD = __APP_BUILD__;

export { APP_VERSION, APP_BUILD };
