import { GAME_BALANCE } from '../../utils/GameBalance.js';

export function buildSimulationComplianceSnapshot(state) {
  const sim = state.simulation || {};
  return {
    schema: state.version,
    mdRules: {
      dayDurationSecondsAt1x: GAME_BALANCE.dayDurationSecondsAt1x,
      speeds: GAME_BALANCE.speeds,
      tripsPerCitizenPerDay: GAME_BALANCE.tripsPerCitizenPerDay,
      carBias: GAME_BALANCE.carBias,
      unemploymentThreshold: GAME_BALANCE.unemploymentThreshold,
      maxOvercrowding: GAME_BALANCE.maxOvercrowding,
      busCapacity: GAME_BALANCE.vehicleCapacities.busStandard,
      railCarCapacity: GAME_BALANCE.vehicleCapacities.railCar
    },
    liveMetrics: {
      population: sim.population || 0,
      jobs: sim.jobs || 0,
      passengersPerHour: sim.passengersPerHour || 0,
      transitOccupancy: sim.transitOccupancy || 0,
      railOccupancy: sim.railOccupancy || 0,
      comfortPenalty: sim.comfortPenalty || 0,
      unemploymentRate: sim.unemploymentRate || 0,
      favelaPressure: sim.favelaPressure || 0,
      netIncomeHourly: sim.netIncomeHourly || 0
    }
  };
}
