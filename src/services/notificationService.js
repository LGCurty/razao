/* services/notificationService.js — notificações do aparelho (alertas de orçamento). */
/* ---- alertas de orçamento ----
   Quando uma categoria do mês corrente passa de 80% e depois de 100% do limite, avisa UMA vez por nível
   em cada mês: um aviso na tela e, se a pessoa ativou, uma notificação do aparelho (via service worker,
   que funciona também com o app instalado na tela inicial). O registro do que já foi avisado fica neste
   aparelho. Notificação com o app totalmente fechado exigiria um servidor de push — fora do escopo. */
const ALERTAS_KEY="razao_alertas_orcamento";
async function notificarAparelho(titulo, corpo, tag){
  if(typeof window==="undefined" || !("Notification" in window) || Notification.permission!=="granted") return false;
  try{
    const reg=navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if(reg && reg.showNotification){ await reg.showNotification(titulo,{ body:corpo, tag, renotify:true }); return true; }
  }catch(_){}
  try{ new Notification(titulo,{ body:corpo, tag }); return true; }catch(_){ return false; }
}

export { ALERTAS_KEY, notificarAparelho };
