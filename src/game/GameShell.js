import { MapAdapter } from '../map/MapAdapter.js';
import { createInitialGameState, serializeGameState } from './GameState.js';
import { makeMaterialSet } from '../utils/Materials.js';
import { RoadSystem } from '../systems/RoadSystem.js';
import { RailSystem } from '../systems/RailSystem.js';
import { ZoningSystem } from '../systems/ZoningSystem.js';
import { BuildingSystem } from '../systems/BuildingSystem.js';
import { VehicleSystem } from '../systems/VehicleSystem.js';
import { SimulationSystem } from '../systems/SimulationSystem.js';
import { TransitSystem } from '../systems/TransitSystem.js';
import { TrafficControlSystem } from '../systems/TrafficControlSystem.js';
import { EventSystem } from '../systems/EventSystem.js';
import { InputController } from '../systems/InputController.js';
import { m } from '../utils/Scale.js';

export class GameShell extends EventTarget {
  constructor(mapCore, assetRegistry) {
    super();
    this.mapCore = mapCore;
    this.map = new MapAdapter(mapCore);
    this.assets = assetRegistry;
    this.state = createInitialGameState(this.map);
    this.materials = makeMaterialSet(this.mapCore.THREE);

    this.groups = {
      construction: new this.mapCore.THREE.Group(),
      roads: new this.mapCore.THREE.Group(),
      rails: new this.mapCore.THREE.Group(),
      transit: new this.mapCore.THREE.Group(),
      zones: new this.mapCore.THREE.Group(),
      buildings: new this.mapCore.THREE.Group(),
      vehicles: new this.mapCore.THREE.Group(),
      trafficControls: new this.mapCore.THREE.Group(),
      events: new this.mapCore.THREE.Group(),
      debug: new this.mapCore.THREE.Group()
    };

    for (const [name, group] of Object.entries(this.groups)) {
      group.name = `newcore-${name}`;
      this.mapCore.addToScene(group);
    }

    this.systems = {
      roads: new RoadSystem({ game: this, materials: this.materials }),
      rails: null,
      zoning: null,
      transit: null,
      buildings: null,
      vehicles: null,
      simulation: null,
      traffic: null,
      events: null,
      input: null
    };
    this.systems.rails = new RailSystem({ game: this, materials: this.materials });
    this.systems.zoning = new ZoningSystem({ game: this, roadSystem: this.systems.roads, materials: this.materials });
    this.systems.transit = new TransitSystem({ game: this, roadSystem: this.systems.roads, materials: this.materials });
    this.systems.buildings = new BuildingSystem({ game: this, assetRegistry: this.assets });
    this.systems.vehicles = new VehicleSystem({ game: this, roadSystem: this.systems.roads, railSystem: this.systems.rails, materials: this.materials });
    this.systems.simulation = new SimulationSystem({ game: this, buildingSystem: this.systems.buildings });
    this.systems.traffic = new TrafficControlSystem({ game: this, roadSystem: this.systems.roads });
    this.systems.events = new EventSystem({ game: this, roadSystem: this.systems.roads });
    this.systems.input = new InputController({ game: this });

    this.clock = new this.mapCore.THREE.Clock();
    this.animationId = null;
    this.startLoop();
  }

  startLoop() {
    const tick = () => {
      this.animationId = requestAnimationFrame(tick);
      const dt = Math.min(0.08, this.clock.getDelta());
      if (this.state.mode === 'city' && !this.state.simulation.paused) {
        this.systems.traffic.advance(dt);
        this.systems.events.advance(dt);
      }
      this.systems.simulation.update(dt);
      if (this.state.mode === 'city') {
        const cycleEnabled = this.state.settings?.dayNightCycleEnabled !== false;
        const visualHour = cycleEnabled ? (this.state.simulation.hour || 0) : 12;
        const visualMinute = cycleEnabled ? (this.state.simulation.minute || 0) : 0;
        this.mapCore.setTimeOfDay?.(visualHour, visualMinute, this.state.simulation.day || 1);
        const weather = this.mapCore.getWeatherState?.() || { rain: 0, cloud: 0, key: 'clear' };
        const isNight = visualHour >= 18 || visualHour < 6;
        this.systems.roads.updateVisualState?.({ weather, isNight });
        this.systems.buildings.updateVisualState?.({ weather, isNight });
      }
      this.systems.vehicles.update(dt);
      this.applyViewLayers();
      this.emitTick();
    };
    tick();
  }

