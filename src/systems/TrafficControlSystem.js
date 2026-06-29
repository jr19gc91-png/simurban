// TrafficControlSystem — adaptação do mini-TMPE do jogo antigo para o NewCore.
// Controla cruzamentos (semáforo / pare / preferencial) por nó e classe de
// segmento (reaproveitando o laneClass que já dita veículos e visual).
// Marcadores são 100% procedurais low-poly (sem assets nem gráfico antigo).

import { m } from '../utils/Scale.js';

const SIGNAL_PERIOD = 13;     // segundos de simulação por ciclo de semáforo
const GREEN_FRACTION = 0.44;  // janela verde de cada eixo (resto = amarelo/limpeza)
const NODE_TYPES = ['none', 'signals', 'stop', 'yield'];
const SIGNAL_PHASE_PLANS = ['auto', 'eastWest', 'northSouth', 'allRed', 'allGreen'];
const CONNECTOR_MODES = ['auto', 'straight', 'noLeft', 'rightOnly'];
const PRIORITY_FLOW_MODES = ['none', 'yieldWide', 'stopWide', 'yieldSpeed'];
const LANE_CLASS_CYCLE = ['general', 'bus', 'emergency', 'service', 'mixed', 'bike', 'parking'];

export class TrafficControlSystem {
  constructor({ game, roadSystem }) {
    this.game = game;
    this.roads = roadSystem;
    this.THREE = game.mapCore.THREE;
    this.group = game.groups.trafficControls;
    this.simTime = 0;
    this.makeMaterials();
  }

  get controlsState() {
    const tc = this.game.state.trafficControls = this.game.state.trafficControls || { autoSignals: true, nodes: {}, segments: {} };
    if (typeof tc.autoSignals !== 'boolean') tc.autoSignals = true;
    tc.nodes = tc.nodes || {};
    tc.segments = tc.segments || {};
    tc.version = tc.version || '2.4.20';
    return tc;
  }

  get nodeControls() {
    return this.controlsState.nodes;
  }

  makeMaterials() {
    const T = this.THREE;
    const mk = (color) => new T.MeshLambertMaterial({ color });
    this.mats = {
      pole: mk(0x2b2f33),
      head: mk(0x14171a),
      red: mk(0xe2533b),
      yellow: mk(0xe6c14a),
      green: mk(0x57c66a),
      stop: mk(0xc8362b),
      stopText: mk(0xf2f2f2),
      yield: mk(0xe05a3a),
      yieldInner: mk(0xf6f6f6)
    };
  }

  advance(dt) {
    this.simTime += dt * (this.game.state.simulation.speed || 1);
  }

  // ------- estado -------
  getNodeType(nodeId) { return this.nodeControls[nodeId]?.type || 'none'; }

  cycleNode(nodeId) {
    const cur = this.getNodeType(nodeId);
    const next = NODE_TYPES[(NODE_TYPES.indexOf(cur) + 1) % NODE_TYPES.length];
    // v2.4.19: controle manual sempre vence o automático. Quando o usuário
    // gira até “sem controle”, gravamos manual:none para não recriar semáforo
    // automático nesse nó no próximo render.
    const existing = this.nodeControls[nodeId] || {};
    this.nodeControls[nodeId] = { ...existing, type: next, manual: true, auto: false };
    this.render();
    this.game.emitChange();
    return next;
  }

  setNode(nodeId, type) {
    const next = NODE_TYPES.includes(type) ? type : 'none';
    const existing = this.nodeControls[nodeId] || {};
    this.nodeControls[nodeId] = { ...existing, type: next, manual: true, auto: false };
    this.render();
    this.game.emitChange();
  }

