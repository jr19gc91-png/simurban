import { closestPointOnPolyline, clamp, dist2D, makeId, pointAlongPolyline, polylineLength, safeDisposeObject, segmentPointDistance2D } from '../utils/MathUtils.js';
import { RoadRenderer } from '../roads/RoadRenderer.js';
import { legacyEndpointTransitions, legacyLaneCenterOffsets, legacyLaneLayout, legacyRoadSpec } from '../roads/LegacyRoadCore5m.js';
import { m } from '../utils/Scale.js';
export class RoadSystem {
  constructor({ game, materials }) {
    this.game = game;
    this.map = game.map;
    this.THREE = game.mapCore.THREE;
    this.materials = materials;
    this.group = game.groups.roads;
    this.previewGroup = game.groups.construction;
    this.pendingNodeId = null;
    this.preview = null;
    this.highlight = null;
    this.snapDistance = m(16);
    this.defaultKind = 'street';
    this.defaultLanes = 2;
    this.defaultSpeed = 50;
    this.defaultGeometry = 'smooth';
    this.defaultDirection = 'twoWay';
    this.defaultLaneClass = 'general';
    this.defaultSnap = true;
    this.defaultZoneable = true;
    this.defaultZoneLeft = true;
    this.defaultZoneRight = true;
    this.defaultZoneType = 'residential';
    this.elevationLevel = 0;
    this.roadWidth = m(25.1);
    this.sidewalkWidth = m(4);
    this.segmentSnapDistance = m(12);
    this.intersectionPadding = m(28);
    this.maxRoadSlope = 34;
    this.bridgeLevelHeight = m(14);
    this.renderer = new RoadRenderer(this);
  }
  isValidLaneClass(value) {
    return ['general', 'bus', 'emergency', 'service', 'mixed', 'bike', 'parking'].includes(value);
  }
  normalizeLaneClass(value = 'general') {
    return this.isValidLaneClass(value) ? value : 'general';
  }
  getLaneClassLabel(value = 'general') {
    return ({
      general: 'geral',
      bus: 'ônibus',
      emergency: 'emergência',
      service: 'serviços',
      mixed: 'mista',
      bike: 'ciclovia',
      parking: 'estacionamento'
    })[this.normalizeLaneClass(value)] || 'geral';
  }
  getConfiguredRoadWidth({ lanes = this.defaultLanes, direction = this.defaultDirection, kind = this.defaultKind } = {}) {
    return legacyRoadSpec({ lanes, direction, kind }).width;
  }
  getSegmentWidth(segment = {}) {
    return this.getConfiguredRoadWidth({
      lanes: segment.lanes || this.defaultLanes,
      direction: segment.direction || this.defaultDirection,
      kind: segment.kind || this.defaultKind
    });
  }
  getLaneLayout(segment = {}, width = this.getSegmentWidth(segment)) {
    return legacyLaneLayout(segment, width);
  }
  getLaneCenterOffsets(segment = {}, width = this.getSegmentWidth(segment)) {
    return legacyLaneCenterOffsets(segment, width);
  }
  getPrimaryLaneClass(segment) {
    const classes = (segment?.laneClasses || []).map(c => this.normalizeLaneClass(c)).filter(c => c !== 'general');
    if (classes.includes('bus')) return 'bus';
    if (classes.includes('emergency')) return 'emergency';
    if (classes.includes('service')) return 'service';
    if (classes.includes('bike')) return 'bike';
    if (classes.includes('parking')) return 'parking';
    if (classes.includes('mixed')) return 'mixed';
    return this.normalizeLaneClass(segment?.laneClass || 'general');
  }
  getLaneClassForLane(segment, laneIndex = 0) {
    if (!segment) return 'general';
    const lanes = Math.max(1, Math.min(5, segment.lanes || 1));
    const idx = Math.max(0, Math.min(lanes - 1, Math.round(laneIndex || 0)));
    return this.normalizeLaneClass(segment.laneClasses?.[idx] || segment.laneClass || 'general');
  }
  getAllowedVehicles(segment) {
    const cls = this.getPrimaryLaneClass(segment);
    if (cls === 'bus') return ['bus', 'emergency', 'service'];
    if (cls === 'emergency') return ['emergency', 'service'];
    if (cls === 'service') return ['service', 'emergency'];
    if (cls === 'bike') return ['bike', 'service'];
    if (cls === 'parking') return ['car', 'service', 'emergency'];
    if (cls === 'mixed') return ['car', 'bus', 'service', 'emergency'];
    return ['car', 'bus', 'service', 'emergency'];
  }
  clearVisuals() {
    this.group.clear();
    this.previewGroup.clear();
  }
  resetInteraction() {
    this.pendingNodeId = null;
    this.clearPreview();
    this.clearHighlight();
  }
  setRoadOptions({ roadType, kind, lanes, elevation, speed, geometry, direction, laneClass, snap, zoneable, zoneLeft, zoneRight, zoneType } = {}) {
    const type = roadType || kind;
    if (type === 'dirt' || type === 'street' || type === 'avenue') this.defaultKind = type;
    if (Number.isFinite(lanes)) this.defaultLanes = Math.max(1, Math.min(5, Math.round(lanes)));
    if (Number.isFinite(speed)) this.defaultSpeed = Math.max(30, Math.min(120, Math.round(speed / 10) * 10));
    if (Number.isFinite(elevation)) this.elevationLevel = Math.max(-5, Math.min(5, Math.round(elevation)));
    if (geometry === 'straight' || geometry === 'smooth') this.defaultGeometry = geometry;
    if (direction === 'twoWay' || direction === 'oneWay') this.defaultDirection = direction;
    if (this.isValidLaneClass(laneClass)) this.defaultLaneClass = laneClass;
    if (typeof snap === 'boolean') this.defaultSnap = snap;
    if (typeof zoneable === 'boolean') this.defaultZoneable = zoneable;
    if (typeof zoneLeft === 'boolean') this.defaultZoneLeft = zoneLeft;
    if (typeof zoneRight === 'boolean') this.defaultZoneRight = zoneRight;
    if (['residential', 'commercial', 'industrial'].includes(zoneType)) this.defaultZoneType = zoneType;
    if (this.defaultKind === 'dirt') {
      this.defaultLanes = 1;
      this.defaultDirection = 'twoWay';
      this.defaultLaneClass = 'general';
      this.defaultSpeed = Math.min(this.defaultSpeed || 30, 40);
      this.defaultZoneable = false;
    }
    this.roadWidth = this.getConfiguredRoadWidth({ lanes: this.defaultLanes, direction: this.defaultDirection, kind: this.defaultKind });
  }
  handleClick(point) {
    if (!point) return;
    const node = this.resolveBuildNode(point);
    if (!this.pendingNodeId) {
      this.pendingNodeId = node.id;
      this.render();
      return;
    }
    if (this.pendingNodeId === node.id) return;
    const a = this.getNode(this.pendingNodeId);
    const b = node;
    if (!a || !b || dist2D(a, b) < m(10)) return;
    const built = this.createNetworkPath(a.id, b.id, { lanes: this.defaultLanes, kind: this.defaultKind, elevation: this.elevationLevel, speedKmh: this.defaultSpeed, geometry: this.defaultGeometry, direction: this.defaultDirection, laneClass: this.defaultLaneClass, zoneable: this.defaultZoneable, zoneLeft: this.defaultZoneLeft, zoneRight: this.defaultZoneRight, zoneType: this.defaultZoneType });
    if (!built.length) {
      const isLooseNode = !this.game.state.networks.roads.some(seg => seg.a === b.id || seg.b === b.id);
      if (isLooseNode) this.game.state.networks.roadNodes = this.game.state.networks.roadNodes.filter(item => item.id !== b.id);
      this.game.state.inspector.text = 'Construção não criada: segmento muito curto ou duplicado.';
      this.render();
      this.game.emitChange();
      return;
    }
    this.pendingNodeId = b.id;
    this.clearNaturalObstaclesForSegments(built);
    this.game.systems.zoning?.generateGridForSegments?.(built);
    this.game.state.simulation.money -= Math.round(built.reduce((sum, seg) => sum + this.getSegmentLength(seg), 0) * 38);
    this.game.rebuildCitySystems({ roads: true, zoning: true, buildings: true, vehicles: true });
    this.game.emitChange();
  }
  handlePointerMove(point) {
    if (!this.pendingNodeId || !point) {
      this.clearPreview();
      return;
    }
    const a = this.getNode(this.pendingNodeId);
    if (!a) return;
    const anchor = this.findBuildAnchor(point);
    const b = anchor?.node || anchor?.point || point;
    this.drawPreview(a, b, this.roadWidth);
  }
  handleUpgrade(point) {
    const hit = this.findNearestSegment(point, m(50));
    if (!hit) {
      this.game.state.inspector.text = 'Upgrade: clique em uma via existente.';
      this.game.emitChange();
      return false;
    }
    const segment = hit.segment;
    const oldLanes = segment.lanes || 2;
    const oldSpeed = segment.speedKmh || 50;
    const oldGeometry = segment.geometry || 'straight';
    const oldDirection = segment.direction || 'twoWay';
    const oldLaneClass = this.normalizeLaneClass(segment.laneClass || 'general');
    const oldKind = segment.kind || 'street';
    const newKind = this.defaultKind;
    const newLanes = this.defaultLanes;
    const newSpeed = this.defaultSpeed;
    const newGeometry = this.defaultGeometry;
    const newDirection = this.defaultDirection;
    const newLaneClass = this.defaultLaneClass;
    if (oldKind === newKind && oldLanes === newLanes && oldSpeed === newSpeed && oldGeometry === newGeometry && oldDirection === newDirection && oldLaneClass === newLaneClass) {
      this.game.state.inspector.text = `Via já está em ${newLanes} faixa(s) e ${newSpeed} km/h.`;
      this.game.emitChange();
      return false;
    }
    segment.kind = newKind;
    segment.lanes = newLanes;
    segment.speedKmh = newSpeed;
    segment.geometry = newGeometry;
    segment.direction = newDirection;
    segment.laneClass = newLaneClass;
    segment.laneClasses = Array.from({ length: Math.max(1, Math.min(5, newLanes)) }, () => newLaneClass);
    segment.zoneable = newKind === 'dirt' ? false : this.defaultZoneable !== false;
    segment.zoneLeft = this.defaultZoneLeft !== false;
    segment.zoneRight = this.defaultZoneRight !== false;
    segment.zoneType = this.defaultZoneType || segment.zoneType || 'residential';
    const len = this.getSegmentLength(segment);
    const laneDelta = Math.abs(newLanes - oldLanes);
    const speedDelta = Math.abs(newSpeed - oldSpeed) / 10;
    this.game.state.simulation.money -= Math.round(len * (18 + laneDelta * 24 + speedDelta * 5));
    this.game.state.inspector.text = `Via atualizada: ${newLanes} faixa(s), ${newSpeed} km/h, ${newDirection === 'oneWay' ? 'mão única' : 'mão dupla'}, faixa ${this.getLaneClassLabel(newLaneClass)}, traçado ${newGeometry === 'smooth' ? 'suave' : 'reto'}.`;
    this.game.rebuildCitySystems({ roads: true, zoning: true, buildings: true, vehicles: true });
    this.game.emitChange();
    return true;
  }
  handleDemolish(point) {
    const hit = this.findNearestSegment(point, m(50));
    if (!hit) return false;
    this.game.state.networks.roads = this.game.state.networks.roads.filter(seg => seg.id !== hit.segment.id);
    const used = new Set();
    for (const seg of this.game.state.networks.roads) {
      used.add(seg.a); used.add(seg.b);
    }
    this.game.state.networks.roadNodes = this.game.state.networks.roadNodes.filter(node => used.has(node.id));
    this.game.state.zoning = this.game.state.zoning.filter(z => z.roadId !== hit.segment.id);
    const lotIds = new Set(this.game.state.zoning.map(z => z.id));
    this.game.state.buildings = this.game.state.buildings.filter(b => lotIds.has(b.lotId));
    this.game.state.simulation.money -= 750;
    this.resetInteraction();
    this.game.rebuildCitySystems({ roads: true, zoning: true, buildings: true, vehicles: true });
    this.game.emitChange();
    return true;
  }
  createNode(point) {
    const node = {
      id: makeId('rn'),
      x: point.x,
      z: point.z,
      y: this.map.getHeightAt(point.x, point.z),
      elevation: this.elevationLevel
    };
    this.game.state.networks.roadNodes.push(node);
    return node;
  }
  createSegment(aId, bId, opts = {}) {
    if (this.game.state.networks.roads.some(seg => (seg.a === aId && seg.b === bId) || (seg.a === bId && seg.b === aId))) {
      return null;
    }
    const kind = opts.kind || this.defaultKind;
    const isDirt = kind === 'dirt';
    const aNode = this.getNode(aId);
    const bNode = this.getNode(bId);
    const elevation = Number.isFinite(opts.elevation) ? opts.elevation : 0;
    const segment = {
      id: makeId('road'),
      a: aId,
      b: bId,
      lanes: isDirt ? 1 : (opts.lanes || this.defaultLanes),
      kind,
      elevation,
      startLevel: Number.isFinite(aNode?.elevation) ? aNode.elevation : elevation,
      endLevel: Number.isFinite(bNode?.elevation) ? bNode.elevation : elevation,
      speedKmh: isDirt ? Math.min(40, opts.speedKmh || this.defaultSpeed || 30) : (opts.speedKmh || this.defaultSpeed),
      geometry: opts.geometry || this.defaultGeometry,
      direction: isDirt ? 'twoWay' : (opts.direction || this.defaultDirection),
      laneClass: isDirt ? 'general' : this.normalizeLaneClass(opts.laneClass || this.defaultLaneClass),
      laneClasses: isDirt ? undefined : Array.from({ length: Math.max(1, Math.min(5, opts.lanes || this.defaultLanes)) }, () => this.normalizeLaneClass(opts.laneClass || this.defaultLaneClass)),
      zoneable: isDirt ? false : opts.zoneable !== false,
      zoneLeft: opts.zoneLeft !== false,
      zoneRight: opts.zoneRight !== false,
      zoneType: opts.zoneType || this.defaultZoneType || 'residential',
      createdAtDay: this.game.state.simulation.day
    };
    this.game.state.networks.roads.push(segment);
    return segment;
  }
  resolveBuildNode(point) {
    const anchor = this.findBuildAnchor(point);
    if (anchor?.node) return anchor.node;
    if (anchor?.segment) return this.splitSegmentAt(anchor.segment, anchor.point, anchor.t)?.node || this.createNode(anchor.point);
    return this.createNode(point);
  }
  findBuildAnchor(point) {
    if (!this.defaultSnap) return null;
    const node = this.findNearestNode(point, this.snapDistance);
    if (node) return { type: 'node', node };
    const hit = this.findNearestSegment(point, this.segmentSnapDistance);
    if (!hit || hit.t <= 0.04 || hit.t >= 0.96) return null;
    const snapPoint = { x: hit.x, z: hit.z, y: this.map.getHeightAt(hit.x, hit.z) };
    return { type: 'segment', segment: hit.segment, point: snapPoint, t: hit.t };
  }
  createNetworkPath(aId, bId, opts = {}) {
    const a = this.getNode(aId);
    const b = this.getNode(bId);
    if (!a || !b || dist2D(a, b) < m(10)) return [];
    if (!this.canBuildSegment(a, b, opts)) return [];
    const route = [{ node: a, t: 0 }, { node: b, t: 1 }];
    const existingSegments = [...this.game.state.networks.roads];
    for (const segment of existingSegments) {
      if (segment.a === a.id || segment.b === a.id || segment.a === b.id || segment.b === b.id) continue;
      if ((segment.elevation || 0) !== (opts.elevation || 0)) continue;
      const c = this.getNode(segment.a);
      const d = this.getNode(segment.b);
      if (!c || !d) continue;
      const hit = this.lineIntersection2D(a, b, c, d);
      if (!hit) continue;
      if (hit.t <= 0.035 || hit.t >= 0.965 || hit.u <= 0.035 || hit.u >= 0.965) continue;
      const nearExisting = this.findNearestNode(hit, Math.max(m(10), this.snapDistance * 0.38));
      let node = nearExisting;
      if (!node) node = this.splitSegmentAt(segment, hit, hit.u)?.node;
      if (node && !route.some(item => item.node.id === node.id)) route.push({ node, t: hit.t });
    }
    route.sort((p, q) => p.t - q.t);
    const created = [];
    for (let i = 1; i < route.length; i++) {
      const from = route[i - 1].node;
      const to = route[i].node;
      if (!from || !to || from.id === to.id || dist2D(from, to) < m(10)) continue;
      if (!this.canBuildSegment(from, to, opts)) continue;
      const seg = this.createSegment(from.id, to.id, opts);
      if (seg) created.push(seg);
    }
    return created;
  }
  splitSegmentAt(segment, point, t = null) {
    const a = this.getNode(segment.a);
    const b = this.getNode(segment.b);
    if (!a || !b) return null;
    const resolved = t == null ? segmentPointDistance2D(point, a, b) : { t, x: point.x, z: point.z };
    if (resolved.t <= 0.04 || resolved.t >= 0.96) return null;
    const x = resolved.x;
    const z = resolved.z;
    const node = this.createNode({ x, z, y: this.map.getHeightAt(x, z) });
    node.elevation = segment.elevation || 0;
    const originalB = segment.b;
    const originalEndLevel = segment.endLevel;
    segment.b = node.id;
    segment.endLevel = segment.elevation || 0;
    const clone = {
      ...segment,
      id: makeId('road'),
      a: node.id,
      b: originalB,
      startLevel: segment.elevation || 0,
      endLevel: Number.isFinite(originalEndLevel) ? originalEndLevel : (segment.elevation || 0),
      createdAtDay: this.game.state.simulation.day
    };
    this.game.state.networks.roads.push(clone);
    return { node, segments: [segment, clone] };
  }
  lineIntersection2D(a, b, c, d) {
    const rX = b.x - a.x;
    const rZ = b.z - a.z;
    const sX = d.x - c.x;
    const sZ = d.z - c.z;
    const denom = rX * sZ - rZ * sX;
    if (Math.abs(denom) < 0.00001) return null;
    const qX = c.x - a.x;
    const qZ = c.z - a.z;
    const t = (qX * sZ - qZ * sX) / denom;
    const u = (qX * rZ - qZ * rX) / denom;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;
    return { x: a.x + rX * t, z: a.z + rZ * t, y: this.map.getHeightAt(a.x + rX * t, a.z + rZ * t), t, u };
  }
  canBuildSegment(a, b, opts = {}) {
    const len = dist2D(a, b);
    if (!Number.isFinite(len) || len < m(10)) return false;
    return true;
  }
  clearNaturalObstaclesForSegments(segments = []) {
    let removed = 0;
    for (const segment of segments) {
      const samples = this.getSegmentSamples(segment, 18);
      const radius = this.getSegmentWidth(segment) * 0.5 + m(8);
      removed += this.game.mapCore.clearNaturalObstaclesAlongPath?.(samples, radius) || 0;
    }
    if (removed > 0) this.game.state.inspector.text = `Via construída. ${removed} árvore(s)/rocha(s)/detalhe(s) removidos da faixa da obra.`;
    return removed;
  }
  getNode(id) {
    return this.game.state.networks.roadNodes.find(node => node.id === id) || null;
  }
  findNearestNode(point, radius = this.snapDistance) {
    let best = null;
    for (const node of this.game.state.networks.roadNodes) {
      const d = dist2D(point, node);
      if (d <= radius && (!best || d < best.d)) best = { node, d };
    }
    return best?.node || null;
  }
  findNearestSegment(point, radius = m(60)) {
    let best = null;
    for (const segment of this.game.state.networks.roads) {
      const samples = this.getSegmentSamples(segment);
      const hit = closestPointOnPolyline(point, samples);
      if (hit && hit.distance <= radius && (!best || hit.distance < best.distance)) best = { ...hit, segment, samples };
    }
    return best;
  }
  cleanupNetwork() {
    const nodeMap = new Map();
    const remap = new Map();
    const mergedNodes = [];
    for (const node of this.game.state.networks.roadNodes) {
      const key = `${Math.round(node.x * 10) / 10}:${Math.round(node.z * 10) / 10}:${node.elevation || 0}`;
      const existing = nodeMap.get(key);
      if (existing) {
        remap.set(node.id, existing.id);
      } else {
        nodeMap.set(key, node);
        remap.set(node.id, node.id);
        mergedNodes.push(node);
      }
    }
    this.game.state.networks.roadNodes = mergedNodes;
    const seen = new Set();
    const valid = [];
    for (const raw of this.game.state.networks.roads) {
      const a = remap.get(raw.a) || raw.a;
      const b = remap.get(raw.b) || raw.b;
      if (a === b) continue;
      const seg = { ...raw, a, b, kind: raw.kind || 'street', direction: raw.direction || 'twoWay', geometry: raw.geometry || 'straight', laneClass: this.normalizeLaneClass(raw.laneClass || 'general'), laneClasses: Array.isArray(raw.laneClasses) ? raw.laneClasses.map(c => this.normalizeLaneClass(c)) : undefined };
      if (seg.kind === 'dirt') { seg.lanes = 1; seg.speedKmh = Math.min(Number(seg.speedKmh) || 30, 40); }
      if (!this.getNode(seg.a) || !this.getNode(seg.b) || this.getSegmentLength(seg) < 8) continue;
      const pair = [seg.a, seg.b].sort().join('|');
      const key = `${pair}:${seg.elevation || 0}`;
      if (seen.has(key)) continue;
      seen.add(key);
      valid.push(seg);
    }
    this.game.state.networks.roads = valid;
    const used = new Set();
    for (const seg of this.game.state.networks.roads) { used.add(seg.a); used.add(seg.b); }
    this.game.state.networks.roadNodes = this.game.state.networks.roadNodes.filter(node => used.has(node.id));
  }
  getRoadGraph(vehicleType = null) {
    const nodes = new Map(this.game.state.networks.roadNodes.map(node => [node.id, node]));
    const edges = new Map();
    for (const node of nodes.values()) edges.set(node.id, []);
    for (const seg of this.game.state.networks.roads) {
      const a = nodes.get(seg.a), b = nodes.get(seg.b);
      if (!a || !b) continue;
      const allowed = this.getAllowedVehicles(seg);
      if (vehicleType && !allowed.includes(vehicleType)) continue;
      const length = this.getSegmentLength(seg);
      const speed = Math.max(20, Number(seg.speedKmh) || 50);
      const cost = length / speed;
      edges.get(seg.a)?.push({ from: seg.a, to: seg.b, segment: seg, length, speedKmh: speed, cost, allowed });
      if ((seg.direction || 'twoWay') !== 'oneWay') {
        edges.get(seg.b)?.push({ from: seg.b, to: seg.a, segment: seg, length, speedKmh: speed, cost, allowed });
      }
    }
    return { nodes, edges };
  }
  getNearestUsableRoadNode(point, vehicleType = 'car', maxDistance = 220) {
    const graph = this.getRoadGraph(vehicleType);
    let best = null;
    for (const node of graph.nodes.values()) {
      const degree = graph.edges.get(node.id)?.length || 0;
      if (degree <= 0) continue;
      const d = dist2D(point, node);
      if (d <= maxDistance && (!best || d < best.d)) best = { node, d };
    }
    return best?.node || null;
  }
  findPath(startNodeId, endNodeId, vehicleType = 'car') {
    if (!startNodeId || !endNodeId || startNodeId === endNodeId) return null;
    const graph = this.getRoadGraph(vehicleType);
    if (!graph.nodes.has(startNodeId) || !graph.nodes.has(endNodeId)) return null;
    const dist = new Map();
    const prev = new Map();
    const open = new Set(graph.nodes.keys());
    for (const id of open) dist.set(id, Infinity);
    dist.set(startNodeId, 0);
    while (open.size) {
      let current = null;
      let best = Infinity;
      for (const id of open) {
        const d = dist.get(id);
        if (d < best) { best = d; current = id; }
      }
      if (!current || best === Infinity) break;
      open.delete(current);
      if (current === endNodeId) break;
      for (const edge of graph.edges.get(current) || []) {
        if (!open.has(edge.to)) continue;
        const prevStep = prev.get(current);
        const traffic = this.game.systems?.traffic;
        if (prevStep?.edge?.segment && traffic?.isTransitionAllowed && !traffic.isTransitionAllowed(current, prevStep.edge.segment, edge.segment, vehicleType)) continue;
        const lanePenalty = this.getLaneClassTravelPenalty(edge.segment, vehicleType);
        const levelPenalty = Math.abs(edge.segment.elevation || 0) * 0.002;
        const alt = best + edge.cost * lanePenalty + levelPenalty;
        if (alt < dist.get(edge.to)) {
          dist.set(edge.to, alt);
          prev.set(edge.to, { id: current, edge });
        }
      }
    }
    if (!prev.has(endNodeId)) return null;
    const edges = [];
    let cursor = endNodeId;
    while (cursor !== startNodeId) {
      const step = prev.get(cursor);
      if (!step) return null;
      edges.unshift(step.edge);
      cursor = step.id;
    }
    return edges;
  }
  getLaneClassTravelPenalty(segment, vehicleType = 'car') {
    const cls = this.getPrimaryLaneClass(segment);
    if (vehicleType === 'bus') {
      if (cls === 'bus') return 0.78;
      if (cls === 'mixed') return 0.90;
      return 1.12;
    }
    if (vehicleType === 'emergency') return cls === 'emergency' ? 0.72 : 0.92;
    if (vehicleType === 'service') return cls === 'service' ? 0.84 : 1.02;
    if (cls === 'parking') return 1.18;
    return 1.0;
  }
  buildRouteFromEdges(edges, vehicleType = 'car') {
    if (!edges?.length) return null;
    const samples = [];
    const segmentIds = [];
    const segmentBreaks = [];
    let length = 0;
    for (const edge of edges) {
      let segSamples = this.getSegmentSamples(edge.segment);
      if (edge.from === edge.segment.b && edge.to === edge.segment.a) segSamples = [...segSamples].reverse();
      if (segSamples.length < 2) continue;
      const stamped = segSamples.map(p => ({ ...p, segmentId: edge.segment.id, roadSegment: edge.segment }));
      if (samples.length) stamped.shift();
      const before = samples.length;
      samples.push(...stamped);
      const segLen = polylineLength(segSamples);
      segmentBreaks.push({ segmentId: edge.segment.id, from: edge.from, to: edge.to, startDistance: length, endDistance: length + segLen, segment: edge.segment });
      segmentIds.push(edge.segment.id);
      length += segLen;
      if (before === samples.length) continue;
    }
    if (samples.length < 2 || length <= 0) return null;
    return { samples, length, segmentIds, segmentBreaks, segment: edges[0].segment, vehicleType };
  }
  findVehicleRouteBetweenPoints(origin, destination, vehicleType = 'car') {
    const start = this.getNearestUsableRoadNode(origin, vehicleType);
    const end = this.getNearestUsableRoadNode(destination, vehicleType);
    if (!start || !end || start.id === end.id) return null;
    const edges = this.findPath(start.id, end.id, vehicleType);
    return this.buildRouteFromEdges(edges, vehicleType);
  }
  getSegmentSamples(segment, steps = null) {
    const a = this.getNode(segment.a);
    const b = this.getNode(segment.b);
    if (!a || !b) return [];
    const length = dist2D(a, b);
    const n = steps ?? Math.max(12, Math.min(132, Math.ceil(length / m(24))));
    const useSmooth = (segment.geometry || 'straight') === 'smooth' && length > m(34);
    const samples = [];
    const level = segment.elevation || 0;
    const transition = legacyEndpointTransitions(this, segment);
    const direct = this.normalize2D({ x: b.x - a.x, z: b.z - a.z }) || { x: 1, z: 0 };
    const tangentA = useSmooth ? this.getEndpointTangent(segment, a, b, direct, true) : direct;
    const tangentB = useSmooth ? this.getEndpointTangent(segment, b, a, direct, false) : direct;
    const tangentScale = useSmooth ? length * 0.46 : length;
    const startRamp = transition.rampStart;
    const endRamp = transition.rampEnd;
    const rampLength = Math.max(m(70), Math.min(length * 0.34, m(190)));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      let x, z;
      if (useSmooth) {
        const p = this.hermite2D(a, b, tangentA, tangentB, tangentScale, t);
        x = p.x; z = p.z;
      } else {
        x = a.x + (b.x - a.x) * t;
        z = a.z + (b.z - a.z) * t;
      }
      const ground = this.map.getHeightAt(x, z) + 0.42;
      let visualLevel = level;
      const distFromStart = length * t;
      const distToEnd = length * (1 - t);
      if (startRamp && distFromStart < rampLength) {
        const eased = this.easeRamp(distFromStart / rampLength);
        visualLevel = transition.startLevel + (level - transition.startLevel) * eased;
      }
      if (endRamp && distToEnd < rampLength) {
        const eased = this.easeRamp(distToEnd / rampLength);
        const endLevel = transition.endLevel + (level - transition.endLevel) * eased;
        if (startRamp && distFromStart < rampLength) {
          const blend = distFromStart / Math.max(0.001, distFromStart + distToEnd);
          visualLevel = visualLevel * (1 - blend) + endLevel * blend;
        } else {
          visualLevel = endLevel;
        }
      }
      const y = ground + visualLevel * this.bridgeLevelHeight;
      samples.push({ x, y, z, t });
    }
    return samples;
  }
  hasSameLevelContinuation(segment, nodeId) {
    return (this.game.state.networks.roads || []).some(seg => {
      if (seg.id === segment.id) return false;
      if ((seg.elevation || 0) !== (segment.elevation || 0)) return false;
      return seg.a === nodeId || seg.b === nodeId;
    });
  }
  easeRamp(t) {
    const clamped = Math.max(0, Math.min(1, t || 0));
    return clamped * clamped * (3 - 2 * clamped);
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
    const sameLevel = segment.elevation || 0;
    const connected = this.game.state.networks.roads.filter(seg => {
      if (seg.id === segment.id) return false;
      if ((seg.elevation || 0) !== sameLevel) return false;
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
  getSegmentLength(segment) {
    const samples = this.getSegmentSamples(segment);
    return polylineLength(samples);
  }
  getAllRoadPaths() {
    return this.game.state.networks.roads.map(segment => {
      const samples = this.getSegmentSamples(segment);
      return { segment, samples, length: polylineLength(samples) };
    }).filter(path => path.samples.length > 1);
  }
  render() {
    this.renderer.render();
  }
  renderSegment(segment) {
    const samples = this.getSegmentSamples(segment);
    if (samples.length < 2) return;
    const width = this.getSegmentWidth(segment);
    const level = segment.elevation || 0;
    const isTunnel = level < 0;
    const baseMesh = this.buildRibbon(samples, width + 3.4, this.materials.roadBase || this.materials.roadEdge, -0.03);
    baseMesh.receiveShadow = true;
    baseMesh.renderOrder = 3;
    this.group.add(baseMesh);
    const roadMesh = this.buildRibbon(samples, width, isTunnel ? this.materials.tunnelPortal : this.materials.road, 0.06);
    roadMesh.name = `road-${segment.id}`;
    roadMesh.userData.segmentId = segment.id;
    roadMesh.receiveShadow = true;
    roadMesh.renderOrder = 4;
    this.group.add(roadMesh);
    this.renderAsphaltWear(segment, samples, width);
    this.renderRoadEdges(segment, samples, width);
    this.renderLaneClassOverlay(segment, samples, width);
    if (this.shouldRenderSidewalk(segment)) this.renderSidewalks(segment, samples, width);
    this.renderLaneMarkings(segment, samples, width);
    this.renderDirectionArrows(segment, samples, width);
    if (level > 0) {
      this.renderBridgeDetails(segment, samples, width);
    } else if (level < 0) {
      this.renderTunnelDetails(segment, samples, width);
    }
  }
  renderRoadEdges(segment, samples, width) {
    const edgeOffset = width / 2 - 0.55;
    this.group.add(this.buildOffsetRibbon(samples, edgeOffset, 0.72, this.materials.roadEdge, 0.15));
    this.group.add(this.buildOffsetRibbon(samples, -edgeOffset, 0.72, this.materials.roadEdge, 0.15));
    if ((segment.elevation || 0) === 0) {
      this.group.add(this.buildDashedMarking(samples, width / 2 - 1.65, 0.28, this.materials.laneEdgeWhite, 0.23));
      this.group.add(this.buildDashedMarking(samples, -(width / 2 - 1.65), 0.28, this.materials.laneEdgeWhite, 0.23));
    }
  }
  renderSidewalks(segment, samples, width) {
    const walkOffset = width / 2 + this.sidewalkWidth / 2 + 0.7;
    const curbOffset = width / 2 + 0.45;
    const leftWalk = this.buildOffsetRibbon(samples, walkOffset, this.sidewalkWidth, this.materials.sidewalk, 0.07);
    const rightWalk = this.buildOffsetRibbon(samples, -walkOffset, this.sidewalkWidth, this.materials.sidewalk, 0.07);
    const leftCurb = this.buildOffsetRibbon(samples, curbOffset, 0.82, this.materials.curb || this.materials.sidewalk, 0.33);
    const rightCurb = this.buildOffsetRibbon(samples, -curbOffset, 0.82, this.materials.curb || this.materials.sidewalk, 0.33);
    this.group.add(leftWalk, rightWalk, leftCurb, rightCurb);
  }
  renderLaneMarkings(segment, samples, width) {
    const layout = this.getLaneLayout(segment, width);
    const { lanes, direction, laneWidth, innerHalf } = layout;
    if (direction === 'oneWay') {
      for (let i = 1; i < lanes; i++) {
        const offset = -innerHalf + i * laneWidth;
        this.group.add(this.buildDashedMarking(samples, offset, 0.32, this.materials.laneWhite, 0.31, { dash: 9, gap: 10 }));
      }
      return;
    }
    this.group.add(this.buildMarking(samples, -0.48, 0.34, this.materials.laneYellow, 0.32));
    this.group.add(this.buildMarking(samples, 0.48, 0.34, this.materials.laneYellow, 0.32));
    for (let i = 1; i < lanes; i++) {
      const offset = i * laneWidth + 0.48;
      this.group.add(this.buildDashedMarking(samples, offset, 0.30, this.materials.laneWhite, 0.33, { dash: 9, gap: 10 }));
      this.group.add(this.buildDashedMarking(samples, -offset, 0.30, this.materials.laneWhite, 0.33, { dash: 9, gap: 10 }));
    }
  }
  renderAsphaltWear(segment, samples, width) {
    if (!this.materials.roadWear) return;
    const layout = this.getLaneLayout(segment, width);
    const offsets = [];
    if (layout.direction === 'oneWay') {
      for (let i = 0; i < layout.lanes; i++) offsets.push(-layout.innerHalf + layout.laneWidth * (i + 0.5));
    } else {
      for (let i = 0; i < layout.lanes; i++) {
        const off = layout.laneWidth * (i + 0.5) + 0.58;
        offsets.push(off, -off);
      }
    }
    for (const offset of offsets) {
      this.group.add(this.buildOffsetRibbon(samples, offset, Math.min(1.15, layout.laneWidth * 0.26), this.materials.roadWear, 0.18));
    }
    if (this.materials.roadPatch && polylineLength(samples) > 80) {
      const mid = pointAlongPolyline(samples, polylineLength(samples) * 0.47);
      if (mid) this.group.add(this.buildFlatRect({ ...mid, y: mid.y + 0.18 }, mid.heading || 0, Math.min(18, width * 0.72), Math.min(width * 0.70, 14), this.materials.roadPatch, 0.04));
    }
  }
  renderLaneClassOverlay(segment, samples, width) {
    const cls = this.normalizeLaneClass(segment.laneClass || 'general');
    if (cls === 'general') return;
    const layout = this.getLaneLayout(segment, width);
    const laneWidth = Math.max(2.8, layout.laneWidth * 0.86);
    const outerRight = -layout.innerHalf + layout.laneWidth * 0.5;
    const outerLeft = layout.innerHalf - layout.laneWidth * 0.5;
    const bothEdges = layout.direction === 'oneWay' ? [outerRight] : [outerRight, outerLeft];
    if (cls === 'bus') {
      for (const offset of bothEdges) this.group.add(this.buildOffsetRibbon(samples, offset, laneWidth, this.materials.busLane, 0.28));
      return;
    }
    if (cls === 'emergency') {
      for (const offset of bothEdges) this.group.add(this.buildOffsetRibbon(samples, offset, laneWidth * 0.82, this.materials.emergencyLane, 0.28));
      return;
    }
    if (cls === 'service') {
      this.group.add(this.buildOffsetRibbon(samples, 0, Math.max(2.8, width * 0.20), this.materials.serviceLane, 0.26));
      return;
    }
    if (cls === 'mixed') {
      this.group.add(this.buildOffsetRibbon(samples, 0, Math.max(3.2, width * 0.24), this.materials.mixedLane, 0.26));
      return;
    }
    if (cls === 'bike') {
      for (const offset of bothEdges) this.group.add(this.buildOffsetRibbon(samples, offset, laneWidth * 0.70, this.materials.bikeLane, 0.30));
      return;
    }
    if (cls === 'parking') {
      for (const offset of bothEdges) this.group.add(this.buildOffsetRibbon(samples, offset, laneWidth, this.materials.parkingLane, 0.25));
      this.renderParkedCars(segment, samples, width, laneWidth);
    }
  }
  renderParkedCars(segment, samples, width, laneWidth) {
    if ((segment.elevation || 0) !== 0 || samples.length < 3) return;
    const length = polylineLength(samples);
    if (length < m(58)) return;
    const carGeo = new this.THREE.BoxGeometry(m(4.6), m(1.35), m(2.1));
    const mats = [0x9e4135, 0x2f5f8e, 0xd2cfc2, 0x2e3031, 0x5b7d52, 0xb9853b].map(color => new this.THREE.MeshStandardMaterial({ color, roughness: 0.78, flatShading: true }));
    const count = Math.min(12, Math.floor(length / m(42)));
    for (let i = 0; i < count; i++) {
      const distance = m(28) + i * m(42);
      const base = pointAlongPolyline(samples, distance);
      if (!base) continue;
      const sideSign = i % 2 === 0 ? -1 : 1;
      if ((segment.direction || 'twoWay') === 'oneWay' && sideSign > 0) continue;
      const offset = sideSign * (width / 2 - laneWidth * 0.55);
      const center = this.offsetPointByHeading(base, offset);
      const car = new this.THREE.Mesh(carGeo, mats[i % mats.length]);
      car.position.set(center.x, center.y + m(1.16), center.z);
      car.rotation.y = -base.heading;
      car.castShadow = true;
      car.receiveShadow = true;
      this.group.add(car);
    }
  }
  shouldRenderSidewalk(segment) {
    if (segment.zoneable === false) return false;
    if ((segment.elevation || 0) !== 0) return false;
    return true;
  }
  renderBridgeDetails(segment, samples, width) {
    const leftBarrier = this.buildOffsetRibbon(samples, width / 2 + m(1.1), m(1.2), this.materials.bridgeBarrier, 1.05);
    const rightBarrier = this.buildOffsetRibbon(samples, -(width / 2 + m(1.1)), m(1.2), this.materials.bridgeBarrier, 1.05);
    this.group.add(leftBarrier, rightBarrier);
    const pillarGeo = new this.THREE.CylinderGeometry(m(1.6), m(2.2), 1, 10);
    const every = Math.max(3, Math.floor(samples.length / Math.max(2, Math.ceil(this.getSegmentLength(segment) / m(90)))));
    for (let i = every; i < samples.length - 1; i += every) {
      const p = samples[i];
      const ground = this.map.getHeightAt(p.x, p.z);
      const h = Math.max(m(5), p.y - ground - m(0.6));
      const pillar = new this.THREE.Mesh(pillarGeo, this.materials.bridgeConcrete);
      pillar.scale.set(1, h, 1);
      pillar.position.set(p.x, ground + h / 2, p.z);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      this.group.add(pillar);
    }
  }
  renderTunnelDetails(segment, samples, width) {
    const ghost = this.buildDashedMarking(samples.map(p => ({
      ...p,
      y: this.map.getHeightAt(p.x, p.z) + m(0.72)
    })), 0, Math.max(m(3), width * 0.38), this.materials.tunnelGhost, 0.18);
    this.group.add(ghost);
    this.buildTunnelPortal(samples, width, true);
    this.buildTunnelPortal(samples, width, false);
  }
  buildTunnelPortal(samples, width, atStart) {
    const p = atStart ? samples[0] : samples[samples.length - 1];
    const q = atStart ? samples[1] : samples[samples.length - 2];
    if (!p || !q) return;
    const heading = Math.atan2(q.z - p.z, q.x - p.x);
    const geo = new this.THREE.BoxGeometry(width + m(8), m(10), m(4));
    const portal = new this.THREE.Mesh(geo, this.materials.tunnelPortal);
    portal.position.set(p.x, this.map.getHeightAt(p.x, p.z) + m(5.1), p.z);
    portal.rotation.y = -heading;
    portal.castShadow = true;
    portal.receiveShadow = true;
    this.group.add(portal);
  }
  renderNode(node, selected = false) {
    if (!selected) return;
    const geo = new this.THREE.CylinderGeometry(m(6.2), m(6.2), m(0.75), 24);
    const mesh = new this.THREE.Mesh(geo, this.materials.preview);
    mesh.position.set(node.x, this.map.getHeightAt(node.x, node.z) + m(1.12) + (node.elevation || 0) * this.bridgeLevelHeight, node.z);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 28;
    this.group.add(mesh);
  }
  renderIntersection(node) {
    const connected = this.game.state.networks.roads.filter(seg => seg.a === node.id || seg.b === node.id);
    if (connected.length < 2) return;
    const byLevel = new Map();
    for (const seg of connected) {
      const level = seg.elevation || 0;
      if (!byLevel.has(level)) byLevel.set(level, []);
      byLevel.get(level).push(seg);
    }
    for (const [level, roads] of byLevel.entries()) {
      if (roads.length < 2) continue;
      this.buildIntersectionPad(node, roads, level);
      if (level === 0) this.renderCrosswalks(node, roads);
    }
  }
  buildIntersectionPad(node, connected, level = 0) {
    const maxWidth = Math.max(...connected.map(seg => this.getSegmentWidth(seg)));
    const radius = maxWidth * 0.78;
    const y = this.map.getHeightAt(node.x, node.z) + 0.70 + level * this.bridgeLevelHeight;
    const baseGeo = new this.THREE.CircleGeometry(radius + m(2.8), 40);
    const base = new this.THREE.Mesh(baseGeo, this.materials.roadBase || this.materials.roadEdge);
    base.rotation.x = -Math.PI / 2;
    base.position.set(node.x, y - m(0.05), node.z);
    base.receiveShadow = true;
    base.renderOrder = 3;
    this.group.add(base);
    const geo = new this.THREE.CircleGeometry(radius, 48);
    const mesh = new this.THREE.Mesh(geo, this.materials.road);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(node.x, y + m(0.03), node.z);
    mesh.receiveShadow = true;
    mesh.renderOrder = 5;
    mesh.userData.intersectionNodeId = node.id;
    this.group.add(mesh);
    for (const seg of connected) {
      const otherId = seg.a === node.id ? seg.b : seg.a;
      const other = this.getNode(otherId);
      if (!other) continue;
      const heading = Math.atan2(other.z - node.z, other.x - node.x);
      const segWidth = this.getSegmentWidth(seg);
      const center = { x: node.x + Math.cos(heading) * radius * 0.52, y: y + 0.05, z: node.z + Math.sin(heading) * radius * 0.52 };
      const flare = this.buildFlatRect(center, heading, radius * 1.45, segWidth + 1.5, this.materials.road, 0.04);
      flare.receiveShadow = true;
      flare.renderOrder = 5;
      this.group.add(flare);
    }
  }
  renderCrosswalks(node, connected) {
    const nodeY = this.map.getHeightAt(node.x, node.z) + 0.97;
    for (const segment of connected) {
      if (segment.zoneable === false || (segment.elevation || 0) !== 0) continue;
      const samples = this.getSegmentSamples(segment, 14);
      if (samples.length < 2) continue;
      const fromStart = segment.a === node.id;
      const p0 = fromStart ? samples[0] : samples[samples.length - 1];
      const p1 = fromStart ? samples[Math.min(2, samples.length - 1)] : samples[Math.max(0, samples.length - 3)];
      const heading = Math.atan2(p1.z - p0.z, p1.x - p0.x);
      const width = this.getSegmentWidth(segment);
      const padOffset = width * 0.46 + 4.5;
      const dir = { x: Math.cos(heading), z: Math.sin(heading) };
      const side = { x: -dir.z, z: dir.x };
      const stripeCount = Math.max(4, Math.min(7, Math.round(width / 5)));
      const stripeAlong = 1.35;
      const stripeGap = 1.55;
      const totalAlong = stripeCount * stripeAlong + (stripeCount - 1) * stripeGap;
      const centerBase = { x: node.x + dir.x * padOffset, y: nodeY, z: node.z + dir.z * padOffset };
      for (let i = 0; i < stripeCount; i++) {
        const along = -totalAlong / 2 + stripeAlong / 2 + i * (stripeAlong + stripeGap);
        const center = { x: centerBase.x + dir.x * along, y: nodeY, z: centerBase.z + dir.z * along };
        this.group.add(this.buildFlatRect(center, heading, stripeAlong, width * 0.88, this.materials.crosswalk, 0.18));
      }
      const stopCenter = {
        x: centerBase.x + dir.x * (totalAlong * 0.5 + 3.4),
        y: nodeY,
        z: centerBase.z + dir.z * (totalAlong * 0.5 + 3.4)
      };
      this.group.add(this.buildFlatRect(stopCenter, heading, 1.15, width * 0.92, this.materials.stopLine, 0.21));
    }
  }
  renderDirectionArrows(segment, samples, width) {
    if (samples.length < 2) return;
    const length = polylineLength(samples);
    if (length < 52) return;
    const layout = this.getLaneLayout(segment, width);
    const arrowCount = Math.max(1, Math.min(5, Math.floor(length / 95)));
    const configs = [];
    if (layout.direction === 'oneWay') {
      for (let i = 0; i < layout.lanes; i++) configs.push({ offset: -layout.innerHalf + layout.laneWidth * (i + 0.5), sign: 1 });
    } else {
      for (let i = 0; i < layout.lanes; i++) {
        const off = layout.laneWidth * (i + 0.5) + 0.58;
        configs.push({ offset: off, sign: 1 });
        configs.push({ offset: -off, sign: -1 });
      }
    }
    for (let i = 0; i < arrowCount; i++) {
      const d = length * ((i + 1) / (arrowCount + 1));
      if (d < 24 || d > length - 24) continue;
      const base = pointAlongPolyline(samples, d);
      if (!base) continue;
      for (const cfg of configs) {
        const center = this.offsetPointByHeading(base, cfg.offset);
        center.y += 0.39;
        this.group.add(this.buildArrowMarker(center, base.heading, cfg.sign, Math.max(3.2, Math.min(5.2, layout.laneWidth * 0.86)), this.materials.arrow));
      }
    }
  }
  offsetPointByHeading(point, offset) {
    const heading = point.heading || 0;
    return {
      x: point.x - Math.sin(heading) * offset,
      y: point.y,
      z: point.z + Math.cos(heading) * offset,
      heading
    };
  }
  buildArrowMarker(center, heading, dirSign = 1, size = 5, material = this.materials.arrow) {
    const len = size * 3.1;
    const w = size * 1.6;
    const dir = { x: Math.cos(heading) * dirSign, z: Math.sin(heading) * dirSign };
    const side = { x: -dir.z, z: dir.x };
    const local = [
      [-len * 0.50, -w * 0.20],
      [ len * 0.06, -w * 0.20],
      [ len * 0.06, -w * 0.45],
      [ len * 0.50,  0],
      [ len * 0.06,  w * 0.45],
      [ len * 0.06,  w * 0.20],
      [-len * 0.50,  w * 0.20]
    ];
    const pos = [];
    for (const [lx, lz] of local) {
      pos.push(center.x + dir.x * lx + side.x * lz, center.y, center.z + dir.z * lx + side.z * lz);
    }
    const idx = [];
    for (let i = 1; i < local.length - 1; i++) idx.push(0, i, i + 1);
    const geo = new this.THREE.BufferGeometry();
    geo.setAttribute('position', new this.THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new this.THREE.Mesh(geo, material);
    mesh.renderOrder = 20;
    return mesh;
  }
  buildFlatRect(center, heading, lengthAlong, widthAcross, material, yOffset = 0.2) {
    const dir = { x: Math.cos(heading), z: Math.sin(heading) };
    const side = { x: -dir.z, z: dir.x };
    const hl = lengthAlong * 0.5;
    const hw = widthAcross * 0.5;
    const pts = [
      [-hl, -hw], [hl, -hw], [-hl, hw], [hl, hw]
    ].map(([lx, lz]) => ({
      x: center.x + dir.x * lx + side.x * lz,
      y: center.y + yOffset,
      z: center.z + dir.z * lx + side.z * lz
    }));
    const geo = new this.THREE.BufferGeometry();
    geo.setAttribute('position', new this.THREE.Float32BufferAttribute([
      pts[0].x, pts[0].y, pts[0].z,
      pts[1].x, pts[1].y, pts[1].z,
      pts[2].x, pts[2].y, pts[2].z,
      pts[3].x, pts[3].y, pts[3].z
    ], 3));
    geo.setIndex([0, 2, 1, 1, 2, 3]);
    geo.computeVertexNormals();
    const mesh = new this.THREE.Mesh(geo, material);
    mesh.renderOrder = 18;
    return mesh;
  }
  buildRibbon(samples, width, material, yOffset = 0) {
    const pos = [], uv = [], idx = [];
    for (let i = 0; i < samples.length; i++) {
      const p = samples[i];
      const prev = samples[Math.max(0, i - 1)];
      const next = samples[Math.min(samples.length - 1, i + 1)];
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
    const shifted = this.offsetSamples(samples, offset);
    return this.buildRibbon(shifted, width, material, yOffset);
  }
  buildMarking(samples, offset, width, material, yOffset = 0.2) {
    return this.buildOffsetRibbon(samples, offset, width, material, yOffset);
  }
  buildDashedMarking(samples, offset, width, material, yOffset = 0.2, options = {}) {
    const group = new this.THREE.Group();
    const dash = options.dash ?? 8.5;
    const gap = options.gap ?? 9.5;
    const period = Math.max(1, dash + gap);
    let accumulated = 0;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1], b = samples[i];
      const segLen = dist2D(a, b);
      if (segLen <= 0.01) continue;
      let local = 0;
      while (local < segLen) {
        const phase = (accumulated + local) % period;
        const remainingInDash = dash - phase;
        if (phase < dash && remainingInDash > 0) {
          const len = Math.min(remainingInDash, segLen - local);
          const t0 = local / segLen;
          const t1 = (local + len) / segLen;
          const s0 = { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0, z: a.z + (b.z - a.z) * t0 };
          const s1 = { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1, z: a.z + (b.z - a.z) * t1 };
          if (dist2D(s0, s1) > 0.4) group.add(this.buildMarking([s0, s1], offset, width, material, yOffset));
          local += Math.max(len, 0.5);
        } else {
          local += Math.max(period - phase, 0.5);
        }
      }
      accumulated += segLen;
    }
    return group;
  }
  offsetSamples(samples, offset) {
    return samples.map((p, i) => {
      const prev = samples[Math.max(0, i - 1)];
      const next = samples[Math.min(samples.length - 1, i + 1)];
      const heading = Math.atan2(next.z - prev.z, next.x - prev.x);
      const nx = -Math.sin(heading), nz = Math.cos(heading);
      {
      const x = p.x + nx * offset;
      const z = p.z + nz * offset;
      const baseDelta = p.y - this.map.getHeightAt(p.x, p.z);
      return { ...p, x, z, y: this.map.getHeightAt(x, z) + baseDelta };
    }
    });
  }
  drawPreview(a, b, width) {
    this.clearPreview();
    const length = dist2D(a, b);
    const n = Math.max(3, Math.min(30, Math.ceil(length / m(30))));
    const direct = this.normalize2D({ x: b.x - a.x, z: b.z - a.z }) || { x: 1, z: 0 };
    const useSmooth = this.defaultGeometry === 'smooth' && length > m(34);
    const fakeCurve = { id: '__preview__', a: a.id, b: b.id, elevation: this.elevationLevel, geometry: this.defaultGeometry };
    const tangentA = useSmooth ? this.getEndpointTangent(fakeCurve, a, b, direct, true) : direct;
    const tangentB = direct;
    const samples = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      let x, z;
      if (useSmooth) {
        const p = this.hermite2D(a, b, tangentA, tangentB, length * 0.72, t);
        x = p.x; z = p.z;
      } else {
        x = a.x + (b.x - a.x) * t;
        z = a.z + (b.z - a.z) * t;
      }
      samples.push({ x, z, y: this.map.getHeightAt(x, z) + m(0.95) + this.elevationLevel * this.bridgeLevelHeight });
    }
    const group = new this.THREE.Group();
    const kind = this.defaultKind;
    const fake = { kind, lanes: this.defaultLanes, direction: this.defaultDirection };
    const add = (mesh, order = 32) => { if (mesh) { mesh.renderOrder = order; group.add(mesh); } };
    add(this.buildRibbon(samples, width, this.materials.preview, m(0.28)), 30);
    const layout = this.getLaneLayout(fake, width);
    if (kind === 'avenue' && layout.direction !== 'oneWay') add(this.buildRibbon(samples, Math.max(m(3.8), layout.centerGap * 0.74), this.materials.roadMedian || this.materials.preview, m(0.42)), 31);
    if (kind !== 'dirt' && layout.direction !== 'oneWay') { add(this.buildOffsetRibbon(samples, -layout.centerLineOffset, m(0.18), this.materials.laneYellow || this.materials.preview, m(0.52))); add(this.buildOffsetRibbon(samples, layout.centerLineOffset, m(0.18), this.materials.laneYellow || this.materials.preview, m(0.52))); }
    if (kind !== 'dirt') for (let i = 1; i < layout.lanes; i++) {
      const off = layout.direction === 'oneWay'
        ? ((layout.forwardCenters?.[i] != null && layout.forwardCenters?.[i - 1] != null) ? (layout.forwardCenters[i] + layout.forwardCenters[i - 1]) * 0.5 : -layout.innerHalf + i * layout.laneWidth)
        : ((layout.forwardCenters?.[i] != null && layout.forwardCenters?.[i - 1] != null) ? (layout.forwardCenters[i] + layout.forwardCenters[i - 1]) * 0.5 : layout.centerLineOffset + i * layout.laneWidth);
      const reverseOff = layout.reverseCenters?.[i] != null && layout.reverseCenters?.[i - 1] != null ? (layout.reverseCenters[i] + layout.reverseCenters[i - 1]) * 0.5 : -off;
      add(this.buildOffsetRibbon(samples, off, m(0.15), this.materials.laneWhite || this.materials.preview, m(0.52)));
      if (layout.direction !== 'oneWay') add(this.buildOffsetRibbon(samples, reverseOff, m(0.15), this.materials.laneWhite || this.materials.preview, m(0.52)));
    }
    const capGeo = new this.THREE.CylinderGeometry(Math.max(m(4.4), Math.min(m(9.5), width * 0.22)), Math.max(m(4.4), Math.min(m(9.5), width * 0.22)), m(0.3), 20);
    for (const p of [samples[0], samples[samples.length - 1]]) {
      const cap = new this.THREE.Mesh(capGeo, this.materials.preview);
      cap.position.set(p.x, p.y + m(0.88), p.z);
      cap.renderOrder = 33;
      group.add(cap);
    }
    this.preview = group;
    this.previewGroup.add(this.preview);
  }
  updateVisualState({ weather = {}, isNight = false } = {}) {
    const rain = Math.max(0, Math.min(1, weather.rain || 0));
    const damp = Math.max(0, rain * 0.95 + (weather.key === 'storm' ? 0.12 : 0));
    const apply = (mat, opts = {}) => {
      if (!mat) return;
      if (typeof opts.roughDry === 'number') mat.roughness = opts.roughDry - damp * (opts.roughDry - (opts.roughWet ?? opts.roughDry));
      if (typeof opts.metalDry === 'number') mat.metalness = opts.metalDry + damp * ((opts.metalWet ?? opts.metalDry) - opts.metalDry);
      if (mat.color && opts.dryColor != null && opts.wetColor != null) {
        const dry = new this.THREE.Color(opts.dryColor);
        const wet = new this.THREE.Color(opts.wetColor);
        mat.color.copy(dry).lerp(wet, damp);
      }
      if (opts.nightEmissive && mat.emissive) mat.emissiveIntensity = isNight ? opts.nightEmissive : 0;
      mat.needsUpdate = true;
    };
    apply(this.materials.road, { dryColor: 0x6f716c, wetColor: 0x4d5257, roughDry: 0.97, roughWet: 0.44, metalDry: 0.00, metalWet: 0.10 });
    apply(this.materials.dirtRoad, { dryColor: 0x8e7251, wetColor: 0x6b5844, roughDry: 0.99, roughWet: 0.82, metalDry: 0.00, metalWet: 0.02 });
    apply(this.materials.roadBase, { dryColor: 0x3b3b39, wetColor: 0x27292d, roughDry: 0.96, roughWet: 0.58, metalDry: 0.00, metalWet: 0.05 });
    apply(this.materials.sidewalk, { dryColor: 0xd0c0aa, wetColor: 0xb6a996, roughDry: 0.98, roughWet: 0.78, metalDry: 0.00, metalWet: 0.02 });
    apply(this.materials.roadEdge, { dryColor: 0x2e3133, wetColor: 0x1e2226, roughDry: 0.95, roughWet: 0.54, metalDry: 0.02, metalWet: 0.08 });
    apply(this.materials.bridgeBarrier, { dryColor: 0x575e60, wetColor: 0x43494d, roughDry: 0.88, roughWet: 0.62, metalDry: 0.10, metalWet: 0.22 });
  }
  clearPreview() {
    if (!this.preview) return;
    safeDisposeObject(this.preview);
    this.previewGroup.remove(this.preview);
    this.preview = null;
  }
  drawSegmentHighlight(point, mode = 'upgrade') {
    this.clearHighlight();
    const hit = this.findNearestSegment(point, m(50));
    if (!hit) return false;
    const samples = this.getSegmentSamples(hit.segment);
    if (samples.length < 2) return false;
    const width = this.getSegmentWidth(hit.segment) + 7;
    const material = mode === 'demolish' ? this.materials.demolish : this.materials.upgradeHighlight;
    this.highlight = this.buildRibbon(samples, width, material, 0.75);
    this.highlight.renderOrder = 30;
    this.previewGroup.add(this.highlight);
    return true;
  }
  clearHighlight() {
    if (!this.highlight) return;
    safeDisposeObject(this.highlight);
    this.previewGroup.remove(this.highlight);
    this.highlight = null;
  }
}