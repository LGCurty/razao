/* components/navigation/ThemeToggle.jsx — botão sol/lua do topo (o tema também pode ser escolhido em
   Configurações › Preferências). */
import React from "react";
import { Icon } from "../common/Icon";
import { useTheme } from "../../context/ThemeContext";

function ThemeToggle(){
  const { theme, toggleTheme } = useTheme();
  return (
    <button className="iconbtn themetoggle" aria-label="Alternar tema" onClick={toggleTheme}>
      <Icon name={theme === "dark" ? "sol" : "lua"} size={17}/>
    </button>
  );
}

export { ThemeToggle };
