/* domain/themes.js — cores de acento escolhíveis em Preferências. */
/* paleta de acentos escolhíveis (Configurações > Personalização). Cada tema já vem com o par
   claro/escuro validado (contraste mínimo garantido contra texto branco em botão sólido e contra
   o fundo do próprio tema) — nenhuma combinação aqui deixa um botão com texto ilegível. "razao" é o
   padrão de fábrica. As cores de status (ganho/gasto/investimento/aviso) e a paleta das categorias
   nos gráficos (QUALITATIVE) nunca mudam com a escolha aqui — só o acento de marca muda. */
const COLOR_THEMES = [
  // padrão desde a logo nova: âmbar da logo. No escuro o âmbar é claro demais para texto branco, então o
  // texto sobre o acento ("on") é o grafite da logo; os outros temas usam branco (padrão do CSS)
  { id:"razao", name:"Razão (âmbar)", light:{accent:"#B45309",deep:"#92400E",on:"#FFFFFF"}, dark:{accent:"#FBBF24",deep:"#D97706",on:"#1F2328"} },
  { id:"aco", name:"Aço", light:{accent:"#3E5266",deep:"#26323F"}, dark:{accent:"#5C7690",deep:"#3E5266"} },
  { id:"grafite", name:"Grafite", light:{accent:"#4A4744",deep:"#2E2C2A"}, dark:{accent:"#857E77",deep:"#6B6762"} },
  { id:"indigo", name:"Índigo", light:{accent:"#4338CA",deep:"#2D2A85"}, dark:{accent:"#7B77E0",deep:"#4F49C4"} },
  { id:"marinho", name:"Azul-marinho", light:{accent:"#1E3A5F",deep:"#12233A"}, dark:{accent:"#5C87B8",deep:"#2E4F78"} },
  { id:"cobalto", name:"Cobalto", light:{accent:"#2145A8",deep:"#152E6E"}, dark:{accent:"#5179E4",deep:"#4161C5"} },
  { id:"petroleo", name:"Petróleo", light:{accent:"#0F5C56",deep:"#0A3E3A"}, dark:{accent:"#408B83",deep:"#24736B"} },
  { id:"turquesa", name:"Turquesa", light:{accent:"#0E7C7B",deep:"#0A5453"}, dark:{accent:"#2F8C89",deep:"#21736F"} },
  { id:"pinho", name:"Verde-pinho", light:{accent:"#3F6B4E",deep:"#294736"}, dark:{accent:"#578A68",deep:"#4A6F5D"} },
  { id:"esmeralda", name:"Esmeralda", light:{accent:"#0F7A4E",deep:"#0A5236"}, dark:{accent:"#20905F",deep:"#19764B"} },
  { id:"musgo", name:"Musgo", light:{accent:"#5C5A2E",deep:"#3D3B1E"}, dark:{accent:"#848144",deep:"#6C6A32"} },
  { id:"ameixa", name:"Ameixa", light:{accent:"#6B3560",deep:"#472240"}, dark:{accent:"#B263A6",deep:"#8F5385"} },
  { id:"violeta", name:"Violeta", light:{accent:"#5B3FA6",deep:"#3B296E"}, dark:{accent:"#8B6CD8",deep:"#6E57B9"} },
  { id:"vinho", name:"Vinho", light:{accent:"#732940",deep:"#471624"}, dark:{accent:"#C06478",deep:"#833B4C"} },
  { id:"rubi", name:"Rubi", light:{accent:"#8F2C40",deep:"#5C1826"}, dark:{accent:"#DA4E62",deep:"#B43E51"} },
  { id:"terracota", name:"Terracota", light:{accent:"#AB4E2C",deep:"#78361C"}, dark:{accent:"#CA602E",deep:"#9A5630"} },
  { id:"ambar", name:"Âmbar escuro", light:{accent:"#8A6318",deep:"#5C4110"}, dark:{accent:"#A47723",deep:"#826224"} },
  { id:"bronze", name:"Bronze", light:{accent:"#705838",deep:"#47351E"}, dark:{accent:"#9D784A",deep:"#7C6348"} },
  { id:"ferrugem", name:"Ferrugem", light:{accent:"#8F401F",deep:"#5C2612"}, dark:{accent:"#CD5E26",deep:"#9E532F"} },
  { id:"chumbo", name:"Chumbo", light:{accent:"#524A42",deep:"#35302A"}, dark:{accent:"#8A7C71",deep:"#70665A"} },
  { id:"ardosia", name:"Ardósia", light:{accent:"#48697F",deep:"#2E4152"}, dark:{accent:"#57849F",deep:"#506B7D"} },
];
const COLOR_THEME_MAP = Object.fromEntries(COLOR_THEMES.map(t=>[t.id,t]));

export { COLOR_THEMES, COLOR_THEME_MAP };