  showMapGeneratorMode() {
    this.state.mode = 'map-generator';
    this.state.simulation.paused = true;
    this.setTool(null);
    this.refreshMapSnapshot();
  }

  startCityMode() {
    this.state.mode = 'city';
    this.state.simulation.paused = false;
    this.state.mapConfig = this.map.getConfig();
    this.state.mapStats = this.map.getStats();
    this.rebuildCitySystems({ roads: true, rails: true, zoning: true, buildings: true, vehicles: true });
    this.emitChange();
  }

  returnToGeneratorMode() {
    this.state.mode = 'map-generator';
    this.state.simulation.paused = true;
    this.setTool(null);
    this.refreshMapSnapshot();
  }

  toggleViewLayer(layer) {
    if (!this.state.viewLayers) this.state.viewLayers = {};
    this.state.viewLayers[layer] = this.state.viewLayers[layer] === false ? true : false;
    this.applyViewLayers();
    this.emitChange();
  }

  applyViewLayers() {
    const layers = this.state.viewLayers || {};
    const tool = this.state.selectedTool;
    const zoneToolsVisible = tool === 'road' || tool === 'zone';
    if (this.groups.buildings) this.groups.buildings.visible = layers.buildings !== false;
    if (this.groups.zones) this.groups.zones.visible = layers.zones !== false && zoneToolsVisible;
    if (this.groups.vehicles) this.groups.vehicles.visible = layers.vehicles !== false;
    if (this.groups.trafficControls) this.groups.trafficControls.visible = layers.trafficControls !== false;
    if (this.groups.events) this.groups.events.visible = layers.events !== false;
    this.applyGrid(layers.grid === true);
  }

  applyGrid(show) {
    if (show && !this.gridHelper) {
      const size = this.map.getWorldSize();
      const divisions = Math.max(10, Math.min(6000, Math.round(size))); // 1 divisão = 1 unidade do jogo = 5m
      const grid = new this.mapCore.THREE.GridHelper(size, divisions, 0x8fd36b, 0x3a4a38);
      grid.material.opacity = 0.18;
      grid.material.transparent = true;
      grid.material.depthTest = false;
      grid.position.y = this.map.getHeightAt(0, 0) + m(2.0);
      grid.renderOrder = 180;
      this.gridHelper = grid;
      this.mapCore.addToScene(grid);
    }
    if (this.gridHelper) this.gridHelper.visible = !!show;
  }

