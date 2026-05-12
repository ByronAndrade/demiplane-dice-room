# Extension

Espaco reservado para a extensao de navegador.

## Plano tecnico

- Manifest V3.
- Content script limitado a `https://app.demiplane.com/nexus/*/character-sheet/*`.
- Popup para configuracao de nome, canal e senha.
- Painel flutuante injetado na pagina da ficha.
- `MutationObserver` para capturar novos itens no historico de rolagem.
- Conexao WebSocket com o relay.

## Modulos esperados

- `content`: captura DOM e comunica com runtime.
- `popup`: configuracao do jogador e canal.
- `background`: estado da conexao, armazenamento e transporte.
- `ui`: painel flutuante e feed de rolagens.
- `shared`: tipos, validacao e utilitarios.
