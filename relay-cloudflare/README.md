# Cloudflare Relay

Relay online para o Demiplane Dice Room. Ele permite que a extensao use um endereco publico `wss://...` sem que alguem da mesa precise abrir o launcher local.

## Desenvolvimento local

```bash
npm run dev:relay:cloudflare
```

O Wrangler mostra uma URL local. Use o equivalente WebSocket no campo `Relay` da extensao.

## Deploy

Entre na sua conta Cloudflare pelo Wrangler:

```bash
npx wrangler login
```

Depois publique:

```bash
npm run deploy:relay:cloudflare
```

O deploy retorna uma URL parecida com:

```text
https://demiplane-dice-room-relay.SEUSUBDOMINIO.workers.dev
```

Na extensao, use a mesma URL com WebSocket seguro:

```text
wss://demiplane-dice-room-relay.SEUSUBDOMINIO.workers.dev
```

Para gerar um instalavel da extensao que ja venha apontando para esse relay:

```bash
DICE_ROOM_DEFAULT_RELAY=wss://demiplane-dice-room-relay.SEUSUBDOMINIO.workers.dev npm run package:extension
```

O launcher local continua funcionando como fallback para teste, mas o fluxo normal da mesa remota pode usar esse relay online.
