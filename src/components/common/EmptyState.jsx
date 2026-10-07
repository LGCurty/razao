/* components/common/EmptyState.jsx — estado vazio com ação. */
import React from "react";
import { Icon } from "./Icon";

function EmptyState({ icon, title, text, action, secondary }){
  return (
    <div className="empty">
      <div className="bigicon"><Icon name={icon} size={40}/></div>
      <h4>{title}</h4>
      <p>{text}</p>
      {(action||secondary) &&
        <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap",marginTop:14}}>
          {action && <button className="sbtn primary" onClick={action.onClick}>{action.icon && <Icon name={action.icon} size={14}/>}{action.label}</button>}
          {secondary && <button className="sbtn" onClick={secondary.onClick}>{secondary.label}</button>}
        </div>}
    </div>
  );
}

export { EmptyState };
