import { dist2D, pointAlongPolyline, polylineLength } from '../utils/MathUtils.js';
import { m } from '../utils/Scale.js';

export const LEGACY_ROAD_5M = {
  edgeInset: m(0.95),
  streetLane: m(3.65),
  avenueLane: m(3.70),
  oneWayLane: m(3.55),
  dirtLane: m(3.25),
  streetCenterMark: m(1.45),
  avenueMedian: m(5.4),
  dirtCenterGap: m(0.55),
  parkingLane: m(2.65),
  baseShoulder: m(5.0),
  minStreetWidth: m(13.0),
  minAvenueWidth: m(20.0),
  minOneWayWidth: m(9.8),
  dirtWidth: m(7.8),
  junctionPadMin: m(7.0),
  junctionPadMax: m(32.0),
  rampPadMin: m(8.0),
  looseRampLength: m(170)
};

export function legacyRoadKind(segment = {}) {
  if ((segment.kind || 'street') === 'dirt') return 'dirt';
  if ((segment.direction || 'twoWay') === 'oneWay') return 'oneway';
  if ((segment.kind || 'street') === 'avenue') return 'avenue';
  return 'street';
}

export function legacyLaneCount(segment = {}) {
  if ((segment.kind || 'street') === 'dirt') return 1;
  return Math.max(1, Math.min(5, Math.round(segment.lanes || 1)));
}

export function legacyRoadSpec(segment = {}) {
  const kind = legacyRoadKind(segment);
  const lanes = legacyLaneCount(segment);
  const parkingAllowed = segment.parkingAllowed === true || segment.laneClass === 'parking';
  const parkingW = parkingAllowed ? LEGACY_ROAD_5M.parkingLane : 0;
  const edgeInset = LEGACY_ROAD_5M.edgeInset;

  if (kind === 'dirt') {
    return {
      kind,
      uiKind: 'dirt',
      direction: 'twoWay',
      lanes: 1,
      lanesForward: 1,
      lanesReverse: 1,
      laneTotal: 2,
      laneWidth: LEGACY_ROAD_5M.dirtLane,
      width: LEGACY_ROAD_5M.dirtWidth,
      edgeInset,
      centerGap: LEGACY_ROAD_5M.dirtCenterGap,
      centerLineOffset: LEGACY_ROAD_5M.dirtCenterGap * 0.5,
      parkingW: 0
    };
  }

  if (kind === 'avenue') {
    const medianWidth = LEGACY_ROAD_5M.avenueMedian;
    const laneWidth = LEGACY_ROAD_5M.avenueLane;
    const parkingSides = parkingAllowed ? 2 : 0;
    const width = Math.max(LEGACY_ROAD_5M.minAvenueWidth, lanes * 2 * laneWidth + medianWidth + LEGACY_ROAD_5M.baseShoulder + parkingSides * parkingW);
    return {
      kind,
      uiKind: 'avenue',
      direction: 'twoWay',
      lanes,
      lanesForward: lanes,
      lanesReverse: lanes,
      laneTotal: lanes * 2,
      laneWidth,
      width,
      edgeInset,
      medianWidth,
      medianHalf: medianWidth * 0.5,
      centerGap: medianWidth,
      centerLineOffset: medianWidth * 0.5,
      parkingW
    };
  }

  if (kind === 'oneway') {
    const laneWidth = LEGACY_ROAD_5M.oneWayLane;
    const width = Math.max(LEGACY_ROAD_5M.minOneWayWidth, lanes * laneWidth + LEGACY_ROAD_5M.baseShoulder + parkingW);
    return {
      kind,
      uiKind: segment.kind || 'street',
      direction: 'oneWay',
      lanes,
      lanesForward: lanes,
      lanesReverse: 0,
      laneTotal: lanes,
      laneWidth,
      width,
      edgeInset,
      centerGap: 0,
      centerLineOffset: 0,
      parkingW
    };
  }

  const laneWidth = LEGACY_ROAD_5M.streetLane;
  const parkingSides = parkingAllowed ? 2 : 0;
  const centerMark = LEGACY_ROAD_5M.streetCenterMark;
  const width = Math.max(LEGACY_ROAD_5M.minStreetWidth, lanes * 2 * laneWidth + m(5.0) + parkingSides * parkingW);
  return {
    kind,
    uiKind: 'street',
    direction: 'twoWay',
    lanes,
    lanesForward: lanes,
    lanesReverse: lanes,
    laneTotal: lanes * 2,
    laneWidth,
    width,
    edgeInset,
    centerMark,
    centerGap: centerMark * 2,
    centerLineOffset: centerMark,
    parkingW
  };
}

