import { clamp, closestPointOnPolyline, dist2D, makeId, polylineLength, safeDisposeObject } from '../utils/MathUtils.js';
import { GAME_BALANCE, normalCapacity, maxCapacity, comfortPenaltyFromOccupancy, comfortScoreFromOccupancy } from '../utils/GameBalance.js';
import { RailRenderer } from '../rail/RailRenderer.js';
import { m, meters } from '../utils/Scale.js';

export class RailSystem {
  constructor({ game, materials }) {
    this.game = game;
    this.map = game.map;
    this.THREE = game.mapCore.THREE;
    this.materials = materials;
    this.group = game.groups.rails || game.groups.roads;
    this.previewGroup = game.groups.construction;
    this.pendingNodeId = null;
    this.preview = null;
    this.lineRouteCache = new Map();
    this.snapDistance = m(36);
    this.stationSnapDistance = m(52);
    this.coverageRadius = m(900);
    this.defaultKind = 'double';
    this.defaultMode = 'train';
    this.defaultGeometry = 'smooth';
    this.defaultSpeed = 90;
    this.defaultElevation = 0;
    this.bridgeLevelHeight = m(14);
    this.renderer = new RailRenderer(this);
  }

  setRailOptions({ kind, geometry, speed, elevation, mode } = {}) {
    if (kind === 'single' || kind === 'double') this.defaultKind = kind;
    if (['train', 'vlt', 'metro'].includes(mode)) this.defaultMode = mode;
    if (geometry === 'straight' || geometry === 'smooth') this.defaultGeometry = geometry;
    if (Number.isFinite(speed)) this.defaultSpeed = Math.max(40, Math.min(160, Math.round(speed / 10) * 10));
    if (Number.isFinite(elevation)) this.defaultElevation = Math.max(-5, Math.min(5, Math.round(elevation)));
  }

  resetInteraction() {
    this.pendingNodeId = null;
    this.clearPreview();
  }

  handleClick(point) {
    if (!point) return;
    const snapped = this.findNearestNode(point, this.snapDistance, this.defaultElevation);
    const node = snapped || this.createNode(point);
    if (!this.pendingNodeId) {
      this.pendingNodeId = node.id;
      this.render();
      return;
    }
    if (this.pendingNodeId === node.id) return;
    const a = this.getNode(this.pendingNodeId);
    const b = node;
    if (!a || !b || dist2D(a, b) < 14) return;
    const seg = this.createSegment(a.id, b.id);
    this.pendingNodeId = b.id;
    if (seg) this.clearNaturalObstaclesForSegment(seg);
    this.game.state.simulation.money -= Math.round(dist2D(a, b) * 72);
    this.game.rebuildCitySystems({ rails: true, vehicles: true });
    this.game.emitChange();
  }

  handlePointerMove(point) {
    if (!point) return;
    if (this.game.state.selectedTool === 'rail-station') {
      this.drawStationPreview(point);
      return;
    }
    if (this.game.state.selectedTool === 'rail-line') {
      this.drawStationHighlight(point);
      return;
    }
    if (!this.pendingNodeId) {
      this.clearPreview();
      return;
    }
    const a = this.getNode(this.pendingNodeId);
    const snapped = this.findNearestNode(point, this.snapDistance, this.defaultElevation);
    const b = snapped || point;
    this.drawPreview(a, b);
  }

  handleDemolish(point) {
    const station = this.findNearestStation(point, 26);
    if (station) {
      this.game.state.railStations = (this.game.state.railStations || []).filter(s => s.id !== station.id);
      this.game.state.transitLines = (this.game.state.transitLines || []).filter(line => line.mode !== 'rail' || !(line.stationIds || []).includes(station.id));
      this.ensureDraft().stationIds = [];
      this.rebuild();
      this.game.rebuildCitySystems({ rails: true, vehicles: true });
      this.game.emitChange();
      return true;
    }
    const hit = this.findNearestSegment(point, m(18));
    if (!hit) return false;
    this.game.state.networks.rails = this.game.state.networks.rails.filter(seg => seg.id !== hit.segment.id);
    this.game.state.railStations = (this.game.state.railStations || []).filter(st => st.segmentId !== hit.segment.id);
    this.game.state.transitLines = (this.game.state.transitLines || []).filter(line => line.mode !== 'rail' || (line.stationIds || []).every(id => this.getStation(id)));
    const used = new Set();
    for (const seg of this.game.state.networks.rails) { used.add(seg.a); used.add(seg.b); }
    this.game.state.networks.railNodes = this.game.state.networks.railNodes.filter(node => used.has(node.id));
    this.resetInteraction();
    this.game.rebuildCitySystems({ rails: true, vehicles: true });
    this.game.emitChange();
    return true;
  }

  createNode(point) {
    const node = { id: makeId('rln'), x: point.x, z: point.z, y: this.map.getHeightAt(point.x, point.z), elevation: this.defaultElevation };
    this.game.state.networks.railNodes.push(node);
    return node;
  }

  createSegment(aId, bId) {
    if (this.game.state.networks.rails.some(seg => (seg.a === aId && seg.b === bId) || (seg.a === bId && seg.b === aId))) return null;
    const segment = { id: makeId('rail'), a: aId, b: bId, kind: this.defaultKind, mode: this.defaultMode, geometry: this.defaultGeometry, elevation: this.defaultElevation, speedKmh: this.defaultSpeed, createdAtDay: this.game.state.simulation.day };
    this.game.state.networks.rails.push(segment);
    return segment;
  }

