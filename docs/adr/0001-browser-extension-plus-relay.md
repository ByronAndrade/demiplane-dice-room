# ADR 0001: Browser Extension Plus Relay

## Status

Accepted

## Contexto

O Demiplane mostra rolagens apenas para o usuario que esta interagindo com a ficha. Queremos compartilhar esses resultados entre jogadores sem alterar a ficha no servidor do Demiplane e sem depender de uma integracao oficial.

Uma extensao de navegador consegue observar a pagina local, mas nao consegue enviar dados diretamente para extensoes instaladas em outros computadores sem um ponto comum de comunicacao.

## Decisao

Usaremos uma extensao de navegador para capturar rolagens e um relay realtime para distribuir eventos entre jogadores no mesmo canal.

Para o MVP, a captura sera feita pelo DOM renderizado. O relay sera simples, baseado em WebSocket, e nao armazenara historico por padrao.

## Consequencias

Vantagens:

- Baixa invasividade.
- Nao depende de APIs privadas do Demiplane.
- Permite validar rapido com uma mesa real.
- Pode ser evoluido para criptografia local.

Desvantagens:

- Captura por DOM pode quebrar se o Demiplane mudar a UI.
- O sistema nao prova que a rolagem e autentica.
- Exige instalar extensao e manter um relay disponivel.

## Alternativas consideradas

- Integracao oficial com Demiplane: ideal, mas nao disponivel no momento.
- Scraping por API interna: mais fragil e potencialmente problematica.
- Compartilhamento peer-to-peer puro: adiciona complexidade de NAT, sinalizacao e suporte entre navegadores.
