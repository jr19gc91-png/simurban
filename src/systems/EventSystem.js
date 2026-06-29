import { clamp, makeId, pointAlongPolyline, safeDisposeObject } from '../utils/MathUtils.js';
import { LEGACY_EVENT_RULES } from '../legacy/LegacyConstants.js';
import { m } from '../utils/Scale.js';

const EVENT_TYPES = Object.freeze({
  accident: { label: 'Acidente', color: 0xd94b3d },
  works: { label: 'Obra', color: 0xd6a23a },
  congestion: { label: 'Congestionamento', color: 0xc9652f }
});

export class EventSystem {
  constructor({ game, roadSystem }) {
    this.game = game;
    this.roads = roadSystem;
    this.THREE = game.mapCore.THREE;
    this.group = game.groups.events;
    this.timer = 0;
    this.materials = new Map();
  }

  reset() {
    safeDisposeObject(this.group);
    this.group.clear();
    this.timer = 0;
    this.ensureState();
  }

  ensureState() {
    if (!this.game.state.events) this.game.state.events = { active: [], history: [] };
    if (!Array.isArray(this.game.state.events.active)) this.game.state.events.active = [];
    if (!Array.isArray(this.game.state.events.history)) this.game.state.events.history = [];
    return this.game.state.events;
  }

  advance(dt) {
    const events = this.ensureState();
    const speed = this.game.state.simulation.speed || 1;
    const minutes = dt * speed * 4;
    let changed = false;

    for (const event of events.active) event.remainingMinutes = Math.max(0, (event.remainingMinutes || 0) - minutes);
    const expired = events.active.filter(event => event.remainingMinutes <= 0);
    if (expired.length) {
      events.history.push(...expired.map(event => ({ ...event, clearedAtDay: this.game.state.simulation.day })));
      events.active = events.active.filter(event => event.remainingMinutes > 0);
      changed = true;
    }

    this.timer += dt * speed;
    if (this.timer >= LEGACY_EVENT_RULES.spawnEverySeconds) {
      this.timer = 0;
      if (this.shouldSpawnEvent()) changed = this.spawnEvent() || changed;
    }

    if (changed) {
      this.render();
      this.updateTelemetry();
      this.game.emitChange();
    } else {
      this.updateTelemetry();
    }
  }

  shouldSpawnEvent() {
    const events = this.ensureState();
    const roads = this.game.state.networks.roads || [];
    if (roads.length < LEGACY_EVENT_RULES.minRoadSegments) return false;
    if (events.active.length >= LEGACY_EVENT_RULES.maxActive) return false;
    const sim = this.game.state.simulation;
    const pressure = clamp(((sim.congestion || 0) / 100) + ((sim.trafficVehicles || 0) / Math.max(40, roads.length * 4)), 0, 1.5);
    return Math.random() < clamp(0.18 + pressure * 0.18, 0.18, 0.48);
  }

  spawnEvent() {
    const events = this.ensureState();
    const candidates = (this.game.state.networks.roads || [])
      .filter(segment => segment.kind !== 'dirt' && (segment.elevation || 0) === 0)
      .filter(segment => !events.active.some(event => event.segmentId === segment.id));
    if (!candidates.length) return false;

    const segment = candidates[Math.floor(Math.random() * candidates.length)];
    const samples = this.roads.getSegmentSamples(segment, Math.max(6, Math.ceil(this.roads.getSegmentLength(segment) / 28)));
    const position = pointAlongPolyline(samples, Math.max(8, this.roads.getSegmentLength(segment) * (0.32 + Math.random() * 0.36)));
    if (!position) return false;

    const types = ['accident', 'works', 'congestion'];
    const type = types[Math.floor(Math.random() * types.length)];
    const duration = LEGACY_EVENT_RULES.durationMinutes;
    events.active.push({
      id: makeId('evt'),
      type,
      label: EVENT_TYPES[type].label,
      segmentId: segment.id,
      x: position.x,
      y: position.y,
      z: position.z,
      remainingMinutes: duration.min + Math.random() * (duration.max - duration.min),
      speedFactor: LEGACY_EVENT_RULES.speedFactor[type] || 0.7,
      createdAtDay: this.game.state.simulation.day
    });
    return true;
  }

  segmentSpeedFactor(segmentId) {
    if (!segmentId) return 1;
    const events = this.ensureState().active.filter(event => event.segmentId === segmentId);
    if (!events.length) return 1;
    return events.reduce((factor, event) => Math.min(factor, event.speedFactor || 1), 1);
  }

  updateTelemetry() {
    const sim = this.game.state.simulation;
    const events = this.ensureState();
    sim.growthEvents = events.active.length;
    sim.activeEvents = events.active.length;
  }

  render() {
    safeDisposeObject(this.group);
    this.group.clear();
    for (const event of this.ensureState().active) this.renderEventMarker(event);
  }

  renderEventMarker(event) {
    const meta = EVENT_TYPES[event.type] || EVENT_TYPES.congestion;
    let mat = this.materials.get(event.type);
    if (!mat) {
      mat = new this.THREE.MeshStandardMaterial({ color: meta.color, roughness: 0.82, metalness: 0.02, flatShading: true });
      this.materials.set(event.type, mat);
    }
    const base = new this.THREE.Mesh(new this.THREE.CylinderGeometry(m(1.8), m(2.4), m(0.55), 10), mat);
    base.position.set(event.x, (event.y || this.game.map.getHeightAt(event.x, event.z)) + m(0.48), event.z);
    const cone = new this.THREE.Mesh(new this.THREE.ConeGeometry(m(1.55), m(3.4), 10), mat);
    cone.position.set(event.x, base.position.y + m(1.85), event.z);
    cone.userData.eventId = event.id;
    base.userData.eventId = event.id;
    this.group.add(base, cone);
  }

  summary() {
    const events = this.ensureState();
    const byType = { accident: 0, works: 0, congestion: 0 };
    for (const event of events.active) byType[event.type] = (byType[event.type] || 0) + 1;
    return { active: events.active.length, history: events.history.length, byType };
  }
}