  clearNaturalObstaclesForSegment(segment) {
    const samples = this.getSegmentSamples(segment, 18);
    const radius = ((segment.kind || 'double') === 'double' ? m(12) : m(8)) + m(4);
    const removed = this.game.mapCore.clearNaturalObstaclesAlongPath?.(samples, radius) || 0;
    if (removed > 0) this.game.state.inspector.text = `Trilho construído. ${removed} árvore(s)/rocha(s)/detalhe(s) removidos da faixa da obra.`;
    return removed;
  }

  getNode(id) { return this.game.state.networks.railNodes.find(node => node.id === id) || null; }
  getStation(id) { return (this.game.state.railStations || []).find(station => station.id === id) || null; }

  findNearestNode(point, radius = this.snapDistance, elevation = null) {
    let best = null;
    for (const node of this.game.state.networks.railNodes) {
      if (elevation != null && (node.elevation || 0) !== elevation) continue;
      const d = dist2D(point, node);
      if (d <= radius && (!best || d < best.d)) best = { node, d };
    }
    return best?.node || null;
  }

  findNearestSegment(point, radius = m(24)) {
    let best = null;
    for (const segment of this.game.state.networks.rails) {
      const samples = this.getSegmentSamples(segment);
      const hit = closestPointOnPolyline(point, samples);
      if (hit && hit.distance <= radius && (!best || hit.distance < best.distance)) best = { ...hit, segment, samples };
    }
    return best;
  }

  findNearestStation(point, radius = m(24)) {
    let best = null;
    for (const station of this.game.state.railStations || []) {
      const d = dist2D(point, station);
      if (d <= radius && (!best || d < best.d)) best = { station, d };
    }
    return best?.station || null;
  }

  handleStationClick(point) {
    const hit = this.findNearestSegment(point, this.stationSnapDistance);
    if (!hit) {
      this.game.state.inspector.text = 'Estação: clique perto de um trilho.';
      this.game.emitChange();
      return null;
    }
    const segmentLength = Math.max(1, polylineLength(hit.samples));
    const t = clamp((hit.index + hit.t) / Math.max(1, hit.samples.length - 1), 0, 1);
    const x = hit.x;
    const z = hit.z;
    if ((this.game.state.railStations || []).some(st => dist2D(st, { x, z }) < m(120))) {
      this.game.state.inspector.text = 'Estação muito próxima de outra.';
      this.game.emitChange();
      return null;
    }
    const heading = this.segmentHeadingAt(hit.segment, t);
    const station = {
      id: makeId('rst'),
      name: `Estação ${String((this.game.state.railStations || []).length + 1).padStart(2, '0')}`,
      mode: 'rail',
      segmentId: hit.segment.id,
      t,
      x,
      z,
      y: this.map.getHeightAt(x, z) + m(0.95),
      heading,
      length: Math.max(m(65), Math.min(m(110), segmentLength * 0.28)),
      createdAtDay: this.game.state.simulation.day
    };
    if (!Array.isArray(this.game.state.railStations)) this.game.state.railStations = [];
    this.game.state.railStations.push(station);
    this.game.state.simulation.money -= 18000;
    this.game.state.inspector.text = `${station.name} criada.`;
    this.rebuild();
    this.game.rebuildCitySystems({ rails: true, vehicles: true });
    this.game.emitChange();
    return station;
  }

  handleLineClick(point) {
    const station = this.findNearestStation(point, m(36));
    if (!station) {
      this.game.state.inspector.text = 'Linha ferroviária: clique em uma estação.';
      this.game.emitChange();
      return;
    }
    const draft = this.ensureDraft();
    if (draft.stationIds.length >= 2 && draft.stationIds[0] === station.id) {
      this.finishDraftLine({ loop: true });
      return;
    }
    if (draft.stationIds.includes(station.id)) return;
    draft.stationIds.push(station.id);
    this.game.state.inspector.text = `Linha ferroviária: ${draft.stationIds.length} estação(ões) no rascunho.`;
    this.render();
    this.game.emitChange();
  }

  finishDraftLine({ loop = true } = {}) {
    const draft = this.ensureDraft();
    const ids = [...new Set(draft.stationIds || [])].filter(id => this.getStation(id));
    if (ids.length < 2) {
      this.game.state.inspector.text = 'Linha ferroviária precisa de pelo menos 2 estações.';
      this.game.emitChange();
      return null;
    }
    const line = {
      id: makeId('rline'),
      name: `Linha Trilho ${String((this.game.state.transitLines || []).filter(l => l.mode === 'rail').length + 1).padStart(2, '0')}`,
      mode: 'rail',
      railMode: this.defaultMode,
      color: this.defaultMode === 'metro' ? '#4c8bdc' : this.defaultMode === 'vlt' ? '#53a66e' : '#e2b64b',
      stationIds: ids,
      loop: loop && ids.length > 2,
      fare: this.defaultMode === 'vlt' ? GAME_BALANCE.fare.vlt : this.defaultMode === 'metro' ? GAME_BALANCE.fare.metro : GAME_BALANCE.fare.rail,
      vehicles: Math.max(1, Math.min(6, Math.ceil(ids.length / 3))),
      carsPerTrain: this.defaultMode === 'vlt' ? 4 : this.defaultMode === 'metro' ? 6 : 12,
      auto: false,
      createdAtDay: this.game.state.simulation.day
    };
    this.game.state.transitLines.push(line);
    draft.stationIds = [];
    this.game.state.simulation.money -= 24000;
    this.rebuild();
    this.game.rebuildCitySystems({ rails: true, vehicles: true });
    this.game.state.inspector.text = `${line.name} criada com ${ids.length} estações.`;
    this.game.emitChange();
    return line;
  }

