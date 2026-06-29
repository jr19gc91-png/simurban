import { makeId, pointAlongPolyline, safeDisposeObject, segmentPointDistance2D } from '../utils/MathUtils.js';
import { LEGACY_CELL_M, LEGACY_ZONE_GRID_DEPTH } from '../legacy/LegacyConstants.js';
import { m } from '../utils/Scale.js';

const ZONE_COLORS = {
  residential: 'zoneResidential',
  commercial: 'zoneCommercial',
  industrial: 'zoneIndustrial'
};

const ZONE_GRID_DEPTH = Math.max(2, Math.min(2, LEGACY_ZONE_GRID_DEPTH));
const ZONE_CELL_SIZE = Math.max(m(14), Math.round(m(LEGACY_CELL_M) * 0.90));

const ZONE_PROFILE = {
  residential: {
    label: 'Residencial',
    lotWidth: m(32),
    lotDepth: m(42),
    roadOffset: m(2.8),
    maxSlope: 12,
    maxHeightDelta: 6.5,
    minRoadDistance: m(18),
    minNodeDistance: m(34),
    cost: 95
  },
  commercial: {
    label: 'Comercial',
    lotWidth: m(40),
    lotDepth: m(48),
    roadOffset: m(3.4),
    maxSlope: 11,
    maxHeightDelta: 6,
    minRoadDistance: m(20),
    minNodeDistance: m(40),
    cost: 135
  },
  industrial: {
    label: 'Industrial',
    lotWidth: m(56),
    lotDepth: m(58),
    roadOffset: m(4.6),
    maxSlope: 9,
    maxHeightDelta: 5.5,
    minRoadDistance: m(26),
    minNodeDistance: m(52),
    cost: 185
  }
};

export class ZoningSystem {
  constructor({ game, roadSystem, materials }) {
    this.game = game;
    this.map = game.map;
    this.THREE = game.mapCore.THREE;
    this.roads = roadSystem;
    this.materials = materials;
    this.group = game.groups.zones;
    this.maxLotsPerClick = 96;
    this.localMaterials = {
      foundation: new this.THREE.MeshStandardMaterial({ color: 0xb8ad98, roughness: 0.96, transparent: true, opacity: 0.72, polygonOffset: true, polygonOffsetFactor: -0.4, polygonOffsetUnits: -0.4 }),
      driveway: new this.THREE.MeshStandardMaterial({ color: 0x777065, roughness: 0.98, transparent: true, opacity: 0.86, polygonOffset: true, polygonOffsetFactor: -0.6, polygonOffsetUnits: -0.6 }),
      grid: new this.THREE.MeshStandardMaterial({ color: 0x9bcf91, roughness: 0.92, transparent: true, opacity: 0.14, polygonOffset: true, polygonOffsetFactor: -0.8, polygonOffsetUnits: -0.8 }),
      invalid: materials.zoneInvalid
    };
  }

  handleClick(point, zoneType = this.game.state.selectedZoneType || 'residential', sideFilter = this.game.state.buildOptions?.zoneSide || 'both') {
    {
      const created = this.paintGridAt(point, zoneType, sideFilter, { radius: m(48), max: this.maxLotsPerClick });
      if (created > 0) {
        const profile = this.getProfile(zoneType);
        this.game.state.simulation.money -= created * profile.cost;
        this.game.state.inspector.text = `${created} lote(s) ${profile.label.toLowerCase()} criados.`;
        this.game.rebuildCitySystems({ zoning: true, buildings: true, vehicles: true });
        this.game.emitChange();
      } else {
        this.game.state.inspector.text = 'Nenhum lote criado: pinte sobre a grade gerada por vias zoneaveis no nivel do solo.';
        this.game.emitChange();
      }
      return created > 0;
    }
    const hit = this.roads.findNearestSegment(point, m(38));
    if (!hit) {
      this.game.state.inspector.text = 'Zoneamento: clique mais perto de uma via térrea.';
      this.game.emitChange();
      return false;
    }
    if ((hit.segment.elevation || 0) !== 0) {
      this.game.state.inspector.text = 'Zoneamento bloqueado: por enquanto só vias no nível do solo geram lotes.';
      this.game.emitChange();
      return false;
    }
    const created = this.zoneRoadSegment(hit.segment, zoneType, sideFilter);
    if (created > 0) {
      const profile = this.getProfile(zoneType);
      this.game.state.simulation.money -= created * profile.cost;
      this.game.state.inspector.text = `${created} lote(s) ${profile.label.toLowerCase()} criados.`;
      this.game.rebuildCitySystems({ zoning: true, buildings: true, vehicles: true });
      this.game.emitChange();
    } else {
      this.game.state.inspector.text = 'Nenhum lote criado: água, declive, cruzamento, estrada próxima ou sobreposição.';
      this.game.emitChange();
    }
    return created > 0;
  }

