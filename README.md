# Terra Nova / SIMURB - NewCore v2.4.20 Functional Parity Transplant 5m/u

## Patch v2.4.20

Base: v2.4.18 Scale Audit + Props Hotfix. Sem teto artificial de 1200 linhas: a auditoria agora só alerta módulos realmente grandes por manutenção, sem bloquear transplante funcional.

- Paridade funcional avançada do tráfego: semáforos automáticos em cruzamentos pavimentados com 3+ braços.
- TMPE manual agora vence o automático; se o usuário alternar o nó para “sem controle”, o sistema não recria semáforo automático naquele nó.
- Veículos ganharam headway simples na mesma rota/faixa para reduzir sobreposição e comboio grudado.
- Eventos agora podem gerar resposta emergencial com veículo dedicado indo até o segmento afetado.
- Composições ferroviárias ajustadas por modo: trem 12 carros, metrô 6 carros e VLT 4 carros, com capacidade operacional compatível.
- Métricas de ônibus/trilho corrigidas para a escala 1 unidade = 5 m usando conversão real para km.
- Fallback de capacidade de prédios antigos/sem capacidade salva agora usa metros reais em vez de unidade compacta.
- `ZoningSystem.js` preservado.

# Terra Nova / SIMURB - NewCore v2.4.18 Crosswalk + Building Scale Hotfix 5m/u

## Patch v2.4.18

Base segura: v2.4.14/v2.4.16. A v2.4.15 continua descartada por regressão de zoneamento e orientação de faixa de pedestres.

- `ZoningSystem.js` preservado: sem reescrita, sem alteração no fluxo de pintura/geração de lotes.
- Faixa de pedestres refeita: zebra posicionada por aproximação, barras no sentido correto da travessia e sem pintura invadindo a área.
- Linha de retenção reposicionada antes da zebra.
- Marcações de faixa/centro cortadas antes da travessia para limpar o cruzamento.
- Guias de aproximação deslocadas para depois da faixa/linha de parada.
- Construções corrigidas para a escala 1 unidade = 5 m: footprint, altura e detalhes fixos convertidos com `m()`.
- Migração visual para construções antigas salvas: prédios sem `scaleVersion: '2.4.18'` são recalculados ao renderizar.
- Launchers Windows/Bazzite e cache-bust atualizados para v2.4.18.

## Patch v2.4.11

- HUD de data agora mostra dia e horário do jogo.
- Botão `Ciclo ON / 12h fixa` adicionado na barra inferior; desligado trava a iluminação visual em 12h sem parar a simulação.
- Iluminação global ajustada para visual mais cinematográfico: céu mais quente, sol mais forte, preenchimento azulado, exposição e fog refinados.
- Zoneamento passou a usar células menores e lotes multi-grid, criando áreas maiores para prédios.
- Construções maiores, com proporções variadas, mais detalhes de fachada, janelas laterais, varandas, volumes industriais, antenas, painéis solares e sujeira procedural.
- Cruzamentos receberam faixa de parada, faixas de pedestre tipo zebra e semáforos procedurais em T/X.
- Veículos de rua e composições ferroviárias agora acompanham melhor o relevo/desnível e aplicam inclinação visual nas rampas.
- Launchers Windows/Bazzite atualizados com cache-bust v2.4.7.

Base: v2.4.2 Grid/Crossing/UI Polish.

## Patch v2.4.2

- Refeita a grade de zoneamento para usar eixo local da via, sem chave global arredondada. Isso corrige lotes em escadinha, desalinhados ou com buracos em ruas diagonais/curvas.
- Ajustada a validação da primeira fileira de lotes para encostar corretamente na calçada sem invadir o asfalto.
- Cruzamentos T/X e curvas passam a usar uma tampa radial mais limpa, sem os blocos retangulares que quebravam o miolo da interseção.
- Submenus de ferramentas viraram cards maiores, com textos menos técnicos e layout mais jogável em 1366x768.
- Presets de estrada e trilho agora mostram seleção ativa.
- Corrigido o botão Pausar/Retomar, que alternava duas vezes e acabava não pausando.
- Launchers Windows/Bazzite atualizados com cache-bust v2.4.2.

Base: v2.4.1 Legacy Parity Lighting/Tools Hotfix.

# Terra Nova / SIMURB - NewCore v2.4.1 Legacy Parity Lighting/Tools Hotfix

## Patch v2.4.1

- Corrige a atmosfera NewCore: ceu passa a seguir a camera, reduz o efeito de "bola azul" no zoom distante e aumenta a iluminacao diurna/clima sem importar luz antiga.
- Reforca o ciclo dia/noite e clima dinamico com sol/lua/nuvens/chuva no renderer moderno.
- Reintroduz opcoes antigas de estrada no submenu: expressa, corredor bus, elevado, tunel, snap, zona, lados de zona, estacionamento e faixa de onibus.
- Adiciona modo Sandbox/Simulacao real: Sandbox usa trafego/linhas de teste; Simulacao depende mais da demanda da cidade.
- Mantem 1 dia de jogo = 30 minutos reais em 1x e acelera apenas o movimento visual de veiculos.
- Corrige zoneamento proximo de cruzamentos e rotacao da grade de lotes.
- Recorta marcacoes/faixas perto de cruzamentos para evitar linhas atravessando o miolo.
- Atualiza launchers Windows e Bazzite/Linux para cache-bust v2.4.1.

Base: v2.4.0 Legacy Systems Integration.

## Patch v2.4.0

