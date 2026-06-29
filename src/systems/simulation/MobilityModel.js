import { clamp } from '../../utils/MathUtils.js';
import { GAME_BALANCE, comfortPenaltyFromOccupancy } from '../../utils/GameBalance.js';

export class MobilityModel {
  constructor({ game }) { this.game = game; }

  updateMobilityStats() {
    const sim = this.game.state.simulation;
    const roadFactor = Math.min(1.6, this.game.state.networks.roads.length / 12);
    this.game.systems.transit?.updateMetrics?.();
    this.game.systems.rails?.updateMetrics?.();

    const transitPax = (sim.transitRidership || 0) + (sim.railRidership || 0);
    const potentialTripsPerHour = Math.round(((sim.population || 0) * GAME_BALANCE.tripsPerCitizenPerDay) / 24);
    const fallbackPax = Math.round(Math.min(sim.population || 0, (sim.jobs || 0) + 1) * roadFactor * 0.34);
    sim.passengersPerHour = Math.max(transitPax, fallbackPax, potentialTripsPerHour ? Math.round(potentialTripsPerHour * 0.12) : 0);

    const structuralCongestion = Math.min(100, Math.round(((sim.population || 0) / Math.max(1, this.game.state.networks.roads.length * 120)) * 100));
    sim.congestion = Math.max(structuralCongestion, sim.vehicleCongestion || 0);

    const transitOccupancy = Math.max(sim.transitOccupancy || 0, sim.railOccupancy || 0);
    const comfortPenalty = comfortPenaltyFromOccupancy(transitOccupancy);
    const congestionPenalty = clamp((sim.congestion || 0) / 100, 0, 1);
    const transitAttraction = clamp(((sim.transitCoverage || 0) + (sim.railLines || 0) * 8) / 100, 0, 1.25) * (1 - comfortPenalty);
    const carAttraction = clamp((1 - congestionPenalty * 0.55) * GAME_BALANCE.carBias, 0.2, 1.5);
    const bikeShare = Math.max(0, Math.min(12, Math.round((sim.bikeNetworkCoverage || 0) * 0.08)));
    const transitShare = Math.round(clamp(transitAttraction / Math.max(0.01, transitAttraction + carAttraction), 0.05, 0.72) * 100);
    const carShare = Math.max(0, 100 - transitShare - bikeShare);
    sim.modalShare = { car: carShare, transit: transitShare, bike: bikeShare };
    sim.comfortPenalty = Math.round(comfortPenalty * 100);

    const employable = Math.max(1, sim.population || 0);
    const employed = Math.min(sim.jobs || 0, employable);
    sim.unemploymentRate = Math.round(clamp(1 - employed / employable, 0, 1) * 100);
    sim.favelaPressure = sim.unemploymentRate >= GAME_BALANCE.unemploymentThreshold * 100
      ? Math.round((sim.unemploymentRate - GAME_BALANCE.unemploymentThreshold * 100) * 1.8)
      : 0;
  }
}