  generateGridForSegments(segments = []) {
    return this.rebuildZoneGrid();
  }

  rebuildZoneGrid() {
    if (!Array.isArray(this.game.state.zoneGrid)) this.game.state.zoneGrid = [];
    const previous = new Map(this.game.state.zoneGrid.map(cell => [cell.key, cell]));
    const lotsByGrid = new Map();
    for (const lot of this.game.state.zoning || []) {
      const keys = Array.isArray(lot.gridKeys) && lot.gridKeys.length ? lot.gridKeys : (lot.gridKey ? [lot.gridKey] : []);
      for (const key of keys) lotsByGrid.set(key, lot);
    }
    this.game.state.zoneGrid = [];
    this._previousGridByKey = previous;
    this._lotsByGridKey = lotsByGrid;
    let created = 0;
    for (const segment of this.game.state.networks.roads || []) created += this.generateGridForRoadSegment(segment);
    this._previousGridByKey = null;
    this._lotsByGridKey = null;
    return created;
  }

  generateGridForRoadSegment(segment) {
    if (!segment || segment.zoneable === false || (segment.elevation || 0) !== 0 || segment.kind === 'dirt') return 0;
    if (!Array.isArray(this.game.state.zoneGrid)) this.game.state.zoneGrid = [];

    const length = this.roads.getSegmentLength(segment);
    if (!Number.isFinite(length) || length < ZONE_CELL_SIZE * 1.1) return 0;
    const samples = this.roads.getSegmentSamples(segment, Math.max(10, Math.ceil(length / 12)));
    if (samples.length < 2) return 0;

    const roadHalf = this.roads.getSegmentWidth(segment) * 0.5;
    const cellSize = ZONE_CELL_SIZE;
    const maxDepth = ZONE_GRID_DEPTH;
    const seen = new Set(this.game.state.zoneGrid.map(cell => cell.key));
    const oldByRoadLocal = this.buildPreviousGridLookup(segment.id);
    const oldLotsByRoadLocal = this.buildPreviousLotLookup(segment.id);
    let created = 0;

    // v2.4.2: grade agora nasce no eixo local da via. Antes a chave global arredondada
    // criava lotes em escadinha, desalinhados e com buracos perto de ruas diagonais/curvas.
    const startMargin = Math.max(cellSize * 0.58, roadHalf * 0.38);
    const endMargin = Math.max(cellSize * 0.58, roadHalf * 0.38);
    const usableLength = Math.max(0, length - startMargin - endMargin);
    const columns = Math.max(1, Math.floor(usableLength / cellSize));
    for (let col = 0; col < columns; col++) {
      const d = startMargin + (col + 0.5) * (usableLength / columns);
      const base = pointAlongPolyline(samples, d);
      if (!base) continue;
      const heading = base.heading || 0;
      const nx = -Math.sin(heading), nz = Math.cos(heading);
      const nodeClearance = Math.max(m(58), roadHalf + cellSize * 2.05);
      if (this.distanceToNearestRoadNode({ x: base.x, z: base.z }) < nodeClearance) continue;

      for (const side of [-1, 1]) {
        if (side < 0 && segment.zoneRight === false) continue;
        if (side > 0 && segment.zoneLeft === false) continue;
        for (let row = 0; row < maxDepth; row++) {
          const dist = roadHalf + this.sidewalkClearanceFor(segment) + cellSize * (row + 0.5);
          const x = base.x + nx * side * dist;
          const z = base.z + nz * side * dist;
          const key = this.gridCellKey(segment, side, row, col);
          if (seen.has(key)) continue;
          const gridCell = {
            id: makeId('zg'), key, roadId: segment.id,
            x, z, y: this.map.getHeightAt(x, z) + 0.08,
            width: cellSize * 0.90, depth: cellSize * 0.90,
            rotation: -heading,
            lotRotation: -heading + (side < 0 ? Math.PI : 0),
            roadHeading: heading,
            roadDistance: dist,
            side,
            row: row + 1,
            col: col + 1,
            level: segment.elevation || 0
          };
          if (!this.isGridCellValid(x, z, gridCell, segment)) continue;
          const localId = this.gridLocalId(side, row, col);
          const oldCell = this._previousGridByKey?.get(key) || oldByRoadLocal.get(localId) || this.findPreviousGridNear(gridCell);
          const existingLot = this._lotsByGridKey?.get(key) || oldLotsByRoadLocal.get(localId) || this.findLotNearGridCell(gridCell);
          if (oldCell?.zone || existingLot?.zone) gridCell.zone = existingLot?.zone || oldCell.zone;
          if (oldCell?.occupied || existingLot) gridCell.occupied = true;
          this.game.state.zoneGrid.push(gridCell);
          seen.add(key);
          created++;
        }
      }
    }
    return created;
  }

