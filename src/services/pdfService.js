/* services/pdfService.js — pdf.js sob demanda (só carrega quando um PDF precisa ser lido) e extração de texto. */
/* pdf.js é pesado (~1,4 MB com o worker) e só serve pra importação do banco — carregado sob demanda,
   só na primeira vez que a pessoa realmente tenta ler um PDF, não no carregamento do app inteiro. */
let pdfJsLoadPromise = null;
function loadPdfJs(){
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (pdfJsLoadPromise) return pdfJsLoadPromise;
  pdfJsLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "vendor/pdf.min.js";
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
      resolve(window.pdfjsLib);
    };
    s.onerror = () => { pdfJsLoadPromise = null; reject(new Error("Não foi possível carregar o leitor de PDF. Verifique sua conexão e tente de novo.")); };
    document.head.appendChild(s);
  });
  return pdfJsLoadPromise;
}

/* extrai o texto de um PDF (extrato bancário), linha a linha, agrupando itens pela posição vertical */
async function extractPdfText(pdf){
  let fullText = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const lines = {};
    content.items.forEach(item => {
      const y = Math.round(item.transform[5] / 2) * 2;
      (lines[y] = lines[y] || []).push(item);
    });
    Object.keys(lines).map(Number).sort((a, b) => b - a).forEach(y => {
      const row = lines[y].sort((a, b) => a.transform[4] - b.transform[4]);
      fullText += row.map(i => i.str).join(" ") + "\n";
    });
  }
  return fullText;
}

export { pdfJsLoadPromise, loadPdfJs, extractPdfText };
