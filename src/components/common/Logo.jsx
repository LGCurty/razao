/* components/common/Logo.jsx — logo oficial do Razão (pacote razao-logo-pack). Os SVGs entram como <img>
   (e não embutidos no HTML) porque todos usam o mesmo id de gradiente: embutidos, um sobrescreveria o outro. */
import React from "react";
import horizontalEscuro from "../../assets/brand/razao-logo-horizontal-fundo-escuro.svg";
import horizontalClaro from "../../assets/brand/razao-logo-horizontal-fundo-claro.svg";
import verticalEscuro from "../../assets/brand/razao-logo-vertical-fundo-escuro.svg";
import verticalClaro from "../../assets/brand/razao-logo-vertical-fundo-claro.svg";
import icone from "../../assets/brand/razao-icone.svg";

const ARQUIVOS = {
  horizontal: { dark: horizontalEscuro, light: horizontalClaro },
  vertical: { dark: verticalEscuro, light: verticalClaro },
  icone: { dark: icone, light: icone },
};

/* variant: "horizontal" (menu, cabeçalho) | "vertical" (login, telas de abertura) | "icone" (espaço pequeno).
   height em px; a largura acompanha a proporção do arquivo. */
function Logo({ variant = "horizontal", theme = "dark", height = 36, className = "" }){
  const src = (ARQUIVOS[variant] || ARQUIVOS.horizontal)[theme === "light" ? "light" : "dark"];
  return <img className={"logo "+className} src={src} alt="Razão — controle financeiro" height={height} style={{ height, width: "auto" }} draggable="false"/>;
}

export { Logo };