  clearDraft() {
    this.ensureDraft().stationIds = [];
    this.render();
    this.game.emitChange();
  }

  ensureDraft() {
    if (!this.game.state.railDraft) this.game.state.railDraft = { mode: 'rail', stationIds: [] };
    if (!Array.isArray(this.game.state.railDraft.stationIds)) this.game.state.railDraft.stationIds = [];
    return this.game.state.railDraft;
  }

  createAutoLine() {
    if ((this.game.state.railStations || []).length < 2) this.createAutoStations();
    const stations = [...(this.game.state.railStations || [])];
    if (stations.length < 2) {
      this.game.state.inspector.text = 'Auto linha ferroviária: construa trilhos maiores primeiro.';
      this.game.emitChange();
      return null;
    }
    let a = stations[0], b = stations[1], best = -1;
    for (const s1 of stations) for (const s2 of stations) {
      if (s1.id === s2.id) continue;
      const d = dist2D(s1, s2);
      if (d > best) { best = d; a = s1; b = s2; }
    }
    const middle = stations.filter(s => s.id !== a.id && s.id !== b.id).sort((x, y) => dist2D(a, x) - dist2D(a, y)).slice(0, 4);
    const ids = [a.id, ...middle.map(s => s.id), b.id];
    this.ensureDraft().stationIds = ids;
    return this.finishDraftLine({ loop: ids.length > 3 });
  }

  createAutoStations() {
    const paths = this.getAllRailPaths().sort((a, b) => b.length - a.length).slice(0, 4);
    let created = 0;
    for (const path of paths) {
      for (const t of [0.18, 0.50, 0.82]) {
        if (created >= 7) break;
        const p = this.pointAlong(path.samples, path.length * t);
        if (!p) continue;
        if ((this.game.state.railStations || []).some(st => dist2D(st, p) < m(220))) continue;
        const station = {
          id: makeId('rst'),
          name: `Estação ${String((this.game.state.railStations || []).length + 1).padStart(2, '0')}`,
          mode: 'rail', railMode: this.defaultMode, segmentId: path.segment.id, t, x: p.x, z: p.z,
          y: this.map.getHeightAt(p.x, p.z) + m(0.95), heading: p.heading,
          length: m(85), auto: true, createdAtDay: this.game.state.simulation.day
        };
        if (!Array.isArray(this.game.state.railStations)) this.game.state.railStations = [];
        this.game.state.railStations.push(station);
        created++;
      }
    }
    if (created) this.game.state.simulation.money -= created * 12000;
    this.rebuild();
    this.game.emitChange();
    return created;
  }

  getSegmentSamples(segment, steps = null, reverse = false) {
    const a = this.getNode(segment.a), b = this.getNode(segment.b);
    if (!a || !b) return [];
    const length = dist2D(a, b);
    const n = steps ?? Math.max(10, Math.min(110, Math.ceil(length / m(35))));
    const useSmooth = (segment.geometry || 'smooth') === 'smooth' && length > m(42);
    const direct = this.normalize2D({ x: b.x - a.x, z: b.z - a.z }) || { x: 1, z: 0 };
    const tangentA = useSmooth ? this.getEndpointTangent(segment, a, b, direct, true) : direct;
    const tangentB = useSmooth ? this.getEndpointTangent(segment, b, a, direct, false) : direct;
    const samples = [];
    for (let i = 0; i <= n; i++) {
      const tRaw = i / n;
      const t = reverse ? 1 - tRaw : tRaw;
      let x, z;
      if (useSmooth) {
        const p = this.hermite2D(a, b, tangentA, tangentB, length * 0.66, t);
        x = p.x; z = p.z;
      } else {
        x = a.x + (b.x - a.x) * t;
        z = a.z + (b.z - a.z) * t;
      }
      samples.push({ x, z, y: this.map.getHeightAt(x, z) + m(0.72) + (segment.elevation || 0) * this.bridgeLevelHeight, t, segmentId: segment.id, segment });
    }
    return samples;
  }

  hermite2D(a, b, tangentA, tangentB, scale, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return {
      x: h00 * a.x + h10 * tangentA.x * scale + h01 * b.x + h11 * tangentB.x * scale,
      z: h00 * a.z + h10 * tangentA.z * scale + h01 * b.z + h11 * tangentB.z * scale
    };
  }

  normalize2D(v) {
    const len = Math.hypot(v.x, v.z);
    if (len < 0.0001) return null;
    return { x: v.x / len, z: v.z / len };
  }

