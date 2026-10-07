/* components/navigation/navEvents.js — navegação disparada de qualquer lugar (abrir o manual numa seção, ir para uma tela com filtro). */
/* ---- ajuda contextual: qualquer componente pode pedir pra abrir o manual numa seção específica sem
   precisar receber setTab/estado de navegação por prop — mesmo padrão pub-sub do toast/confirm ---- */
let helpListener=null;
function setHelpListener(fn){ helpListener=fn; }
function openHelp(sectionId){ helpListener && helpListener(sectionId); }
// mesmo padrão do openHelp: deixa qualquer cartão mandar a pessoa para a aba certa (ex: o estado
// vazio do Balanço oferecendo a importação do banco como caminho rápido). O segundo argumento
// (opcional) carrega um filtro pra aplicar assim que a aba de destino abrir — é o que permite
// clicar numa categoria/tag no Panorama e já chegar no Balanço com a lista filtrada.
let tabListener=null;
function setTabListener(fn){ tabListener=fn; }
function goToTab(tab, filter){ tabListener && tabListener(tab, filter); }

export { helpListener, setHelpListener, openHelp, tabListener, setTabListener, goToTab };
