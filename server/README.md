# Server

Relay realtime em Node.js/TypeScript. Ele recebe conexoes WebSocket, agrupa clientes por hash de canal/senha, retransmite rolagens apenas para a mesma sala e mantem um historico curto em memoria.

## Scripts

```bash
npm run host:relay
npm run dev --workspace server
npm run build --workspace server
npm run start --workspace server
```

Para uso durante o jogo, prefira `npm run host:relay` ou os launchers em `launchers/`. Eles iniciam o relay, tentam abrir um tunel publico temporario para jogadores remotos e abrem a pagina de status.

Por padrao o servidor escuta em:

```text
ws://localhost:8787
```

Tambem existe um healthcheck HTTP em:

```text
http://localhost:8787/health
```

A pagina amigavel do relay fica em:

```text
http://localhost:8787
```

Ela mostra `ws://localhost:8787`, os IPs de rede local detectados, o tunel publico temporario `wss://...trycloudflare.com` quando estiver pronto e, se configurado, `PUBLIC_RELAY_URL` para servidor online.

O launcher usa Cloudflare Tunnel em modo temporario. Se `cloudflared` nao estiver instalado, ele tenta baixar o binario oficial para `.tools/`. O endereco `wss://...trycloudflare.com` muda a cada reinicio. Para desligar esse comportamento e rodar apenas local/LAN:

```bash
DICE_ROOM_TUNNEL=0 npm run host:relay
```

## Eventos

- `hello`: cliente entra em uma sala.
- `roll`: cliente publica uma rolagem.
- `presence`: servidor informa participantes conectados.
- `error`: servidor informa erro de validacao ou estado.

## Notas

O relay nao persiste historico por padrao e nao recebe a senha em texto apos o `hello`. Para producao, a proxima evolucao recomendada e criptografar o payload da rolagem no cliente usando uma chave derivada da senha da sala.

O historico atual guarda as ultimas 100 rolagens por sala enquanto o processo do relay estiver ativo. Ao reiniciar o servidor, esse historico e apagado.