  gridCellKey(segment, side, row, col) {
    return `grid:${segment.id}:${side}:${row + 1}:${col + 1}`;
  }

  gridLocalId(side, row, col) {
    return `${side}:${row + 1}:${col + 1}`;
  }

  buildPreviousGridLookup(roadId) {
    const lookup = new Map();
    for (const cell of this._previousGridByKey?.values?.() || []) {
      if (cell.roadId !== roadId || !Number.isFinite(cell.side) || !Number.isFinite(cell.row) || !Number.isFinite(cell.col)) continue;
      lookup.set(`${cell.side}:${cell.row}:${cell.col}`, cell);
    }
    return lookup;
  }

  buildPreviousLotLookup(roadId) {
    const lookup = new Map();
    for (const lot of this.game.state.zoning || []) {
      if (lot.roadId !== roadId || !Number.isFinite(lot.side) || !Number.isFinite(lot.row) || !Number.isFinite(lot.col)) continue;
      lookup.set(`${lot.side}:${lot.row}:${lot.col}`, lot);
    }
    return lookup;
  }

  findPreviousGridNear(cell) {
    let best = null;
    for (const old of this._previousGridByKey?.values?.() || []) {
      if (old.roadId !== cell.roadId || old.side !== cell.side || old.row !== cell.row) continue;
      const d = Math.hypot(old.x - cell.x, old.z - cell.z);
      if (d < ZONE_CELL_SIZE * 0.62 && (!best || d < best.d)) best = { old, d };
    }
    return best?.old || null;
  }

  findLotNearGridCell(cell) {
    let best = null;
    for (const lot of this.game.state.zoning || []) {
      if (lot.roadId !== cell.roadId || lot.side !== cell.side || lot.row !== cell.row) continue;
      const d = Math.hypot(lot.x - cell.x, lot.z - cell.z);
      if (d < ZONE_CELL_SIZE * 0.78 && (!best || d < best.d)) best = { lot, d };
    }
    return best?.lot || null;
  }

  sidewalkClearanceFor(segment) {
    if (segment.kind === 'dirt' || segment.zoneable === false) return m(0.5);
    return m(0.30);
  }

  isGridCellValid(x, z, cell = null, sourceSegment = null) {
    if (!this.map.isInsideWorld(x, z)) return false;
    if (this.map.isWaterAt(x, z)) return false;
    if (!this.map.isBuildableAt(x, z, { maxSlope: 28, minHeightAboveSea: 5 })) return false;
    if (cell && this.cellNearRoadNode(cell, sourceSegment)) return false;
    if (cell && this.cellConflictsWithRoads(cell, sourceSegment)) return false;
    for (const lot of this.game.state.zoning) {
      if (cell?.key && lot.gridKey === cell.key) continue;
      if (Math.hypot(x - lot.x, z - lot.z) < Math.max(m(12), Math.min(lot.width, lot.depth) * 0.6)) return false;
    }
    return true;
  }

  cellConflictsWithRoads(cell, sourceSegment = null) {
    const rotation = cell.rotation || 0;
    const probes = [
      { x: cell.x, z: cell.z },
      ...this.getLotCorners({ ...cell, rotation }),
      ...this.getLotEdgeMidpoints(this.getLotCorners({ ...cell, rotation }))
    ];
    for (const segment of this.game.state.networks.roads || []) {
      if ((segment.elevation || 0) !== (cell.level || 0)) continue;
      const width = this.roads.getSegmentWidth(segment);
      // Para a própria via, deixa a primeira fileira encostar na calçada sem ser invalidada.
      const threshold = width * 0.5 + (segment.id === sourceSegment?.id ? m(0.35) : m(22.0));
      const samples = this.roads.getSegmentSamples(segment, Math.max(6, Math.ceil(this.roads.getSegmentLength(segment) / 22)));
      for (const probe of probes) {
        if (this.distanceToSamples(probe, samples) < threshold) return true;
      }
    }
    return false;
  }

  cellNearRoadNode(cell, sourceSegment = null) {
    const rotation = cell.rotation || 0;
    const corners = this.getLotCorners({ ...cell, rotation });
    const probes = [
      { x: cell.x, z: cell.z },
      ...corners,
      ...this.getLotEdgeMidpoints(corners)
    ];
    const sourceWidth = sourceSegment ? this.roads.getSegmentWidth(sourceSegment) : m(24);
    const clearance = Math.max(m(64), sourceWidth * 0.5 + Math.max(cell.width || 0, cell.depth || 0) * 1.35);
    for (const node of this.game.state.networks.roadNodes || []) {
      if ((node.elevation || 0) !== (cell.level || 0)) continue;
      for (const probe of probes) {
        if (Math.hypot(probe.x - node.x, probe.z - node.z) < clearance) return true;
      }
    }
    return false;
  }

