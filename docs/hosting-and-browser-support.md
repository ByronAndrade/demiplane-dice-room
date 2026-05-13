# Hosting and Browser Support

## Fluxo recomendado: relay online

Para mesas remotas, o fluxo mais simples e usar um relay online 24/7. Com isso, ninguem precisa abrir o `.cmd` antes da sessao: todos instalam a extensao, usam o mesmo endereco `wss://...`, e entram na sala pelo nome e senha combinados.

O pacote `relay-cloudflare` prepara esse modo usando Cloudflare Workers + Durable Objects, que mantem uma instancia isolada por sala.

```bash
npx wrangler login
npm run deploy:relay:cloudflare
```

O deploy retorna uma URL HTTPS. No campo `Relay` da extensao, use a mesma URL como WebSocket seguro:

```text
wss://demiplane-dice-room-relay.SEUSUBDOMINIO.workers.dev
```

Depois disso, o fluxo de uso fica:

1. O narrador abre a ficha, abre a extensao, escolhe nome da sala e senha, e clica em `Criar sala` / `Conectar`.
2. Os jogadores usam o mesmo relay online, digitam o mesmo nome de sala e senha, e clicam em `Entrar em sala` / `Conectar`.
3. As rolagens passam a ecoar para todos na mesma sala.

O launcher local continua existindo como fallback de teste ou para uma sessao temporaria.

Para distribuir a extensao ja configurada com o relay online, gere o pacote assim:

```bash
DICE_ROOM_DEFAULT_RELAY=wss://demiplane-dice-room-relay.SEUSUBDOMINIO.workers.dev npm run package:extension
```

## Rodar o relay durante a sessao

Enquanto nao houver um relay 24/7, uma pessoa da mesa pode hospedar o servidor durante o jogo. Para mesas remotas, o launcher tenta criar um tunel publico temporario automaticamente. Esse e o fluxo esperado para jogadores fora da sua rede.

### Windows / WSL

Abra:

```text
launchers/Start Dice Room Relay.cmd
```

Ele instala dependencias se precisar, compila o servidor, inicia o relay, tenta abrir um tunel publico com Cloudflare Tunnel e abre a pagina:

```text
http://localhost:8787
```

Essa pagina mostra os enderecos para copiar no campo Relay da extensao. Para a mesa online, use o endereco publico `wss://...trycloudflare.com` quando ele aparecer. O primeiro uso pode baixar `cloudflared` para `.tools/`; depois ele reaproveita esse arquivo.

### macOS / Linux

```bash
./launchers/start-dice-room-relay.sh
```

Tambem existe o comando direto:

```bash
npm run host:relay
```

Por padrao, o relay escuta em todas as interfaces da maquina e sempre mostra:

```text
ws://localhost:8787
```

Para jogadores no mesmo computador, `localhost` funciona. Para jogadores remotos, use o endereco publico do tunel. Esse endereco temporario muda a cada vez que o relay e reiniciado, entao o narrador deve copiar o novo link para os jogadores no comeco da sessao. Exemplos:

- Tunel temporario automatico: `wss://ALGUMA-COISA.trycloudflare.com`, mostrado na pagina de status.
- LAN: `ws://IP-DO-HOST:8787`, mostrado na pagina de status, se todos estiverem na mesma rede e firewall/roteador permitirem.
- Deploy depois: um host 24/7 com WebSocket e, idealmente, `wss://`.

Cada jogador deve colocar o mesmo endereco no campo `Relay` do popup da extensao.

Se quiser desativar o tunel automatico e rodar apenas local/LAN:

```bash
DICE_ROOM_TUNNEL=0 npm run host:relay
```

No Windows PowerShell:

```powershell
$env:DICE_ROOM_TUNNEL="0"; npm run host:relay
```

## Modo local

A extensao funciona mesmo antes de entrar em uma sala. Na ficha do Demiplane, ela continua capturando rolagens locais para testes, para a opcao `Mostrar minhas rolagens` e para mostrar interpretacoes especiais como falha bestial ou critico bestial.

Sem relay conectado, nada e enviado para outros jogadores. Ao conectar em um relay local, tunel temporario ou servidor online, as rolagens passam a ecoar normalmente para quem estiver no mesmo nome/senha de sala.

## Usar servidor online

O fluxo online usa a mesma extensao e o mesmo campo `Relay`. A diferenca e que, em vez de um endereco local como `ws://localhost:8787`, todos usam um endereco publico como:

```text
wss://dice-room.seudominio.com
```

Para deploy, rode o pacote `server` em qualquer host que suporte WebSocket. Configure:

```text
PORT=8787
HOST=0.0.0.0
PUBLIC_RELAY_URL=wss://dice-room.seudominio.com
```

`PUBLIC_RELAY_URL` so muda o endereco exibido na pagina de status; o transporte da extensao continua sendo definido pelo campo `Relay`.

## Gerar pacote da extensao

Para gerar os pacotes instalaveis:

```bash
npm run package:extension
```

Os arquivos saem em:

```text
artifacts/demiplane-dice-room-<versao>-chromium.zip
artifacts/demiplane-dice-room-<versao>-firefox.zip
```

Para instalar em modo desenvolvedor, extraia o zip e carregue a pasta extraida que contem `manifest.json`.

## Navegadores

### Chrome

Suportado pelo build atual. Use `chrome://extensions`, ative Developer Mode e carregue `extension/dist` ou a pasta extraida do zip.

### Edge

Deve funcionar com o mesmo pacote Chromium. O Edge documenta sideload de extensoes com Developer Mode e Load unpacked.

### Opera / Opera GX

Deve funcionar com o mesmo pacote Chromium. O Opera documenta o fluxo `opera:extensions`, Developer Mode e Load Unpacked Extension.

### Firefox

Use o pacote `firefox.zip`. Ele troca o background `service_worker` do Chromium por `background.scripts` com modulo, que e o formato compativel com Firefox WebExtensions. Para uso local, carregue o zip/pasta temporariamente em `about:debugging`. Para distribuicao permanente, o Firefox normalmente exige assinatura pelo fluxo oficial de extensoes.

## Fontes oficiais

- Chrome Extensions: https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world
- Microsoft Edge sideload: https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/getting-started/extension-sideloading
- Opera extension testing: https://help.opera.com/en/extensions/testing/
- MDN background manifest: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background
