/* components/navigation/sections.js — as 5 seções do menu e suas sub-telas. */
/* navegação: 5 seções no menu principal (barra lateral no computador, barra inferior no celular). Cada
   seção agrupa uma ou mais telas — as abas antigas — trocadas por um seletor no topo da seção. Nada foi
   removido, só reagrupado. As chaves das telas ("geral", "balanco"…) continuam as mesmas, então
   goToTab()/openHelp() e os links internos seguem funcionando sem mudança. */
const NAV_SECTIONS = [
  { key:"home", label:"Home", icon:"panorama", views:[["geral","Resumo"],["perguntar","Assistente"]] },
  { key:"gastos", label:"Gastos", icon:"calendario", views:[["balanco","Lançamentos"],["extrato","Importar do banco"]] },
  { key:"orcamento", label:"Orçamento", icon:"orcamento", views:[["orcamento","Orçamento"]] },
  { key:"investimentos", label:"Investimentos", icon:"investimentos", views:[["investimentos","Carteira"],["metas","Metas"]] },
  { key:"config", label:"Configurações", icon:"config", views:[["contas","Contas e bancos"],["preferencias","Preferências"],["ajuda","Ajuda"]] },
];
const sectionOfView = (v)=>NAV_SECTIONS.find(sec=>sec.views.some(([k])=>k===v))||NAV_SECTIONS[0];

export { NAV_SECTIONS, sectionOfView };