  distanceToSamples(point, samples = []) {
    let best = Infinity;
    for (let i = 1; i < samples.length; i++) {
      best = Math.min(best, segmentPointDistance2D(point, samples[i - 1], samples[i]).distance);
    }
    return best;
  }

  getZoneDensity(zoneType = this.game.state.selectedZoneType || 'residential') {
    return zoneType === 'industrial' ? 'low' : (this.game.state.selectedZoneDensity || 'low');
  }

  getProfile(zoneType) {
    const base = ZONE_PROFILE[zoneType] || ZONE_PROFILE.residential;
    const density = this.getZoneDensity(zoneType);
    const lotMul = density === 'high' ? 1.28 : density === 'medium' ? 1.12 : 1.0;
    const depthMul = density === 'high' ? 1.16 : density === 'medium' ? 1.08 : 1.0;
    const costMul = zoneType === 'industrial' ? 1 : density === 'high' ? 1.45 : density === 'medium' ? 1.18 : 1.0;
    return {
      ...base,
      density,
      label: zoneType === 'industrial' ? base.label : `${base.label} ${density === 'high' ? 'alta' : density === 'medium' ? 'média' : 'baixa'}`,
      lotWidth: Math.round(base.lotWidth * lotMul),
      lotDepth: Math.round(base.lotDepth * depthMul),
      roadOffset: Math.max(m(2.6), base.roadOffset + (density === 'high' ? -m(1.4) : density === 'medium' ? -m(0.8) : -m(0.2))),
      cost: Math.round(base.cost * costMul)
    };
  }

  zoneRoadSegment(segment, zoneType, sideFilter = 'both') {
    const profile = this.getProfile(zoneType);
    const length = this.roads.getSegmentLength(segment);
    const steps = Math.max(4, Math.min(80, Math.ceil(length / Math.max(m(18), profile.lotWidth * 0.86))));
    const samples = this.roads.getSegmentSamples(segment, steps);
    if (samples.length < 2) return 0;

    const existingKeys = new Set(this.game.state.zoning.map(lot => lot.key));
    let created = 0;
    for (let i = 0; i < samples.length - 1 && created < this.maxLotsPerClick; i++) {
      const a = samples[i], b = samples[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < m(12)) continue;
      const count = Math.max(1, Math.floor(len / profile.lotWidth));
      const heading = Math.atan2(dz, dx);
      for (let j = 0; j < count && created < this.maxLotsPerClick; j++) {
        const t = (j + 0.5) / count;
        const cx = a.x + dx * t;
        const cz = a.z + dz * t;
        if (this.distanceToNearestRoadNode({ x: cx, z: cz }) < profile.minNodeDistance) continue;
        for (const side of this.resolveSides(sideFilter, heading)) {
          const candidate = this.makeLotCandidate({ segment, zoneType, profile, cx, cz, heading, side });
          if (existingKeys.has(candidate.key)) continue;
          if (!this.isLotValid(candidate, segment)) continue;
          const lot = {
            id: makeId('lot'),
            key: candidate.key,
            roadId: segment.id,
            zone: zoneType,
            x: candidate.x,
            y: this.map.getHeightAt(candidate.x, candidate.z) + 0.11,
            z: candidate.z,
            width: candidate.width,
            depth: candidate.depth,
            rotation: candidate.rotation,
            side,
            roadHeading: heading,
            roadDistance: candidate.roadDistance,
            occupied: false,
            terrain: candidate.terrain,
            createdAtDay: this.game.state.simulation.day
          };
          this.game.state.zoning.push(lot);
          existingKeys.add(candidate.key);
          created++;
        }
      }
    }
    return created;
  }

  resolveSides(sideFilter = 'both', heading = 0) {
    if (sideFilter === 'left') return [1];
    if (sideFilter === 'right') return [-1];
    return [-1, 1];
  }

  paintAt(point, zoneType = this.game.state.selectedZoneType || 'residential', sideFilter = this.game.state.buildOptions?.zoneSide || 'both') {
    return this.paintGridAt(point, zoneType, sideFilter, { radius: m(42), max: this.maxLotsPerClick });
  }

  paintGridAt(point, zoneType = this.game.state.selectedZoneType || 'residential', sideFilter = 'both', { radius = m(42), max = 96 } = {}) {
    if (!point) return 0;
    if (!Array.isArray(this.game.state.zoneGrid) || this.game.state.zoneGrid.length === 0) this.rebuildZoneGrid();
    const allowedSides = new Set(this.resolveSides(sideFilter));
    const candidates = (this.game.state.zoneGrid || [])
      .filter(cell => !cell.occupied && allowedSides.has(cell.side))
      .map(cell => ({ cell, d: Math.hypot(cell.x - point.x, cell.z - point.z) }))
      .filter(hit => hit.d <= radius)
      .sort((a, b) => a.d - b.d);
    let created = 0;
    for (const { cell } of candidates) {
      if (created >= max) break;
      if (this.createLotFromGridCell(cell, zoneType)) created++;
    }
    return created;
  }

