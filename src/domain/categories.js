/* domain/categories.js — categorias da planilha, dicas de cada uma, conversão das categorias antigas e cores fixas. */
/* categorias da planilha de referência. "Proventos" continua em Renda porque é ela que alimenta o
   índice de Independência Financeira (renda passiva de investimentos). */
const CATS = {
  gasto: [["Moradia","moradia"],["Transporte","transporte"],["Vida Diária","alimentacao"],["Saúde","saude"],["Entretenimento","lazer"],["Obrigações","contas-cat"],["Outros","outros"]],
  ganho: [["Salário Mensal","salario"],["Renda extra","freelance"],["Proventos","proventos"],["Outros","outros"]],
  investimento: [["Ações","acoes"],["Renda Fixa","rendafixa"],["Fundos","fundos"],["Cripto","cripto"],["Tesouro","tesouro"],["Previdência","previdencia"],["Outros","outros"]],
};
const CAT_ICON = Object.fromEntries(Object.values(CATS).flat().map(([n,ic])=>[n,ic]));
// o que entra em cada categoria — aparece como dica no formulário e ajuda a IA a classificar
const CAT_HINT = {
  "Moradia":"aluguel, condomínio, luz, água, gás, telefone, internet",
  "Transporte":"combustível, Uber, ônibus, estacionamento, pedágio, manutenção do carro",
  "Vida Diária":"supermercado, padaria, restaurante, roupas, salão, pet shop",
  "Saúde":"plano de saúde, consultas, exames, remédios, academia",
  "Entretenimento":"lazer, cinema, streaming, viagens, bares, hobbies",
  "Obrigações":"impostos, taxas e tarifas, juros, anuidade, escola/faculdade, seguros",
  "Salário Mensal":"salário, pró-labore",
  "Renda extra":"freelance, bicos, vendas, cashback",
  "Proventos":"dividendos, juros e rendimentos de investimentos",
};
const catComDica = (n)=> CAT_HINT[n] ? `${n} (${CAT_HINT[n]})` : n;
/* conversão das categorias antigas para as da planilha (schemaVersion 6). Só nomes antigos são chaves
   aqui, então rodar de novo sobre dado já convertido não muda nada. */
const CAT_MIGRACAO = {
  gasto: { "Alimentação":"Vida Diária", "Compras":"Vida Diária", "Pets":"Vida Diária", "Lazer":"Entretenimento", "Assinaturas":"Entretenimento", "Contas":"Moradia", "Educação":"Obrigações" },
  ganho: { "Salário":"Salário Mensal", "Freelance":"Renda extra", "Presente":"Outros", "Reembolso":"Outros", "Rendimento":"Proventos" },
};
const novaCategoria = (tipo, nome)=> (CAT_MIGRACAO[tipo] && CAT_MIGRACAO[tipo][nome]) || nome;
const CLASSES = ["Renda Fixa","Renda Variável","Fundos","Cripto","Tesouro","Previdência","Outros"];
// paleta qualitativa (nunca usa o acento para valor semântico de entrada/saída/investimento — só para identidade de categoria)
const QUALITATIVE = ["#F76B3C","#5A8DEE","#2FB98A","#E8B23C","#A57BE0","#E2564D","#46B7C7","#8C93A8"];
// cor fixa por categoria (não muda quando a lista é reordenada por valor)
const CAT_COLOR = Object.fromEntries([...new Set(Object.values(CATS).flat().map(c=>c[0]))].map((n,i)=>[n,QUALITATIVE[i%QUALITATIVE.length]]));
const CLASS_COLOR = Object.fromEntries(CLASSES.map((n,i)=>[n,QUALITATIVE[i%QUALITATIVE.length]]));

export { CATS, CAT_ICON, CAT_HINT, catComDica, CAT_MIGRACAO, novaCategoria, CLASSES, QUALITATIVE, CAT_COLOR, CLASS_COLOR };