  handleTrafficControlClick(point, mode = 'auto') {
    const traffic = this.systems.traffic;
    if (mode === 'permissions') {
      const seg = this.systems.roads.findNearestSegment(point, 26);
      if (seg) {
        const laneIndex = Number.isFinite(this.state.tmpeLaneIndex) ? this.state.tmpeLaneIndex : -1;
        const desiredClass = this.state.tmpeLaneClass || 'bus';
        const cls = traffic.setSegmentLaneClass(seg.segment, laneIndex, desiredClass);
        const alvo = laneIndex >= 0 ? `faixa ${laneIndex + 1}` : 'segmento inteiro';
        this.state.inspector.text = `Classe ${alvo}: ${this.systems.roads.getLaneClassLabel(cls)}.`;
        this.emitChange();
        return true;
      }
      this.state.inspector.text = 'Nenhuma via próxima para alterar classe do segmento.';
      this.emitChange();
      return false;
    }
    const specialNodeMode = ['phases', 'connectors', 'priority'].includes(mode);
    if (specialNodeMode) {
      const node = this.systems.roads.findNearestNode(point, 42);
      if (!node) {
        this.state.inspector.text = 'Nenhum nó próximo para configurar TMPE.';
        this.emitChange();
        return false;
      }
      if (mode === 'phases') {
        const plan = traffic.cycleSignalPhasePlan(node.id);
        this.state.inspector.text = `Fase do semáforo: ${traffic.getPhasePlanLabel(plan)}.`;
      } else if (mode === 'connectors') {
        const conn = traffic.cycleConnectorMode(node.id);
        this.state.inspector.text = `Conectores faixa-a-faixa: ${traffic.getConnectorModeLabel(conn)}.`;
      } else if (mode === 'priority') {
        const pri = traffic.cyclePriorityFlow(node.id);
        this.state.inspector.text = `Prioridade de fluxo: ${traffic.getPriorityModeLabel(pri)}.`;
      }
      this.emitChange();
      return true;
    }
    // padrão: cruzamento (semáforo/pare/preferencial) no nó mais próximo
    const node = this.systems.roads.findNearestNode(point, 40);
    if (node) {
      const type = traffic.cycleNode(node.id);
      const label = { none: 'sem controle', signals: 'semáforo', stop: 'pare (parada obrigatória)', yield: 'preferencial' }[type];
      this.state.inspector.text = `Cruzamento: ${label}.`;
      this.emitChange();
      return true;
    }
    // se não há nó próximo, tenta classe do segmento como fallback
    const seg = this.systems.roads.findNearestSegment(point, 24);
    if (seg) {
      const laneIndex = Number.isFinite(this.state.tmpeLaneIndex) ? this.state.tmpeLaneIndex : -1;
      const cls = traffic.cycleSegmentLaneClass(seg.segment, laneIndex);
      const alvo = laneIndex >= 0 ? `faixa ${laneIndex + 1}` : 'segmento inteiro';
      this.state.inspector.text = `Classe ${alvo}: ${this.systems.roads.getLaneClassLabel(cls)}.`;
      this.emitChange();
      return true;
    }
    this.state.inspector.text = 'Aproxime de um cruzamento (nó) ou via para usar o gestor de tráfego.';
    this.emitChange();
    return false;
  }

  setTmpeMode(mode) {
    const allowed = new Set(['signals', 'permissions', 'phases', 'connectors', 'priority']);
    this.state.tmpeMode = allowed.has(mode) ? mode : 'signals';
    this.emitChange();
  }

  setTmpeLaneIndex(index) {
    const value = Number(index);
    this.state.tmpeLaneIndex = Number.isFinite(value) ? Math.max(-1, Math.min(4, Math.round(value))) : -1;
    this.emitChange();
  }

  setTmpeLaneClass(laneClass) {
    const allowed = new Set(['general', 'bus', 'emergency', 'service', 'mixed', 'bike', 'parking']);
    this.state.tmpeLaneClass = allowed.has(laneClass) ? laneClass : 'general';
    this.emitChange();
  }

  setTool(toolName) {
    this.state.selectedTool = toolName;
    if (toolName !== 'road') this.systems.roads.resetInteraction();
    if (toolName !== 'rail') this.systems.rails.resetInteraction();
    if (toolName !== 'bus-stop' && toolName !== 'bus-line') this.systems.transit.clearPreview?.();
    if (toolName !== 'rail' && toolName !== 'rail-station' && toolName !== 'rail-line') this.systems.rails.clearPreview?.();
    this.emitChange();
  }

