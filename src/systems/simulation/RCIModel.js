import { clamp } from '../../utils/MathUtils.js';

const ZONE_TO_DEMAND = {
  residential: 'residential',
  commercial: 'commercial',
  industrial: 'industrial'
};

export class RCIModel {
  constructor({ game, access }) {
    this.game = game;
    this.access = access;
  }

  updateDemand() {
    const sim = this.game.state.simulation;
    const lots = this.game.state.zoning || [];
    const buildings = this.game.state.buildings || [];
    const homes = buildings.filter(b => b.zone === 'residential');
    const commerce = buildings.filter(b => b.zone === 'commercial');
    const industry = buildings.filter(b => b.zone === 'industrial');

    const resCap = homes.reduce((sum, b) => sum + this.access.getResidentCapacity(b), 0);
    const comCap = commerce.reduce((sum, b) => sum + this.access.getJobCapacity(b), 0);
    const indCap = industry.reduce((sum, b) => sum + this.access.getJobCapacity(b), 0);
    const pop = homes.reduce((sum, b) => sum + (b.residents || 0), 0);
    const jobsC = commerce.reduce((sum, b) => sum + (b.jobs || 0), 0);
    const jobsI = industry.reduce((sum, b) => sum + (b.jobs || 0), 0);
    const jobs = jobsC + jobsI;
    const emptyLots = {
      residential: lots.filter(l => l.zone === 'residential' && !buildings.some(b => b.lotId === l.id)).length,
      commercial: lots.filter(l => l.zone === 'commercial' && !buildings.some(b => b.lotId === l.id)).length,
      industrial: lots.filter(l => l.zone === 'industrial' && !buildings.some(b => b.lotId === l.id)).length
    };

    const congestion = clamp((sim.congestion || 0) / 100, 0, 1);
    const transit = clamp(((sim.transitCoverage || 0) + (sim.railLines ? 18 : 0)) / 100, 0, 1.25);
    const employmentRate = pop > 0 ? clamp(jobs / Math.max(1, pop), 0, 1.6) : 0;
    const housingOccupancy = resCap > 0 ? clamp(pop / resCap, 0, 1.35) : 0;
    const jobOccupancy = (comCap + indCap) > 0 ? clamp(jobs / Math.max(1, comCap + indCap), 0, 1.35) : 0;
    const roadAccess = clamp((this.game.state.networks.roads.length || 0) / 18, 0, 1.35);

    const targetR = clamp(0.18 + roadAccess * 0.22 + employmentRate * 0.26 + jobOccupancy * 0.18 + transit * 0.12 + emptyLots.residential * 0.012 - congestion * 0.32 - housingOccupancy * 0.18, 0.05, 1);
    const targetC = clamp(0.14 + roadAccess * 0.18 + (pop / 180) * 0.24 + transit * 0.16 + emptyLots.commercial * 0.012 - congestion * 0.26 - (jobsC / Math.max(1, pop + 40)) * 0.12, 0.04, 1);
    const targetI = clamp(0.16 + roadAccess * 0.24 + (pop / 240) * 0.14 + emptyLots.industrial * 0.015 - congestion * 0.20 - (jobsI / Math.max(1, pop + 80)) * 0.10, 0.04, 1);

    const smooth = 0.12;
    sim.demand.residential = this.lerp(sim.demand.residential, targetR, smooth);
    sim.demand.commercial = this.lerp(sim.demand.commercial, targetC, smooth);
    sim.demand.industrial = this.lerp(sim.demand.industrial, targetI, smooth);
    sim.employmentRate = Math.round(employmentRate * 100);
    sim.housingPressure = Math.round(targetR * 100);
    sim.jobPressure = Math.round(jobOccupancy * 100);
    sim.commercialPressure = Math.round(targetC * 100);
    sim.industrialPressure = Math.round(targetI * 100);
  }

  updateBuildingOccupancy() {
    const sim = this.game.state.simulation;
    let population = 0, jobs = 0, satisfactionSum = 0, valueSum = 0, counted = 0;

    for (const b of this.game.state.buildings) {
      const demandKey = ZONE_TO_DEMAND[b.zone] || 'residential';
      const demand = clamp(sim.demand?.[demandKey] ?? 0.5, 0, 1);
      const access = this.access.accessibilityAt(b.x, b.z);
      const transit = this.access.transitCoverageAt(b.x, b.z);
      const congestion = clamp((sim.congestion || 0) / 100, 0, 1);
      const ageBonus = clamp((b.ageDays || 0) / 45, 0, 0.08);
      const levelBonus = clamp(((b.level || 1) - 1) * 0.045, 0, 0.18);
      const terrainPenalty = this.access.terrainPenaltyAt(b.x, b.z);
      const satisfaction = clamp(access * 0.38 + transit * 0.18 + demand * 0.22 + (1 - congestion) * 0.16 + levelBonus + ageBonus - terrainPenalty, 0.12, 1);
      b.satisfaction = Math.round(satisfaction * 100);
      b.landValue = Math.round(clamp((access * 0.45 + transit * 0.22 + satisfaction * 0.28 + levelBonus) * 100, 5, 100));

      if (b.zone === 'residential') {
        const cap = this.access.getResidentCapacity(b);
        b.residentCapacity = cap;
        b.residents = Math.max(0, Math.round(cap * clamp(0.42 + demand * 0.44 + satisfaction * 0.22 - congestion * 0.16, 0.18, 1.05)));
        population += b.residents || 0;
      } else {
        const cap = this.access.getJobCapacity(b);
        b.jobCapacity = cap;
        b.jobs = Math.max(0, Math.round(cap * clamp(0.38 + demand * 0.46 + satisfaction * 0.20 - congestion * 0.14, 0.16, 1.05)));
        jobs += b.jobs || 0;
      }
      satisfactionSum += b.satisfaction;
      valueSum += b.landValue;
      counted++;
    }

    sim.population = population;
    sim.jobs = jobs;
    sim.satisfaction = counted ? Math.round(satisfactionSum / counted) : 72;
    sim.landValue = counted ? Math.round(valueSum / counted) : 38;
  }

  evaluateBuildingScore(b) {
    const sim = this.game.state.simulation;
    const demandKey = ZONE_TO_DEMAND[b.zone] || 'residential';
    const demand = clamp(sim.demand?.[demandKey] ?? 0.5, 0, 1);
    const satisfaction = clamp((b.satisfaction || 60) / 100, 0, 1);
    const access = this.access.accessibilityAt(b.x, b.z);
    const congestion = clamp((sim.congestion || 0) / 100, 0, 1);
    return demand * 0.34 + satisfaction * 0.30 + access * 0.22 + clamp((b.landValue || 40) / 100, 0, 1) * 0.14 - congestion * 0.22;
  }

  lerp(a, b, t) { return a + (b - a) * clamp(t, 0, 1); }
}
