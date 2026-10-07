/* components/common/Charts.jsx — gráficos (barra de progresso, rosca, barras, legenda, sparkline e fluxo do mês). */
import React, { useEffect, useId, useMemo, useState } from "react";
import { buildMonthFlow } from "../../utils/calculations";
import { abbrevBRL, brl, brlNum } from "../../utils/formatters";

/* ---- barra de progresso: excedente em hachura + marcador no ponto de 100% ---- */
function ProgressBar({ spent, limit, status }){
  if(!(limit>0)) return null;
  const color = status==="over"?"var(--neg)":status==="warn"?"var(--warn)":"var(--pos)";
  if(spent<=limit){
    const pct=Math.min(100, spent/limit*100);
    return <div className="bar"><i style={{ width:pct+"%", background:color }}/></div>;
  }
  const markerPct = limit/spent*100;
  return (
    <div className="bar">
      <i style={{ width:markerPct+"%", background:"var(--pos)" }}/>
      <i className="bar-excess" style={{ left:markerPct+"%", width:(100-markerPct)+"%" }}/>
      <span className="bar-marker" style={{ left:markerPct+"%" }}/>
    </div>
  );
}

/* ---- componentes de gráfico (SVG/CSS, sem dependências) ---- */
function Donut({ data, size=160, thickness=22, onSelect, selected, centerLabel }){
  const total = data.reduce((s,d)=>s+d.value,0) || 1;
  const r=(size-thickness)/2, c=2*Math.PI*r, cx=size/2;
  let acc=0;
  return (
    <div className="donutwrap" style={{ width:size, height:size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`rotate(-90 ${cx} ${cx})`}>
          {data.map((d,i)=>{
            const frac=d.value/total, dash=frac*c;
            const dim=selected && selected!==d.name;
            const el=<circle key={i} cx={cx} cy={cx} r={r} fill="none" stroke={d.color}
              strokeWidth={thickness} strokeLinecap="round" strokeDasharray={`${Math.max(0,dash-2)} ${c-dash+2}`} strokeDashoffset={-acc*c}
              style={{opacity:dim?.28:1,cursor:onSelect?"pointer":"default",transition:"opacity .15s"}}
              onClick={onSelect?()=>onSelect(d.name):undefined}>
              <title>{d.name}: {brl(d.value)} ({(frac*100).toFixed(0)}%)</title>
            </circle>;
            acc+=frac; return el;
          })}
        </g>
      </svg>
      <div className="donutcenter">
        <b className="num">{brlNum(total)}</b>
        <span>{centerLabel||"total"}</span>
      </div>
    </div>
  );
}
function BarGroups({ data, onSelect, activeIndex }){
  const [mounted,setMounted]=useState(false);
  const [tip,setTip]=useState(null);
  useEffect(()=>{ const t=setTimeout(()=>setMounted(true),20); return ()=>clearTimeout(t); },[]);
  const max = Math.max(...data.flatMap(g=>g.bars.map(b=>b.v)), 1);
  const gridFracs=[1,0.5];
  return (
    <div className="chartwrap">
      <div className="bargroups">
        <div className="chartgrid" style={{position:"absolute",inset:0,pointerEvents:"none"}}>
          {gridFracs.map(f=>(
            <div className="gridline" key={f} style={{ bottom:(f*100)+"%" }}><span>{abbrevBRL(Math.round(max*f*100))}</span></div>
          ))}
        </div>
        {data.map((g,i)=>{
          const dim=activeIndex!=null && activeIndex!==i;
          return (
          <div className={"grp"+(onSelect?" grp-clickable":"")+(activeIndex===i?" grp-active":"")} key={i}
            onClick={onSelect?()=>onSelect(i):undefined}>
            <div className="bset">
              {g.bars.map((b,j)=>(
                <div key={j} className="b"
                  style={{ height:mounted?(b.v/max*100)+"%":"0%", background:b.color, opacity:dim?.35:1, transitionDelay:(i*30+j*15)+"ms" }}
                  onMouseEnter={e=>setTip({ x:e.clientX, y:e.clientY, name:g.name, value:b.v })}
                  onMouseMove={e=>setTip(t=>t&&({ ...t, x:e.clientX, y:e.clientY }))}
                  onMouseLeave={()=>setTip(null)} />
              ))}
            </div>
            <div className="lbl">{g.name}</div>
          </div>);
        })}
      </div>
      {tip && <div className="charttip" style={{ left:tip.x+12, top:tip.y-36 }}>{tip.name}: {brl(Math.round(tip.value*100))}</div>}
    </div>
  );
}
function Legend({ data, onSelect, selected }){
  const total=data.reduce((s,d)=>s+d.value,0)||1;
  return <div className="legend">{data.map((d)=>{
    const dim=selected && selected!==d.name;
    const pct=(d.value/total*100).toFixed(0);
    return (
      <div className={"li"+(onSelect?" li-clickable":"")} key={d.name} style={{opacity:dim?.45:1}}
        onClick={onSelect?()=>onSelect(d.name):undefined}>
        <i style={{background:d.color}}/><span>{d.name}</span>
        <span className="lv">{brl(d.value)} <span style={{color:"var(--text-mut)"}}>{pct}%</span></span>
      </div>);
  })}</div>;
}

/* diagrama de fluxo do mês: as entradas à esquerda, categorias de gasto + investido + sobra à direita,
   ligadas por faixas cuja espessura é proporcional ao valor. Clique numa faixa ou na legenda destaca
   (mesmo padrão de clique-pra-selecionar do Donut/Legend, sem filtrar nada — é só leitura). */
function MonthFlow({ totals, byCatChart, monthLabel }){
  const [active,setActive]=useState(null);
  const flow=useMemo(()=>buildMonthFlow(totals,byCatChart),[totals,byCatChart]);
  if(!flow) return null;
  const { inc, nodes, deficit, shown } = flow;
  const toggle=(name)=>setActive(a=>a===name?null:name);

  const VB_W=480, VB_H=200, NODE_W=10, GAP=4, PAD=6, LABEL_MIN_H=15;
  const RIGHT_X=VB_W-96;
  const usableH=VB_H-PAD*2;
  const scale=usableH/Math.max(inc,shown);
  const leftH=inc*scale;
  // as faixas nascem de fatias contíguas do nó de entradas — como há uma única origem, elas nunca se
  // cruzam. Quando falta dinheiro (deficit>0) essas fatias ficam proporcionalmente mais estreitas que o
  // destino de verdade, e a faixa "abre" ao longo do caminho — o próprio desenho avisa que gastou mais
  // do que entrou, sem precisar de nó negativo.
  const leftSliceScale=leftH/shown;
  let cursorRight=PAD, cursorLeft=PAD;
  const laid=nodes.map(n=>{
    const rh=Math.max(n.value*scale,5);
    const ry0=cursorRight, ry1=ry0+rh; cursorRight=ry1+GAP;
    const lh=n.value*leftSliceScale;
    const ly0=cursorLeft, ly1=ly0+lh; cursorLeft=ly1;
    return { ...n, ry0, ry1, ly0, ly1 };
  });
  const midX=(NODE_W+RIGHT_X)/2;

  return (
    <div>
      <div className="sub" style={{marginBottom:14}}>{brl(inc)} entraram em {monthLabel} — veja para onde foram.</div>
      <svg width="100%" viewBox={`0 0 ${VB_W} ${VB_H}`} role="img" style={{overflow:"visible",display:"block"}}
        aria-label={`Fluxo de ${brl(inc)} entre gastos, investimento e sobra em ${monthLabel}`}>
        <rect x={0} y={PAD} width={NODE_W} height={Math.max(leftH,2)} rx={2} fill="var(--pos)"/>
        {laid.map(n=>{
          const dim=active && active!==n.name;
          const path=`M ${NODE_W},${n.ly0} C ${midX},${n.ly0} ${midX},${n.ry0} ${RIGHT_X},${n.ry0} L ${RIGHT_X},${n.ry1} C ${midX},${n.ry1} ${midX},${n.ly1} ${NODE_W},${n.ly1} Z`;
          return (
            <g key={n.name} className="flowribbon" style={{cursor:"pointer"}} tabIndex={0} role="button"
              aria-label={`${n.name}: ${brl(n.value)}, ${Math.round(n.value/shown*100)}% das entradas`}
              onClick={()=>toggle(n.name)}
              onKeyDown={e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); toggle(n.name); } }}>
              <path d={path} fill={n.color} style={{opacity:dim?.15:.55,transition:"opacity .15s"}}/>
              <rect className="flownode" x={RIGHT_X} y={n.ry0} width={NODE_W} height={n.ry1-n.ry0} rx={2} fill={n.color}
                style={{opacity:dim?.28:1,transition:"opacity .15s"}}/>
              {(n.ry1-n.ry0)>=LABEL_MIN_H &&
                <text x={RIGHT_X+NODE_W+8} y={(n.ry0+n.ry1)/2} dominantBaseline="middle" fill="var(--text-mut)"
                  style={{fontSize:10,fontFamily:"'IBM Plex Mono',monospace",opacity:dim?.35:1}}>
                  {abbrevBRL(n.value)}
                </text>}
            </g>
          );
        })}
      </svg>
      <Legend data={nodes} onSelect={toggle} selected={active}/>
      {deficit>0 &&
        <p className="hint" style={{color:"var(--warn)"}}>Gastou {brl(deficit)} a mais do que entrou este mês — por isso "Sobrou" não aparece no fluxo.</p>}
    </div>
  );
}

function Sparkline({ data, w=100, h=40 }){
  const gradId="sparkgrad-"+useId(); // id único por instância — duas sparklines na mesma tela não podem colidir
  if(!data || data.length<2) return null;
  const min=Math.min(...data,0), max=Math.max(...data,0);
  const range=(max-min)||1;
  const pts=data.map((v,i)=>[ (i/(data.length-1))*w, h-((v-min)/range)*h ]);
  const line=pts.map((p,i)=>(i===0?"M":"L")+p[0].toFixed(1)+","+p[1].toFixed(1)).join(" ");
  const area=line+` L${w},${h} L0,${h} Z`;
  const up = data[data.length-1]>=data[0];
  const color = up?"var(--pos)":"var(--neg)";
  return (
    <svg width={w} height={h} className="herospark" viewBox={`0 0 ${w} ${h}`}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} stroke="none"/>
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export { ProgressBar, Donut, BarGroups, Legend, MonthFlow, Sparkline };