  setRoadOptions(options = {}) {
    this.state.buildOptions = { ...this.state.buildOptions, ...options };
    if (Object.prototype.hasOwnProperty.call(options, 'roadBusLane') && options.roadBusLane) {
      this.state.buildOptions.roadParkingAllowed = false;
      this.state.buildOptions.roadLaneClass = 'bus';
    }
    if (Object.prototype.hasOwnProperty.call(options, 'roadParkingAllowed') && options.roadParkingAllowed) {
      this.state.buildOptions.roadBusLane = false;
      this.state.buildOptions.roadLaneClass = 'parking';
    }
    if (options.roadLaneClass && options.roadLaneClass !== 'bus') this.state.buildOptions.roadBusLane = false;
    if (options.roadLaneClass && options.roadLaneClass !== 'parking') this.state.buildOptions.roadParkingAllowed = false;
    if (this.state.buildOptions.roadType === 'dirt') {
      this.state.buildOptions.roadLanes = 1;
      this.state.buildOptions.roadDirection = 'twoWay';
      this.state.buildOptions.roadLaneClass = 'general';
      this.state.buildOptions.roadSpeed = Math.min(40, this.state.buildOptions.roadSpeed || 30);
      this.state.buildOptions.roadZoneEdges = false;
    }
    this.systems.roads.setRoadOptions({
      roadType: this.state.buildOptions.roadType,
      lanes: this.state.buildOptions.roadLanes,
      elevation: this.state.buildOptions.roadElevation,
      speed: this.state.buildOptions.roadSpeed,
      geometry: this.state.buildOptions.roadGeometry,
      direction: this.state.buildOptions.roadDirection,
      laneClass: this.state.buildOptions.roadLaneClass,
      snap: this.state.buildOptions.roadSnap,
      zoneable: this.state.buildOptions.roadZoneEdges,
      zoneLeft: this.state.buildOptions.roadZoneLeft,
      zoneRight: this.state.buildOptions.roadZoneRight,
      zoneType: this.state.buildOptions.roadAutoZoneType
    });
    this.emitChange();
  }

  setRailOptions(options = {}) {
    this.state.buildOptions = { ...this.state.buildOptions, ...options };
    this.systems.rails.setRailOptions({
      kind: this.state.buildOptions.railKind,
      geometry: this.state.buildOptions.railGeometry,
      elevation: this.state.buildOptions.railElevation,
      speed: this.state.buildOptions.railSpeed,
      mode: this.state.buildOptions.railMode
    });
    this.emitChange();
  }

  setLaneClass(laneClass) {
    const allowed = new Set(['general', 'bus', 'emergency', 'service', 'mixed', 'bike', 'parking']);
    this.state.buildOptions.roadLaneClass = allowed.has(laneClass) ? laneClass : 'general';
    this.state.buildOptions.roadBusLane = this.state.buildOptions.roadLaneClass === 'bus';
    this.state.buildOptions.roadParkingAllowed = this.state.buildOptions.roadLaneClass === 'parking';
    this.setRoadOptions({ roadLaneClass: this.state.buildOptions.roadLaneClass });
  }

  setZoneType(zoneType) {
    this.state.selectedZoneType = zoneType;
    if (this.state.mode === 'city') this.state.selectedTool = 'zone';
    this.emitChange();
  }

  setZoneDensity(zoneDensity) {
    const zone = this.state.selectedZoneType || 'residential';
    if (zone === 'industrial') this.state.selectedZoneDensity = 'low';
    else {
      const allowed = new Set(['low', 'medium', 'high']);
      this.state.selectedZoneDensity = allowed.has(zoneDensity) ? zoneDensity : 'low';
    }
    if (this.state.mode === 'city') this.state.selectedTool = 'zone';
    this.emitChange();
  }

  setZoneSide(zoneSide) {
    const allowed = new Set(['both', 'left', 'right']);
    this.state.buildOptions.zoneSide = allowed.has(zoneSide) ? zoneSide : 'both';
    if (this.state.mode === 'city') this.state.selectedTool = 'zone';
    this.emitChange();
  }

  setTerrainBrush(brush) {
    const allowed = new Set(['trees', 'rocks', 'grass', 'dirt', 'gravel', 'clear', 'flatten', 'raise', 'lower']);
    this.state.selectedTerrainBrush = allowed.has(brush) ? brush : 'trees';
    if (this.state.mode === 'city') this.state.selectedTool = 'terrain';
    this.emitChange();
  }