export function legacyLaneMetrics(segment = {}, spec = legacyRoadSpec(segment)) {
  const lanes = spec.lanes || legacyLaneCount(segment);
  const parkingW = spec.parkingW || 0;
  if (spec.kind === 'oneway') {
    const driveWidth = Math.max(m(3.8), spec.width - spec.edgeInset * 2 - parkingW);
    const laneW = Math.max(m(3.35), driveWidth / lanes);
    const shift = parkingW ? -parkingW * 0.5 : 0;
    const centers = Array.from({ length: lanes }, (_, i) => (((lanes - 1) / 2) - i) * laneW + shift);
    return { ...spec, laneW, centers, forwardCenters: centers, reverseCenters: [] };
  }
  if (spec.kind === 'avenue') {
    const medianHalf = spec.medianHalf ?? (spec.medianWidth || LEGACY_ROAD_5M.avenueMedian) * 0.5;
    const sideWidth = Math.max(m(3.8), spec.width * 0.5 - spec.edgeInset - medianHalf - parkingW);
    const laneW = Math.max(m(3.45), sideWidth / lanes);
    const forwardCenters = Array.from({ length: lanes }, (_, i) => medianHalf + laneW * (i + 0.5));
    const reverseCenters = forwardCenters.map(v => -v);
    return { ...spec, laneW, medianHalf, centers: forwardCenters, forwardCenters, reverseCenters };
  }
  const centerMark = spec.centerMark || LEGACY_ROAD_5M.streetCenterMark;
  const laneW = Math.max(m(3.35), (spec.width * 0.5 - spec.edgeInset - centerMark - parkingW) / lanes);
  const forwardCenters = Array.from({ length: lanes }, (_, i) => centerMark + laneW * (i + 0.5));
  const reverseCenters = forwardCenters.map(v => -v);
  return { ...spec, laneW, centerMark, centers: forwardCenters, forwardCenters, reverseCenters };
}

export function legacyLaneLayout(segment = {}, widthOverride = null) {
  const spec = legacyRoadSpec(segment);
  if (Number.isFinite(widthOverride)) spec.width = widthOverride;
  const metrics = legacyLaneMetrics(segment, spec);
  const innerHalf = Math.max(m(2.2), (metrics.width * 0.5) - metrics.edgeInset - (metrics.parkingW || 0));
  return {
    lanes: metrics.lanes,
    direction: metrics.direction,
    kind: metrics.uiKind,
    legacyKind: metrics.kind,
    total: metrics.laneTotal,
    laneWidth: metrics.laneW,
    innerWidth: innerHalf * 2,
    innerHalf,
    centerGap: metrics.centerGap || 0,
    centerLineOffset: metrics.kind === 'avenue' ? metrics.medianHalf : (metrics.centerMark || 0),
    medianWidth: metrics.medianWidth || 0,
    medianHalf: metrics.medianHalf || 0,
    edgeInset: metrics.edgeInset,
    parkingW: metrics.parkingW || 0,
    forwardCenters: metrics.forwardCenters || metrics.centers || [],
    reverseCenters: metrics.reverseCenters || []
  };
}

