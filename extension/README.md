# Extension

Extensao Chrome/Chromium Manifest V3 para capturar rolagens renderizadas pelo Demiplane e compartilhar com uma sala via relay WebSocket.

## Scripts

```bash
npm run build --workspace extension
npm run typecheck --workspace extension
```

O build gera `extension/dist`, que pode ser carregado em `chrome://extensions` usando o modo desenvolvedor.

## Modulos

- `src/content.ts`: observa a ficha com `MutationObserver`, normaliza texto de rolagem, injeta o painel flutuante retratil e anima os dados na ficha quando a opcao estiver ligada.
- `src/background.ts`: guarda configuracao, abre o WebSocket, envia rolagens e recebe eventos remotos.
- `src/popup.ts`: controla o formulario de jogador/canal/senha/relay.
- `src/shared`: tipos e acesso ao `chrome.storage.local`.

## Captura

O content script roda apenas em:

```text
https://app.demiplane.com/nexus/*/character-sheet/*
```

A heuristica inicial procura classes conhecidas como `.dice-roller`, `.dice-history-main-container` e elementos com `dice-history`. Todo evento mantem `rawText` para facilitar diagnostico quando o Demiplane mudar a UI.

O popup serve como configuracao. Depois que o jogador conecta uma vez, a extensao salva a intencao de reconectar e o painel na ficha vira a superficie principal durante a sessao.

## Animacao dos dados

A opcao `Animacao dos dados` fica ligada por padrao. Quando uma rolagem ao vivo aparece, a extensao cria uma camada visual leve sobre a ficha, joga os dados com gravidade, colisao, quique e som sintetizado localmente. A face exibida ao final vem dos valores capturados pelo Demiplane, e os dados podem ser arrastados ate desaparecerem alguns segundos depois.

## Empacotamento

Na raiz do repositorio:

```bash
npm run package:extension
```

Isso gera zips em `artifacts/`: um pacote Chromium para Chrome, Edge, Opera e outros navegadores Chromium, e um pacote Firefox com manifest ajustado para WebExtensions.