  handleTerrainBrush(point) {
    if (!point) return false;
    const brush = this.state.selectedTerrainBrush || 'trees';
    const size = Math.max(8, Math.min(80, this.state.terrainBrushSize || 26));
    let changed = false;
    if (brush === 'clear') {
      const removed = this.mapCore.clearNaturalObstaclesInRect?.({ x: point.x, z: point.z, width: size * 2.0, depth: size * 2.0, rotation: 0, padding: 0 }) || 0;
      this.state.inspector.text = `Terreno: ${removed} árvore(s)/rocha(s) removidas.`;
      changed = true;
    } else if (brush === 'trees') {
      for (let i = 0; i < 4; i++) this.mapCore.addTreeAt?.(point.x + (Math.random() - 0.5) * size, point.z + (Math.random() - 0.5) * size, 0.8 + Math.random() * 0.6);
      this.state.inspector.text = 'Terreno: árvores plantadas.';
      changed = true;
    } else if (brush === 'rocks') {
      for (let i = 0; i < 3; i++) this.mapCore.addRockAt?.(point.x + (Math.random() - 0.5) * size, point.z + (Math.random() - 0.5) * size, 0.8 + Math.random() * 1.2);
      this.state.inspector.text = 'Terreno: rochas adicionadas.';
      changed = true;
    } else {
      const kind = brush === 'flatten' ? 'level' : brush === 'raise' ? 'fill' : brush === 'lower' ? 'cut' : brush;
      this.mapCore.addTerrainPatchAt?.(point.x, point.z, { kind, radius: size * (brush === 'flatten' ? 1.25 : 1.0) });
      this.state.inspector.text = brush === 'flatten' ? 'Terreno: platô visual criado.' : brush === 'raise' ? 'Terreno: aterro visual criado.' : brush === 'lower' ? 'Terreno: rebaixo visual criado.' : `Terreno: textura ${brush} aplicada.`;
      changed = true;
    }
    if (changed) this.emitChange();
    return changed;
  }

  setGameMode(mode) {
    if (!this.state.settings) this.state.settings = {};
    this.state.settings.gameMode = mode === 'simulation' ? 'simulation' : 'sandbox';
    if (this.state.settings.gameMode === 'simulation') this.state.settings.testTrafficEnabled = false;
    else this.state.settings.testTrafficEnabled = true;
    this.systems.vehicles.rebuild();
    this.systems.simulation.recalculateStats();
    this.emitChange();
  }

  toggleGameMode() {
    const current = this.state.settings?.gameMode || 'sandbox';
    this.setGameMode(current === 'sandbox' ? 'simulation' : 'sandbox');
  }

  setTestTrafficEnabled(enabled) {
    if (!this.state.settings) this.state.settings = {};
    this.state.settings.testTrafficEnabled = !!enabled;
    if (this.state.settings.testTrafficEnabled) this.state.settings.gameMode = 'sandbox';
    this.systems.vehicles.rebuild();
    this.emitChange();
  }


  toggleDayNightCycle() {
    if (!this.state.settings) this.state.settings = {};
    this.state.settings.dayNightCycleEnabled = this.state.settings.dayNightCycleEnabled === false;
    const sim = this.state.simulation || {};
    const visualHour = this.state.settings.dayNightCycleEnabled ? (sim.hour || 0) : 12;
    const visualMinute = this.state.settings.dayNightCycleEnabled ? (sim.minute || 0) : 0;
    this.mapCore.setTimeOfDay?.(visualHour, visualMinute, sim.day || 1);
    this.emitChange();
  }

  togglePause() {
    this.state.simulation.paused = !this.state.simulation.paused;
    this.emitChange();
  }

  setSpeed(speed) {
    this.state.simulation.speed = Math.max(1, Math.min(5, Number(speed) || 1));
    this.state.simulation.paused = false;
    this.emitChange();
  }

