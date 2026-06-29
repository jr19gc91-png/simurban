// Terra Nova / SIMURB — balanceamento central alinhado ao .md raiz.
// Mantém números de simulação/economia em um único ponto para não espalhar regra pelo jogo.

export const GAME_BALANCE = Object.freeze({
  minLevel: -5,
  maxLevel: 5,
  zoneDepthTiles: 4,
  dayDurationSecondsAt1x: 30 * 60,
  vehicleMotionScale: 5.0,
  speeds: [1, 3, 5],
  tripsPerCitizenPerDay: 2.5,
  carBias: 1.5,
  unemploymentThreshold: 0.15,
  maxOvercrowding: 1.2,
  fare: {
    bus: 4.40,
    rail: 5.20,
    vlt: 4.80,
    metro: 5.20
  },
  vehicleCapacities: {
    busStandard: { seated: 40, standing: 20, label: 'ônibus convencional' },
    busArticulated: { seated: 55, standing: 35, label: 'ônibus articulado' },
    busBiarticulated: { seated: 70, standing: 50, label: 'ônibus biarticulado' },
    railCar: { seated: 60, standing: 40, label: 'carro trem/metrô' },
    vlt: { seated: 45, standing: 30, label: 'VLT' }
  },
  hourlyOperatingCost: {
    busDriverSalary: 9.5,
    busMaintenance: 11.0,
    busFuelPerKm: 3.9,
    railCrew: 24.0,
    railMaintenance: 38.0,
    railEnergyPerKm: 7.4
  },
  taxes: {
    residentHourly: 0.16,
    jobHourly: 0.34,
    landValueHourly: 0.018
  }
});

export function normalCapacity(capacity) {
  return Math.max(0, Math.round((capacity?.seated || 0) + (capacity?.standing || 0)));
}

export function maxCapacity(capacity) {
  return Math.max(0, Math.round((capacity?.seated || 0) + (capacity?.standing || 0) * GAME_BALANCE.maxOvercrowding));
}

export function occupancyPercent(passengers, capacity) {
  const normal = normalCapacity(capacity);
  if (!normal) return 0;
  return Math.round((Math.max(0, passengers || 0) / normal) * 100);
}

export function comfortPenaltyFromOccupancy(occupancyPercentValue) {
  const rate = Math.max(0, (occupancyPercentValue || 0) / 100);
  if (rate <= 1) return 0;
  if (rate <= GAME_BALANCE.maxOvercrowding) return ((rate - 1) / (GAME_BALANCE.maxOvercrowding - 1)) * 0.30;
  return 0.30;
}

export function comfortScoreFromOccupancy(occupancyPercentValue) {
  return Math.round((1 - comfortPenaltyFromOccupancy(occupancyPercentValue)) * 100);
}

export function allowedGameSpeed(speed) {
  const value = Math.round(Number(speed) || 1);
  return GAME_BALANCE.speeds.includes(value) ? value : 1;
}

export function minutesAdvanced(realSeconds, speed = 1) {
  const gameMinutesPerSecond = 1440 / GAME_BALANCE.dayDurationSecondsAt1x;
  return Math.max(0, realSeconds || 0) * allowedGameSpeed(speed) * gameMinutesPerSecond;
}
