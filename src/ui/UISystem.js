export class UISystem {
  constructor({ gameShell, assetRegistry }) {
    this.game = gameShell;
    this.assets = assetRegistry;
    this.flow = 'start';
    this.appMode = null;
    this.classicPanel = 'reports';
    this.bind();
    this.game.addEventListener('statechange', () => this.render());
    this.render();
    document.body.classList.add('app-ready');
  }

  $(id) { return document.getElementById(id); }

  setAppMode(mode) {
    const allowed = new Set(['start', 'generator', 'city']);
    const nextMode = allowed.has(mode) ? mode : 'start';
    const previousMode = this.appMode;
    this.appMode = nextMode;
    this.flow = nextMode;

    document.body.classList.remove('start-mode', 'generator-mode', 'city-mode');
    document.body.classList.add(`${nextMode}-mode`);
    document.body.dataset.appMode = nextMode;

    if (previousMode !== nextMode) {
      this.$('hamburgerMenu')?.classList.add('hidden');
      this.closeToolSubmenu();
    }
  }

  closeToolSubmenu() {
    const panel = this.$('toolPanel');
    if (panel) panel.dataset.activeTool = 'none';
    document.querySelectorAll('[data-tool-section]').forEach(section => {
      section.classList.toggle('active', section.dataset.toolSection === 'none');
    });
    document.querySelectorAll('[data-tool]').forEach(btn => btn.classList.remove('active'));
  }

  bind() {
    this.$('openGenerator')?.addEventListener('click', () => {
      this.setAppMode('generator');
      this.game.returnToGeneratorMode();
      this.render();
    });
    this.$('quickStartCity')?.addEventListener('click', () => {
      this.setAppMode('city');
      this.game.startCityMode();
    });
    this.$('loadGameFromStart')?.addEventListener('click', () => this.loadGameFromPrompt());
    this.$('backToStartFromGenerator')?.addEventListener('click', () => {
      this.setAppMode('start');
      this.classicPanel = 'reports';
      this.game.showMapGeneratorMode();
      this.render();
    });
    this.$('startCity')?.addEventListener('click', () => {
      this.setAppMode('city');
      this.game.startCityMode();
    });
    this.$('backToGenerator')?.addEventListener('click', () => {
      this.setAppMode('generator');
      this.game.returnToGeneratorMode();
      this.render();
    });
    this.$('hambMenu')?.addEventListener('click', () => this.$('hamburgerMenu')?.classList.toggle('hidden'));
    this.$('menuNewMap')?.addEventListener('click', () => {
      this.$('hamburgerMenu')?.classList.add('hidden');
      this.setAppMode('generator');
      this.game.returnToGeneratorMode();
      this.render();
    });
    this.$('menuBackStart')?.addEventListener('click', () => {
      this.$('hamburgerMenu')?.classList.add('hidden');
      this.setAppMode('start');
      this.classicPanel = 'reports';
      this.game.showMapGeneratorMode();
      this.render();
    });
    this.$('menuSaveGame')?.addEventListener('click', () => this.saveGameToClipboard());
    this.$('menuLoadGame')?.addEventListener('click', () => this.loadGameFromPrompt());
    this.$('menuClearCity')?.addEventListener('click', () => {
      if (confirm('Limpar vias, zonas, construções, veículos e linhas deste mapa?')) this.game.clearCity();
    });
    this.$('pauseGame')?.addEventListener('click', () => this.game.togglePause());
    this.$('gameModeToggle')?.addEventListener('click', () => this.game.toggleGameMode());
    this.$('dayNightToggle')?.addEventListener('click', () => this.game.toggleDayNightCycle());
    this.$('clearCity')?.addEventListener('click', () => {
      if (confirm('Limpar vias, zonas, construções, veículos e linhas deste mapa?')) this.game.clearCity();
    });
    this.$('clearCityInside')?.addEventListener('click', () => {
      if (confirm('Limpar vias, zonas, construções, veículos e linhas deste mapa?')) this.game.clearCity();
    });
    this.$('toolPanelCancel')?.addEventListener('click', () => this.game.setTool(null));
    this.$('tmpeOpenUpgrade')?.addEventListener('click', () => this.game.setTool('upgrade'));
    this.$('autoBusLine')?.addEventListener('click', () => this.game.systems.transit.createAutoLine());
    this.$('finishBusLine')?.addEventListener('click', () => this.game.systems.transit.finishDraftLine({ loop: true }));
    this.$('clearBusDraft')?.addEventListener('click', () => this.game.systems.transit.clearDraft());
    this.$('autoRailLine')?.addEventListener('click', () => this.game.systems.rails.createAutoLine());
    this.$('finishRailLine')?.addEventListener('click', () => this.game.systems.rails.finishDraftLine({ loop: true }));
    this.$('clearRailDraft')?.addEventListener('click', () => this.game.systems.rails.clearDraft());

    for (const id of ['generate', 'randomSeed', 'reset']) {
      this.$(id)?.addEventListener('click', () => {
        const hadCity = (this.game.state.networks?.roads?.length || 0) || (this.game.state.networks?.rails?.length || 0) || (this.game.state.buildings?.length || 0) || (this.game.state.zoning?.length || 0);
        if (hadCity) this.game.clearCity();
        window.setTimeout(() => {
          this.game.refreshMapSnapshot();
          if (this.game.state.mode === 'city') this.game.rebuildCitySystems({ roads: true, rails: true, zoning: true, buildings: true, vehicles: true, noSpawn: true });
        }, 0);
      });
    }

    document.querySelectorAll('[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.tool;
        this.game.setTool(this.game.state.selectedTool === tool ? null : tool);
      });
    });

    document.querySelectorAll('[data-classic-panel]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.classicPanel = btn.dataset.classicPanel;
        this.renderClassicPanel();
      });
    });

    document.querySelectorAll('[data-zone-type]').forEach(btn => {
      btn.addEventListener('click', () => this.game.setZoneType(btn.dataset.zoneType));
    });

    document.querySelectorAll('[data-zone-density]').forEach(btn => {
      btn.addEventListener('click', () => this.game.setZoneDensity(btn.dataset.zoneDensity));
    });

    document.querySelectorAll('[data-terrain-brush]').forEach(btn => {
      btn.addEventListener('click', () => this.game.setTerrainBrush(btn.dataset.terrainBrush));
    });

    document.querySelectorAll('[data-zone-side]').forEach(btn => {
      btn.addEventListener('click', () => this.game.setZoneSide(btn.dataset.zoneSide));
    });

    document.querySelectorAll('[data-road-type]').forEach(btn => {
      btn.addEventListener('click', () => this.game.setRoadOptions({ roadType: btn.dataset.roadType }));
    });

    document.querySelectorAll('[data-road-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset.roadPreset;
        const presets = {
          dirt: { roadType: 'dirt', roadDirection: 'twoWay', roadLanes: 1, roadSpeed: 30, roadLaneClass: 'general', roadGeometry: 'smooth', roadElevation: 0, roadZoneEdges: false, roadBusLane: false, roadParkingAllowed: false },
          'street-main': { roadType: 'street', roadDirection: 'twoWay', roadLanes: 2, roadSpeed: 50, roadLaneClass: 'general', roadGeometry: 'smooth', roadElevation: 0, roadZoneEdges: true, roadBusLane: false, roadParkingAllowed: false },
          avenue: { roadType: 'avenue', roadDirection: 'twoWay', roadLanes: 2, roadSpeed: 60, roadLaneClass: 'general', roadGeometry: 'smooth', roadElevation: 0, roadZoneEdges: true, roadBusLane: false, roadParkingAllowed: false },
          oneway: { roadType: 'street', roadDirection: 'oneWay', roadLanes: 2, roadSpeed: 50, roadLaneClass: 'general', roadGeometry: 'smooth', roadElevation: 0, roadZoneEdges: true, roadBusLane: false, roadParkingAllowed: false }
        };
        this.game.setTool('road');
        this.game.setRoadOptions(presets[preset] || presets['street-main']);
      });
    });

    document.querySelectorAll('[data-road-lanes]').forEach(btn => {
      btn.addEventListener('click', () => this.game.setRoadOptions({ roadLanes: Number(btn.dataset.roadLanes) }));
    });

    document.querySelectorAll('[data-road-speed]').forEach(btn => {
      btn.addEventListener('click', () => this.game.setRoadOptions({ roadSpeed: Number(btn.dataset.roadSpeed) }));
    });


    document.querySelectorAll('[data-road-geometry]').forEach(btn => {
      btn.addEventListener('click', () => this.game.setRoadOptions({ roadGeometry: btn.dataset.roadGeometry }));
    });

    document.querySelectorAll('[data-road-direction]').forEach(btn => {
      btn.addEventListener('click', () => this.game.setRoadOptions({ roadDirection: btn.dataset.roadDirection }));
    });

    document.querySelectorAll('[data-road-elevation]').forEach(btn => {
      btn.addEventListener('click', () => this.game.setRoadOptions({ roadElevation: Number(btn.dataset.roadElevation) }));
    });

    document.querySelectorAll('[data-road-toggle]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.roadToggle;
        const current = !!this.game.state.buildOptions?.[key];
        const options = { [key]: !current };
        if ((key === 'roadBusLane' || key === 'roadParkingAllowed') && current) options.roadLaneClass = 'general';
        this.game.setRoadOptions(options);
      });
    });

    document.querySelectorAll('[data-road-zone-side]').forEach(btn => {
      btn.addEventListener('click', () => {
        const side = btn.dataset.roadZoneSide;
        this.game.setRoadOptions({
          roadZoneEdges: true,
          roadZoneLeft: side !== 'right',
          roadZoneRight: side !== 'left'
        });
      });
    });

    document.querySelectorAll('[data-road-auto-zone]').forEach(btn => {
      btn.addEventListener('click', () => this.game.setRoadOptions({ roadAutoZoneType: btn.dataset.roadAutoZone, roadZoneEdges: true }));
    });

    document.querySelectorAll('[data-road-lane-class]').forEach(btn => {
      btn.addEventListener('click', () => this.game.setLaneClass(btn.dataset.roadLaneClass));
    });

    document.querySelectorAll('[data-rail-kind]').forEach(btn => {
      btn.addEventListener('click', () => this.game.setRailOptions({ railKind: btn.dataset.railKind }));
    });

    document.querySelectorAll('[data-rail-mode]').forEach(btn => {
      btn.addEventListener('click', () => this.game.setRailOptions({ railMode: btn.dataset.railMode }));
    });


    document.querySelectorAll('[data-rail-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset.railPreset;
        const presets = {
          single: { railKind: 'single' },
          double: { railKind: 'double' },
          train: { railMode: 'train', railSpeed: 90 },
          vlt: { railMode: 'vlt', railKind: 'double', railSpeed: 60 },
          metro: { railMode: 'metro', railKind: 'double', railSpeed: 100 }
        };
        this.game.setTool('rail');
        this.game.setRailOptions(presets[preset] || {});
      });
    });

    document.querySelectorAll('[data-rail-speed]').forEach(btn => {
      btn.addEventListener('click', () => this.game.setRailOptions({ railSpeed: Number(btn.dataset.railSpeed) }));
    });

    document.querySelectorAll('[data-subtool]').forEach(btn => {
      btn.addEventListener('click', () => this.game.setTool(btn.dataset.subtool));
    });
    this.$('terrainBackGenerator')?.addEventListener('click', () => {
      this.setAppMode('generator');
      this.game.returnToGeneratorMode();
      this.render();
    });

    document.querySelectorAll('[data-rail-geometry]').forEach(btn => {
      btn.addEventListener('click', () => this.game.setRailOptions({ railGeometry: btn.dataset.railGeometry }));
    });

    this.$('railSpeed')?.addEventListener('input', (event) => {
      const speed = Number(event.target.value);
      this.$('railSpeedOut').textContent = `${speed}`;
      this.game.setRailOptions({ railSpeed: speed });
    });


    document.querySelectorAll('[data-speed]').forEach(btn => {
      btn.addEventListener('click', () => this.game.setSpeed(Number(btn.dataset.speed)));
    });

    document.querySelectorAll('[data-tmpe-mode]').forEach(btn => {
      btn.addEventListener('click', () => this.game.setTmpeMode(btn.dataset.tmpeMode));
    });
    document.querySelectorAll('[data-tmpe-lane]').forEach(btn => {
      btn.addEventListener('click', () => this.game.setTmpeLaneIndex(btn.dataset.tmpeLane));
    });
    document.querySelectorAll('[data-tmpe-class]').forEach(btn => {
      btn.addEventListener('click', () => this.game.setTmpeLaneClass(btn.dataset.tmpeClass));
    });
    this.$('tmpeClear')?.addEventListener('click', () => {
      if (confirm('Remover semáforos, pare/preferenciais e resetar classes de segmento?')) this.game.systems.traffic.clearAll();
    });

    this.$('laneCount')?.addEventListener('input', (event) => {
      const lanes = Number(event.target.value);
      this.$('laneCountOut').textContent = `${lanes}`;
      this.game.setRoadOptions({ roadLanes: lanes });
    });

    this.$('roadSpeed')?.addEventListener('input', (event) => {
      const speed = Number(event.target.value);
      this.$('roadSpeedOut').textContent = `${speed}`;
      this.game.setRoadOptions({ roadSpeed: speed });
    });


    this.$('upgradeLaneCount')?.addEventListener('input', (event) => {
      const lanes = Number(event.target.value);
      this.$('upgradeLaneCountOut').textContent = `${lanes}`;
      this.game.setRoadOptions({ roadLanes: lanes });
    });

    this.$('upgradeRoadSpeed')?.addEventListener('input', (event) => {
      const speed = Number(event.target.value);
      this.$('upgradeRoadSpeedOut').textContent = `${speed}`;
      this.game.setRoadOptions({ roadSpeed: speed });
    });

    this.$('saveGame')?.addEventListener('click', () => this.saveGameToClipboard());
    this.$('loadGame')?.addEventListener('click', () => this.loadGameFromPrompt());
  }


  formatGameDate(day = 1) {
    const start = new Date(Date.UTC(2040, 0, 1));
    start.setUTCDate(start.getUTCDate() + Math.max(0, Math.floor(day || 1) - 1));
    const dd = String(start.getUTCDate()).padStart(2, '0');
    const mm = String(start.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = start.getUTCFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  render() {
    const state = this.game.state;
    const stats = this.game.map.getStats();
    const sim = state.simulation;
    const money = Math.round(sim.money).toLocaleString('pt-BR');
    const minute = String(Math.floor(sim.minute || 0)).padStart(2, '0');
    const hour = String(Math.floor(sim.hour || 0)).padStart(2, '0');
    const calendarDate = this.formatGameDate(sim.day || 1);
    const cycleEnabled = state.settings?.dayNightCycleEnabled !== false;

    if (this.$('newcoreMode')) this.$('newcoreMode').textContent = state.mode === 'city' ? (sim.paused ? 'Cidade pausada' : 'Cidade') : 'Gerador';
    if (this.$('newcoreGameMode')) this.$('newcoreGameMode').textContent = (state.settings?.gameMode || 'sandbox') === 'simulation' ? 'Simulacao' : 'Sandbox';
    if (this.$('newcoreDate')) this.$('newcoreDate').textContent = `${calendarDate} ${hour}:${minute}`;
    if (this.$('newcoreWeather')) this.$('newcoreWeather').textContent = this.game.mapCore?.getWeatherLabel?.() || this.game.map.getWeatherLabel?.() || 'Tempo dinâmico';
    if (this.$('newcoreMoney')) this.$('newcoreMoney').textContent = `R$ ${money}`;
    if (this.$('newcoreNetIncomeTop')) this.$('newcoreNetIncomeTop').textContent = `${(sim.netIncomeHourly || 0) >= 0 ? '+' : '-'}R$ ${Math.abs(Math.round(sim.netIncomeHourly || 0)).toLocaleString('pt-BR')}`;
    if (this.$('newcorePop')) this.$('newcorePop').textContent = `${sim.population}`;
    if (this.$('newcoreJobs')) this.$('newcoreJobs').textContent = `${sim.jobs || 0}`;
    if (this.$('newcorePax')) this.$('newcorePax').textContent = `${sim.passengersPerHour || 0}`;
    if (this.$('newcoreVehicles')) this.$('newcoreVehicles').textContent = `${sim.trafficVehicles || 0}`;
    if (this.$('newcoreCongestion')) this.$('newcoreCongestion').textContent = `${sim.congestion || 0}%`;
    if (this.$('newcoreEvents')) this.$('newcoreEvents').textContent = `${state.events?.active?.length || sim.activeEvents || sim.growthEvents || 0}`;
    if (this.$('newcoreClock')) this.$('newcoreClock').textContent = `D${sim.day} ${hour}:${minute} • ${sim.speed}×`;
    if (this.$('dayNightToggle')) this.$('dayNightToggle').textContent = cycleEnabled ? 'Ciclo ON' : '12h fixa';
    this.$('dayNightToggle')?.classList.toggle('active', !cycleEnabled);
    if (this.$('newcoreBuildable')) this.$('newcoreBuildable').textContent = `${Math.round((stats.build || 0) * 100)}%`;
    if (this.$('newcoreAssetPacks')) this.$('newcoreAssetPacks').textContent = `${this.assets.listBuildingPacks().length}`;
    if (this.$('newcoreLots')) this.$('newcoreLots').textContent = `${state.zoning.length}`;
    if (this.$('newcoreBuildings')) this.$('newcoreBuildings').textContent = `${state.buildings.length}`;
    if (this.$('newcoreRCI')) {
      const d = sim.demand || {};
      this.$('newcoreRCI').textContent = `${Math.round((d.residential || 0) * 100)}/${Math.round((d.commercial || 0) * 100)}/${Math.round((d.industrial || 0) * 100)}`;
    }
    if (this.$('newcoreSatisfaction')) this.$('newcoreSatisfaction').textContent = `${sim.satisfaction || 0}%`;
    if (this.$('newcoreLandValue')) this.$('newcoreLandValue').textContent = `${sim.landValue || 0}`;
    if (this.$('newcoreTaxIncome')) this.$('newcoreTaxIncome').textContent = `R$ ${Math.round(sim.taxIncomeHourly || 0).toLocaleString('pt-BR')}`;
    if (this.$('newcoreNetIncome')) this.$('newcoreNetIncome').textContent = `${(sim.netIncomeHourly || 0) >= 0 ? '+' : '-'}R$ ${Math.abs(Math.round(sim.netIncomeHourly || 0)).toLocaleString('pt-BR')}`;
    if (this.$('newcoreStops')) this.$('newcoreStops').textContent = `${sim.transitStops || state.transitStops?.length || 0}`;
    if (this.$('newcoreBusLines')) this.$('newcoreBusLines').textContent = `${sim.busLines || state.transitLines?.filter(l => l.mode === 'bus').length || 0}`;
    if (this.$('newcoreRailStations')) this.$('newcoreRailStations').textContent = `${sim.railStations || state.railStations?.length || 0}`;
    if (this.$('newcoreRailLines')) this.$('newcoreRailLines').textContent = `${sim.railLines || state.transitLines?.filter(l => l.mode === 'rail').length || 0}`;
    if (this.$('newcoreRailOccupancy')) this.$('newcoreRailOccupancy').textContent = `${sim.railOccupancy || 0}%`;
    if (this.$('newcoreTransitCoverage')) this.$('newcoreTransitCoverage').textContent = `${sim.transitCoverage || 0}%`;
    if (this.$('newcoreTransitOccupancy')) this.$('newcoreTransitOccupancy').textContent = `${sim.transitOccupancy || 0}%`;
    if (this.$('newcoreModalShare')) {
      const m = sim.modalShare || { car: 100, transit: 0, bike: 0 };
      this.$('newcoreModalShare').textContent = `${m.car || 0}/${m.transit || 0}/${m.bike || 0}`;
    }
    if (this.$('newcoreUnemployment')) this.$('newcoreUnemployment').textContent = `${sim.unemploymentRate || 0}%`;
    if (this.$('newcoreComfortPenalty')) this.$('newcoreComfortPenalty').textContent = `${sim.comfortPenalty || 0}%`;
    if (this.$('pauseGame')) this.$('pauseGame').textContent = sim.paused ? 'Retomar' : 'Pausar';
    if (this.$('laneCount')) this.$('laneCount').value = state.buildOptions?.roadLanes ?? 2;
    if (this.$('laneCountOut')) this.$('laneCountOut').textContent = `${state.buildOptions?.roadLanes ?? 2}`;
    if (this.$('roadSpeed')) this.$('roadSpeed').value = state.buildOptions?.roadSpeed ?? 50;
    if (this.$('roadSpeedOut')) this.$('roadSpeedOut').textContent = `${state.buildOptions?.roadSpeed ?? 50}`;
    if (this.$('roadLevelOut')) this.$('roadLevelOut').textContent = `${state.buildOptions?.roadElevation ?? 0}`;
    if (this.$('railLevelOut')) this.$('railLevelOut').textContent = `${state.buildOptions?.railElevation ?? 0}`;
    if (this.$('upgradeLaneCount')) this.$('upgradeLaneCount').value = state.buildOptions?.roadLanes ?? 2;
    if (this.$('upgradeLaneCountOut')) this.$('upgradeLaneCountOut').textContent = `${state.buildOptions?.roadLanes ?? 2}`;
    if (this.$('upgradeRoadSpeed')) this.$('upgradeRoadSpeed').value = state.buildOptions?.roadSpeed ?? 50;
    if (this.$('upgradeRoadSpeedOut')) this.$('upgradeRoadSpeedOut').textContent = `${state.buildOptions?.roadSpeed ?? 50}`;
    if (this.$('railSpeed')) this.$('railSpeed').value = state.buildOptions?.railSpeed ?? 90;
    if (this.$('railSpeedOut')) this.$('railSpeedOut').textContent = `${state.buildOptions?.railSpeed ?? 90}`;
    if (this.$('toolRailSegments')) this.$('toolRailSegments').textContent = `${state.networks?.rails?.length || 0}`;
    if (this.$('toolRailStations')) this.$('toolRailStations').textContent = `${state.railStations?.length || 0}`;
    if (this.$('toolRailLinesMirror')) this.$('toolRailLinesMirror').textContent = `${sim.railLines || state.transitLines?.filter(l => l.mode === 'rail').length || 0}`;
    if (this.$('classicTransportStops')) this.$('classicTransportStops').textContent = `${(state.transitStops || []).length}`;
    if (this.$('classicTransportLines')) this.$('classicTransportLines').textContent = `${(state.transitLines || []).length}`;
    if (this.$('inspectorText')) this.$('inspectorText').textContent = state.inspector?.text || 'Nada selecionado.';

    const visualMode = state.mode === 'city' ? 'city' : (this.flow === 'start' ? 'start' : 'generator');
    this.setAppMode(visualMode);
    this.renderToolSubmenu(state);
    document.querySelectorAll('[data-tool]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === state.selectedTool);
      btn.disabled = state.mode !== 'city';
    });
    document.querySelectorAll('[data-zone-type]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.zoneType === state.selectedZoneType);
    });
    const zoneDensity = state.selectedZoneType === 'industrial' ? 'low' : (state.selectedZoneDensity || 'low');
    document.querySelectorAll('[data-zone-density]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.zoneDensity === zoneDensity);
      btn.disabled = state.selectedZoneType === 'industrial';
    });
    const zoneDensityWrap = this.$('zoneDensityButtons');
    if (zoneDensityWrap) zoneDensityWrap.classList.toggle('disabled', state.selectedZoneType === 'industrial');
    const zoneDensityHint = this.$('zoneDensityHint');
    if (zoneDensityHint) zoneDensityHint.textContent = state.selectedZoneType === 'industrial'
      ? 'Industrial não usa densidade nesta versão.'
      : `Densidade ativa: ${zoneDensity === 'high' ? 'alta' : zoneDensity === 'medium' ? 'média' : 'baixa'}.`;
    document.querySelectorAll('[data-terrain-brush]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.terrainBrush === (state.selectedTerrainBrush || 'trees'));
    });
    document.querySelectorAll('[data-zone-side]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.zoneSide === (state.buildOptions?.zoneSide || 'both'));
    });
    document.querySelectorAll('[data-road-type]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.roadType === (state.buildOptions?.roadType || 'street'));
    });
    document.querySelectorAll('[data-road-lanes]').forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.roadLanes) === (state.buildOptions?.roadLanes || 2));
    });
    document.querySelectorAll('[data-road-speed]').forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.roadSpeed) === (state.buildOptions?.roadSpeed || 50));
    });
    document.querySelectorAll('[data-road-geometry]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.roadGeometry === (state.buildOptions?.roadGeometry || 'smooth'));
    });
    document.querySelectorAll('[data-road-direction]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.roadDirection === (state.buildOptions?.roadDirection || 'twoWay'));
    });
    document.querySelectorAll('[data-road-elevation]').forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.roadElevation) === (state.buildOptions?.roadElevation || 0));
    });
    document.querySelectorAll('[data-road-toggle]').forEach(btn => {
      btn.classList.toggle('active', !!state.buildOptions?.[btn.dataset.roadToggle]);
    });
    const zoneSide = state.buildOptions?.roadZoneLeft === false ? 'right' : state.buildOptions?.roadZoneRight === false ? 'left' : 'both';
    document.querySelectorAll('[data-road-zone-side]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.roadZoneSide === zoneSide);
    });
    document.querySelectorAll('[data-road-auto-zone]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.roadAutoZone === (state.buildOptions?.roadAutoZoneType || 'residential'));
    });
    const roadPresetKey = this.resolveRoadPresetKey(state.buildOptions || {});
    document.querySelectorAll('[data-road-preset]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.roadPreset === roadPresetKey);
    });
    document.querySelectorAll('[data-rail-preset]').forEach(btn => {
      const preset = btn.dataset.railPreset;
      const active = preset === 'single' || preset === 'double'
        ? preset === (state.buildOptions?.railKind || 'double')
        : preset === (state.buildOptions?.railMode || 'train');
      btn.classList.toggle('active', active);
    });
    document.querySelectorAll('[data-road-lane-class]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.roadLaneClass === (state.buildOptions?.roadLaneClass || 'general'));
    });
    if (this.$('roadLaneClassOut')) {
      const cls = state.buildOptions?.roadLaneClass || 'general';
      this.$('roadLaneClassOut').textContent = this.game.systems.roads.getLaneClassLabel(cls);
    }
    document.querySelectorAll('[data-rail-kind]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.railKind === (state.buildOptions?.railKind || 'double'));
    });
    document.querySelectorAll('[data-rail-mode]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.railMode === (state.buildOptions?.railMode || 'train'));
    });
    document.querySelectorAll('[data-rail-geometry]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.railGeometry === (state.buildOptions?.railGeometry || 'smooth'));
    });
    document.querySelectorAll('[data-rail-speed]').forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.railSpeed) === (state.buildOptions?.railSpeed || 90));
    });
    document.querySelectorAll('[data-speed]').forEach(btn => {
      btn.classList.toggle('speed-active', Number(btn.dataset.speed) === sim.speed && !sim.paused);
    });

    // Submenu do gestor de tráfego (TMPE) fica acima da barra inferior, no padrão clássico.
    const mode = state.tmpeMode || 'signals';
    document.querySelectorAll('[data-tmpe-mode]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tmpeMode === mode);
    });
    document.querySelectorAll('[data-tmpe-lane]').forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.tmpeLane) === (Number.isFinite(state.tmpeLaneIndex) ? state.tmpeLaneIndex : -1));
    });
    document.querySelectorAll('[data-tmpe-class]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tmpeClass === (state.tmpeLaneClass || 'bus'));
    });
    if (this.$('tmpeHint')) {
      const laneIndex = Number.isFinite(state.tmpeLaneIndex) ? state.tmpeLaneIndex : -1;
      const alvo = laneIndex >= 0 ? `faixa ${laneIndex + 1}` : 'segmento inteiro';
      const classe = this.game.systems.roads.getLaneClassLabel(state.tmpeLaneClass || 'bus');
      this.$('tmpeHint').textContent = mode === 'permissions'
        ? `Modo classes: alvo ${alvo}, classe ${classe}. Clique numa via para aplicar diretamente, sem ciclo aleatório.`
        : mode === 'phases'
          ? 'Modo fases: clique num nó para alternar auto → leste-oeste → norte-sul → tudo vermelho → tudo verde.'
          : mode === 'connectors'
            ? 'Modo conectores: clique num nó para alternar livre → só reto → sem esquerda → só direita.'
            : mode === 'priority'
              ? 'Modo prioridade: clique num nó para priorizar via larga/rápida e fazer a menor ceder.'
              : 'Modo cruzamentos: clique perto de um nó para alternar sem controle → semáforo → pare → preferencial.';
    }
    const tc = this.game.systems.traffic?.summary?.() || { signals: 0, priority: 0, restrictions: 0, manualPhases: 0, connectors: 0 };
    if (this.$('tmpeSignals')) this.$('tmpeSignals').textContent = `${tc.signals}`;
    if (this.$('tmpePriority')) this.$('tmpePriority').textContent = `${tc.priority}`;
    if (this.$('tmpeRestrictions')) this.$('tmpeRestrictions').textContent = `${tc.restrictions}`;
    if (this.$('tmpePhases')) this.$('tmpePhases').textContent = `${tc.manualPhases || 0}`;
    if (this.$('tmpeConnectors')) this.$('tmpeConnectors').textContent = `${tc.connectors || 0}`;
    this.renderClassicPanel();
  }

  renderClassicPanel() {
    const state = this.game.state;
    const sim = state.simulation || {};
    const panel = this.classicPanel || 'reports';
    document.querySelectorAll('[data-classic-panel]').forEach(btn => btn.classList.toggle('active', btn.dataset.classicPanel === panel));
    const body = this.$('classicPanelBody');
    if (!body) return;
    const money = Math.round(sim.money || 0).toLocaleString('pt-BR');
    const roads = state.networks?.roads?.length || 0;
    const rails = state.networks?.rails?.length || 0;
    const busLines = (state.transitLines || []).filter(l => l.mode === 'bus').length;
    const railLines = (state.transitLines || []).filter(l => l.mode === 'rail').length;
    const rows = {
      reports: [
        ['População', sim.population || 0], ['Empregos', sim.jobs || 0], ['RCI', `${Math.round((sim.demand?.residential || 0)*100)}/${Math.round((sim.demand?.commercial || 0)*100)}/${Math.round((sim.demand?.industrial || 0)*100)}`], ['Satisfação', `${sim.satisfaction || 0}%`]
      ],
      lines: [
        ['Paradas bus', (state.transitStops || []).length], ['Linhas bus', busLines], ['Estações', (state.railStations || []).length], ['Linhas trilho', railLines]
      ],
      economy: [
        ['Caixa', `R$ ${money}`], ['Saldo/h', `R$ ${Math.round(sim.netIncomeHourly || 0).toLocaleString('pt-BR')}`], ['Impostos/h', `R$ ${Math.round(sim.taxIncomeHourly || 0).toLocaleString('pt-BR')}`], ['Transporte/h', `R$ ${Math.round(sim.transitExpensesHourly || 0).toLocaleString('pt-BR')}`]
      ],
      traffic: [
        ['Vias', roads], ['Trilhos', rails], ['Veículos', sim.trafficVehicles || 0], ['Cong.', `${sim.congestion || 0}%`]
      ],
      population: [
        ['População', sim.population || 0], ['Empregos', sim.jobs || 0], ['Desemprego', `${sim.unemploymentRate || 0}%`], ['Satisfação', `${sim.satisfaction || 0}%`]
      ],
      transport: [
        ['Paradas bus', (state.transitStops || []).length], ['Estações', (state.railStations || []).length], ['Linhas totais', (state.transitLines || []).length], ['Pass/h', sim.passengersPerHour || 0]
      ],
      graphs: [
        ['Histórico', (sim.history || []).length], ['RCI R/C/I', `${Math.round((sim.demand?.residential || 0)*100)}/${Math.round((sim.demand?.commercial || 0)*100)}/${Math.round((sim.demand?.industrial || 0)*100)}`], ['Saldo/h', `R$ ${Math.round(sim.netIncomeHourly || 0).toLocaleString('pt-BR')}`], ['Cong.', `${sim.congestion || 0}%`]
      ]
    }[panel] || [];
    const classicTitles = { reports: 'Relatórios', lines: 'Linhas', economy: 'Economia', traffic: 'Tráfego', population: 'População', transport: 'Transporte', graphs: 'Gráficos' };
    body.innerHTML = `<h2>${classicTitles[panel] || classicTitles.reports}</h2><div class="classic-cards">${rows.map(([k,v])=>`<article><span>${k}</span><b>${v}</b></article>`).join('')}</div>`;
  }

  resolveRoadPresetKey(options = {}) {
    const type = options.roadType || 'street';
    const direction = options.roadDirection || 'twoWay';
    if (type === 'dirt') return 'dirt';
    if (direction === 'oneWay') return 'oneway';
    if (type === 'avenue') return 'avenue';
    return 'street-main';
  }

  renderToolSubmenu(state) {
    const labels = {
      none: ['Ferramentas', 'Escolha uma ferramenta na barra inferior.'],
      road: ['Estradas', 'Construção por nós e segmentos.'],
      rail: ['Trilhos', 'Construção ferroviária.'],
      'rail-station': ['Estação', 'Posicionamento em trilhos.'],
      'rail-line': ['Linha de trilho', 'Conexão de estações.'],
      transport: ['Transporte', 'Ônibus, paradas, estações e linhas.'],
      zone: ['Zoneamento', 'Lotes R/C/I junto às vias.'],
      terrain: ['Terreno', 'Mapa e camadas naturais.'],
      'bus-stop': ['Parada bus', 'Pontos de ônibus.'],
      'bus-line': ['Linha bus', 'Rotas entre paradas.'],
      upgrade: ['Editar via', 'Edição rápida a partir do menu TMPE.'],
      tmpe: ['TMPE / Tráfego', 'Cruzamentos, faixas e edição de via.'],
      demolish: ['Demolir', 'Remoção cirúrgica.'],
      inspect: ['Inspecionar', 'Dados do item clicado.']
    };
    const selected = state.mode === 'city' ? (state.selectedTool || 'none') : 'none';
    const [title, subtitle] = labels[selected] || labels.none;
    if (this.$('toolPanelTitle')) this.$('toolPanelTitle').textContent = title;
    if (this.$('toolPanelSubtitle')) this.$('toolPanelSubtitle').textContent = subtitle;
    const panel = this.$('toolPanel');
    if (panel) panel.dataset.activeTool = selected;
    document.querySelectorAll('[data-tool-section]').forEach(section => {
      section.classList.toggle('active', section.dataset.toolSection === selected);
    });
  }

  async saveGameToClipboard() {
    const text = this.game.exportSaveText();
    try {
      await navigator.clipboard.writeText(text);
      this.flash('Save JSON copiado.');
    } catch {
      window.prompt('Copie o save JSON:', text);
    }
  }

  loadGameFromPrompt() {
    const raw = window.prompt('Cole o save JSON NewCore:');
    if (!raw) return;
    try {
      this.setAppMode('city');
      this.game.importSaveObject(JSON.parse(raw));
      this.$('hamburgerMenu')?.classList.add('hidden');
      this.flash('Save carregado.');
    } catch (err) {
      this.flash(err.message || 'Falha ao carregar save.', true);
    }
  }

  flash(message, isError = false) {
    const el = this.$('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('error', !!isError);
    el.classList.add('show');
    window.setTimeout(() => el.classList.remove('show'), 1800);
  }
}
