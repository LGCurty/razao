/* context/DataContext.jsx — estado global dos dados do app: o registro completo (data), o ponto único de
   mutação (update, que respeita o modo somente leitura offline) e o motor de sincronização do Open
   Finance (pluggySync). O App continua sendo o dono do estado; o contexto só o torna alcançável. */
import React, { createContext, useContext } from "react";

const DataContext = createContext({ data: null, update: () => {}, pluggySync: null });

function DataProvider({ data, update, pluggySync, children }){
  return <DataContext.Provider value={{ data, update, pluggySync }}>{children}</DataContext.Provider>;
}
const useData = () => useContext(DataContext);

export { DataContext, DataProvider, useData };
