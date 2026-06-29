import { clamp } from '../utils/MathUtils.js';
import { GAME_BALANCE, minutesAdvanced } from '../utils/GameBalance.js';
import { SimulationAccess } from './simulation/SimulationAccess.js';
import { RCIModel } from './simulation/RCIModel.js';
import { EconomyModel } from './simulation/EconomyModel.js';
import { MobilityModel } from './simulation/MobilityModel.js';
import { buildSimulationComplianceSnapshot } from './simulation/ComplianceAudit.js';

export class SimulationSystem {
  constructor({ game, buildingSystem }) {
    this.game = game;
    this.buildings = buildingSystem;
    this.growthTimer = 0;
    this.levelTimer = 0;
    this._levelCursor = 0;
    this.historyLimit = 48;
    this.access = new SimulationAccess(game);
    this.rci = new RCIModel({ game, access: this.access });
    this.economy = new EconomyModel({ game, access: this.access });
    this.mobility = new MobilityModel({ game });
  }

  update(dt) {
    const state = this.game.state;
    if (state.mode !== 'city' || state.simulation.paused) return;
    const speed = state.simulation.speed || 1;
    const scaled = dt * speed;
    this.growthTimer += scaled;
    this.levelTimer += scaled;

    state.simulation.minute += minutesAdvanced(dt, speed);
    while (state.simulation.minute >= 60) {
      state.simulation.minute -= 60;
      state.simulation.hour += 1;
      this.hourlyTick();
    }
    while (state.simulation.hour >= 24) {
      state.simulation.hour -= 24;
      state.simulation.day += 1;
      this.dailyTick();
    }

    if (this.growthTimer >= 5) {
      this.growthTimer = 0;
      this.recalculateStats();
      const spawned = this.buildings.ensureBuildings({ immediate: false });
      if (spawned) this.game.rebuildCitySystems({ buildings: true, vehicles: true, noSimRecalc: true });
    }

    if (this.levelTimer >= 8) {
      this.levelTimer = 0;
      const changed = this.evolveBuildingLevels();
      if (changed) {
        this.buildings.render();
        this.game.rebuildCitySystems({ vehicles: true, noSpawn: true, noSimRecalc: true });
      }
    }
  }

  hourlyTick() {
    this.recalculateStats();
    const sim = this.game.state.simulation;
    sim.money += Math.round(sim.netIncomeHourly || 0);
    this.pushHistory();
  }

  pushHistory() {
    const sim = this.game.state.simulation;
    if (!Array.isArray(sim.history)) sim.history = [];
    sim.history.push({
      t: (sim.day || 1) * 24 + (sim.hour || 0),
      population: sim.population || 0,
      jobs: sim.jobs || 0,
      money: Math.round(sim.money || 0),
      netIncomeHourly: Math.round(sim.netIncomeHourly || 0),
      passengersPerHour: sim.passengersPerHour || 0,
      congestion: sim.congestion || 0,
      transitShare: sim.modalShare?.transit || 0,
      satisfaction: sim.satisfaction || 0
    });
    while (sim.history.length > this.historyLimit) sim.history.shift();
  }

  dailyTick() {
    for (const b of this.game.state.buildings) b.ageDays = (b.ageDays || 0) + 1;
    this.recalculateStats();
  }

  recalculateStats() {
    this.ensureEconomyFields();
    this.game.systems.transit?.updateMetrics?.();
    this.game.systems.rails?.updateMetrics?.();
    this.rci.updateDemand();
    this.rci.updateBuildingOccupancy();
    this.mobility.updateMobilityStats();
    this.economy.updateFinancials();
    this.game.state.simulation.specCompliance = buildSimulationComplianceSnapshot(this.game.state);
  }

  ensureEconomyFields() {
    const sim = this.game.state.simulation;
    sim.demand = {
      residential: 0.62,
      commercial: 0.44,
      industrial: 0.40,
      ...(sim.demand || {})
    };
    for (const key of [
      'satisfaction', 'landValue', 'employmentRate', 'housingPressure', 'jobPressure',
      'commercialPressure', 'industrialPressure', 'taxIncomeHourly', 'serviceExpensesHourly',
      'infrastructureExpensesHourly', 'transitBalanceHourly', 'netIncomeHourly', 'growthEvents', 'activeEvents',
      'upgradedBuildings', 'unemploymentRate', 'favelaPressure', 'comfortPenalty'
    ]) if (!Number.isFinite(sim[key])) sim[key] = 0;
    if (!sim.modalShare) sim.modalShare = { car: 100, transit: 0, bike: 0 };
    if (!Array.isArray(this.game.state.citizens)) this.game.state.citizens = [];
  }

  evolveBuildingLevels() {
    const buildings = this.game.state.buildings || [];
    if (!buildings.length) return false;
    const sim = this.game.state.simulation;
    const batch = Math.min(34, buildings.length);
    this._levelCursor = this._levelCursor % buildings.length;
    let changed = false;

    for (let i = 0; i < batch; i++) {
      const b = buildings[(this._levelCursor + i) % buildings.length];
      const score = this.rci.evaluateBuildingScore(b);
      const level = Math.max(1, Math.min(5, b.level || 1));
      if (level < 5 && score > 0.66 && Math.random() < 0.08) {
        this.levelUp(b);
        sim.upgradedBuildings = (sim.upgradedBuildings || 0) + 1;
        changed = true;
      } else if (level > 1 && score < 0.22 && Math.random() < 0.018) {
        b.level = level - 1;
        b.height = Math.max(4, b.height * 0.88);
        b.residentCapacity = Math.round((b.residentCapacity || b.residents || 2) * 0.88);
        b.jobCapacity = Math.round((b.jobCapacity || b.jobs || 2) * 0.88);
        changed = true;
      }
    }
    this._levelCursor = (this._levelCursor + batch) % buildings.length;
    return changed;
  }

  levelUp(b) {
    const level = Math.max(1, b.level || 1) + 1;
    b.level = Math.min(5, level);
    const growth = b.zone === 'industrial' ? 1.12 : b.zone === 'commercial' ? 1.16 : 1.10;
    b.height = Math.min(b.zone === 'commercial' ? 58 : b.zone === 'industrial' ? 32 : 30, b.height * growth + 1.4);
    if (b.zone === 'residential') b.residentCapacity = Math.max(this.getResidentCapacity(b), Math.round((b.residentCapacity || b.residents || 2) * 1.18 + 1));
    else b.jobCapacity = Math.max(this.getJobCapacity(b), Math.round((b.jobCapacity || b.jobs || 2) * 1.20 + 1));
  }

  // Proxies públicos preservam compatibilidade com módulos/legado adaptado.
  accessibilityAt(x, z) { return this.access.accessibilityAt(x, z); }
  transitCoverageAt(x, z) { return this.access.transitCoverageAt(x, z); }
  terrainPenaltyAt(x, z) { return this.access.terrainPenaltyAt(x, z); }
  getResidentCapacity(b) { return this.access.getResidentCapacity(b); }
  getJobCapacity(b) { return this.access.getJobCapacity(b); }
  segmentLength(seg, system) { return this.access.segmentLength(seg, system); }
  getBalance() { return GAME_BALANCE; }
  lerp(a, b, t) { return a + (b - a) * clamp(t, 0, 1); }
}
