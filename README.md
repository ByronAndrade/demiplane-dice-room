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

## Status

Projeto iniciado com documentacao tecnica e de produto. A proxima etapa e implementar um prototipo da extensao com captura por `MutationObserver` e um relay WebSocket local.