  refreshMapSnapshot() {
    this.state.mapConfig = this.map.getConfig();
    this.state.mapStats = this.map.getStats();
    this.emitChange();
  }

  rebuildCitySystems(flags = {}) {
    if (flags.roads) this.systems.roads.cleanupNetwork?.();
    if (flags.zoning || flags.roads) this.systems.zoning.cleanupInvalidLots?.();
    if (flags.roads) this.systems.zoning.rebuildZoneGrid?.();
    if (flags.roads) this.systems.roads.render();
    if (flags.rails) this.systems.rails.rebuild?.();
    if (flags.zoning) this.systems.zoning.render();
    if (flags.transit || flags.roads) this.systems.transit.rebuild();
    if (flags.buildings) {
      if (!flags.noSpawn) this.systems.buildings.ensureBuildings({ immediate: true });
      this.systems.buildings.render();
    }
    if (flags.transit || flags.buildings) this.systems.transit.updateMetrics();
    if (flags.vehicles) this.systems.vehicles.rebuild();
    this.systems.traffic?.render();
    this.systems.events?.render();
    this.applyViewLayers();
    if (!flags.noSimRecalc) this.systems.simulation.recalculateStats();
  }

  inspectAt(point) {
    const road = this.systems.roads.findNearestSegment(point, 18);
    if (road) {
      this.state.inspector.text = `Via ${road.segment.lanes} faixa(s) • ${Math.round(road.segment.speedKmh)} km/h • ${road.segment.direction === 'oneWay' ? 'mão única' : 'mão dupla'} • faixa ${this.systems.roads.getLaneClassLabel(road.segment.laneClass || 'general')} • nível ${road.segment.elevation || 0} • ${road.segment.geometry === 'smooth' ? 'suave' : 'reta'}`;
      this.emitChange();
      return;
    }
    const station = this.systems.rails.findNearestStation?.(point, 26);
    if (station) {
      const lines = this.state.transitLines.filter(line => line.mode === 'rail' && (line.stationIds || []).includes(station.id));
      this.state.inspector.text = `${station.name} • ${lines.length} linha(s) • estação ferroviária`;
      this.emitChange();
      return;
    }
    const rail = this.systems.rails.findNearestSegment(point, 16);
    if (rail) {
      this.state.inspector.text = `Trilho duplo • ${Math.round(rail.segment.speedKmh)} km/h • estações ${this.state.railStations?.length || 0}`;
      this.emitChange();
      return;
    }
    const stop = this.systems.transit.findNearestStop?.(point, 24);
    if (stop) {
      const lines = this.state.transitLines.filter(line => line.mode === 'bus' && (line.stopIds || []).includes(stop.id));
      this.state.inspector.text = `${stop.name} • ${lines.length} linha(s) • ônibus`;
      this.emitChange();
      return;
    }
    const lot = this.state.zoning.find(l => Math.hypot(l.x - point.x, l.z - point.z) < Math.max(l.width, l.depth) * 0.55);
    if (lot) {
      const b = this.state.buildings.find(item => item.lotId === lot.id);
      this.state.inspector.text = b ? `Lote ${lot.zone} ocupado • nível ${b.level || 1} • sat ${b.satisfaction || 0}% • valor ${b.landValue || 0} • pop ${b.residents || 0} • empregos ${b.jobs || 0}` : `Lote ${lot.zone} livre`;
      this.emitChange();
      return;
    }
    this.state.inspector.text = `Terreno • alt ${Math.round(this.map.getHeightAt(point.x, point.z))}m • inclinação ${Math.round(this.map.getSlopeAt(point.x, point.z))}°`;
    this.emitChange();
  }

