/* context/AuthContext.jsx — sessão do Supabase (quem está logado) disponível para qualquer componente,
   sem precisar descer por props. null em Modo local ou antes do login. */
import React, { createContext, useContext } from "react";

const AuthContext = createContext({ session: null });

function AuthProvider({ session, children }){
  return <AuthContext.Provider value={{ session: session || null }}>{children}</AuthContext.Provider>;
}
const useAuth = () => useContext(AuthContext);

export { AuthContext, AuthProvider, useAuth };