  getEndpointTangent(segment, node, other, direct, isStart) {
    const connected = this.game.state.networks.rails.filter(seg => {
      if (seg.id === segment.id) return false;
      return seg.a === node.id || seg.b === node.id;
    });
    if (connected.length !== 1) return direct;
    const neighbor = connected[0];
    const otherId = neighbor.a === node.id ? neighbor.b : neighbor.a;
    const n = this.getNode(otherId);
    if (!n) return direct;
    const through = isStart
      ? this.normalize2D({ x: node.x - n.x, z: node.z - n.z })
      : this.normalize2D({ x: n.x - node.x, z: n.z - node.z });
    if (!through) return direct;
    const averaged = this.normalize2D({ x: through.x + direct.x, z: through.z + direct.z });
    return averaged || direct;
  }


  getAllRailPaths() {
    return this.game.state.networks.rails.map(segment => {
      const samples = this.getSegmentSamples(segment);
      return { segment, samples, length: polylineLength(samples) };
    }).filter(path => path.samples.length > 1);
  }

  rebuild() {
    this.lineRouteCache.clear();
    this.updateMetrics();
    this.render();
  }

  render() {
    this.renderer.render();
  }

  renderSegment(segment) {
    const samples = this.getSegmentSamples(segment);
    if (samples.length < 2) return;
    const isDouble = (segment.kind || 'double') === 'double';
    const bedWidth = isDouble ? 23 : 15;
    const trackCenters = isDouble ? [-4.4, 4.4] : [0];

    const bedBase = this.buildRibbon(samples, bedWidth + 3.2, this.materials.roadBase || this.materials.railBed, -0.05);
    bedBase.receiveShadow = true;
    this.group.add(bedBase);

    const ballast = this.buildRibbon(samples, bedWidth, this.materials.railBed, 0.05);
    ballast.receiveShadow = true;
    ballast.renderOrder = 4;
    this.group.add(ballast);

    for (const center of trackCenters) {
      this.group.add(this.buildSleepers(samples, center, isDouble ? 10.0 : 12.0));
      this.group.add(this.buildOffsetRibbon(samples, center - 2.0, 0.70, this.materials.railRust || this.materials.railMetal, 0.58));
      this.group.add(this.buildOffsetRibbon(samples, center + 2.0, 0.70, this.materials.railRust || this.materials.railMetal, 0.58));
      this.group.add(this.buildOffsetRibbon(samples, center - 2.0, 0.42, this.materials.railMetal, 0.84));
      this.group.add(this.buildOffsetRibbon(samples, center + 2.0, 0.42, this.materials.railMetal, 0.84));
      this.group.add(this.buildOffsetRibbon(samples, center, 0.22, this.materials.laneEdgeWhite || this.materials.railMetal, 0.46));
    }
  }

  renderCoverage() {
    const geo = new this.THREE.CircleGeometry(this.coverageRadius, 36);
    const mat = this.materials.transitCoverage || this.materials.preview;
    for (const station of this.game.state.railStations || []) {
      const mesh = new this.THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(station.x, this.map.getHeightAt(station.x, station.z) + 0.18, station.z);
      mesh.renderOrder = 2;
      this.group.add(mesh);
    }
  }

  renderLine(line) {
    const route = this.buildRouteForLine(line);
    if (!route?.samples?.length) return;
    const mat = new this.THREE.MeshBasicMaterial({ color: new this.THREE.Color(line.color || '#e2b64b'), transparent: true, opacity: 0.52, side: this.THREE.DoubleSide, depthWrite: false });
    const ribbon = this.buildRibbon(route.samples, m(2.2), mat, m(1.15));
    ribbon.renderOrder = 24;
    this.group.add(ribbon);
  }

  renderDraftLine() {
    const ids = this.ensureDraft().stationIds || [];
    if (ids.length < 2) return;
    const fake = { id: '__draft_rail__', mode: 'rail', stationIds: ids, loop: false };
    const route = this.buildRouteForLine(fake);
    if (!route?.samples?.length) return;
    const ribbon = this.buildRibbon(route.samples, m(2.5), this.materials.transitDraft || this.materials.preview, m(1.35));
    ribbon.renderOrder = 28;
    this.group.add(ribbon);
  }

