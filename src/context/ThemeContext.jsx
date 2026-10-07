/* context/ThemeContext.jsx — tema claro/escuro. O valor fica salvo nos dados (data.theme) para valer em
   todos os aparelhos; o contexto expõe o tema atual e como trocá-lo. */
import React, { createContext, useContext } from "react";

const ThemeContext = createContext({ theme: "dark", setTheme: () => {}, toggleTheme: () => {} });

function ThemeProvider({ theme, setTheme, children }){
  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");
  return <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>{children}</ThemeContext.Provider>;
}
const useTheme = () => useContext(ThemeContext);

export { ThemeContext, ThemeProvider, useTheme };
