import { GAME_BALANCE } from '../../utils/GameBalance.js';

export class EconomyModel {
  constructor({ game, access }) {
    this.game = game;
    this.access = access;
  }

  updateFinancials() {
    const sim = this.game.state.simulation;
    const roads = this.game.state.networks.roads || [];
    const rails = this.game.state.networks.rails || [];
    const buildings = this.game.state.buildings || [];

    const residentialTax = (sim.population || 0) * GAME_BALANCE.taxes.residentHourly;
    const jobTax = (sim.jobs || 0) * GAME_BALANCE.taxes.jobHourly;
    const landTax = buildings.reduce((sum, b) => sum + (b.landValue || 35) * GAME_BALANCE.taxes.landValueHourly * (b.level || 1), 0);
    const taxIncome = residentialTax + jobTax + landTax;

    const roadCost = roads.reduce((sum, seg) => {
      const len = this.access.segmentLength(seg, this.game.systems.roads);
      const laneMul = Math.max(1, seg.lanes || 1);
      const levelMul = (seg.elevation || 0) === 0 ? 1 : ((seg.elevation || 0) < 0 ? 1.55 : 1.32);
      return sum + (len / 100) * laneMul * levelMul * 1.85;
    }, 0);
    const railCost = rails.reduce((sum, seg) => sum + (this.access.segmentLength(seg, this.game.systems.rails) / 100) * 3.8, 0);
    const civicCost = Math.max(8, (sim.population || 0) * 0.045 + (sim.jobs || 0) * 0.028 + buildings.length * 0.55);
    const congestionCost = (sim.congestion || 0) * Math.max(1, (sim.population || 0) / 240) * 0.75;

    // Regra do .md: receita = passageiros transportados × tarifa; custos = frota/manutenção/energia/salários.
    const fareIncome = Math.round((sim.busFareRevenueHourly || 0) + (sim.railFareRevenueHourly || 0));
    const transitCost = Math.round((sim.busTransitExpensesHourly || 0) + (sim.railExpensesHourly || 0));

    sim.taxIncomeHourly = Math.round(taxIncome);
    sim.infrastructureExpensesHourly = Math.round(roadCost + railCost);
    sim.serviceExpensesHourly = Math.round(civicCost + congestionCost);
    sim.fareRevenueHourly = fareIncome;
    sim.transitExpensesHourly = transitCost;
    sim.transitBalanceHourly = Math.round(fareIncome - transitCost);
    sim.netIncomeHourly = Math.round(taxIncome + fareIncome - transitCost - roadCost - railCost - civicCost - congestionCost);
  }
}