  cycleSignalPhasePlan(nodeId) {
    const existing = this.nodeControls[nodeId] || {};
    const cur = SIGNAL_PHASE_PLANS.includes(existing.phasePlan) ? existing.phasePlan : 'auto';
    const next = SIGNAL_PHASE_PLANS[(SIGNAL_PHASE_PLANS.indexOf(cur) + 1) % SIGNAL_PHASE_PLANS.length];
    this.nodeControls[nodeId] = { ...existing, type: 'signals', manual: true, auto: false, phasePlan: next };
    this.render();
    this.game.emitChange();
    return next;
  }

  cycleConnectorMode(nodeId) {
    const existing = this.nodeControls[nodeId] || {};
    const cur = CONNECTOR_MODES.includes(existing.connectorMode) ? existing.connectorMode : 'auto';
    const next = CONNECTOR_MODES[(CONNECTOR_MODES.indexOf(cur) + 1) % CONNECTOR_MODES.length];
    this.nodeControls[nodeId] = { ...existing, manual: true, auto: false, connectorMode: next };
    this.render();
    this.game.systems.vehicles?.rebuild?.();
    this.game.emitChange();
    return next;
  }

  cyclePriorityFlow(nodeId) {
    const existing = this.nodeControls[nodeId] || {};
    const cur = PRIORITY_FLOW_MODES.includes(existing.priorityMode) ? existing.priorityMode : 'none';
    const next = PRIORITY_FLOW_MODES[(PRIORITY_FLOW_MODES.indexOf(cur) + 1) % PRIORITY_FLOW_MODES.length];
    const type = next === 'none' ? 'none' : (next.startsWith('stop') ? 'stop' : 'yield');
    this.nodeControls[nodeId] = { ...existing, type, manual: true, auto: false, priorityMode: next };
    this.render();
    this.game.systems.vehicles?.rebuild?.();
    this.game.emitChange();
    return next;
  }

  setSegmentLaneClass(segment, laneIndex = -1, laneClass = 'general') {
    if (!segment) return null;
    const lanes = Math.max(1, Math.min(5, segment.lanes || 1));
    const next = this.roads.normalizeLaneClass(laneClass || 'general');
    if (segment.kind === 'dirt') {
      segment.laneClass = 'general';
      delete segment.laneClasses;
      this.roads.render();
      this.game.systems.vehicles?.rebuild?.();
      this.game.emitChange();
      return 'general';
    }
    if (Number.isFinite(laneIndex) && laneIndex >= 0 && laneIndex < lanes) {
      segment.laneClasses = Array.from({ length: lanes }, (_, i) => this.roads.normalizeLaneClass(segment.laneClasses?.[i] || segment.laneClass || 'general'));
      segment.laneClasses[laneIndex] = next;
      segment.laneClass = this.roads.getPrimaryLaneClass?.(segment) || next;
    } else {
      segment.laneClass = next;
      segment.laneClasses = Array.from({ length: lanes }, () => next);
    }
    this.roads.render();
    this.game.systems.vehicles?.rebuild?.();
    this.game.emitChange();
    return next;
  }

  cycleSegmentLaneClass(segment, laneIndex = -1) {
    if (!segment) return null;
    const lanes = Math.max(1, Math.min(5, segment.lanes || 1));
    let next = 'general';
    if (Number.isFinite(laneIndex) && laneIndex >= 0 && laneIndex < lanes && segment.kind !== 'dirt') {
      segment.laneClasses = Array.from({ length: lanes }, (_, i) => this.roads.normalizeLaneClass(segment.laneClasses?.[i] || segment.laneClass || 'general'));
      const cur = this.roads.normalizeLaneClass(segment.laneClasses[laneIndex] || 'general');
      next = LANE_CLASS_CYCLE[(LANE_CLASS_CYCLE.indexOf(cur) + 1) % LANE_CLASS_CYCLE.length];
      segment.laneClasses[laneIndex] = next;
      segment.laneClass = this.roads.getPrimaryLaneClass?.(segment) || next;
    } else {
      const cur = this.roads.normalizeLaneClass(segment.laneClass || 'general');
      next = LANE_CLASS_CYCLE[(LANE_CLASS_CYCLE.indexOf(cur) + 1) % LANE_CLASS_CYCLE.length];
      segment.laneClass = next;
      if (segment.kind !== 'dirt') segment.laneClasses = Array.from({ length: lanes }, () => next);
    }
    this.roads.render();
    this.game.systems.vehicles?.rebuild?.();
    this.game.emitChange();
    return next;
  }

