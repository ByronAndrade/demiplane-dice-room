# Product Brief

## Problema

Em mesas online que usam Demiplane para fichas de RPG, as rolagens feitas dentro da ficha ficam visiveis apenas para quem esta com aquela ficha aberta. Isso quebra a dinamica da mesa, porque os outros jogadores e o narrador nao veem imediatamente o resultado.

## Solucao proposta

Criar uma extensao de navegador que detecta os resultados das rolagens ja exibidos pelo Demiplane e os envia para uma sala compartilhada. Todos os jogadores com a extensao instalada, conectados ao mesmo canal, recebem e veem as rolagens em um painel flutuante.

## Publico

- Jogadores que usam Demiplane como ficha digital.
- Narradores que querem acompanhar rolagens sem pedir screenshots ou depender de leitura verbal.
- Mesas remotas que jogam por chamada de voz ou video.

## Experiencia desejada

1. O jogador abre a ficha no Demiplane.
2. Abre o popup da extensao.
3. Informa nome, canal e senha da mesa.
4. Clica nos atributos/pericias normalmente e rola pelo proprio Demiplane.
5. A extensao detecta o resultado e publica para a sala.
6. Os outros jogadores veem a rolagem no painel compartilhado.

## MVP

- Extensao Chrome/Chromium Manifest V3.
- Captura visual/DOM das rolagens no Demiplane.
- Canal de mesa com senha.
- Relay realtime simples.
- Painel flutuante com ultimas rolagens.
- Botao para conectar/desconectar.
- Indicador de status: desconectado, conectando, conectado, erro.

## Fora do MVP

- Validacao criptografica contra trapaça.
- Integracao oficial com APIs do Demiplane.
- Suporte a varios sistemas alem de Vampire: The Masquerade.
- Aplicativo mobile.
- Historico persistente longo.

## Riscos

- O Demiplane pode mudar classes, estrutura do DOM ou fluxo de rolagem.
- Como a captura acontece no navegador do jogador, o sistema nao e a prova de falsificacao.
- Extensoes em Manifest V3 tem restricoes de background, armazenamento e conexoes persistentes que precisam ser consideradas.

## Principio de produto

A extensao deve parecer uma camada discreta da mesa, nao uma substituicao do Demiplane. O jogador continua usando a ficha como ja usa hoje.
