# Hosting and Browser Support

## Fluxo recomendado: relay online

Para mesas remotas, o fluxo mais simples e usar um relay online 24/7. Com isso, ninguem precisa abrir o `.cmd` antes da sessao: todos instalam a extensao, usam o mesmo endereco `wss://...`, informam a chave do relay quando houver, e entram na sala pelo nome e senha combinados.

O pacote `relay-cloudflare` prepara esse modo usando Cloudflare Workers + Durable Objects, que mantem uma instancia isolada por sala. Cada sala aceita ate 10 jogadores conectados.

```bash
relay-cloudflare/node_modules/.bin/wrangler login
relay-cloudflare/node_modules/.bin/wrangler secret put DICE_ROOM_RELAY_KEY --name demiplane-dice-room-relay
npm run deploy:relay:cloudflare
```

Use uma chave longa e aleatoria no secret `DICE_ROOM_RELAY_KEY`. Essa chave nao deve ser versionada no Git. O deploy retorna uma URL HTTPS. No campo `Relay` da extensao, use a mesma URL como WebSocket seguro:

```text
wss://demiplane-dice-room-relay.SEUSUBDOMINIO.workers.dev
```

Depois disso, o fluxo de uso fica:

1. O narrador abre a ficha, abre a extensao, escolhe nome da sala e senha, e clica em `Criar sala` / `Conectar`.
2. Os jogadores usam o mesmo nome de sala e a mesma senha, e clicam em `Entrar em sala` / `Conectar`.
3. Quem quiser usar relay proprio abre `Configuracoes avancadas` e troca Relay/chave.
4. As rolagens passam a ecoar para todos na mesma sala.

O launcher local continua existindo como fallback de teste ou para uma sessao temporaria.

Para distribuir a extensao ja configurada com o relay online, gere o pacote assim:

```bash
DICE_ROOM_DEFAULT_RELAY=wss://demiplane-dice-room-relay.SEUSUBDOMINIO.workers.dev npm run package:extension
```

Para uma versao comunitaria plug and play, voce tambem pode gerar o pacote com uma chave padrao:

```bash
DICE_ROOM_DEFAULT_RELAY=wss://demiplane-dice-room-relay.SEUSUBDOMINIO.workers.dev DICE_ROOM_DEFAULT_RELAY_KEY=sua-chave npm run package:extension
```

Chave dentro de pacote publico nao e segredo. Ela serve apenas como chave comunitaria rotacionavel. Se precisar de uma mesa privada de verdade, distribua uma chave fora da extensao publica ou peca que o grupo configure o proprio Worker/relay local.

## Limites do relay comunitario

Os limites foram escolhidos para bloquear spam sem punir mesa normal:

- 10 jogadores por sala.
- 20 pedidos pendentes de entrada por sala.
- 30 rolagens por minuto por jogador, com burst de 15.
- 180 rolagens por minuto por sala, com burst de 60.
- Movimento de dados: cliente envia ate cerca de 15/s; relay aceita 30/s por jogador e 180/s por sala.
- Limpar dados: 12 vezes por minuto pelo narrador.
- Reconexoes: 30 a cada 5 minutos por cliente/sala, com burst de 10.

O relay descarta excesso de movimento visual silenciosamente. Excesso de rolagens ou acoes administrativas recebe `rate_limited` e a conexao continua aberta.

No relay Node local, `DICE_ROOM_MAX_ROOMS` e `DICE_ROOM_MAX_CONNECTIONS` podem ajustar limites globais de processo. No Cloudflare, use os dashboards/alerts da conta para acompanhar uso do Worker e configure notificacoes de limite no painel da Cloudflare.

## Relay protegido

O relay aceita uma chave opcional. Quando o secret `DICE_ROOM_RELAY_KEY` existe no Cloudflare Worker, toda conexao WebSocket precisa enviar a mesma chave no parametro `key`. A extensao faz isso automaticamente a partir do campo `Chave do relay`.

Exemplo de URL final gerada internamente pela extensao:

```text
wss://demiplane-dice-room-relay.SEUSUBDOMINIO.workers.dev?room=HASH_DA_SALA&key=CHAVE
```

No relay local Node.js, a mesma regra funciona se a variavel `DICE_ROOM_RELAY_KEY` estiver definida. Sem essa variavel, o relay local continua aberto para facilitar testes.

```bash
DICE_ROOM_RELAY_KEY=sua-chave npm run host:relay
```

## Distribuicao gratuita

O caminho gratuito mais simples e publicar os ZIPs em um GitHub Release do proprio projeto:

```text
artifacts/demiplane-dice-room-<versao>-chromium.zip
artifacts/demiplane-dice-room-<versao>-firefox.zip
```

Esse modelo nao cobra nada, mas os navegadores Chromium continuam exigindo instalacao por modo desenvolvedor quando a extensao vem por ZIP. Tambem nao ha atualizacao automatica: quando uma nova versao sair, os jogadores baixam o ZIP novo e carregam a pasta atualizada.

Para instalacao com botao unico e atualizacao automatica, o caminho e loja de extensoes. A publicacao em loja pode ter exigencias de conta, revisao, assinatura e politicas de privacidade conforme o navegador.

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
wss://demiplane-dice-room-relay.foxbyron.workers.dev
```

Este projeto tambem mantem um relay Cloudflare Workers publicado em:

```text
https://demiplane-dice-room-relay.foxbyron.workers.dev
```

Para outro deploy proprio, rode o pacote `server` em qualquer host que suporte WebSocket. Configure:

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

## Instalar em Edge, Opera e Chromium

Para Edge, Opera e outros navegadores Chromium, use o pacote `chromium.zip`.

1. Extraia o ZIP em uma pasta fixa, por exemplo `Demiplane Dice Room`.
2. Abra a pagina de extensoes do navegador: `edge://extensions` no Edge, `opera://extensions` no Opera ou `chrome://extensions` no Chrome.
3. Ative o modo de desenvolvedor.
4. Clique em `Load unpacked` / `Carregar sem compactacao`.
5. Selecione a pasta extraida que contem o `manifest.json`.
6. Abra uma ficha do Demiplane, clique no painel `Dice Room`, abra a engrenagem e informe jogador, canal e senha.

Todos os jogadores de uma mesa devem usar o mesmo canal e a mesma senha. O relay padrao do pacote ja aponta para:

```text
wss://demiplane-dice-room-relay.foxbyron.workers.dev
```

Se precisar usar outro relay, abra `Configuracoes avancadas` na extensao e informe o endpoint/chave.

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
