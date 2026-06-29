import { MapGenerator, NEWCORE_VERSION } from './map/MapGenerator.js';
import { GameShell } from './game/GameShell.js';
import { UISystem } from './ui/UISystem.js';
import { InfoPanels } from './ui/InfoPanels.js';
import { Minimap } from './ui/Minimap.js';
import { Shortcuts } from './ui/Shortcuts.js';
import { AssetRegistry } from './assets/AssetRegistry.js';
import { placeholderBuildingPack } from './assets/buildings/placeholderBuildingPack.js';

const mapCore = new MapGenerator({ mount: document.body });
const assetRegistry = new AssetRegistry();
assetRegistry.registerBuildingPack(placeholderBuildingPack);
const gameShell = new GameShell(mapCore, assetRegistry);
const ui = new UISystem({ gameShell, assetRegistry });
const infoPanels = new InfoPanels({ gameShell });
const minimap = new Minimap({ gameShell });
const shortcuts = new Shortcuts();

window.TerraNovaNewCore = {
  version: NEWCORE_VERSION,
  mapCore,
  gameShell,
  assetRegistry,
  ui,
  infoPanels,
  minimap,
  shortcuts
};

console.info(`[TerraNova] ${NEWCORE_VERSION} carregado.`);

// v2.3.19.3: guarda contra boot sem interface e estados visuais hibridos.
// Se algum ajuste de CSS/fluxo deixar o jogo sem start/generator/city, força a tela inicial.
window.setTimeout(() => {
  const body = document.body;
  const hasMode = body.classList.contains('start-mode') || body.classList.contains('generator-mode') || body.classList.contains('city-mode');
  if (!hasMode) {
    body.classList.add('app-ready', 'start-mode');
    body.classList.remove('generator-mode', 'city-mode');
    if (ui) {
      ui.flow = 'start';
      ui.render?.();
    }
    console.warn('[TerraNova] UI boot guard ativado: fluxo visual restaurado para tela inicial.');
  }
}, 350);
