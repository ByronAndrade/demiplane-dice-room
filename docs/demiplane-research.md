# Demiplane Research

## Pagina analisada

```text
https://app.demiplane.com/nexus/vampire/character-sheet/4dadfb67-a458-4ba8-81a0-c30a50fa54c1
```

## Achados

- O Demiplane usa Next.js e carrega a ficha como aplicacao client-side.
- A ficha de Vampire: The Masquerade tem um painel de rolagem fixo.
- O HTML inicial da pagina inclui dados da ficha, mas a rolagem acontece no cliente depois da hidratacao.
- Os bundles JavaScript mencionam um estado chamado `system--dice-state`.
- Ha um componente identificado no bundle como `CharacterSheetDiceRollOverlay`.
- Ha eventos internos de dados: `ROLL`, `REROLL`, `RESULT_MOVED`, `REROLL_UPDATED`, `VALUES_CLEARED`, `STATE_UPDATED`.
- O CSS externo do Demiplane revela classes uteis para captura visual:
  - `.dice-roller`
  - `.dice-history-main-container`
  - `.dice-history-expanded-container`
  - `.history-item-calculated__value.dice-history-name`
  - `.history-item-static__value.dice-history-successes-label`
  - `.history-item-calculated__value.dice-history-successes-value`

## Estrategia de captura recomendada

1. Esperar a pagina terminar de renderizar.
2. Procurar o container `.dice-roller`.
3. Instalar `MutationObserver` no container ou no `document.body` como fallback.
4. Quando surgir/alterar um item de historico, extrair `innerText` e campos conhecidos.
5. Normalizar o texto em um objeto `RollEvent`.
6. Criar uma assinatura da rolagem para evitar duplicatas.

## Motivos para evitar APIs internas

- APIs internas podem exigir autenticacao ou permissao do Demiplane.
- O objetivo e compartilhar apenas aquilo que o jogador ja viu na tela.
- Alterar ou chamar logica interna pode ser mais fragil e mais arriscado em termos de compatibilidade.

## Fragilidade esperada

A captura por DOM depende de classes e textos atuais. Para reduzir risco:

- Centralizar seletores em um unico modulo.
- Guardar `rawText` em todo evento.
- Ter heuristicas por sistema, com fallback generico.
- Adicionar uma tela de diagnostico na extensao mostrando o ultimo texto capturado.
