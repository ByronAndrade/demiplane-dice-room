# Roadmap

## Fase 0 - Fundacao

- Criar repositorio privado.
- Documentar produto, arquitetura e pesquisa inicial.
- Definir formato `RollEvent`.

## Fase 1 - Prototipo local

- Criar extensao Manifest V3 minima.
- Injetar content script em fichas do Demiplane.
- Detectar rolagem por `MutationObserver`.
- Exibir painel flutuante local com rolagens capturadas.
- Criar relay WebSocket local.
- Conectar duas janelas no mesmo canal.

## Fase 2 - MVP jogavel

- Popup da extensao com canal, senha e nome.
- Compartilhamento realtime entre jogadores.
- Deduplicacao de eventos.
- Reconexao automatica.
- Estado visual de conexao.
- Modo debug para mostrar ultimo payload capturado.

## Fase 3 - Privacidade e robustez

- Criptografia local baseada na senha do canal.
- Validacao de schema com `zod`.
- Rate limit basico no relay.
- Logs reduzidos por padrao.
- Deploy do relay.

## Fase 4 - Polimento

- Painel com tema visual inspirado em mesa de RPG, sem competir com a ficha.
- Historico curto por sessao.
- Filtros por personagem.
- Exportar log da sessao.

## Perguntas abertas

- O primeiro navegador alvo sera Chrome, Edge ou ambos?
- O relay deve ser auto-hospedado ou usar servico gerenciado?
- A mesa quer historico persistente ou apenas sessao ao vivo?
- Devemos permitir que o narrador marque rolagens como privadas?