  createLotFromGridCell(cell, zoneType) {
    if (!cell || cell.occupied) return false;
    const segment = this.game.state.networks.roads.find(seg => seg.id === cell.roadId);
    if (!segment || segment.kind === 'dirt' || (segment.elevation || 0) !== 0 || segment.zoneable === false) return false;
    if (!this.isGridCellValid(cell.x, cell.z, cell, segment)) return false;

    const block = this.gatherGridLotBlock(cell, zoneType, segment);
    if (!block?.cells?.length) return false;
    const candidate = this.makeLotCandidateFromGridBlock(block, cell);
    candidate.corners = this.getLotCorners(candidate);
    if (this.overlapsExistingLots(candidate)) return false;
    if (this.cellConflictsWithRoads({ ...candidate, level: cell.level }, segment)) return false;

    let minY = Infinity;
    let maxY = -Infinity;
    let maxSlope = 0;
    for (const probe of [{ x: candidate.x, z: candidate.z }, ...candidate.corners, ...this.getLotEdgeMidpoints(candidate.corners)]) {
      if (!this.map.isInsideWorld(probe.x, probe.z) || this.map.isWaterAt(probe.x, probe.z)) return false;
      const yProbe = this.map.getHeightAt(probe.x, probe.z);
      minY = Math.min(minY, yProbe);
      maxY = Math.max(maxY, yProbe);
      maxSlope = Math.max(maxSlope, this.map.getSlopeAt(probe.x, probe.z));
    }
    if ((maxY - minY) > 7.4 || maxSlope > 28) return false;

    const y = this.map.getHeightAt(candidate.x, candidate.z);
    const keys = block.cells.map(item => item.key);
    this.game.state.zoning.push({
      id: makeId('lot'),
      key: `${zoneType}:${keys.join('|')}`,
      gridKey: cell.key,
      gridKeys: keys,
      gridSpan: { cols: block.colSpan, rows: block.rowSpan },
      roadId: segment.id,
      zone: zoneType,
      x: candidate.x,
      y: y + 0.11,
      z: candidate.z,
      width: candidate.width,
      depth: candidate.depth,
      rotation: candidate.rotation,
      side: cell.side,
      row: cell.row,
      col: cell.col,
      roadHeading: cell.roadHeading,
      roadDistance: cell.roadDistance,
      density: this.getZoneDensity(zoneType),
      occupied: false,
      terrain: { minY: Math.round(minY * 10) / 10, maxY: Math.round(maxY * 10) / 10, slope: Math.round(maxSlope * 10) / 10 },
      createdAtDay: this.game.state.simulation.day
    });
    for (const used of block.cells) {
      used.occupied = true;
      used.zone = zoneType;
    }
    return true;
  }


