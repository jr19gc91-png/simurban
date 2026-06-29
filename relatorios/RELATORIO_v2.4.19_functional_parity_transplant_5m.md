# TerraNova-NewCore v2.4.19 — Functional Parity Transplant 5m/u

Base: `TerraNova-NewCore-v2.4.18-scale-audit-props-hotfix-5m.zip`.

## Objetivo

Continuar o transplante de paridade funcional do jogo modular para o NewCore sem impor teto artificial de 1200 linhas por módulo. A regra passa a ser pragmática: manter modularidade quando ajudar manutenção, mas não bloquear feature funcional só para obedecer número fixo de linhas.

## Alterações principais

### Tráfego / TMPE

- Adicionado semáforo automático em cruzamentos pavimentados com 3 ou mais braços no mesmo nível.
- O controle manual do TMPE agora vence o automático.
- Se o usuário alternar um nó até `sem controle`, o sistema grava override manual e não recria semáforo automático naquele nó.
- Marcador de semáforo automático recebe base discreta para diferenciar de controle manual.

### IA de veículos

- Aumentado limite de tráfego visual de 140 para 180 veículos.
- Adicionado headway simples por mesma rota/faixa para reduzir veículos sobrepostos ou grudados.
- Veículos de emergência agora podem ser gerados quando há evento/incidente ativo.
- Emergência usa rotas compatíveis com classe `emergency` e tem visual próprio procedural.

### Eventos

- Eventos ativos agora acionam resposta emergencial leve: um veículo dedicado tenta sair de uma origem urbana até o trecho afetado.
- Eventos continuam influenciando velocidade do segmento como antes.

### Trilhos / metrô / VLT

- Linhas ferroviárias passam a guardar `railMode` conforme modo ativo: `train`, `metro` ou `vlt`.
- Composição por modo:
  - trem: 12 carros;
  - metrô: 6 carros;
  - VLT: 4 carros.
- Capacidade operacional e custo/receita passam a respeitar o número de carros.
- Cores/fare padrão ajustados por modo.

### Escala funcional

- Métricas de ônibus e trilho passaram a converter distância por `meters()` antes de calcular km.
- Fallback de capacidade de prédios antigos/sem capacidade salva agora converte largura, profundidade e altura para metros reais.

### Auditoria modular

- Removida a mentalidade de teto 1200 linhas.
- `audit-modules.mjs` agora só alerta módulo acima de 5000 linhas, sem bloquear o transplante funcional.
- Continua bloqueando `game.js` monolítico na raiz.

## Arquivos alterados

- `src/game/GameState.js`
- `src/systems/TrafficControlSystem.js`
- `src/systems/VehicleSystem.js`
- `src/systems/TransitSystem.js`
- `src/systems/RailSystem.js`
- `src/systems/simulation/SimulationAccess.js`
- `src/map/MapGenerator.js`
- `tools/audit-modules.mjs`
- `index.html`
- `README.md`
- `package.json`
- `iniciar-terra-nova-bazzite.sh`
- `iniciar-terra-nova-windows.bat`

## Preservado

- `ZoningSystem.js` não recebeu alteração nesta rodada.
- RoadCore visual/base da v2.4.18 preservado.
- Correções de escala visual da v2.4.18 preservadas.

## Validação

- `npm run check`: passou (`checked=38`).
- `npm run audit`: passou (`modules=38`, `totalLines=11998`, `maxModuleLines=1189`).
- `npm run smoke`: não executado porque Playwright não está instalado no ambiente.

## Pendência honesta

Ainda não é paridade total do modular antigo. Esta rodada avança blocos funcionais de tráfego, TMPE automático, emergência e trilhos, mas ainda faltam para paridade pesada:

- conectores faixa-a-faixa reais;
- fases manuais completas de semáforo;
- prioridade com conflito real entre fluxos;
- rotatórias;
- AMV/chaves ferroviárias;
- passageiros/cidadãos individualizados mais completos;
- transporte com compra/modelo de frota na UI.
