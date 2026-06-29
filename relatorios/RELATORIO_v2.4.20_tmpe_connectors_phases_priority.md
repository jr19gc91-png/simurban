# Terra Nova NewCore v2.4.20 — TMPE conectores, fases e prioridade

Base: v2.4.19 functional parity transplant.

## Implementado

- TMPE com modo **Fases**: auto, leste-oeste, norte-sul, tudo vermelho e tudo verde.
- TMPE com modo **Conectores** por nó: livre, só reto, sem conversão à esquerda e só direita.
- TMPE com modo **Prioridade**: preferencial por via larga, pare na via menor, preferencial por via rápida.
- `TrafficControlSystem.redForHeading()` agora recebe o segmento de aproximação e aplica prioridade por segmento.
- `RoadSystem.findPath()` considera bloqueios de conversão do TMPE ao montar rotas quando possível.
- `VehicleSystem` usa conector faixa-a-faixa para mirar a faixa de saída antes do nó e frear em conversões bloqueadas.
- UI do TMPE expandida sem submenu novo e sem mexer no `ZoningSystem.js`.

## Preservado

- Zoneamento não foi refeito.
- Escala 5m/u da v2.4.18 mantida.
- Semáforos automáticos da v2.4.19 mantidos, com manual vencendo automático.

## Limitações conhecidas

- Os conectores ainda são por modo de nó, não por desenho individual de cada par de faixa na interface.
- O Dijkstra foi adaptado para respeitar conversões, mas ainda não usa estado completo por faixa como um TMPE final.
- A visualização dos conectores é simples; precisa de overlay mais claro na próxima rodada.
