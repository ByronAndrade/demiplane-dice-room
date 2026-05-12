# Server

Espaco reservado para o relay realtime.

## Plano tecnico

- Node.js com TypeScript.
- WebSocket usando `ws`.
- Salas identificadas por hash de canal/senha.
- Validacao de payload.
- Broadcast para clientes da mesma sala.
- Sem persistencia por padrao.

## Eventos

- `hello`: cliente entra em uma sala.
- `roll`: cliente publica uma rolagem.
- `presence`: mudanca de presenca.
- `error`: erro de validacao ou conexao.

## Proxima decisao

Escolher se o relay de producao ficara em Cloudflare Workers, Fly.io, Render, Railway, Supabase Realtime ou outro servico.