- Integra comportamento e layout do SIMURB modular antigo por adaptadores NewCore, sem substituir `src/main.js` e sem monolito.
- Mantem tela inicial, gerador de mapas e HUD da cidade separados.
- Adiciona iluminacao/ciclo dia-noite/clima dinamico cinematografico feitos no renderer NewCore; sky, fog, sol, tone mapping e setup de sombras do jogo antigo nao foram importados.
- Reforca controles classicos, dock/painel lateral, grade RCI de 20m, pintura por grade, indicadores de economia/transporte e incidentes operacionais leves.
- Atualiza launchers Windows e Bazzite/Linux para cache-bust v2.4.0.

Base: v2.3.21 Controls / Road Grid / UI Fix.

# Terra Nova / SIMURB - NewCore v2.3.21 Classic Tools / Road Grid Fix

## Patch v2.3.21

- Corrigido fluxo visual exclusivo: Novo Jogo, Gerador de Mapas e Cidade nao ficam ativos ao mesmo tempo.
- HUD da cidade restaurada no padrao antigo: topbar de status, lateral esquerda de dashboards e barra inferior de ferramentas.
- Submenus das ferramentas passam a abrir compactos acima da barra inferior, sem painel fixo no lado direito.
- Ambiente moderno do NewCore preservado; terreno, render, veiculos, IA, economia e RoadCore nao foram alterados nesta rodada.

Base: v2.3.11 PageUp Levels Tools Polish.

## Patch v2.3.19

- Mantido o visual moderno do ambiente/terreno/luz do NewCore.
- Aproximada a interface de ferramentas do modo antigo.
- Painel de Estradas mais compacto: Terra, Rua, Avenida, Mão Única, faixas, velocidade, curva/reta.
- Painel de Trilhos mais compacto: Simples/Duplo, Trem/VLT/Metrô, velocidade, curva/reta.
- Níveis continuam exclusivamente por PageUp/PageDown; a UI só mostra o nível atual.
- Preview de estrada agora exibe largura real, marcações básicas e canteiro em avenida.
- Preview de trilho ajusta largura para simples/duplo/metro.
- Não foram reintroduzidos controles de nível na interface.

# Terra Nova / SIMURB - NewCore v2.3.19 Classic Click Road UI Fix

Base de trabalho: `TerraNova-NewCore-v2.3.5-visual-refine.zip`.

Esta versão mantém o NewCore modular, a tela inicial, o gerador separado da cidade, a UI por submenus e o controle de câmera estilo Cities Skylines 1.

## Patch v2.3.19

Rodada de polimento visual premium, sem reescrever sistemas:

- UI/HUD com glassmorphism mais limpo, menos brilho e melhor contraste.
- Topbar e barra inferior mais compactas e consistentes em 1366x768.
- Painel lateral direito refinado, mantendo um submenu único por ferramenta.
- Estradas com asfalto mais escuro/natural, menos plástico e mais textura sutil.
- Marcações viárias mais finas e discretas.
- Removidas linhas brancas externas das bordas da pista.
- Setas reduzidas e menos repetidas.
- Guias de aproximação em cruzamentos menos agressivas.
- Iluminação, fog, água e terreno ajustados para visual menos lavado.
- Edifícios com paleta mais natural, base/sombra, frisos e acabamento simples de fachada.
- Veículos com cores menos brinquedo, rodas, faróis/lanternas e volumes um pouco mais legíveis.
- Zonas menos opacas, poluindo menos o mapa.

## Mantido

- Three.js/WebGL.
- RoadCore atual.
- Construção de estradas/trilhos.
- Zoneamento.
- Transporte/veículos.
- Tela inicial.
- Gerador de mapas isolado da interface da cidade.
- Submenus por ferramenta no painel direito.
- Minimapa.
- Save/load JSON.
- `iniciar-terra-nova-bazzite.sh`.
- Câmera estilo Cities:
  - botão direito gira;
  - botão do meio move;
  - roda zoom;
  - WASD/setas movem;
  - Q/E giram;
  - botão esquerdo livre para ferramentas.

## Inicialização

### Windows
```bat
iniciar-terra-nova-windows.bat
```

### Bazzite/Linux
```bash
./iniciar-terra-nova-bazzite.sh
```

Use HTTP local. `file://` bloqueia módulos ES.

## Validação

```bash
bash -n iniciar-terra-nova-bazzite.sh
node tools/check-js.mjs
node tools/audit-modules.mjs
node tools/smoke-newcore.mjs
```

Nesta execução, o smoke test pode ficar como `SKIPPED` se Playwright não estiver instalado.

## Próximo foco sugerido

Agora que o visual ficou mais controlado, o próximo ganho real é atacar IA/faixas/direção dos veículos e TMPE faixa-a-faixa de verdade.


## Patch v2.3.19

- Fluxo clássico separado: Novo Jogo → Gerador de Mapas → Cidade.
- Barra inferior por categorias, mais próxima da UI antiga.
- Painel esquerdo clássico com relatórios/linhas/economia/tráfego.
- Submenus de estrada/trilho/transporte/terreno mais próximos do modo antigo.


## Patch v2.3.19

- Removidos controles de nível dos painéis de ferramentas de estrada e trilho.
- PageUp/PageDown vira a regra única para alterar nível de estrada/trilho durante construção.
- Ferramenta de trilho agora também responde a PageUp/PageDown.
- Presets ferroviários de superfície/elevado/subterrâneo foram retirados da UI para não duplicar controle.


## v2.4.20 — Functional parity TMPE connectors

- Adicionados conectores faixa-a-faixa por nó no TMPE: livre, só reto, sem esquerda e só direita.
- Adicionadas fases manuais de semáforo: automática, leste-oeste, norte-sul, tudo vermelho e tudo verde.
- Adicionada prioridade de fluxo por via larga/rápida: via principal passa, via menor reduz/para.
- Roteamento rodoviário passa a respeitar restrições de conversão quando possível.
- Veículos miram a faixa correta antes do nó usando o conector faixa-a-faixa.
