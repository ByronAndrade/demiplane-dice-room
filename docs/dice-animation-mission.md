# Missao da instancia: animacao dos dados

Esta instancia esta concentrada exclusivamente no efeito visual de rolagem dos dados na extensao. Ha outra instancia trabalhando no projeto, entao o escopo aqui deve permanecer estreito e evitar refatores fora da camada de animacao/captura necessaria para esse efeito.

## Objetivo

Transformar a animacao atual em uma rolagem visual fiel aos dados do Demiplane para Vampire: The Masquerade:

- Cada dado animado deve parecer um d10/decaedro, nao um token generico.
- Dados normais devem ser pretos com escrita em vermelho sangue.
- Dados de hunger devem ser vermelhos sangue com escrita preta.
- A animacao deve preservar o resultado capturado: valor, tipo do dado e interpretacao especial.

Nota de vocabulario: "normal" na conversa da mesa corresponde ao `regular` no codigo; "hunger" tambem pode aparecer informalmente como "hanger".

## Fluxo esperado

O jogador fonte rola no Demiplane. A extensao captura o card/historico da rolagem, extrai os dados e publica o evento estruturado para a sala. Os outros jogadores nao recebem um video ou estado fisico da animacao; eles recebem o mesmo resultado de rolagem e a extensao local deles gera a animacao equivalente, terminando nos mesmos valores e tipos de dados.

## Fronteiras desta instancia

- Editar preferencialmente `extension/src/content.ts`, onde ficam captura, painel e camada visual da animacao.
- Documentar decisoes neste arquivo quando isso ajudar a manter o foco.
- Nao alterar relay, popup, empacotamento ou arquitetura geral, a menos que a animacao precise diretamente.
- Nao reverter mudancas existentes no repositorio, porque podem pertencer a outra instancia.

## Primeira entrega

Reformar a camada visual da animacao para que os dados animados tenham leitura clara de d10/decaedro e diferenciem visualmente `regular` e `hunger` com as paletas corretas.