  // ------- lógica de fase (lida pelos veículos) -------
  // Retorna o eixo verde atual: 0 = leste-oeste, 1 = norte-sul.
  greenAxisAt(time = this.simTime, nodeId = null) {
    const plan = nodeId ? (this.nodeControls[nodeId]?.phasePlan || 'auto') : 'auto';
    if (plan === 'eastWest') return 0;
    if (plan === 'northSouth') return 1;
    const phase = ((time % SIGNAL_PERIOD) / SIGNAL_PERIOD);
    return phase < 0.5 ? 0 : 1;
  }

  // Está em janela de transição (amarelo/limpeza)?
  isClearancePhase(time = this.simTime, nodeId = null) {
    const plan = nodeId ? (this.nodeControls[nodeId]?.phasePlan || 'auto') : 'auto';
    if (plan === 'eastWest' || plan === 'northSouth' || plan === 'allRed' || plan === 'allGreen') return false;
    const phase = ((time % SIGNAL_PERIOD) / SIGNAL_PERIOD);
    const half = phase < 0.5 ? phase / 0.5 : (phase - 0.5) / 0.5;
    return half > GREEN_FRACTION / 0.5;
  }

  // Um veículo com este heading deve parar no nó? Considera controle, fase manual e prioridade por aproximação.
  redForHeading(nodeId, heading, time = this.simTime, segment = null) {
    const control = this.nodeControls[nodeId] || {};
    const type = control.type || 'none';
    if (type === 'none') return { stop: false, slow: 1 };
    if (type === 'signals') {
      const phasePlan = control.phasePlan || 'auto';
      if (phasePlan === 'allGreen') return { stop: false, slow: 1, phasePlan };
      if (phasePlan === 'allRed') return { stop: true, slow: 0.0, phasePlan };
      const axis = (Math.abs(Math.cos(heading)) >= Math.abs(Math.sin(heading))) ? 0 : 1;
      if (this.isClearancePhase(time, nodeId)) return { stop: true, slow: 0.0, phasePlan };
      const green = this.greenAxisAt(time, nodeId);
      return axis === green ? { stop: false, slow: 1, phasePlan } : { stop: true, slow: 0.0, phasePlan };
    }
    const priority = this.getApproachPriority(nodeId, segment);
    if (type === 'stop') {
      if (priority === 'major') return { stop: false, slow: 1, priority };
      return { stop: true, slow: 0.0, stopSign: true, priority };
    }
    if (type === 'yield') {
      if (priority === 'major') return { stop: false, slow: 1, priority };
      return { stop: false, slow: 0.34, priority };
    }
    return { stop: false, slow: 1 };
  }

  getApproachPriority(nodeId, segment = null) {
    if (!segment) return 'minor';
    const control = this.nodeControls[nodeId] || {};
    const mode = control.priorityMode || 'none';
    if (mode === 'none') return 'minor';
    const major = this.getMajorApproachSegmentIds(nodeId, mode);
    return major.has(segment.id) ? 'major' : 'minor';
  }

  getMajorApproachSegmentIds(nodeId, mode = 'yieldWide') {
    const node = this.roads.getNode(nodeId);
    const out = new Set();
    if (!node) return out;
    const level = node.elevation || 0;
    const arms = (this.game.state.networks.roads || []).filter(seg => (seg.elevation || 0) === level && (seg.a === nodeId || seg.b === nodeId));
    if (!arms.length) return out;
    const score = (seg) => {
      const width = this.roads.getSegmentWidth?.(seg) || 0;
      const speed = Number(seg.speedKmh) || 40;
      if (mode === 'yieldSpeed') return speed * 2 + width * 0.2;
      return width * 1.8 + speed * 0.35 + ((seg.kind || 'street') === 'avenue' ? 8 : 0);
    };
    const best = Math.max(...arms.map(score));
    for (const seg of arms) if (score(seg) >= best - 0.001) out.add(seg.id);
    return out;
  }

