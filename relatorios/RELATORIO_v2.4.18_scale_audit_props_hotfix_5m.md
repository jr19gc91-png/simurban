# TerraNova-NewCore v2.4.18 — Scale Audit + Props Hotfix 5m/u

## Base

- Base usada: `TerraNova-NewCore-v2.4.17-crosswalk-building-scale-hotfix-5m.zip`.
- Escopo fechado: corrigir itens ainda fora de escala sem mexer no `ZoningSystem` estrutural nem refazer RoadCore.

## Problemas encontrados

1. Paradas de ônibus, abrigo, placas e preview ainda usavam medidas antigas em unidades diretas.
2. Marcadores TMPE/semáforo/pare/preferencial estavam grandes demais para escala 1u = 5m.
3. Marcadores de eventos/acidentes estavam fora de escala.
4. Árvores, arbustos, rochas naturais e brush de árvores/rochas do mapa ainda usavam escala antiga.
5. Driveway visual do lote aceitava largura/profundidade máxima em unidade direta, criando acessos grandes demais.
6. Renderizadores legados/fallback de trilho e via ainda tinham geometrias fixas antigas.

## Correções aplicadas

- `TransitSystem.js`: paradas, abrigos, placas, preview, offset de linhas e raio de snap convertidos para escala métrica. Cobertura mantida como 850m reais via `m(850)`.
- `TrafficControlSystem.js`: postes, cabeças de semáforo, luzes, placa PARE e preferencial convertidos com `m()`.
- `EventSystem.js`: cones/marcadores de incidente convertidos com `m()`.
- `MapGenerator.js`: árvores, arbustos, rochas e brush natural passaram a usar `UNITS_PER_METER` para não ficarem gigantes no mapa 5m/u.
- `ZoningSystem.js`: driveway visual limitado por `m(10)`/`m(11)`. Fluxo de geração de zoneamento não foi alterado.
- `RailSystem.js` e `RoadSystem.js`: renderizadores legados/fallback recalibrados para não ressuscitar escala antiga se forem chamados.
- Versão/cache atualizado para v2.4.18.

## Validação

- `npm run check`: OK (`checked=38`).
- `npm run audit`: OK, maior módulo abaixo de 1200 linhas.
- `npm run smoke`: não executado; Playwright não está instalado no ambiente.

## Observação

Terreno, água, nuvens, céu e efeitos de horizonte não foram reduzidos, porque são elementos de escala macro do mapa e não props urbanos.