  clearCity() {
    this.state.networks.roads = [];
    this.state.networks.roadNodes = [];
    this.state.networks.rails = [];
    this.state.networks.railNodes = [];
    this.state.zoning = [];
    this.state.zoneGrid = [];
    this.state.buildings = [];
    this.state.vehicles = [];
    this.state.transitStops = [];
    this.state.transitLines = [];
    this.state.transitDraft = { mode: 'bus', stopIds: [] };
    this.state.railStations = [];
    this.state.railDraft = { mode: 'rail', stationIds: [] };
    this.state.trafficControls = { nodes: {}, segments: {} };
    this.state.events = { active: [], history: [] };
    const fresh = createInitialGameState(this.map);
    this.state.simulation = { ...fresh.simulation, paused: this.state.simulation.paused, speed: this.state.simulation.speed };
    this.state.settings = { ...fresh.settings, ...(this.state.settings || {}) };
    this.systems.roads.setRoadOptions({ roadType: this.state.buildOptions.roadType, lanes: this.state.buildOptions.roadLanes, elevation: this.state.buildOptions.roadElevation, speed: this.state.buildOptions.roadSpeed, geometry: this.state.buildOptions.roadGeometry, direction: this.state.buildOptions.roadDirection, laneClass: this.state.buildOptions.roadLaneClass, snap: this.state.buildOptions.roadSnap, zoneable: this.state.buildOptions.roadZoneEdges, zoneLeft: this.state.buildOptions.roadZoneLeft, zoneRight: this.state.buildOptions.roadZoneRight, zoneType: this.state.buildOptions.roadAutoZoneType });
    this.rebuildCitySystems({ roads: true, rails: true, zoning: true, transit: true, buildings: true, vehicles: true, noSpawn: true });
    this.emitChange();
  }

  exportSaveText() {
    return JSON.stringify(serializeGameState(this.state, this.map), null, 2);
  }

  importSaveObject(save) {
    if (!save || !save.mapConfig) throw new Error('Save inválido: faltando mapConfig.');
    this.mapCore.setConfig(save.mapConfig);
    const fresh = createInitialGameState(this.map);
    this.state = {
      ...fresh,
      ...save,
      selectedTool: null,
      mapConfig: this.map.getConfig(),
      mapStats: this.map.getStats(),
      networks: {
        ...fresh.networks,
        ...(save.networks || {})
      },
      zoneGrid: Array.isArray(save.zoneGrid) ? save.zoneGrid : [],
      simulation: {
        ...fresh.simulation,
        ...(save.simulation || {})
      },
      buildOptions: {
        ...fresh.buildOptions,
        ...(save.buildOptions || {})
      },
      settings: {
        ...fresh.settings,
        ...(save.settings || {})
      },
      transitStops: save.transitStops || [],
      transitLines: save.transitLines || [],
      transitDraft: save.transitDraft || { mode: 'bus', stopIds: [] },
      railStations: save.railStations || [],
      railDraft: save.railDraft || { mode: 'rail', stationIds: [] },
      events: save.events || { active: [], history: [] }
    };
    this.systems.roads.setRoadOptions({ roadType: this.state.buildOptions.roadType, lanes: this.state.buildOptions.roadLanes, elevation: this.state.buildOptions.roadElevation, speed: this.state.buildOptions.roadSpeed, geometry: this.state.buildOptions.roadGeometry, direction: this.state.buildOptions.roadDirection, laneClass: this.state.buildOptions.roadLaneClass, snap: this.state.buildOptions.roadSnap, zoneable: this.state.buildOptions.roadZoneEdges, zoneLeft: this.state.buildOptions.roadZoneLeft, zoneRight: this.state.buildOptions.roadZoneRight, zoneType: this.state.buildOptions.roadAutoZoneType });
    this.rebuildCitySystems({ roads: true, rails: true, zoning: true, transit: true, buildings: true, vehicles: true, noSpawn: true });
    this.emitChange();
  }

  emitTick() {
    if (this.state.mode !== 'city') return;
    const now = performance.now();
    if (!this._lastTickEmit || now - this._lastTickEmit > 650) {
      this._lastTickEmit = now;
      this.emitChange();
    }
  }

  emitChange() {
    this.dispatchEvent(new CustomEvent('statechange', { detail: this.state }));
  }
}