  getTurnInfo(nodeId, prevSegment, nextSegment) {
    const node = this.roads.getNode(nodeId);
    if (!node || !prevSegment || !nextSegment || prevSegment.id === nextSegment.id) return { turn: 'straight', angleDeg: 0, signed: 0 };
    const otherOf = (seg) => this.roads.getNode(seg.a === nodeId ? seg.b : seg.a);
    const prevOther = otherOf(prevSegment);
    const nextOther = otherOf(nextSegment);
    if (!prevOther || !nextOther) return { turn: 'straight', angleDeg: 0, signed: 0 };
    // vetor de entrada: de onde o veículo veio até o nó; vetor de saída: do nó para o próximo braço
    const inV = { x: node.x - prevOther.x, z: node.z - prevOther.z };
    const outV = { x: nextOther.x - node.x, z: nextOther.z - node.z };
    const inLen = Math.hypot(inV.x, inV.z) || 1;
    const outLen = Math.hypot(outV.x, outV.z) || 1;
    inV.x /= inLen; inV.z /= inLen; outV.x /= outLen; outV.z /= outLen;
    const cross = inV.x * outV.z - inV.z * outV.x;
    const dot = Math.max(-1, Math.min(1, inV.x * outV.x + inV.z * outV.z));
    const signed = Math.atan2(cross, dot);
    const angleDeg = Math.abs(signed) * 180 / Math.PI;
    let turn = 'straight';
    if (angleDeg > 130) turn = 'uturn';
    else if (angleDeg > 38) turn = signed > 0 ? 'left' : 'right';
    return { turn, angleDeg, signed };
  }

  isTransitionAllowed(nodeId, prevSegment, nextSegment, vehicleType = 'car', laneIndex = null) {
    if (!prevSegment || !nextSegment || vehicleType === 'emergency') return true;
    const mode = this.nodeControls[nodeId]?.connectorMode || 'auto';
    if (mode === 'auto') return true;
    const info = this.getTurnInfo(nodeId, prevSegment, nextSegment);
    if (info.turn === 'uturn') return false;
    if (mode === 'straight') return info.turn === 'straight';
    if (mode === 'noLeft') return info.turn !== 'left';
    if (mode === 'rightOnly') return info.turn === 'right';
    return true;
  }

  getConnectorTargetLane(nodeId, prevSegment, nextSegment, currentLane = 0, vehicleType = 'car') {
    if (!nextSegment) return 0;
    const lanes = Math.max(1, Math.min(5, nextSegment.lanes || 1));
    const laneClasses = Array.from({ length: lanes }, (_, i) => this.roads.getLaneClassForLane?.(nextSegment, i) || 'general');
    if (vehicleType === 'bus') {
      const idx = laneClasses.findIndex(c => c === 'bus' || c === 'mixed');
      if (idx >= 0) return idx;
    }
    if (vehicleType === 'emergency') {
      const idx = laneClasses.findIndex(c => c === 'emergency' || c === 'service' || c === 'mixed');
      if (idx >= 0) return idx;
    }
    const info = this.getTurnInfo(nodeId, prevSegment, nextSegment);
    if (info.turn === 'right') return Math.max(0, lanes - 1);
    if (info.turn === 'left') return 0;
    return Math.max(0, Math.min(lanes - 1, Math.round(currentLane || 0)));
  }

  getConnectorModeLabel(mode = 'auto') {
    return ({ auto: 'livre', straight: 'só reto', noLeft: 'sem conversão à esquerda', rightOnly: 'só direita' })[mode] || 'livre';
  }

