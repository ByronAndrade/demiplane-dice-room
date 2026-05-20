# Demiplane Dice Room

Extensao de navegador e relay realtime para compartilhar rolagens do Demiplane entre jogadores que estejam no mesmo canal de mesa.

## Objetivo

O Demiplane ja permite rolar dados dentro da ficha de personagem, mas o resultado aparece apenas para quem esta vendo aquela ficha. Este projeto cria uma camada paralela: uma extensao observa as rolagens na pagina, publica o resultado em um canal da mesa, e as outras extensoes conectadas ao mesmo canal exibem o historico compartilhado.

## Escopo inicial

- Capturar rolagens exibidas na ficha do Demiplane sem modificar a conta, a ficha ou APIs internas.
- Permitir que jogadores entrem em um canal usando nome de jogador/personagem e senha da sala.
- Compartilhar eventos de rolagem em tempo real.
- Exibir um painel flutuante com historico da mesa.
- Manter a primeira versao simples, transparente e facil de testar durante uma sessao.

## Estrutura

```text
.
├── docs/
│   ├── architecture.md
│   ├── demiplane-research.md
│   ├── product-brief.md
│   ├── roadmap.md
│   └── adr/
│       └── 0001-browser-extension-plus-relay.md
├── extension/
│   └── README.md
└── server/
    └── README.md
```

## Leitura recomendada

Comece por [docs/product-brief.md](docs/product-brief.md) para entender o produto e depois leia [docs/architecture.md](docs/architecture.md) para a arquitetura proposta.

## Como rodar o prototipo local

Instale as dependencias:

```bash
npm install
```

Para mesa remota, o ideal e usar um relay online:

```bash
npm run deploy:relay:cloudflare
```

Depois use a URL `wss://...workers.dev` no campo `Relay` da extensao. Assim ninguem precisa abrir o launcher local durante a sessao.

Se o relay online for publico, proteja-o com uma chave:

```bash
relay-cloudflare/node_modules/.bin/wrangler secret put DICE_ROOM_RELAY_KEY --name demiplane-dice-room-relay
```

Cada sala aceita ate 20 jogadores conectados. A chave do relay fica fora do Git e deve ser passada apenas para quem pode usar aquele Worker.

Para gerar a extensao ja apontando para esse relay:

```bash
DICE_ROOM_DEFAULT_RELAY=wss://demiplane-dice-room-relay.SEUSUBDOMINIO.workers.dev npm run package:extension
```

Para desenvolvimento local, suba o relay WebSocket:

```bash
npm run host:relay
```

No Windows/WSL, tambem da para abrir `launchers/Start Dice Room Relay.cmd`. Ele sobe o relay, tenta criar um tunel publico temporario para jogadores remotos e abre uma pagina com os enderecos para copiar. Esse caminho agora e principalmente um fallback; para uso facil e recorrente, prefira o relay online.

Gere a extensao:

```bash
npm run build:extension
```

Depois abra `chrome://extensions`, ative o modo desenvolvedor e carregue a pasta `extension/dist` como extensao sem pacote.

Para gerar zips instalaveis para navegadores Chromium e Firefox:

```bash
npm run package:extension
```

Veja [docs/hosting-and-browser-support.md](docs/hosting-and-browser-support.md) para hospedar o relay durante a sessao e para notas sobre Chrome, Edge, Opera e Firefox.

## Fluxo de teste

1. Abra uma ficha em `https://app.demiplane.com/nexus/*/character-sheet/*`.
2. Abra o popup da extensao.
3. Informe nome do jogador, canal e senha. O pacote padrao ja usa o relay online `wss://demiplane-dice-room-relay.foxbyron.workers.dev`. Para teste na mesma maquina, `ws://localhost:8787` funciona; para fallback temporario, o launcher ainda pode gerar um `wss://...trycloudflare.com`.
4. Se o relay estiver protegido, informe tambem a chave do relay.
5. Clique em `Conectar`.
6. Repita em outra janela/perfil de navegador com o mesmo canal, senha e chave de relay.
7. Use o botao `Teste` ou faca uma rolagem no Demiplane.

## Status

Prototipo local iniciado:

- Relay WebSocket em Node.js/TypeScript com salas por hash de canal/senha.
- Extensao Chrome/Chromium Manifest V3.
- Popup de configuracao e conexao.
- Content script com `MutationObserver` para capturar rolagens renderizadas.
- Painel flutuante retratil com historico curto de rolagens locais e remotas.
- Historico em memoria no relay com as ultimas 100 rolagens por sala enquanto o servidor estiver rodando.