  renderStation(station) {
    const group = new this.THREE.Group();
    const y = this.map.getHeightAt(station.x, station.z) + m(0.75);
    group.position.set(station.x, y, station.z);
    group.rotation.y = -station.heading;
    const len = Math.max(m(55), Math.min(m(120), station.length || m(85)));
    const platformMat = this.materials.sidewalk || this.materials.bridgeConcrete;
    const platformA = new this.THREE.Mesh(new this.THREE.BoxGeometry(len, m(0.36), m(5.0)), platformMat);
    platformA.position.set(0, m(0.18), -m(8.8));
    const platformB = new this.THREE.Mesh(new this.THREE.BoxGeometry(len, m(0.36), m(5.0)), platformMat);
    platformB.position.set(0, m(0.18), m(8.8));
    const roofMat = this.materials.transitShelter || this.materials.bridgeConcrete;
    const roofA = new this.THREE.Mesh(new this.THREE.BoxGeometry(len * 0.62, m(0.42), m(5.8)), roofMat);
    roofA.position.set(0, m(3.1), -m(8.8));
    const roofB = new this.THREE.Mesh(new this.THREE.BoxGeometry(len * 0.62, m(0.42), m(5.8)), roofMat);
    roofB.position.set(0, m(3.1), m(8.8));
    const sign = new this.THREE.Mesh(new this.THREE.BoxGeometry(m(8.5), m(2.0), m(0.34)), this.materials.transitStopSign || this.materials.preview);
    sign.position.set(-len * 0.32, m(2.05), -m(12.2));
    const bridge = new this.THREE.Mesh(new this.THREE.BoxGeometry(m(10), m(0.55), m(22)), this.materials.bridgeConcrete || platformMat);
    bridge.position.set(len * 0.22, m(3.0), 0);
    for (const x of [-len * 0.26, 0, len * 0.26]) {
      const colA = new this.THREE.Mesh(new this.THREE.CylinderGeometry(m(0.18), m(0.22), m(3.0), 8), this.materials.transitStopPole);
      colA.position.set(x, m(1.55), -m(8.8));
      const colB = new this.THREE.Mesh(new this.THREE.CylinderGeometry(m(0.18), m(0.22), m(3.0), 8), this.materials.transitStopPole);
      colB.position.set(x, m(1.55), m(8.8));
      group.add(colA, colB);
    }
    group.add(platformA, platformB, roofA, roofB, sign, bridge);
    group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    group.renderOrder = 20;
    this.group.add(group);
  }

  renderNode(node, selected = false) {
    if (!selected) return;
    const mesh = new this.THREE.Mesh(new this.THREE.CylinderGeometry(m(5.2), m(5.2), m(0.75), 20), this.materials.preview);
    mesh.position.set(node.x, this.map.getHeightAt(node.x, node.z) + m(1.1), node.z);
    mesh.renderOrder = 28;
    this.group.add(mesh);
  }

  buildSleepers(samples, offset = 0, width = 12) {
    const group = new this.THREE.Group();
    const geo = new this.THREE.BoxGeometry(width, m(0.50), m(1.45));
    const length = polylineLength(samples);
    const count = Math.max(2, Math.min(90, Math.floor(length / m(7.5))));
    for (let i = 0; i <= count; i++) {
      const d = (length * i) / Math.max(1, count);
      const p = this.pointAlong(samples, d);
      if (!p) continue;
      const center = this.offsetPointByHeading(p, offset);
      const sleeper = new this.THREE.Mesh(geo, this.materials.railSleeper || this.materials.railBed);
      sleeper.rotation.y = -p.heading + Math.PI / 2;
      sleeper.position.set(center.x, center.y + m(0.34), center.z);
      sleeper.castShadow = true;
      sleeper.receiveShadow = true;
      group.add(sleeper);
    }
    return group;
  }