  getPhasePlanLabel(plan = 'auto') {
    return ({ auto: 'automática', eastWest: 'fixa leste-oeste', northSouth: 'fixa norte-sul', allRed: 'tudo vermelho', allGreen: 'tudo verde' })[plan] || 'automática';
  }

  getPriorityModeLabel(mode = 'none') {
    return ({ none: 'sem prioridade', yieldWide: 'preferencial via larga', stopWide: 'pare na via menor', yieldSpeed: 'preferencial via rápida' })[mode] || 'sem prioridade';
  }

  // ------- consulta espacial usada pelo VehicleSystem -------
  controlledNodesWorld() {
    const out = [];
    for (const id of Object.keys(this.nodeControls)) {
      const node = this.roads.getNode(id);
      if (!node) continue;
      const control = this.nodeControls[id] || {};
      out.push({ id, x: node.x, z: node.z, y: this.nodeWorldY(node), elevation: node.elevation || 0, type: control.type, phasePlan: control.phasePlan, connectorMode: control.connectorMode, priorityMode: control.priorityMode });
    }
    return out;
  }

  summary() {
    this.ensureAutomaticNodeControls();
    let signals = 0, priority = 0, autoSignals = 0, manualPhases = 0, connectors = 0;
    for (const id of Object.keys(this.nodeControls)) {
      const t = this.nodeControls[id].type;
      const nodeControl = this.nodeControls[id] || {};
      if (t === 'signals') { signals++; if (nodeControl.auto) autoSignals++; if (nodeControl.phasePlan && nodeControl.phasePlan !== 'auto') manualPhases++; }
      else if (t === 'stop' || t === 'yield') priority++;
      if (nodeControl.connectorMode && nodeControl.connectorMode !== 'auto') connectors++;
    }
    const restrictions = (this.game.state.networks.roads || []).filter(s => (s.laneClass || 'general') !== 'general' || (s.laneClasses || []).some(c => c !== 'general')).length;
    return { signals, autoSignals, priority, restrictions, manualPhases, connectors };
  }

  // remove controles de nós que não existem mais
  cleanup() {
    for (const id of Object.keys(this.nodeControls)) {
      if (!this.roads.getNode(id)) delete this.nodeControls[id];
    }
    this.ensureAutomaticNodeControls();
  }

  ensureAutomaticNodeControls() {
    const tc = this.controlsState;
    if (tc.autoSignals === false) return;
    for (const node of this.game.state.networks.roadNodes || []) {
      const existing = tc.nodes[node.id];
      if (existing?.manual) continue;
      if (this.shouldAutoSignalNode(node)) tc.nodes[node.id] = { ...(existing || {}), type: 'signals', auto: true };
      else if (existing?.auto) delete tc.nodes[node.id];
    }
  }

  shouldAutoSignalNode(node) {
    if (!node) return false;
    const level = node.elevation || 0;
    const arms = (this.game.state.networks.roads || []).filter(seg => {
      if ((seg.elevation || 0) !== level) return false;
      if (seg.kind === 'dirt') return false;
      return seg.a === node.id || seg.b === node.id;
    });
    if (arms.length < 3) return false;
    const pavedWidth = arms.reduce((sum, seg) => sum + (this.roads.getSegmentWidth?.(seg) || 0), 0);
    return pavedWidth > 0;
  }

  clearAll() {
    const tc = this.controlsState;
    tc.nodes = {};
    tc.segments = {};
    for (const segment of this.game.state.networks.roads || []) { segment.laneClass = 'general'; delete segment.laneClasses; }
    this.roads.render();
    this.game.systems.vehicles?.rebuild?.();
    this.render();
    this.game.emitChange();
  }

  nodeWorldY(node) {
    const level = node?.elevation || 0;
    return this.game.map.getHeightAt(node.x, node.z) + level * (this.roads.bridgeLevelHeight || m(10));
  }