  hashString(text) {
    let h = 2166136261;
    for (let i = 0; i < String(text).length; i++) {
      h ^= String(text).charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  rand01(seed) {
    let t = (seed >>> 0) + 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  gatherGridLotBlock(anchor, zoneType, segment) {
    const preferred = this.preferredGridSpan(anchor, zoneType);
    const candidates = [];
    for (let cols = preferred.cols; cols >= 1; cols--) {
      for (let rows = preferred.rows; rows >= 1; rows--) candidates.push({ cols, rows });
    }
    const byLocal = new Map((this.game.state.zoneGrid || [])
      .filter(c => c.roadId === anchor.roadId && c.side === anchor.side && (c.level || 0) === (anchor.level || 0))
      .map(c => [`${c.row}:${c.col}`, c]));
    for (const span of candidates) {
      const cells = this.tryCollectGridSpan(anchor, span.cols, span.rows, byLocal, segment);
      if (cells.length === span.cols * span.rows) return { cells, colSpan: span.cols, rowSpan: span.rows };
    }
    return { cells: [anchor], colSpan: 1, rowSpan: 1 };
  }

  preferredGridSpan(cell, zoneType) {
    const seed = this.hashString(`${cell.key}:${zoneType}:span`);
    const r = this.rand01(seed);
    const density = this.getZoneDensity(zoneType);
    if (zoneType === 'industrial') return r > 0.62 ? { cols: 4, rows: 3 } : r > 0.28 ? { cols: 3, rows: 3 } : { cols: 3, rows: 2 };
    if (zoneType === 'commercial') {
      if (density === 'high') return r > 0.60 ? { cols: 4, rows: 3 } : { cols: 3, rows: 3 };
      if (density === 'medium') return r > 0.58 ? { cols: 3, rows: 2 } : { cols: 2, rows: 2 };
      return r > 0.70 ? { cols: 3, rows: 2 } : r > 0.34 ? { cols: 2, rows: 2 } : { cols: 2, rows: 1 };
    }
    if (density === 'high') return r > 0.55 ? { cols: 4, rows: 3 } : { cols: 3, rows: 3 };
    if (density === 'medium') return r > 0.58 ? { cols: 3, rows: 2 } : { cols: 2, rows: 2 };
    return r > 0.82 ? { cols: 2, rows: 2 } : r > 0.46 ? { cols: 2, rows: 1 } : { cols: 1, rows: 2 };
  }

  tryCollectGridSpan(anchor, cols, rows, byLocal, segment) {
    const cells = [];
    const startCol = anchor.col - Math.floor((cols - 1) * 0.5);
    const startRow = anchor.row;
    for (let row = startRow; row < startRow + rows; row++) {
      for (let col = startCol; col < startCol + cols; col++) {
        const cell = byLocal.get(`${row}:${col}`);
        if (!cell || cell.occupied || cell.zone) return [];
        if (!this.isGridCellValid(cell.x, cell.z, cell, segment)) return [];
        cells.push(cell);
      }
    }
    return cells;
  }

  makeLotCandidateFromGridBlock(block, anchor) {
    const cells = block.cells;
    const x = cells.reduce((sum, c) => sum + c.x, 0) / cells.length;
    const z = cells.reduce((sum, c) => sum + c.z, 0) / cells.length;
    const cellSize = ZONE_CELL_SIZE;
    const width = Math.max(m(14), block.colSpan * cellSize * 0.96);
    const depth = Math.max(m(14), block.rowSpan * cellSize * 0.96);
    return {
      x,
      z,
      width,
      depth,
      rotation: Number.isFinite(anchor.lotRotation) ? anchor.lotRotation : (anchor.rotation || 0)
    };
  }

  makeLotCandidate({ segment, zoneType, profile, cx, cz, heading, side }) {
    const nx = -Math.sin(heading), nz = Math.cos(heading);
    const roadHalf = this.roads.getSegmentWidth(segment) * 0.5;
    const roadDistance = roadHalf + profile.roadOffset + profile.lotDepth * 0.5;
    const x = cx + nx * side * roadDistance;
    const z = cz + nz * side * roadDistance;
    return {
      segment,
      zoneType,
      profile,
      x,
      z,
      width: profile.lotWidth * 0.94,
      depth: profile.lotDepth,
      rotation: -heading + (side < 0 ? Math.PI : 0),
      side,
      roadDistance,
      key: `${zoneType}:${Math.round(x / 8)}:${Math.round(z / 8)}:${side}`
    };
  }

  isLotValid(candidate, sourceSegment) {
    const profile = candidate.profile;
    const corners = this.getLotCorners(candidate);
    const probes = [
      [candidate.x, candidate.z],
      ...corners.map(p => [p.x, p.z]),
      ...this.getLotEdgeMidpoints(corners).map(p => [p.x, p.z])
    ];

    let minY = Infinity;
    let maxY = -Infinity;
    let maxSlope = 0;
    for (const [sx, sz] of probes) {
      if (!this.map.isInsideWorld(sx, sz)) return false;
      if (!this.map.isBuildableAt(sx, sz, { maxSlope: profile.maxSlope, minHeightAboveSea: 7 })) return false;
      if (this.map.isWaterAt(sx, sz)) return false;
      const y = this.map.getHeightAt(sx, sz);
      const slope = this.map.getSlopeAt(sx, sz);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      maxSlope = Math.max(maxSlope, slope);
    }
    if ((maxY - minY) > profile.maxHeightDelta) return false;

    const candidateRect = { ...candidate, corners };
    if (this.overlapsExistingLots(candidateRect)) return false;
    if (this.conflictsWithRoads(candidateRect, sourceSegment, profile)) return false;

    candidate.terrain = {
      minY: Math.round(minY * 10) / 10,
      maxY: Math.round(maxY * 10) / 10,
      slope: Math.round(maxSlope * 10) / 10
    };
    return true;
  }

  distanceToNearestRoadNode(point) {
    let best = Infinity;
    for (const node of this.game.state.networks.roadNodes) {
      best = Math.min(best, Math.hypot(point.x - node.x, point.z - node.z));
    }
    return best;
  }

  conflictsWithRoads(candidate, sourceSegment, profile) {
    const center = { x: candidate.x, z: candidate.z };
    for (const segment of this.game.state.networks.roads) {
      if (segment.id === sourceSegment.id) continue;
      if ((segment.elevation || 0) !== 0) continue;
      const a = this.roads.getNode(segment.a);
      const b = this.roads.getNode(segment.b);
      if (!a || !b) continue;
      const hit = segmentPointDistance2D(center, a, b);
      if (hit.distance < profile.minRoadDistance) return true;
      for (const corner of candidate.corners) {
        const cHit = segmentPointDistance2D(corner, a, b);
        if (cHit.distance < m(10)) return true;
      }
    }
    return false;
  }

  overlapsExistingLots(candidate) {
    for (const lot of this.game.state.zoning) {
      const rough = Math.hypot(candidate.x - lot.x, candidate.z - lot.z);
      if (rough > (candidate.width + candidate.depth + lot.width + lot.depth) * 0.42) continue;
      const other = { ...lot, corners: this.getLotCorners(lot) };
      if (this.orientedRectsOverlap(candidate, other)) return true;
    }
    return false;
  }

  getLotCorners(lot) {
    const c = Math.cos(lot.rotation), s = Math.sin(lot.rotation);
    const hx = lot.width * 0.5;
    const hz = lot.depth * 0.5;
    const local = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]];
    return local.map(([x, z]) => ({
      x: lot.x + x * c - z * s,
      z: lot.z + x * s + z * c
    }));
  }

  getLotEdgeMidpoints(corners) {
    const mids = [];
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % corners.length];
      mids.push({ x: (a.x + b.x) * 0.5, z: (a.z + b.z) * 0.5 });
    }
    return mids;
  }

  orientedRectsOverlap(a, b) {
    const axes = [];
    for (const rect of [a, b]) {
      const c = rect.corners;
      for (let i = 0; i < 2; i++) {
        const p = c[i], q = c[(i + 1) % c.length];
        const ex = q.x - p.x, ez = q.z - p.z;
        const len = Math.hypot(ex, ez) || 1;
        axes.push({ x: -ez / len, z: ex / len });
      }
    }
    for (const axis of axes) {
      const pa = this.projectCorners(a.corners, axis);
      const pb = this.projectCorners(b.corners, axis);
      if (pa.max < pb.min + 1.5 || pb.max < pa.min + 1.5) return false;
    }
    return true;
  }

  projectCorners(corners, axis) {
    let min = Infinity, max = -Infinity;
    for (const p of corners) {
      const v = p.x * axis.x + p.z * axis.z;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    return { min, max };
  }

  clearZoneAt(point) {
    let best = null;
    for (const lot of this.game.state.zoning) {
      const d = Math.hypot(point.x - lot.x, point.z - lot.z);
      if (d < Math.max(lot.width, lot.depth) * 0.62 && (!best || d < best.d)) best = { lot, d };
    }
    if (!best) return false;
    this.game.state.zoning = this.game.state.zoning.filter(lot => lot.id !== best.lot.id);
    const gridKeys = Array.isArray(best.lot.gridKeys) && best.lot.gridKeys.length ? best.lot.gridKeys : (best.lot.gridKey ? [best.lot.gridKey] : []);
    if (gridKeys.length && Array.isArray(this.game.state.zoneGrid)) {
      const keySet = new Set(gridKeys);
      for (const cell of this.game.state.zoneGrid) {
        if (!keySet.has(cell.key)) continue;
        cell.occupied = false;
        delete cell.zone;
      }
    }
    this.game.state.buildings = this.game.state.buildings.filter(b => b.lotId !== best.lot.id);
    this.game.rebuildCitySystems({ zoning: true, buildings: true, vehicles: true });
    this.game.emitChange();
    return true;
  }

  cleanupInvalidLots() {
    const before = this.game.state.zoning.length;
    const roads = new Map(this.game.state.networks.roads.map(seg => [seg.id, seg]));
    this.game.state.zoning = this.game.state.zoning.filter(lot => {
      const segment = roads.get(lot.roadId);
      if (!segment) return false;
      if ((segment.elevation || 0) !== 0) return false;
      const profile = this.getProfile(lot.zone);
      const candidate = { ...lot, profile, corners: this.getLotCorners(lot) };
      const center = { x: lot.x, z: lot.z };
      const a = this.roads.getNode(segment.a);
      const b = this.roads.getNode(segment.b);
      if (!a || !b) return false;
      const hit = segmentPointDistance2D(center, a, b);
      const expectedDistance = lot.roadDistance || (this.roads.getSegmentWidth(segment) * 0.5 + profile.roadOffset + profile.lotDepth * 0.5);
      if (Math.abs(hit.distance - expectedDistance) > Math.max(m(12), profile.lotDepth * 0.36)) return false;
      return this.isTerrainStillValid(candidate, profile);
    });
    if (this.game.state.zoning.length !== before) {
      const lots = new Set(this.game.state.zoning.map(lot => lot.id));
      this.game.state.buildings = this.game.state.buildings.filter(b => lots.has(b.lotId));
    }
    if (Array.isArray(this.game.state.zoneGrid)) {
      const roads = new Set(this.game.state.networks.roads.map(seg => seg.id));
      this.game.state.zoneGrid = this.game.state.zoneGrid.filter(cell => roads.has(cell.roadId));
    }
  }

  isTerrainStillValid(lot, profile) {
    const corners = lot.corners || this.getLotCorners(lot);
    const probes = [[lot.x, lot.z], ...corners.map(p => [p.x, p.z]), ...this.getLotEdgeMidpoints(corners).map(p => [p.x, p.z])];
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [x, z] of probes) {
      if (!this.map.isInsideWorld(x, z)) return false;
      if (this.map.isWaterAt(x, z)) return false;
      if (!this.map.isBuildableAt(x, z, { maxSlope: profile.maxSlope, minHeightAboveSea: 7 })) return false;
      const y = this.map.getHeightAt(x, z);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    return (maxY - minY) <= profile.maxHeightDelta + 1.2;
  }

  render() {
    safeDisposeObject(this.group);
    this.group.clear();
    if (this.shouldRenderZoneGrid()) for (const cell of (this.game.state.zoneGrid || [])) this.renderGridCell(cell);
    for (const lot of this.game.state.zoning) this.renderLot(lot);
  }

  shouldRenderZoneGrid() {
    const tool = this.game.state.selectedTool;
    return tool === 'road' || tool === 'zone';
  }

  renderGridCell(cell) {
    const y = this.map.getHeightAt(cell.x, cell.z);
    const toolZone = this.game.state.selectedZoneType || 'residential';
    const zone = cell.zone || toolZone;
    const colorMap = { residential: 0x4db96a, commercial: 0x3d7fc7, industrial: 0xd3a332 };
    const fill = new this.THREE.MeshStandardMaterial({
      color: colorMap[zone] || 0x9bcf91,
      roughness: 0.92,
      transparent: true,
      opacity: cell.zone ? 0.14 : 0.085,
      polygonOffset: true,
      polygonOffsetFactor: -0.8,
      polygonOffsetUnits: -0.8
    });
    const mesh = new this.THREE.Mesh(new this.THREE.PlaneGeometry(cell.width, cell.depth), fill);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = cell.rotation || 0;
    mesh.position.set(cell.x, y + 0.125, cell.z);
    mesh.renderOrder = 1;
    this.group.add(mesh);
    const border = new this.THREE.LineSegments(
      new this.THREE.EdgesGeometry(new this.THREE.BoxGeometry(cell.width, 0.10, cell.depth)),
      new this.THREE.LineBasicMaterial({ color: colorMap[zone] || 0xc8f1bd, transparent: true, opacity: cell.zone ? 0.28 : 0.18 })
    );
    border.rotation.y = cell.rotation;
    border.position.set(cell.x, y + 0.28, cell.z);
    this.group.add(border);
  }

  renderLot(lot) {
    const mat = this.materials[ZONE_COLORS[lot.zone] || 'zoneResidential'];
    const y = this.map.getHeightAt(lot.x, lot.z);

    const pad = new this.THREE.Mesh(new this.THREE.PlaneGeometry(lot.width * 1.02, lot.depth * 1.02), this.localMaterials.foundation);
    pad.rotation.x = -Math.PI / 2;
    pad.rotation.z = lot.rotation;
    pad.position.set(lot.x, y + 0.135, lot.z);
    pad.renderOrder = 3;
    this.group.add(pad);

    const mesh = new this.THREE.Mesh(new this.THREE.PlaneGeometry(lot.width, lot.depth), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = lot.rotation;
    mesh.position.set(lot.x, y + 0.19, lot.z);
    mesh.renderOrder = 4;
    mesh.userData.lotId = lot.id;
    this.group.add(mesh);

    const drivewayDepth = Math.min(m(10), lot.depth * 0.24);
    const driveway = new this.THREE.Mesh(new this.THREE.PlaneGeometry(Math.min(m(11), lot.width * 0.38), drivewayDepth), this.localMaterials.driveway);
    driveway.rotation.x = -Math.PI / 2;
    driveway.rotation.z = lot.rotation;
    const frontOffset = -lot.depth * 0.5 + drivewayDepth * 0.5;
    const c = Math.cos(lot.rotation), s = Math.sin(lot.rotation);
    driveway.position.set(lot.x - frontOffset * s, y + 0.225, lot.z + frontOffset * c);
    driveway.renderOrder = 5;
    this.group.add(driveway);

    const border = new this.THREE.LineSegments(
      new this.THREE.EdgesGeometry(new this.THREE.BoxGeometry(lot.width, 0.18, lot.depth)),
      new this.THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: lot.occupied ? 0.10 : 0.24 })
    );
    border.rotation.y = lot.rotation;
    border.position.set(lot.x, y + 0.43, lot.z);
    this.group.add(border);
  }
}
