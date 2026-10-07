/* components/common/Icon.jsx — ícones SVG do app e a marca. */
import React from "react";

/* =======================================================================
   ÍCONES — SVG desenhados à mão, estilo outline geométrico (1.5, currentColor).
   Substituem todo emoji da interface, inclusive nas categorias.
   ======================================================================= */
const ICONS = {
  casa: <React.Fragment><path d="M4 11 L12 4 L20 11"/><path d="M6 9.5 V20 H18 V9.5"/><path d="M10 20 V14 H14 V20"/></React.Fragment>,
  grafico: <React.Fragment><line x1="4" y1="20" x2="20" y2="20"/><rect x="6" y="12" width="3" height="6" rx="1"/><rect x="11" y="8" width="3" height="10" rx="1"/><rect x="16" y="4" width="3" height="14" rx="1"/></React.Fragment>,
  menu: <React.Fragment><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></React.Fragment>,
  "x-circulo": <React.Fragment><circle cx="12" cy="12" r="9"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></React.Fragment>,
  livro: <React.Fragment><path d="M4 5.5 C4 4.7 4.7 4 5.5 4 H11 V20 H5.5 C4.7 20 4 19.3 4 18.5 Z"/><path d="M20 5.5 C20 4.7 19.3 4 18.5 4 H13 V20 H18.5 C19.3 20 20 19.3 20 18.5 Z"/></React.Fragment>,
  panorama: <React.Fragment><circle cx="12" cy="12" r="9"/><path d="M14 10 L12 12 L10 14 L12 12 Z"/></React.Fragment>,
  calendario: <React.Fragment><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/></React.Fragment>,
  orcamento: <React.Fragment><circle cx="12" cy="12" r="9"/><path d="M12 12 L12 3 A9 9 0 0 1 19.5 16.5 Z"/></React.Fragment>,
  metas: <React.Fragment><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/></React.Fragment>,
  investimentos: <React.Fragment><path d="M4 16 L9 10 L13 13 L20 5"/><path d="M15 5 H20 V10"/></React.Fragment>,
  extrato: <React.Fragment><rect x="5" y="3" width="14" height="18" rx="2"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="13" y2="16"/></React.Fragment>,
  assistente: <path d="M4 5 H20 V16 H9 L5 19 V16 H4 Z"/>,
  contas: <React.Fragment><path d="M3 10 L12 4 L21 10"/><line x1="4" y1="10" x2="4" y2="19"/><line x1="8" y1="10" x2="8" y2="19"/><line x1="12" y1="10" x2="12" y2="19"/><line x1="16" y1="10" x2="16" y2="19"/><line x1="20" y1="10" x2="20" y2="19"/><line x1="3" y1="19" x2="21" y2="19"/></React.Fragment>,
  mais: <React.Fragment><circle cx="7" cy="7" r="1.4" fill="currentColor" stroke="none"/><circle cx="17" cy="7" r="1.4" fill="currentColor" stroke="none"/><circle cx="7" cy="17" r="1.4" fill="currentColor" stroke="none"/><circle cx="17" cy="17" r="1.4" fill="currentColor" stroke="none"/></React.Fragment>,
  sol: <React.Fragment><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.9" y1="4.9" x2="6.3" y2="6.3"/><line x1="17.7" y1="17.7" x2="19.1" y2="19.1"/><line x1="4.9" y1="19.1" x2="6.3" y2="17.7"/><line x1="17.7" y1="6.3" x2="19.1" y2="4.9"/></React.Fragment>,
  lua: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"/>,
  "seta-esquerda": <path d="M15 6 L9 12 L15 18"/>,
  "seta-direita": <path d="M9 6 L15 12 L9 18"/>,
  "chevron-baixo": <path d="M6 9 L12 15 L18 9"/>,
  fechar: <React.Fragment><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></React.Fragment>,
  editar: <React.Fragment><path d="M4 20 L4 16.5 L15.5 5 A2 2 0 0 1 18.5 8 L7 19.5 Z"/><line x1="13.5" y1="6.5" x2="17" y2="10"/></React.Fragment>,
  excluir: <React.Fragment><path d="M4 7 H20"/><path d="M9 7 V4.5 H15 V7"/><path d="M6 7 L7 20 H17 L18 7"/><line x1="10" y1="11" x2="10" y2="16"/><line x1="14" y1="11" x2="14" y2="16"/></React.Fragment>,
  adicionar: <React.Fragment><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></React.Fragment>,
  check: <path d="M5 12.5 L10 17.5 L19 7"/>,
  alerta: <React.Fragment><path d="M12 3 L22 20 H2 Z"/><line x1="12" y1="9" x2="12" y2="14"/><circle cx="12" cy="17" r="0.8" fill="currentColor" stroke="none"/></React.Fragment>,
  baixar: <React.Fragment><line x1="12" y1="3" x2="12" y2="15"/><path d="M7 10 L12 15 L17 10"/><line x1="4" y1="20" x2="20" y2="20"/></React.Fragment>,
  enviar: <React.Fragment><line x1="12" y1="21" x2="12" y2="9"/><path d="M7 14 L12 9 L17 14"/><line x1="4" y1="4" x2="20" y2="4"/></React.Fragment>,
  camera: <React.Fragment><path d="M4 8 H8 L9.5 5.5 H14.5 L16 8 H20 V19 H4 Z"/><circle cx="12" cy="13.5" r="3.5"/></React.Fragment>,
  documento: <React.Fragment><rect x="6" y="3" width="12" height="18" rx="1.5"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></React.Fragment>,
  cartao: <React.Fragment><rect x="3" y="6" width="18" height="13" rx="2"/><line x1="3" y1="10.5" x2="21" y2="10.5"/><line x1="6" y1="15" x2="10" y2="15"/></React.Fragment>,
  banco: <React.Fragment><path d="M3 10 L12 4 L21 10"/><line x1="4" y1="10" x2="4" y2="19"/><line x1="8" y1="10" x2="8" y2="19"/><line x1="12" y1="10" x2="12" y2="19"/><line x1="16" y1="10" x2="16" y2="19"/><line x1="20" y1="10" x2="20" y2="19"/><line x1="3" y1="19" x2="21" y2="19"/></React.Fragment>,
  atualizar: <React.Fragment><path d="M20.5 12a8.5 8.5 0 1 1-2.49-6.01"/><polyline points="20.5 3.8 20.5 9.2 15.1 9.2"/></React.Fragment>,
  filtro: <path d="M4 5 H20 L14 12.5 V18 L10 20 V12.5 Z"/>,
  buscar: <React.Fragment><circle cx="10" cy="10" r="6.5"/><line x1="15" y1="15" x2="20" y2="20"/></React.Fragment>,
  sincronizar: <React.Fragment><path d="M20 11 A8 8 0 0 0 6.3 6.3 L4 8.5"/><path d="M4 4 V8.5 H8.5"/><path d="M4 13 A8 8 0 0 0 17.7 17.7 L20 15.5"/><path d="M20 20 V15.5 H15.5"/></React.Fragment>,
  config: <React.Fragment><circle cx="12" cy="12" r="3"/><path d="M12 3 V6 M12 18 V21 M3 12 H6 M18 12 H21 M5.6 5.6 L7.8 7.8 M16.2 16.2 L18.4 18.4 M18.4 5.6 L16.2 7.8 M7.8 16.2 L5.6 18.4"/></React.Fragment>,
  ajuda: <React.Fragment><circle cx="12" cy="12" r="9"/><path d="M9.2 9.5 C9.2 7.8 10.5 6.7 12 6.7 C13.5 6.7 14.8 7.6 14.8 9.1 C14.8 10.9 12.9 11.2 12.3 12.3 C12.1 12.7 12 13.1 12 13.6"/><circle cx="12" cy="16.6" r="0.9" fill="currentColor" stroke="none"/></React.Fragment>,
  sair: <React.Fragment><path d="M10 4 H5 V20 H10"/><line x1="21" y1="12" x2="11" y2="12"/><path d="M17 8 L21 12 L17 16"/></React.Fragment>,
  brilho: <path d="M12 3 L13.4 9.5 L20 11 L13.4 12.5 L12 19 L10.6 12.5 L4 11 L10.6 9.5 Z"/>,
  transferencia: <React.Fragment><path d="M4 8 H17"/><path d="M13.5 4.5 L17 8 L13.5 11.5"/><path d="M20 16 H7"/><path d="M10.5 12.5 L7 16 L10.5 19.5"/></React.Fragment>,
  olho: <React.Fragment><path d="M2 12 C5 6 9 4 12 4 C15 4 19 6 22 12 C19 18 15 20 12 20 C9 20 5 18 2 12 Z"/><circle cx="12" cy="12" r="3"/></React.Fragment>,
  "olho-fechado": <React.Fragment><path d="M2 12 C5 6 9 4 12 4 C15 4 19 6 22 12 C19 18 15 20 12 20 C9 20 5 18 2 12 Z"/><circle cx="12" cy="12" r="3"/><line x1="3" y1="3" x2="21" y2="21"/></React.Fragment>,
  escudo: <path d="M12 3 L20 6 V11 C20 16 16.5 19.5 12 21 C7.5 19.5 4 16 4 11 V6 Z"/>,
  // categorias
  alimentacao: <React.Fragment><line x1="6" y1="2" x2="6" y2="10"/><line x1="4.5" y1="2" x2="4.5" y2="6"/><line x1="7.5" y1="2" x2="7.5" y2="6"/><line x1="6" y1="10" x2="6" y2="22"/><path d="M17 2 C15 4 15 8 17 10 V22"/></React.Fragment>,
  transporte: <React.Fragment><path d="M4 16 L5.5 10 H18.5 L20 16"/><rect x="3" y="16" width="18" height="4" rx="1"/><circle cx="7.5" cy="20" r="1.5"/><circle cx="16.5" cy="20" r="1.5"/></React.Fragment>,
  moradia: <React.Fragment><path d="M4 11 L12 4 L20 11"/><path d="M6 10 V20 H18 V10"/></React.Fragment>,
  "contas-cat": <React.Fragment><rect x="6" y="3" width="12" height="18" rx="1.5"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></React.Fragment>,
  saude: <path d="M12 20 C4 14 3 9 6.5 6.5 C9 4.7 12 6 12 9 C12 6 15 4.7 17.5 6.5 C21 9 20 14 12 20 Z"/>,
  lazer: <React.Fragment><circle cx="12" cy="12" r="9"/><path d="M10 8.5 L16 12 L10 15.5 Z"/></React.Fragment>,
  compras: <React.Fragment><path d="M6 8 H18 L17 20 H7 Z"/><path d="M9 8 V6 A3 3 0 0 1 15 6 V8"/></React.Fragment>,
  educacao: <React.Fragment><path d="M12 6 C10 4.5 6 4 4 4.5 V18 C6 17.5 10 18 12 19.5 C14 18 18 17.5 20 18 V4.5 C18 4 14 4.5 12 6 Z"/><line x1="12" y1="6" x2="12" y2="19.5"/></React.Fragment>,
  assinaturas: <React.Fragment><path d="M4 12 A8 8 0 0 1 12 4 H17"/><path d="M15 2 L17 4 L15 6"/><path d="M20 12 A8 8 0 0 1 12 20 H7"/><path d="M9 18 L7 20 L9 22"/></React.Fragment>,
  pets: <React.Fragment><circle cx="8" cy="9" r="1.6"/><circle cx="12" cy="7" r="1.6"/><circle cx="16" cy="9" r="1.6"/><path d="M8 13 C6 13 5 15 6 17 C7 19 10 19.5 12 18 C14 19.5 17 19 18 17 C19 15 18 13 16 13 C14 13 13 14.5 12 14.5 C11 14.5 10 13 8 13 Z"/></React.Fragment>,
  outros: <React.Fragment><circle cx="6" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.5" fill="currentColor" stroke="none"/></React.Fragment>,
  salario: <React.Fragment><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M8 8 V6 A2 2 0 0 1 10 4 H14 A2 2 0 0 1 16 6 V8"/><line x1="3" y1="13" x2="21" y2="13"/></React.Fragment>,
  freelance: <React.Fragment><rect x="4" y="5" width="16" height="10" rx="1"/><path d="M2 19 L4 15 H20 L22 19 Z"/></React.Fragment>,
  presente: <React.Fragment><rect x="4" y="9" width="16" height="11" rx="1"/><line x1="4" y1="13" x2="20" y2="13"/><line x1="12" y1="9" x2="12" y2="20"/><path d="M12 9 C9 9 8 6 10 5 C12 4 12 7 12 9 Z"/><path d="M12 9 C15 9 16 6 14 5 C12 4 12 7 12 9 Z"/></React.Fragment>,
  reembolso: <path d="M4 11 H15 A5 5 0 0 1 15 21 H13 M4 11 L7.5 8 M4 11 L7.5 14"/>,
  rendimento: <React.Fragment><path d="M4 16 L9 10 L13 13 L20 5"/><path d="M15 5 H20 V10"/></React.Fragment>,
  proventos: <React.Fragment><circle cx="9" cy="9" r="5.5"/><circle cx="15" cy="15" r="5.5"/></React.Fragment>,
  acoes: <React.Fragment><line x1="5" y1="20" x2="5" y2="13"/><line x1="10" y1="20" x2="10" y2="8"/><line x1="15" y1="20" x2="15" y2="11"/><line x1="20" y1="20" x2="20" y2="5"/></React.Fragment>,
  rendafixa: <React.Fragment><path d="M3 10 L12 4 L21 10"/><line x1="4" y1="10" x2="4" y2="19"/><line x1="8" y1="10" x2="8" y2="19"/><line x1="12" y1="10" x2="12" y2="19"/><line x1="16" y1="10" x2="16" y2="19"/><line x1="20" y1="10" x2="20" y2="19"/><line x1="3" y1="19" x2="21" y2="19"/></React.Fragment>,
  fundos: <path d="M3 7 H9 L11 9 H21 V19 H3 Z"/>,
  cripto: <React.Fragment><circle cx="12" cy="12" r="8"/><line x1="12" y1="8" x2="12" y2="16"/><path d="M9.5 10 H13 A1.5 1.5 0 0 1 13 13 H9.5 M9.5 13 H13.5"/></React.Fragment>,
  tesouro: <React.Fragment><line x1="6" y1="3" x2="6" y2="21"/><path d="M6 4 H18 L15 8 L18 12 H6"/></React.Fragment>,
  previdencia: <path d="M12 3 L20 6 V11 C20 16 16.5 19.5 12 21 C7.5 19.5 4 16 4 11 V6 Z"/>,
};
function Icon({ name, size=20, className="", ...rest }){
  const p = ICONS[name];
  if(!p) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      className={"icon "+className} aria-hidden="true" {...rest}>
      {p}
    </svg>
  );
}
function BrandMark({ size=22 }){
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round">
      <line x1="12" y1="4" x2="12" y2="20"/>
      <line x1="5" y1="8" x2="12" y2="8"/>
      <line x1="12" y1="15" x2="20" y2="15"/>
      <circle cx="5" cy="11" r="2.4" strokeWidth="1.6"/>
      <circle cx="20" cy="18" r="2.4" strokeWidth="1.6"/>
    </svg>
  );
}

export { ICONS, Icon, BrandMark };