  // ------- render dos marcadores -------
  render() {
    this.group.clear();
    if (this.game.state.viewLayers?.trafficControls === false) return;
    this.cleanup();
    for (const id of Object.keys(this.nodeControls)) {
      const node = this.roads.getNode(id);
      if (!node) continue;
      const control = this.nodeControls[id];
      const type = control?.type || 'none';
      if (type === 'none') continue;
      const y = this.nodeWorldY(node);
      const marker = this.makeMarker(type, control);
      marker.position.set(node.x, y, node.z);
      this.group.add(marker);
    }
  }

  makeMarker(type, control = {}) {
    const T = this.THREE;
    const g = new T.Group();
    const pole = new T.Mesh(new T.CylinderGeometry(m(0.35), m(0.45), m(7.5), 6), this.mats.pole);
    pole.position.y = m(3.75);
    g.add(pole);
    if (control.auto) {
      const base = new T.Mesh(new T.CylinderGeometry(m(1.0), m(1.0), m(0.16), 12), this.mats.green);
      base.position.y = m(0.12);
      g.add(base);
    }

    if (type === 'signals') {
      const head = new T.Mesh(new T.BoxGeometry(m(1.5), m(3.6), m(1.2)), this.mats.head);
      head.position.set(0, m(7.6), 0);
      g.add(head);
      const dot = (mat, yy) => {
        const d = new T.Mesh(new T.CylinderGeometry(m(0.42), m(0.42), m(0.3), 10), mat);
        d.rotation.x = Math.PI / 2;
        d.position.set(0, yy, m(0.66));
        g.add(d);
      };
      dot(this.mats.red, m(8.6));
      dot(this.mats.yellow, m(7.6));
      dot(this.mats.green, m(6.6));
    } else if (type === 'stop') {
      const disc = new T.Mesh(new T.CylinderGeometry(m(1.7), m(1.7), m(0.35), 8), this.mats.stop);
      disc.rotation.x = Math.PI / 2;
      disc.position.set(0, m(7.3), 0);
      g.add(disc);
      const bar = new T.Mesh(new T.BoxGeometry(m(2.2), m(0.42), m(0.1)), this.mats.stopText);
      bar.position.set(0, m(7.3), m(0.2));
      g.add(bar);
    } else if (type === 'yield') {
      const tri = new T.Mesh(new T.ConeGeometry(m(1.9), m(1.9), 3), this.mats.yield);
      tri.rotation.x = Math.PI / 2;
      tri.rotation.z = Math.PI;        // ponta para baixo
      tri.position.set(0, m(7.4), 0);
      g.add(tri);
      const inner = new T.Mesh(new T.ConeGeometry(m(1.2), m(1.2), 3), this.mats.yieldInner);
      inner.rotation.x = Math.PI / 2;
      inner.rotation.z = Math.PI;
      inner.position.set(0, m(7.4), m(0.12));
      g.add(inner);
    }
    this.addConnectorGlyph(g, control);
    return g;
  }

  addConnectorGlyph(group, control = {}) {
    const mode = control.connectorMode || 'auto';
    const phase = control.phasePlan || 'auto';
    if (mode === 'auto' && phase === 'auto') return;
    const T = this.THREE;
    const mat = mode === 'rightOnly' ? this.mats.green : mode === 'noLeft' ? this.mats.yellow : mode === 'straight' ? this.mats.stopText : this.mats.red;
    const y = m(5.15);
    const len = mode === 'rightOnly' ? m(3.2) : m(2.4);
    const bar = new T.Mesh(new T.BoxGeometry(len, m(0.22), m(0.22)), mat);
    bar.position.set(0, y, 0);
    bar.rotation.y = mode === 'rightOnly' ? Math.PI / 4 : 0;
    group.add(bar);
    if (phase !== 'auto') {
      const ring = new T.Mesh(new T.TorusGeometry(m(1.15), m(0.10), 6, 18), phase === 'allRed' ? this.mats.red : phase === 'allGreen' ? this.mats.green : this.mats.yellow);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = m(4.55);
      group.add(ring);
    }
  }
}