export function legacyLaneCenterOffsets(segment = {}, widthOverride = null) {
  const layout = legacyLaneLayout(segment, widthOverride);
  return {
    forward: [...layout.forwardCenters],
    reverse: [...layout.reverseCenters],
    layout
  };
}

export function legacyEndpointTransitions(system, segment = {}) {
  const level = Number(segment.elevation || 0);
  if (level === 0) return { rampStart: false, rampEnd: false, startLevel: 0, endLevel: 0 };
  const startNode = system.getNode?.(segment.a);
  const endNode = system.getNode?.(segment.b);
  const touchDifferent = (nodeId) => {
    for (const other of system.game?.state?.networks?.roads || []) {
      if (other.id === segment.id) continue;
      if (other.a !== nodeId && other.b !== nodeId) continue;
      const otherLevel = Number(other.elevation || 0);
      if (otherLevel !== level) return otherLevel;
    }
    return null;
  };
  const hasSame = (nodeId) => system.hasSameLevelContinuation?.(segment, nodeId) === true;
  const resolve = (which, node) => {
    const explicit = Number(segment[which === 'start' ? 'startLevel' : 'endLevel']);
    if (Number.isFinite(explicit) && explicit !== level) return explicit;
    const nodeLevel = Number(node?.elevation);
    if (Number.isFinite(nodeLevel) && nodeLevel !== level) return nodeLevel;
    const touched = touchDifferent(which === 'start' ? segment.a : segment.b);
    if (touched !== null) return touched;
    // Rampa visual só existe quando há conexão real entre níveis diferentes.
    // Segmento elevado solto ou continuação no mesmo nível NÃO deve descer sozinho ao solo,
    // pois isso gerava rampas/placas quebradas nos nós.
    if (!hasSame(which === 'start' ? segment.a : segment.b)) return level;
    return level;
  };
  const startLevel = resolve('start', startNode);
  const endLevel = resolve('end', endNode);
  return {
    rampStart: Number(startLevel) !== level,
    rampEnd: Number(endLevel) !== level,
    startLevel,
    endLevel
  };
}

export function legacyTrimSamplesAtJunctions(system, segment, samples, width, options = {}) {
  if (!segment || !samples?.length) return samples || [];
  const length = polylineLength(samples);
  if (length < m(20)) return samples;
  const level = segment.elevation || 0;
  const degreeAt = (nodeId) => (system.game?.state?.networks?.roads || [])
    .filter(seg => (seg.elevation || 0) === level && (seg.a === nodeId || seg.b === nodeId))
    .length;
  const tr = legacyEndpointTransitions(system, segment);
  // Marcações precisam parar antes da zebra + linha de retenção. A superfície
  // continua com corte curto; só pintura/overlays usam o afastamento maior.
  const junctionPad = Math.max(
    LEGACY_ROAD_5M.junctionPadMin,
    Math.min(LEGACY_ROAD_5M.junctionPadMax, width * (options.surface ? 0.38 : 1.05) + (options.surface ? m(1.6) : m(7.2)))
  );
  const loosePad = options.surface ? m(0.8) : m(3.2);
  const rampPad = Math.max(LEGACY_ROAD_5M.rampPadMin, Math.min(length * 0.22, width * 0.86 + m(1.2)));
  const startTrim = tr.rampStart ? rampPad : (degreeAt(segment.a) >= 3 ? junctionPad : loosePad);
  const endTrim = tr.rampEnd ? rampPad : (degreeAt(segment.b) >= 3 ? junctionPad : loosePad);
  if (length <= startTrim + endTrim + m(6)) return [];
  const out = [];
  const start = pointAlongPolyline(samples, startTrim);
  const end = pointAlongPolyline(samples, length - endTrim);
  if (start) out.push(start);
  let walked = 0;
  for (let i = 1; i < samples.length - 1; i++) {
    walked += dist2D(samples[i - 1], samples[i]);
    if (walked > startTrim && walked < length - endTrim) out.push(samples[i]);
  }
  if (end) out.push(end);
  return out;
}
