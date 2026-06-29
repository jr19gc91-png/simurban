// Teste de fumaça / regressão do NewCore (headless, Playwright).
// Usa regex de versão flexível para sobreviver a bumps de versão.
// Uso: node tools/smoke-newcore.mjs   (sobe servidor próprio em :8137)
//
// Requisitos no ambiente do Jonathan (Bazzite): playwright + chromium instalados.
// Playwright é buscado no projeto e, se necessário, por PW_INDEX.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const PORT = process.env.PW_PORT || '8137';
const PW_INDEX = process.env.PW_INDEX || null;
const PYTHON = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const CHROME_PATH = process.env.CHROME_PATH || null;
const VERSION_RE = /TerraNova-NewCore-v\d+\.\d+/; // flexível: não casa string literal

function assert(cond, msg) { if (!cond) throw new Error('FALHOU: ' + msg); console.log('  ok - ' + msg); }

const server = spawn(PYTHON, ['-m', 'http.server', PORT, '--bind', '127.0.0.1'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1600));

let exitCode = 0;
let chromium;
try {
  try {
    const require = createRequire(import.meta.url);
    ({ chromium } = await import(require.resolve('playwright')));
  } catch (localError) {
    if (!PW_INDEX) throw localError;
    ({ chromium } = await import(PW_INDEX));
  }
} catch (e) {
  console.error('Playwright não encontrado. Instale com npm i -D playwright ou defina PW_INDEX. Smoke test NÃO executado.');
  server.kill();
  process.exit(2);
}

const launchOptions = { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] };
if (CHROME_PATH) launchOptions.executablePath = CHROME_PATH;
const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({ viewport: { width: 1400, height: 880 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console.error ' + m.text()); });

try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1200);

  const res = await page.evaluate(async () => {
    const tn = window.TerraNovaNewCore; const g = tn.gameShell;
    const meshes = (grp) => { let n = 0; grp.traverse(o => { if (o.isMesh) n++; }); return n; };
    g.startCityMode();
    const R = g.systems.roads;
    const mk = (x, z) => ({ x, y: g.map.getHeightAt(x, z), z });
    // Vias longas retas (lotes longe das pontas dos segmentos → passam no cleanup).
    R.handleClick(mk(-420, -60)); R.handleClick(mk(420, -60)); R.resetInteraction();
    R.handleClick(mk(-420, 140)); R.handleClick(mk(420, 140)); R.resetInteraction();
    const Z = g.systems.zoning;
    for (let i = 0; i < 9; i++) Z.paintAt(mk(-360 + i * 90, -60), 'residential', 'both');
    for (let i = 0; i < 9; i++) Z.paintAt(mk(-360 + i * 90, 140), 'commercial', 'both');
    g.systems.buildings.ensureBuildings({ immediate: true });
    // Igual ao fluxo real (InputController.paintZone): NÃO passar roads:true após zonear,
    // senão cleanupNetwork mescla nós e os lotes recém-criados perdem o roadId.
    g.rebuildCitySystems({ zoning: true, buildings: true, vehicles: true });

    // TMPE — usa um nó de via real (robusto a geometria)
    g.setTool('tmpe'); g.setTmpeMode('signals');
    const anyNode = g.state.networks.roadNodes[0];
    if (anyNode) g.handleTrafficControlClick({ x: anyNode.x, y: g.map.getHeightAt(anyNode.x, anyNode.z), z: anyNode.z }, 'auto');
    const tcSummary = g.systems.traffic.summary();
    const tcMeshes = meshes(g.groups.trafficControls);

    // view layer
    g.toggleViewLayer('buildings');
    const buildingsHidden = g.groups.buildings.visible === false;
    g.toggleViewLayer('buildings');

    // panels
    const panelLens = {};
    for (const k of ['population', 'finance', 'transport', 'lines', 'vehicles', 'traffic', 'graphs']) {
      tn.infoPanels.toggle(k);
      panelLens[k] = (document.querySelector('#tnInfoPanel')?.innerHTML || '').length;
      tn.infoPanels.toggle(k);
    }

    // save/load round-trip
    const saveText = g.exportSaveText();
    const before = { roads: g.state.networks.roads.length, lots: g.state.zoning.length, buildings: g.state.buildings.length, signals: tcSummary.signals };
    g.importSaveObject(JSON.parse(saveText));
    const after = { roads: g.state.networks.roads.length, lots: g.state.zoning.length, buildings: g.state.buildings.length, signals: g.systems.traffic.summary().signals };

    return {
      version: tn.version,
      systems: Object.keys(g.systems).filter(s => g.systems[s]),
      roadMeshes: meshes(g.groups.roads),
      buildingMeshes: meshes(g.groups.buildings),
      tcSummary, tcMeshes, buildingsHidden,
      panelLens,
      dock: document.querySelectorAll('#tnInfoDock [data-panel]').length,
      minimapCanvas: !!document.querySelector('#tnMinimapCanvas'),
      shortcutsBtn: !!document.querySelector('#tnShortcutsBtn'),
      before, after
    };
  });

  console.log('\n[smoke] versão:', res.version);
  assert(VERSION_RE.test(res.version), 'versão casa o padrão NewCore (regex flexível)');
  assert(res.systems.includes('traffic'), 'sistema de tráfego (TMPE) presente');
  assert(['roads', 'rails', 'zoning', 'transit', 'buildings', 'vehicles', 'simulation', 'input'].every(s => res.systems.includes(s)), 'todos os sistemas-núcleo presentes');
  assert(res.roadMeshes > 0, 'vias renderizam malhas (' + res.roadMeshes + ')');
  assert(res.buildingMeshes > 0, 'construções renderizam malhas (' + res.buildingMeshes + ')');
  assert(res.tcSummary.signals >= 1, 'gestor de tráfego registra semáforo');
  assert(res.tcMeshes > 0, 'marcador de semáforo renderiza (' + res.tcMeshes + ' malhas)');
  assert(res.buildingsHidden === true, 'camada de construções alterna visibilidade');
  assert(res.dock === 7, 'dock de painéis tem 7 botões');
  assert(res.minimapCanvas, 'minimapa presente');
  assert(res.shortcutsBtn, 'botão de atalhos presente');
  for (const [k, len] of Object.entries(res.panelLens)) assert(len > 400, 'painel "' + k + '" renderiza conteúdo (' + len + ' chars)');
  assert(res.after.roads === res.before.roads, 'save/load preserva vias');
  assert(res.after.lots === res.before.lots, 'save/load preserva lotes');
  assert(res.after.buildings === res.before.buildings, 'save/load preserva construções');
  assert(res.after.signals === res.before.signals, 'save/load preserva controles de tráfego');
  assert(errors.length === 0, 'nenhum erro de runtime (' + errors.slice(0, 3).join(' | ') + ')');

  console.log('\n[smoke] TODOS OS TESTES PASSARAM ✔');
} catch (e) {
  console.error('\n[smoke] ' + e.message);
  if (errors.length) console.error('erros de página:', errors.slice(0, 6).join('\n'));
  exitCode = 1;
} finally {
  await browser.close();
  server.kill();
  process.exit(exitCode);
}
