import { clamp } from '../../utils/MathUtils.js';
import { meters } from '../../utils/Scale.js';

export class SimulationAccess {
  constructor(game) { this.game = game; }

  accessibilityAt(x, z) {
    const roads = this.game.state.networks.roads || [];
    if (!roads.length) return 0;
    const hit = this.game.systems.roads.findNearestSegment({ x, z }, 180);
    if (!hit) return 0.10;
    const speedBoost = clamp(((hit.segment.speedKmh || 50) - 30) / 90, 0, 1) * 0.18;
    const laneBoost = clamp(((hit.segment.lanes || 1) - 1) / 4, 0, 1) * 0.16;
    const distanceScore = clamp(1 - hit.distance / 180, 0.08, 1);
    return clamp(distanceScore + speedBoost + laneBoost, 0, 1);
  }

  transitCoverageAt(x, z) {
    let best = 0;
    for (const stop of this.game.state.transitStops || []) {
      const d = Math.hypot(stop.x - x, stop.z - z);
      best = Math.max(best, clamp(1 - d / 210, 0, 1));
    }
    for (const st of this.game.state.railStations || []) {
      const d = Math.hypot(st.x - x, st.z - z);
      best = Math.max(best, clamp(1 - d / 360, 0, 1));
    }
    return best;
  }

  terrainPenaltyAt(x, z) {
    const slope = this.game.map.getSlopeAt(x, z) || 0;
    return clamp((slope - 8) / 28, 0, 0.18);
  }

  getResidentCapacity(b) {
    if (Number.isFinite(b.residentCapacity) && b.residentCapacity > 0) return b.residentCapacity;
    return Math.max(2, Math.round(((meters(b.width) * meters(b.depth)) / 260) * (meters(b.height) / 5.5) * (1 + ((b.level || 1) - 1) * 0.12))); 
  }

  getJobCapacity(b) {
    if (Number.isFinite(b.jobCapacity) && b.jobCapacity > 0) return b.jobCapacity;
    if (b.zone === 'industrial') return Math.max(6, Math.round(((meters(b.width) * meters(b.depth)) / 210) * 1.7 * (1 + ((b.level || 1) - 1) * 0.16))); 
    return Math.max(3, Math.round(((meters(b.width) * meters(b.depth)) / 230) * (meters(b.height) / 6.5) * (1 + ((b.level || 1) - 1) * 0.15))); 
  }

  segmentLength(seg, system) {
    if (!seg || !system?.getSegmentLength) return 0;
    try { return system.getSegmentLength(seg); } catch { return 0; }
  }
}
