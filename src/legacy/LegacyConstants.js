export const LEGACY_CELL_M = 20;
export const LEGACY_ZONE_GRID_DEPTH = 4;

export const LEGACY_ROAD_PROFILES = Object.freeze({
  dirt: { lanes: 1, speedKmh: 30, zoneable: false },
  street: { lanes: 2, speedKmh: 50, zoneable: true },
  avenue: { lanes: 4, speedKmh: 60, zoneable: true },
  highway: { lanes: 4, speedKmh: 90, zoneable: false }
});

export const LEGACY_TRANSIT_CAPACITY = Object.freeze({
  bus: { seated: 34, standing: 42 },
  articulatedBus: { seated: 54, standing: 88 },
  trainCar: { seated: 92, standing: 148 }
});

export const LEGACY_EVENT_RULES = Object.freeze({
  minRoadSegments: 8,
  spawnEverySeconds: 22,
  maxActive: 3,
  durationMinutes: { min: 35, max: 110 },
  speedFactor: { accident: 0.42, works: 0.62, congestion: 0.72 }
});

export const LEGACY_IGNORED_RENDER_SYSTEMS = Object.freeze([
  'legacy sky',
  'legacy sunlight',
  'legacy ambient/fog',
  'legacy tone mapping',
  'legacy renderer/shadow setup'
]);
