# Otimização de tokens

## Monitoramento
- Extensão "Claude Code Usage" no VSCode (Ctrl+Shift+X); acompanhe o breakdown de tokens.
- Meta: manter <30% dos tokens acima de 150k de contexto. Use `/context` e `/compact` ou `/clear` entre tarefas.

## Padrões que economizam
- MCP Google Drive em vez de copiar/colar.
- Reutilizar resultados de análise dentro do mesmo contexto.
- Tarefas pequenas e focadas.
- Prompts diretos: problema → ação → resultado.

## Checklist
- [ ] Arquivo lido várias vezes? Reutilizar o que já está no contexto.
- [ ] Comando falhou? Investigar a causa, não repetir.
- [ ] Resultado grande? Dividir em seções / filtrar com Grep.
- [ ] Contexto >150k? Revisar o que é necessário, `/compact`.

## Fontes de dados
- Planilha de Execução: Google Drive MCP.
- Dashboard Manutenção OT: Power BI / Google Drive.
- Relatórios TOCICA: Gmail MCP (buscar templates).
- Cursos ISO: Drive (docs de referência).

## Setup de MCPs
- Google Drive, Gmail e Calendar: já conectados via claude.ai.
- context7 (não instalado). Instalar:
  `claude mcp add --scope project context7 -- npx -y @upstash/context7-mcp`