  pointAlong(samples, distance) {
    if (!samples.length) return null;
    let remaining = distance;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1], b = samples[i];
      const seg = dist2D(a, b);
      if (remaining <= seg) {
        const t = seg <= 0.0001 ? 0 : remaining / seg;
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, heading: Math.atan2(b.z - a.z, b.x - a.x), segmentId: b.segmentId || a.segmentId, segment: b.segment || a.segment };
      }
      remaining -= seg;
    }
    const last = samples[samples.length - 1];
    const prev = samples[Math.max(0, samples.length - 2)];
    return { ...last, heading: Math.atan2(last.z - prev.z, last.x - prev.x) };
  }

  offsetPointByHeading(point, offset) {
    const heading = point.heading || 0;
    return { x: point.x - Math.sin(heading) * offset, y: point.y, z: point.z + Math.cos(heading) * offset, heading };
  }

  buildRibbon(samples, width, material, yOffset = 0) {
    const pos = [], uv = [], idx = [];
    for (let i = 0; i < samples.length; i++) {
      const p = samples[i], prev = samples[Math.max(0, i - 1)], next = samples[Math.min(samples.length - 1, i + 1)];
      const heading = Math.atan2(next.z - prev.z, next.x - prev.x);
      const nx = -Math.sin(heading), nz = Math.cos(heading);
      for (const side of [-1, 1]) {
        pos.push(p.x + nx * width * 0.5 * side, p.y + yOffset, p.z + nz * width * 0.5 * side);
        uv.push(side < 0 ? 0 : 1, i / Math.max(1, samples.length - 1));
      }
    }
    for (let i = 0; i < samples.length - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    const geo = new this.THREE.BufferGeometry();
    geo.setAttribute('position', new this.THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new this.THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return new this.THREE.Mesh(geo, material);
  }

  buildOffsetRibbon(samples, offset, width, material, yOffset = 0) {
    const shifted = samples.map((p, i) => {
      const prev = samples[Math.max(0, i - 1)], next = samples[Math.min(samples.length - 1, i + 1)];
      const heading = Math.atan2(next.z - prev.z, next.x - prev.x);
      const nx = -Math.sin(heading), nz = Math.cos(heading);
      const x = p.x + nx * offset, z = p.z + nz * offset;
      const baseDelta = p.y - this.map.getHeightAt(p.x, p.z);
      return { x, z, y: this.map.getHeightAt(x, z) + baseDelta, segmentId: p.segmentId, segment: p.segment };
    });
    return this.buildRibbon(shifted, width, material, yOffset);
  }

  drawPreview(a, b) {
    this.clearPreview();
    const length = dist2D(a, b);
    const n = Math.max(4, Math.min(44, Math.ceil(length / m(35))));
    const direct = this.normalize2D({ x: b.x - a.x, z: b.z - a.z }) || { x: 1, z: 0 };
    const fake = { id: '__rail_preview__', a: a.id, b: b.id || '__pointer__', geometry: this.defaultGeometry, elevation: this.defaultElevation };
    const tangentA = this.getEndpointTangent(fake, a, b, direct, true);
    const samples = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = this.defaultGeometry === 'smooth' && length > m(42) ? this.hermite2D(a, b, tangentA, direct, length * 0.66, t) : { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      samples.push({ x: p.x, z: p.z, y: this.map.getHeightAt(p.x, p.z) + m(1.15) + this.defaultElevation * this.bridgeLevelHeight });
    }
    const previewWidth = (this.defaultKind === 'single' ? m(7.2) : m(12.0)) + (this.defaultMode === 'metro' ? m(1.0) : 0);
    const group = new this.THREE.Group();
    const add = (mesh, order = 32) => { if (mesh) { mesh.renderOrder = order; group.add(mesh); } };
    add(this.buildRibbon(samples, previewWidth, this.materials.preview, m(0.4)), 30);
    const centers = this.defaultKind === 'single' ? [0] : [-m(3.05), m(3.05)];
    for (const center of centers) {
      add(this.buildOffsetRibbon(samples, center - m(0.72), m(0.22), this.materials.railMetal || this.materials.preview, m(0.86)), 34);
      add(this.buildOffsetRibbon(samples, center + m(0.72), m(0.22), this.materials.railMetal || this.materials.preview, m(0.86)), 34);
    }
    this.preview = group;
    this.previewGroup.add(this.preview);
  }


  drawStationPreview(point) {
    this.clearPreview();
    const hit = this.findNearestSegment(point, this.stationSnapDistance);
    if (!hit) return;
    const heading = this.segmentHeadingAt(hit.segment, (hit.index + hit.t) / Math.max(1, hit.samples.length - 1));
    const group = new this.THREE.Group();
    group.position.set(hit.x, this.map.getHeightAt(hit.x, hit.z) + m(1.0), hit.z);
    group.rotation.y = -heading;
    const mesh = new this.THREE.Mesh(new this.THREE.BoxGeometry(m(85), m(0.38), m(15)), this.materials.preview);
    mesh.position.y = m(0.12);
    group.add(mesh);
    this.preview = group;
    this.previewGroup.add(group);
  }

  drawStationHighlight(point) {
    this.clearPreview();
    const st = this.findNearestStation(point, 36);
    if (!st) return;
    const mesh = new this.THREE.Mesh(new this.THREE.CylinderGeometry(m(9), m(9), m(1.0), 24), this.materials.preview);
    mesh.position.set(st.x, this.map.getHeightAt(st.x, st.z) + m(2.2), st.z);
    this.preview = mesh;
    this.previewGroup.add(mesh);
  }

  clearPreview() {
    if (!this.preview) return;
    safeDisposeObject(this.preview);
    this.previewGroup.remove(this.preview);
    this.preview = null;
  }

  segmentHeadingAt(segment, t = 0.5) {
    const a = this.getNode(segment.a), b = this.getNode(segment.b);
    if (!a || !b) return 0;
    return Math.atan2(b.z - a.z, b.x - a.x);
  }

  buildRouteForLine(line) {
    if (line.id && line.id !== '__draft_rail__' && this.lineRouteCache.has(line.id)) return this.lineRouteCache.get(line.id);
    const stations = (line.stationIds || []).map(id => this.getStation(id)).filter(Boolean);
    if (stations.length < 2) return null;
    const samples = [];
    const segmentIds = [];
    const segmentBreaks = [];
    let distance = 0;
    const pairs = [];
    for (let i = 1; i < stations.length; i++) pairs.push([stations[i - 1], stations[i]]);
    if (line.loop && stations.length > 2) pairs.push([stations[stations.length - 1], stations[0]]);
    for (const [a, b] of pairs) {
      const route = this.findRouteBetweenStations(a, b);
      if (!route?.samples?.length) continue;
      const stamped = route.samples.map(s => ({ ...s, segmentId: s.segmentId, segment: s.segment }));
      if (samples.length) stamped.shift();
      samples.push(...stamped);
      for (const id of route.segmentIds || []) if (!segmentIds.includes(id)) segmentIds.push(id);
      for (const br of route.segmentBreaks || []) segmentBreaks.push({ ...br, startDistance: br.startDistance + distance, endDistance: br.endDistance + distance });
      distance += route.length || polylineLength(route.samples);
    }
    if (samples.length < 2) return null;
    const result = { samples, length: polylineLength(samples), segmentIds, segmentBreaks, vehicleType: 'train', lineId: line.id, stations };
    if (line.id && line.id !== '__draft_rail__') this.lineRouteCache.set(line.id, result);
    return result;
  }

  findRouteBetweenStations(aStation, bStation) {
    const aSeg = this.game.state.networks.rails.find(s => s.id === aStation.segmentId);
    const bSeg = this.game.state.networks.rails.find(s => s.id === bStation.segmentId);
    if (!aSeg || !bSeg) return null;
    if (aSeg.id === bSeg.id) return this.routeOnSingleSegment(aSeg, aStation.t, bStation.t);
    const candidates = [];
    for (const startNodeId of [aSeg.a, aSeg.b]) {
      for (const endNodeId of [bSeg.a, bSeg.b]) {
        const mid = this.dijkstra(startNodeId, endNodeId);
        if (!mid) continue;
        const startPartial = this.routeStationToNode(aStation, startNodeId);
        const endPartial = this.routeNodeToStation(endNodeId, bStation);
        const route = this.mergeRailRouteParts([startPartial, mid, endPartial]);
        if (route?.samples?.length) candidates.push(route);
      }
    }
    candidates.sort((a, b) => a.length - b.length);
    return candidates[0] || null;
  }

  routeOnSingleSegment(segment, t0, t1) {
    const n = Math.max(2, Math.ceil(Math.abs(t1 - t0) * 28));
    const samples = [];
    for (let i = 0; i <= n; i++) {
      const t = t0 + (t1 - t0) * (i / n);
      const s = this.sampleSegmentAt(segment, t);
      samples.push(s);
    }
    const length = polylineLength(samples);
    return { samples, length, segmentIds: [segment.id], segmentBreaks: [{ segmentId: segment.id, startDistance: 0, endDistance: length, segment }] };
  }

  routeStationToNode(station, nodeId) {
    const segment = this.game.state.networks.rails.find(s => s.id === station.segmentId);
    if (!segment) return null;
    const targetT = nodeId === segment.a ? 0 : 1;
    return this.routeOnSingleSegment(segment, station.t, targetT);
  }

  routeNodeToStation(nodeId, station) {
    const segment = this.game.state.networks.rails.find(s => s.id === station.segmentId);
    if (!segment) return null;
    const startT = nodeId === segment.a ? 0 : 1;
    return this.routeOnSingleSegment(segment, startT, station.t);
  }

  sampleSegmentAt(segment, t) {
    const a = this.getNode(segment.a), b = this.getNode(segment.b);
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    return { x, z, y: this.map.getHeightAt(x, z) + 1.05, t, segmentId: segment.id, segment };
  }

  mergeRailRouteParts(parts) {
    const samples = [], segmentIds = [], segmentBreaks = [];
    let distance = 0;
    for (const part of parts.filter(Boolean)) {
      if (!part.samples?.length) continue;
      const stamped = part.samples.map(s => ({ ...s }));
      if (samples.length) stamped.shift();
      samples.push(...stamped);
      for (const id of part.segmentIds || []) if (!segmentIds.includes(id)) segmentIds.push(id);
      for (const br of part.segmentBreaks || []) segmentBreaks.push({ ...br, startDistance: br.startDistance + distance, endDistance: br.endDistance + distance });
      distance += part.length || polylineLength(part.samples);
    }
    const length = polylineLength(samples);
    return samples.length > 1 ? { samples, length, segmentIds, segmentBreaks } : null;
  }

  dijkstra(startNodeId, endNodeId) {
    if (startNodeId === endNodeId) return { samples: [this.nodeSample(startNodeId)], length: 0, segmentIds: [], segmentBreaks: [] };
    const nodes = new Set(this.game.state.networks.railNodes.map(n => n.id));
    const dist = new Map();
    const prev = new Map();
    const visited = new Set();
    for (const id of nodes) dist.set(id, Infinity);
    dist.set(startNodeId, 0);
    while (visited.size < nodes.size) {
      let u = null, best = Infinity;
      for (const id of nodes) {
        if (!visited.has(id) && (dist.get(id) ?? Infinity) < best) { best = dist.get(id); u = id; }
      }
      if (!u || u === endNodeId) break;
      visited.add(u);
      for (const seg of this.game.state.networks.rails) {
        let v = null;
        if (seg.a === u) v = seg.b;
        else if (seg.b === u) v = seg.a;
        if (!v) continue;
        const a = this.getNode(seg.a), b = this.getNode(seg.b);
        const weight = dist2D(a, b);
        const alt = dist.get(u) + weight;
        if (alt < (dist.get(v) ?? Infinity)) { dist.set(v, alt); prev.set(v, { node: u, segment: seg }); }
      }
    }
    if (!prev.has(endNodeId)) return null;
    const pairs = [];
    let cur = endNodeId;
    while (cur !== startNodeId) {
      const p = prev.get(cur);
      if (!p) return null;
      pairs.unshift({ from: p.node, to: cur, segment: p.segment });
      cur = p.node;
    }
    const parts = [];
    for (const item of pairs) {
      const reverse = item.segment.a !== item.from;
      const samples = this.getSegmentSamples(item.segment, null, reverse).map(s => ({ ...s, y: s.y + 0.35 }));
      const length = polylineLength(samples);
      parts.push({ samples, length, segmentIds: [item.segment.id], segmentBreaks: [{ segmentId: item.segment.id, startDistance: 0, endDistance: length, segment: item.segment }] });
    }
    return this.mergeRailRouteParts(parts);
  }

  nodeSample(id) {
    const n = this.getNode(id);
    return n ? { x: n.x, z: n.z, y: this.map.getHeightAt(n.x, n.z) + 1.05 } : null;
  }

  updateMetrics() {
    const sim = this.game.state.simulation;
    const railLines = (this.game.state.transitLines || []).filter(l => l.mode === 'rail');
    let ridership = 0, revenue = 0, expenses = 0, weightedOccupancy = 0, vehicles = 0;
    for (const line of railLines) {
      this.updateLineMetrics(line);
      ridership += line.ridershipHourly || 0;
      revenue += line.revenueHourly || 0;
      expenses += line.expenseHourly || 0;
      weightedOccupancy += (line.occupancy || 0) * (line.vehicles || 1);
      vehicles += line.vehicles || 1;
    }
    sim.railStations = (this.game.state.railStations || []).length;
    sim.railLines = railLines.length;
    sim.railRidership = Math.round(ridership);
    sim.railOccupancy = vehicles ? Math.round(weightedOccupancy / vehicles) : 0;
    sim.railFareRevenueHourly = Math.round(revenue);
    sim.railExpensesHourly = Math.round(expenses);
    sim.passengersPerHour = Math.max(sim.passengersPerHour || 0, (sim.transitRidership || 0) + Math.round(ridership));
    sim.fareRevenueHourly = Math.round((sim.busFareRevenueHourly || 0) + (sim.railFareRevenueHourly || 0));
    sim.transitExpensesHourly = Math.round((sim.busTransitExpensesHourly || 0) + (sim.railExpensesHourly || 0));
  }

  updateLineMetrics(line) {
    const route = this.buildRouteForLine(line);
    const stations = (line.stationIds || []).map(id => this.getStation(id)).filter(Boolean);
    let coveredPop = 0, coveredJobs = 0;
    const covered = new Set();
    for (const b of this.game.state.buildings || []) {
      for (const st of stations) {
        if (dist2D(b, st) <= this.coverageRadius) {
          if (!covered.has(b.id)) {
            covered.add(b.id);
            coveredPop += b.residents || 0;
            coveredJobs += b.jobs || 0;
          }
          break;
        }
      }
    }
    const lineVehicles = Math.max(1, line.vehicles || 1);
    const lengthKm = meters(route?.length || line.length || 0) / 1000;
    const carsPerTrain = Math.max(3, line.carsPerTrain || (line.railMode === 'vlt' ? 4 : line.railMode === 'metro' ? 6 : 12));
    const carCapacity = GAME_BALANCE.vehicleCapacities.railCar;
    const normalPerTrain = normalCapacity(carCapacity) * carsPerTrain;
    const maxPerTrain = maxCapacity(carCapacity) * carsPerTrain;
    const cycleMinutes = Math.max(14, (lengthKm / 36) * 60 * 2 + stations.length * 0.75);
    const departuresPerHour = Math.max(1, lineVehicles * 60 / cycleMinutes);
    const capacityHourly = Math.max(1, Math.round(departuresPerHour * normalPerTrain));
    const maxCapacityHourly = Math.max(capacityHourly, Math.round(departuresPerHour * maxPerTrain));
    const demand = Math.min(coveredPop, coveredJobs + Math.round(coveredPop * 0.28)) * (0.18 + Math.min(0.42, stations.length * 0.04));
    const service = clamp(departuresPerHour / Math.max(0.35, lengthKm * 0.25), 0.42, 1.65);
    const rawRidership = Math.round(demand * service);
    const ridership = Math.min(rawRidership, maxCapacityHourly);
    line.length = Math.round(route?.length || 0);
    line.frequencyMin = Math.round(60 / departuresPerHour);
    line.carsPerTrain = carsPerTrain;
    line.capacitySeated = carCapacity.seated * carsPerTrain;
    line.capacityStanding = carCapacity.standing * carsPerTrain;
    line.capacityHourly = capacityHourly;
    line.maxCapacityHourly = maxCapacityHourly;
    line.ridershipHourly = Math.max(0, ridership);
    line.leftBehindHourly = Math.max(0, rawRidership - maxCapacityHourly);
    line.occupancy = capacityHourly ? Math.min(140, Math.round((ridership / capacityHourly) * 100)) : 0;
    line.overcrowded = line.occupancy > 100;
    line.comfortPenalty = Math.round(comfortPenaltyFromOccupancy(line.occupancy) * 100);
    line.qualityScore = comfortScoreFromOccupancy(line.occupancy);
    line.revenueHourly = Math.round(line.ridershipHourly * (line.fare || GAME_BALANCE.fare.rail));
    line.expenseHourly = Math.round(lineVehicles * (GAME_BALANCE.hourlyOperatingCost.railCrew + GAME_BALANCE.hourlyOperatingCost.railMaintenance) + lengthKm * GAME_BALANCE.hourlyOperatingCost.railEnergyPerKm + stations.length * 10);
    line.coveredPopulation = coveredPop;
    line.coveredJobs = coveredJobs;
    return line;
  }

  getRailVehiclePlan() {
    this.updateMetrics();
    const plans = [];
    for (const line of this.game.state.transitLines || []) {
      if (line.mode !== 'rail') continue;
      const route = this.buildRouteForLine(line);
      if (route?.length > 70) plans.push({ line, route, vehicles: Math.max(1, Math.min(6, line.vehicles || 1)) });
    }
    return plans;
  }
}
