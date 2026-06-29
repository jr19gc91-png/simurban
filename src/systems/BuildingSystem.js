import { clamp, makeId, safeDisposeObject } from '../utils/MathUtils.js';
import { m, meters, METERS_PER_UNIT } from '../utils/Scale.js';

const COLOR_PALETTES = {
  residentialWall: [0xbda77d, 0xac8159, 0xbfb69c, 0x9faf91, 0xa56f64, 0xc3b89d, 0x9ea783, 0xad8d80, 0xaa9c80, 0x91a698],
  residentialRoof: [0x74301f, 0x5d2c24, 0x454945, 0x814629, 0x543a2b, 0x2d3231],
  commercialWall: [0x9fa8aa, 0xaa9e85, 0x9c968d, 0x839db2, 0x9cae91, 0xaea285, 0x89867e],
  commercialSign: [0x1d5c8d, 0x2b7554, 0x9c6629, 0x783538, 0x4d3d78, 0x25546a],
  industrialWall: [0x787a66, 0x80735d, 0x707a65, 0x807a69, 0x6f736d, 0x666d66]
};

export class BuildingSystem {
  constructor({ game, assetRegistry }) {
    this.game = game;
    this.assets = assetRegistry;
    this.map = game.map;
    this.THREE = game.mapCore.THREE;
    this.group = game.groups.buildings;
    this.materialCache = new Map();
    this.visualState = { rain: 0, isNight: false };
  }

  ensureBuildings({ immediate = false } = {}) {
    const lots = this.game.state.zoning;
    const existingByLot = new Map(this.game.state.buildings.map(b => [b.lotId, b]));
    let spawned = 0;
    for (const lot of lots) {
      if (existingByLot.has(lot.id)) {
        lot.occupied = true;
        continue;
      }
      const chance = this.getSpawnChance(lot.zone, lot, { immediate });
      if (this.rand01(this.hashString(`${lot.id}:spawn:${this.game.state.simulation.day}`)) > chance) continue;
      const def = this.pickDefinition(lot.zone, lot);
      const building = this.createBuildingState(lot, def);
      this.game.state.buildings.push(building);
      lot.occupied = true;
      spawned++;
    }
    if (spawned > 0) this.render();
    return spawned;
  }

  getSpawnChance(zone, lot = null, { immediate = false } = {}) {
    const roadCount = this.game.state.networks.roads.length;
    if (roadCount < 1) return 0;
    const sim = this.game.state.simulation || {};
    const demandKey = zone === 'commercial' ? 'commercial' : zone === 'industrial' ? 'industrial' : 'residential';
    const demand = clamp(sim.demand?.[demandKey] ?? (zone === 'residential' ? 0.55 : 0.42), 0, 1);
    const access = lot ? this.getLotAccessScore(lot) : clamp(roadCount / 18, 0.15, 1);
    const emptyPenalty = this.countZoneBuildings(zone) > 0 ? 0 : 0.08;
    const base = zone === 'residential' ? 0.09 : zone === 'commercial' ? 0.07 : 0.06;
    const chance = base + demand * 0.34 + access * 0.18 + roadCount * 0.006 + emptyPenalty;
    return clamp(immediate ? chance + 0.32 : chance, 0, immediate ? 0.90 : 0.58);
  }

  countZoneBuildings(zone) {
    return (this.game.state.buildings || []).filter(b => b.zone === zone).length;
  }

  getLotAccessScore(lot) {
    const hit = this.game.systems.roads?.findNearestSegment?.({ x: lot.x, z: lot.z }, m(170));
    if (!hit) return 0.08;
    const speed = clamp(((hit.segment.speedKmh || 50) - 30) / 90, 0, 1) * 0.16;
    const lanes = clamp(((hit.segment.lanes || 1) - 1) / 4, 0, 1) * 0.12;
    return clamp(1 - hit.distance / m(170) + speed + lanes, 0.08, 1);
  }

  pickDefinition(zone, lot) {
    const defs = this.assets?.getBuildingDefinitions({ zone }) || [];
    const wantedDensity = lot?.density || 'low';
    if (!defs.length) return { id: `${zone}-procedural`, zone, density: wantedDensity, footprint: [4, 4], factory: `procedural-${zone}` };
    const fitting = defs.filter(def => this.definitionFitsLot(def, lot));
    const pool = fitting.length ? fitting : defs;
    const densityMatch = pool.filter(def => (def.density || 'low') === wantedDensity);
    const list = densityMatch.length ? densityMatch : pool;
    const idx = this.hashString(`${lot.id}:${zone}:${wantedDensity}`) % list.length;
    return list[idx];
  }

  definitionFitsLot(def, lot) {
    const [fw = 4, fd = 4] = def.footprint || [4, 4];
    const zone = def.zone || lot?.zone || 'residential';
    const meterPerFootprint = zone === 'industrial' ? 5.4 : zone === 'commercial' ? 4.4 : 3.35;
    const widthU = m(fw * meterPerFootprint);
    const depthU = m(fd * meterPerFootprint * (zone === 'residential' ? 1.12 : 1.04));
    return widthU <= lot.width * 1.10 && depthU <= lot.depth * 1.10;
  }

  createBuildingState(lot, def) {
    const seed = this.hashString(`${lot.id}:${def.id}:${lot.zone}`);
    const height = m(this.pickHeight(lot.zone, def, seed));
    const footprintScale = this.pickFootprintScale(lot, def, seed);
    const lotAreaM2 = meters(lot.width) * meters(lot.depth);
    const heightM = meters(height);
    const residentCapacity = lot.zone === 'residential' ? Math.max(2, Math.round((lotAreaM2 / 260) * (heightM / 5.5) + this.randRange(seed + 7, 1, 6))) : 0;
    const jobCapacity = lot.zone === 'commercial'
      ? Math.max(3, Math.round((lotAreaM2 / 230) * (heightM / 6.5) + this.randRange(seed + 11, 2, 10)))
      : lot.zone === 'industrial'
        ? Math.max(6, Math.round((lotAreaM2 / 210) * 1.7 + this.randRange(seed + 13, 4, 16)))
        : 0;
    const sim = this.game.state.simulation || {};
    const demandKey = lot.zone === 'commercial' ? 'commercial' : lot.zone === 'industrial' ? 'industrial' : 'residential';
    const demand = clamp(sim.demand?.[demandKey] ?? 0.55, 0.15, 1);
    const satisfactionSeed = clamp(0.48 + demand * 0.34 + this.getLotAccessScore(lot) * 0.20, 0.25, 0.98);
    const residents = lot.zone === 'residential' ? Math.round(residentCapacity * satisfactionSeed) : 0;
    const jobs = lot.zone !== 'residential' ? Math.round(jobCapacity * satisfactionSeed) : 0;
    return {
      id: makeId('bld'),
      lotId: lot.id,
      defId: def.id,
      packId: def.packId || 'procedural-newcore',
      factory: def.factory || `procedural-${lot.zone}`,
      zone: lot.zone,
      density: lot.density || def.density || 'low',
      x: lot.x,
      z: lot.z,
      rotation: lot.rotation,
      width: footprintScale.width,
      depth: footprintScale.depth,
      height,
      seed,
      residents,
      jobs,
      residentCapacity,
      jobCapacity,
      satisfaction: Math.round(satisfactionSeed * 100),
      landValue: Math.round((0.34 + this.getLotAccessScore(lot) * 0.44 + demand * 0.22) * 100),
      level: 1,
      ageDays: 0,
      styleVariant: seed % 7,
      scaleVersion: '2.4.18'
    };
  }

  pickFootprintScale(lot, def, seed) {
    const [fw = 4, fd = 4] = def.footprint || [4, 4];
    const density = lot.density || def.density || 'low';
    const zone = lot.zone || def.zone || 'residential';

    // v2.4.18: corrigido para a escala 1 unidade = 5 m.
    // Antes os prédios ocupavam quase 100% do lote e pareciam maquetes gigantes.
    const meterPerFootprint = zone === 'industrial' ? 5.4 : zone === 'commercial' ? 4.4 : 3.35;
    const desiredW = m(fw * meterPerFootprint);
    const desiredD = m(fd * meterPerFootprint * (zone === 'residential' ? 1.12 : 1.04));
    const zoneBoost = zone === 'industrial'
      ? 1.08
      : zone === 'commercial'
        ? (density === 'high' ? 1.14 : density === 'medium' ? 1.06 : 0.96)
        : (density === 'high' ? 1.12 : density === 'medium' ? 1.02 : 0.92);
    const wide = this.randRange(seed + 29, density === 'high' ? 0.94 : 0.82, density === 'high' ? 1.18 : 1.08);
    const deep = this.randRange(seed + 31, density === 'high' ? 0.90 : 0.78, density === 'high' ? 1.16 : 1.08);
    const coverage = zone === 'industrial'
      ? { w: 0.82, d: 0.76, minW: m(14), minD: m(14) }
      : zone === 'commercial'
        ? { w: density === 'low' ? 0.70 : 0.80, d: density === 'low' ? 0.64 : 0.74, minW: m(7.5), minD: m(8.0) }
        : { w: density === 'low' ? 0.62 : 0.72, d: density === 'low' ? 0.56 : 0.66, minW: m(5.8), minD: m(6.8) };
    return {
      width: Math.max(Math.min(lot.width * coverage.w, coverage.minW), Math.min(lot.width * coverage.w, desiredW * wide * zoneBoost)),
      depth: Math.max(Math.min(lot.depth * coverage.d, coverage.minD), Math.min(lot.depth * coverage.d, desiredD * deep * zoneBoost))
    };
  }


  pickHeight(zone, def, seed) {
    const density = def.density || 'low';
    // Valores em metros convertidos por m(). Mantém escala compatível com ruas de 5 m/unidade.
    if (zone === 'industrial') return this.randRange(seed, density === 'medium' ? 10 : 6, density === 'medium' ? 24 : 15);
    if (zone === 'commercial') {
      if (density === 'high') return this.randRange(seed, 24, 58);
      if (density === 'medium') return this.randRange(seed, 10, 28);
      return this.randRange(seed, 5, 13.5);
    }
    if (density === 'high') return this.randRange(seed, 18, 42);
    if (density === 'medium') return this.randRange(seed, 8, 18);
    return this.randRange(seed, 4.2, 8.8);
  }


  render() {
    safeDisposeObject(this.group);
    this.group.clear();
    for (const building of this.game.state.buildings) {
      this.normalizeBuildingScale(building);
      this.map.clearNaturalObstaclesInRect?.({ x: building.x, z: building.z, width: building.width * 1.45, depth: building.depth * 1.45, rotation: building.rotation, padding: m(3.5) });
      this.renderBuilding(building);
    }
    this.updateVisualState(this.visualState);
  }

  normalizeBuildingScale(building) {
    if (!building || building.scaleVersion === '2.4.18') return;
    const lot = (this.game.state.zoning || []).find(item => item.id === building.lotId);
    if (!lot) return;
    const defs = this.assets?.getBuildingDefinitions({ zone: building.zone }) || [];
    const def = defs.find(item => item.id === building.defId) || { id: building.defId || `${building.zone}-procedural`, zone: building.zone, density: building.density || lot.density || 'low', footprint: [4, 4] };
    const seed = building.seed || this.hashString(`${lot.id}:${def.id}:${lot.zone}`);
    const fit = this.pickFootprintScale(lot, def, seed);
    building.width = fit.width;
    building.depth = fit.depth;
    building.height = m(this.pickHeight(building.zone, { ...def, density: building.density || def.density || lot.density || 'low' }, seed));
    building.scaleVersion = '2.4.18';
  }

  renderBuilding(building) {
    const group = new this.THREE.Group();
    group.name = `building-${building.id}`;
    group.position.set(building.x, this.map.getHeightAt(building.x, building.z) + m(0.18), building.z);
    group.rotation.y = building.rotation;

    this.addContactShadow(group, building);

    if (building.zone === 'industrial') this.buildIndustrial(group, building);
    else if (building.zone === 'commercial') this.buildCommercial(group, building);
    else this.buildResidential(group, building);

    this.group.add(group);
  }

  mat(key, color, opts = {}) {
    const clean = Math.max(0, Math.min(0xffffff, Math.round(color)));
    const id = `${key}-${clean}-${JSON.stringify(opts)}`;
    if (!this.materialCache.has(id)) {
      const material = new this.THREE.MeshStandardMaterial({ color: clean, roughness: 0.92, metalness: 0.01, flatShading: true, ...opts });
      material.userData.baseRoughness = material.roughness;
      material.userData.baseMetalness = material.metalness;
      material.userData.baseOpacity = material.opacity;
      material.userData.key = key;
      material.userData.category = /window|glass/i.test(key) ? 'window' : /roof|awning/i.test(key) ? 'roof' : /wall|facade|plinth|corner|stain/i.test(key) ? 'wall' : /yard|drive|concrete/i.test(key) ? 'ground' : 'generic';
      this.materialCache.set(id, material);
    }
    return this.materialCache.get(id);
  }

  seededColor(seed, palette) {
    return palette[Math.abs(seed) % palette.length];
  }

  rand01(seed) {
    let t = (seed >>> 0) + 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  randRange(seed, min, max) {
    return min + (max - min) * this.rand01(seed);
  }

  hashString(text) {
    let h = 2166136261;
    for (let i = 0; i < String(text).length; i++) {
      h ^= String(text).charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  box(group, { w, h, d, x = 0, y = null, z = 0, mat, cast = true, receive = true, rot = [0, 0, 0] }) {
    const mesh = new this.THREE.Mesh(new this.THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y == null ? h * 0.5 : y, z);
    mesh.rotation.set(rot[0], rot[1], rot[2]);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    group.add(mesh);
    return mesh;
  }

  cylinder(group, { r1, r2 = r1, h, x = 0, y = null, z = 0, mat, sides = 12 }) {
    const mesh = new this.THREE.Mesh(new this.THREE.CylinderGeometry(r1, r2, h, sides), mat);
    mesh.position.set(x, y == null ? h * 0.5 : y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  buildResidential(group, b) {
    const wall = this.seededColor(b.seed, COLOR_PALETTES.residentialWall);
    const trim = this.seededColor(b.seed + 17, [0xf0ead8, 0xd6cfbc, 0x8a7d65, 0xa08874]);
    const roof = this.seededColor(b.seed >> 2, COLOR_PALETTES.residentialRoof);
    const baseH = Math.min(b.height, b.density === 'medium' ? m(8.8) : m(4.8));
    const upperH = Math.max(0, b.height - baseH);

    this.box(group, { w: b.width, h: baseH, d: b.depth, mat: this.mat('res-wall', wall) });
    if (upperH > m(1.6)) {
      this.box(group, { w: b.width * 0.82, h: upperH, d: b.depth * 0.76, y: baseH + upperH * 0.5, mat: this.mat('res-upper', this.tint(wall, 12)) });
    }

    const roofType = b.styleVariant % 3;
    if (roofType === 0) this.buildPitchedRoof(group, b, roof, b.height + m(0.72));
    else if (roofType === 1) this.box(group, { w: b.width * 1.04, h: m(0.35), d: b.depth * 1.04, y: b.height + m(0.18), mat: this.mat('roof-slab-res', 0x4f4b45) });
    else this.buildTwoSlopeRoof(group, b, roof, b.height + m(0.60));

    this.addWindows(group, b, Math.max(1, Math.floor(b.width / m(3.4))), Math.max(1, Math.floor(b.height / m(3.0))), 0x26313a, -b.depth * 0.505);
    this.addDoor(group, b, trim);
    this.addWall(group, b);
    this.addResidentialProps(group, b);
    this.addLotProps(group, b, 'residential');
    this.addSideWindows(group, b, 'residential');
    this.addBalconies(group, b, 'residential');
    this.addWindowACUnits(group, b, 'residential');
    this.addFacadeAwnings(group, b, 'residential');
    this.addFacadePolish(group, b, 'residential');
  }


  buildCommercial(group, b) {
    const wall = this.seededColor(b.seed, COLOR_PALETTES.commercialWall);
    const signColor = this.seededColor(b.seed >> 3, COLOR_PALETTES.commercialSign);
    this.box(group, { w: b.width, h: b.height, d: b.depth, mat: this.mat('com-wall', wall) });

    const signH = Math.min(m(1.45), Math.max(m(0.65), b.height * 0.16));
    this.box(group, { w: b.width * 0.88, h: signH, d: m(0.20), y: Math.min(b.height - signH * 0.5, m(3.2)), z: -b.depth * 0.515, mat: this.mat('sign', signColor, { roughness: 0.68 }) });
    this.addStorefront(group, b);
    this.addWindows(group, b, Math.max(2, Math.floor(b.width / m(3.4))), Math.max(2, Math.floor(b.height / m(3.2))), 0x203040, -b.depth * 0.507);
    this.box(group, { w: b.width * 1.03, h: m(0.34), d: b.depth * 1.03, y: b.height + m(0.17), mat: this.mat('roof-slab', 0x3b3b38) });
    this.addRooftopProps(group, b);
    this.addLotProps(group, b, 'commercial');
    this.addSideWindows(group, b, 'commercial');
    this.addBalconies(group, b, 'commercial');
    this.addWindowACUnits(group, b, 'commercial');
    this.addFacadeAwnings(group, b, 'commercial');
    this.addFacadePolish(group, b, 'commercial');
  }


  buildIndustrial(group, b) {
    const wall = this.seededColor(b.seed, COLOR_PALETTES.industrialWall);
    this.box(group, { w: b.width * 1.08, h: b.height, d: b.depth * 0.92, mat: this.mat('ind-wall', wall) });
    const bays = Math.max(2, Math.min(5, Math.floor(b.width / m(9.0))));
    for (let i = 0; i < bays; i++) {
      const x = -b.width * 0.45 + i * (b.width * 0.9 / Math.max(1, bays - 1));
      this.box(group, { w: b.width / bays * 0.78, h: m(0.55), d: b.depth * 0.98, x, y: b.height + m(0.28), mat: this.mat('ind-roof', 0x5c5f5e), rot: [0, 0, (i % 2 ? -0.10 : 0.10)] });
    }
    this.box(group, { w: b.width * 0.26, h: Math.min(m(3.8), b.height * 0.34), d: m(0.28), y: Math.min(m(3.4), b.height * 0.38), z: -b.depth * 0.49, mat: this.mat('dock-door', 0x4a4c4d) });
    this.box(group, { w: b.width * 0.20, h: m(2.0), d: m(0.26), y: m(1.1), z: -b.depth * 0.50, x: -b.width * 0.28, mat: this.mat('office-door', 0x27323a) });
    this.cylinder(group, { r1: m(0.45), r2: m(0.58), h: b.height * 1.05, x: b.width * 0.34, y: b.height * 0.53, z: b.depth * 0.24, mat: this.mat('chimney', 0x645a4f), sides: 10 });
    this.addIndustrialYard(group, b);
    this.addIndustrialDetails(group, b);
    this.addLotProps(group, b, 'industrial');
    this.addFacadePolish(group, b, 'industrial');
  }


  buildPitchedRoof(group, b, roof, y) {
    const base = Math.min(b.width, b.depth);
    const roofGeo = new this.THREE.ConeGeometry(Math.max(m(1.8), base * 0.52), Math.min(m(2.2), Math.max(m(0.9), base * 0.22)), 4);
    const roofMesh = new this.THREE.Mesh(roofGeo, this.mat('roof', roof));
    roofMesh.rotation.y = Math.PI / 4;
    roofMesh.scale.x = Math.min(1.16, Math.max(0.86, b.width / Math.max(0.1, b.depth)));
    roofMesh.scale.z = Math.min(1.16, Math.max(0.86, b.depth / Math.max(0.1, b.width)));
    roofMesh.position.y = y;
    roofMesh.castShadow = true;
    group.add(roofMesh);
  }


  buildTwoSlopeRoof(group, b, roof, y) {
    this.box(group, { w: b.width * 0.54, h: m(0.42), d: b.depth * 0.98, x: -b.width * 0.19, y, mat: this.mat('half-roof-a', roof), rot: [0, 0, 0.18] });
    this.box(group, { w: b.width * 0.54, h: m(0.42), d: b.depth * 0.98, x: b.width * 0.19, y, mat: this.mat('half-roof-b', roof), rot: [0, 0, -0.18] });
  }


  addDoor(group, b, trim) {
    this.box(group, { w: Math.min(m(1.35), b.width * 0.24), h: Math.min(m(2.25), b.height * 0.56), d: m(0.12), y: Math.min(m(1.12), b.height * 0.28), z: -b.depth * 0.515, mat: this.mat('door', 0x5c3f2d) });
    this.box(group, { w: Math.min(m(3.2), b.width * 0.42), h: m(0.16), d: m(0.18), y: Math.min(m(2.36), b.height * 0.55), z: -b.depth * 0.525, mat: this.mat('door-trim', trim) });
  }


  addStorefront(group, b) {
    const glass = this.mat('store-glass', 0x172833, { roughness: 0.24, metalness: 0.06, transparent: true, opacity: 0.78, emissive: 0x071018, emissiveIntensity: 0.08 });
    const cols = Math.max(2, Math.floor(b.width / m(3.8)));
    for (let i = 0; i < cols; i++) {
      const x = -b.width * 0.38 + i * (b.width * 0.76 / Math.max(1, cols - 1));
      this.box(group, { w: Math.min(m(2.2), b.width * 0.22), h: Math.min(m(2.4), b.height * 0.48), d: m(0.10), x, y: Math.min(m(1.45), b.height * 0.30), z: -b.depth * 0.522, mat: glass, cast: false, receive: false });
    }
    this.box(group, { w: b.width * 0.92, h: m(0.22), d: m(0.60), y: Math.min(m(2.85), b.height * 0.56), z: -b.depth * 0.55, mat: this.mat('awning', 0xcfc8b8) });
  }


  addWindows(group, b, cols = 2, rows = 2, color = 0x223344, z = null) {
    const mat = this.mat('window', color, { roughness: 0.30, metalness: 0.08, emissive: color, emissiveIntensity: 0.05 });
    const rowsSafe = Math.min(rows, 11);
    const colsSafe = Math.min(cols + 1, 9);
    const winW = Math.min(m(1.35), Math.max(m(0.70), b.width * 0.14));
    const winH = Math.min(m(1.10), Math.max(m(0.52), b.height * 0.16));
    for (let r = 0; r < rowsSafe; r++) {
      const y = m(2.2) + r * m(3.0);
      if (y > b.height - m(0.75)) continue;
      for (let c = 0; c < colsSafe; c++) {
        const x = -b.width * 0.36 + c * (b.width * 0.72 / Math.max(1, colsSafe - 1));
        this.box(group, { w: winW, h: winH, d: m(0.08), x, y, z: z ?? -b.depth * 0.505, mat, cast: false, receive: false });
      }
    }
  }


  addWall(group, b) {
    const mat = this.mat('lot-wall', 0x9b927e);
    const h = m(1.65);
    this.box(group, { w: b.width * 1.20, h, d: m(0.24), y: h * 0.5, z: -b.depth * 0.67, mat });
    this.box(group, { w: m(0.24), h, d: b.depth * 0.86, x: -b.width * 0.62, y: h * 0.5, z: 0, mat });
    this.box(group, { w: m(0.24), h, d: b.depth * 0.86, x: b.width * 0.62, y: h * 0.5, z: 0, mat });
  }


  addResidentialProps(group, b) {
    if (b.seed % 2 === 0) this.cylinder(group, { r1: m(0.42), r2: m(0.42), h: m(0.65), x: b.width * 0.22, y: b.height + m(0.55), z: b.depth * 0.18, mat: this.mat('water-tank', 0x2f3437), sides: 12 });
    if (b.seed % 3 === 0) {
      this.box(group, { w: m(0.07), h: m(2.4), d: m(0.07), x: -b.width * 0.28, y: b.height + m(1.20), z: b.depth * 0.18, mat: this.mat('antenna', 0x363636) });
      this.box(group, { w: m(1.1), h: m(0.045), d: m(0.045), x: -b.width * 0.28, y: b.height + m(2.20), z: b.depth * 0.18, mat: this.mat('antenna-arm', 0x363636) });
    }
    if (b.width > m(10)) this.box(group, { w: Math.min(m(3.0), b.width * 0.30), h: m(1.85), d: Math.min(m(2.2), b.depth * 0.28), x: b.width * 0.25, y: m(0.93), z: -b.depth * 0.25, mat: this.mat('garage-door', 0x6f6d68) });
  }



  addSideWindows(group, b, zone = 'residential') {
    if (b.depth < m(8) || b.height < m(4.5)) return;
    const color = zone === 'commercial' ? 0x203142 : 0x26313a;
    const mat = this.mat(`side-window-${zone}`, color, { roughness: 0.32, metalness: 0.08, emissive: color, emissiveIntensity: 0.045 });
    const rows = Math.min(7, Math.max(1, Math.floor(b.height / m(3.6))));
    const count = Math.min(5, Math.max(1, Math.floor(b.depth / m(4.0))));
    for (const side of [-1, 1]) {
      for (let r = 0; r < rows; r++) {
        const y = m(2.35) + r * m(3.0);
        if (y > b.height - m(0.8)) continue;
        for (let i = 0; i < count; i++) {
          const z = -b.depth * 0.30 + i * (b.depth * 0.60 / Math.max(1, count - 1));
          this.box(group, { w: m(0.08), h: m(0.88), d: m(1.05), x: side * b.width * 0.505, y, z, mat, cast: false, receive: false });
        }
      }
    }
  }


  addBalconies(group, b, zone = 'residential') {
    if (b.height < m(8) || b.width < m(10)) return;
    const slab = this.mat(`balcony-slab-${zone}`, zone === 'commercial' ? 0x8d918e : 0x9c9486, { roughness: 0.96 });
    const rail = this.mat(`balcony-rail-${zone}`, 0x2d3435, { roughness: 0.70, metalness: 0.12 });
    const rows = Math.min(4, Math.floor((b.height - m(4)) / m(4.0)));
    const cols = Math.min(4, Math.max(1, Math.floor(b.width / m(5.0))));
    for (let r = 0; r < rows; r++) {
      const y = m(4.2) + r * m(3.6);
      for (let c = 0; c < cols; c++) {
        if ((b.seed + r * 5 + c) % 5 === 0) continue;
        const x = -b.width * 0.34 + c * (b.width * 0.68 / Math.max(1, cols - 1));
        const w = Math.min(m(2.8), b.width / Math.max(2, cols) * 0.62);
        this.box(group, { w, h: m(0.08), d: m(0.70), x, y, z: -b.depth * 0.56, mat: slab });
        this.box(group, { w, h: m(0.62), d: m(0.06), x, y: y + m(0.32), z: -b.depth * 0.62, mat: rail });
      }
    }
  }


  addWindowACUnits(group, b, zone = 'residential') {
    if (b.height < m(7)) return;
    const acMat = this.mat(`ac-unit-${zone}`, 0xd6d7d0, { roughness: 0.92 });
    const rows = Math.min(4, Math.max(1, Math.floor((b.height - m(4)) / m(4.0))));
    const cols = Math.min(4, Math.max(1, Math.floor(b.width / m(5.0))));
    for (let r = 0; r < rows; r++) {
      const y = m(3.4) + r * m(4.0);
      for (let c = 0; c < cols; c++) {
        if ((b.seed + r * 13 + c * 7) % 3 !== 0) continue;
        const x = -b.width * 0.36 + c * (b.width * 0.72 / Math.max(1, cols - 1));
        this.box(group, { w: m(0.60), h: m(0.34), d: m(0.28), x, y, z: -b.depth * 0.57, mat: acMat });
      }
    }
  }


  addFacadeAwnings(group, b, zone = 'residential') {
    if (b.width < m(8) || b.height < m(4.5)) return;
    const awningMat = this.mat(`awning-${zone}-extra`, zone === 'commercial' ? 0xc8c1b2 : 0xa68a74, { roughness: 0.88 });
    const count = Math.min(3, Math.max(1, Math.floor(b.width / m(6.0))));
    for (let i = 0; i < count; i++) {
      if ((b.seed + i) % 4 === 0 && zone !== 'commercial') continue;
      const x = -b.width * 0.30 + i * (b.width * 0.60 / Math.max(1, count - 1));
      this.box(group, { w: Math.min(m(2.8), b.width * 0.24), h: m(0.08), d: m(0.75), x, y: Math.min(m(2.6), b.height * 0.34), z: -b.depth * 0.565, mat: awningMat, rot: [0.18, 0, 0] });
    }
  }


  addIndustrialDetails(group, b) {
    const pipeMat = this.mat('industrial-pipes', 0x3f4443, { roughness: 0.78, metalness: 0.18 });
    for (let i = 0; i < Math.min(4, Math.floor(b.width / m(8))); i++) {
      const x = -b.width * 0.38 + i * (b.width * 0.25);
      this.box(group, { w: m(0.16), h: b.height * 0.62, d: m(0.16), x, y: b.height * 0.45, z: b.depth * 0.50, mat: pipeMat });
    }
    if (b.width > m(22)) {
      this.box(group, { w: b.width * 0.22, h: m(0.50), d: m(0.80), x: b.width * 0.18, y: b.height + m(0.55), z: -b.depth * 0.18, mat: this.mat('roof-vent-long', 0x70736f, { roughness: 0.92 }) });
      this.box(group, { w: b.width * 0.16, h: m(0.42), d: m(0.70), x: -b.width * 0.16, y: b.height + m(0.50), z: b.depth * 0.10, mat: this.mat('roof-vent-small', 0x656962, { roughness: 0.92 }) });
    }
  }


  addRooftopProps(group, b) {
    this.cylinder(group, { r1: m(0.42), r2: m(0.42), h: m(0.60), x: b.width * 0.25, y: b.height + m(0.52), z: b.depth * 0.22, mat: this.mat('com-water-tank', 0x30383a), sides: 12 });
    if (b.height > m(18)) this.box(group, { w: m(2.2), h: m(0.60), d: m(1.25), x: -b.width * 0.23, y: b.height + m(0.58), z: b.depth * 0.18, mat: this.mat('hvac', 0x737675) });
    if (b.width > m(12)) this.box(group, { w: Math.min(m(4.0), b.width * 0.28), h: m(0.08), d: m(1.8), x: b.width * 0.05, y: b.height + m(0.72), z: -b.depth * 0.22, mat: this.mat('solar-panel', 0x151f2b, { roughness: 0.42, metalness: 0.16 }) });
  }


  addIndustrialYard(group, b) {
    const tankMat = this.mat('yard-tank', 0x888a82);
    this.cylinder(group, { r1: m(0.90), h: m(2.5), x: -b.width * 0.33, y: m(1.25), z: b.depth * 0.30, mat: tankMat, sides: 12 });
    this.cylinder(group, { r1: m(0.70), h: m(2.0), x: -b.width * 0.21, y: m(1.0), z: b.depth * 0.32, mat: tankMat, sides: 12 });
    this.box(group, { w: m(4.8), h: m(1.35), d: m(2.2), x: b.width * 0.18, y: m(0.68), z: -b.depth * 0.36, mat: this.mat('yard-container', 0x8c4d34) });
  }


  addFacadePolish(group, b, zone) {
    const trim = zone === 'commercial' ? 0xbbb29f : zone === 'industrial' ? 0x5b5f5b : 0xb7ad98;
    const shadow = zone === 'industrial' ? 0x2a2b29 : 0x332f29;
    const frontZ = -b.depth * 0.526;
    const sideZ = b.depth * 0.526;
    const plinthH = m(0.24);
    this.box(group, { w: b.width * 1.04, h: plinthH, d: m(0.14), y: plinthH * 0.5, z: frontZ, mat: this.mat(`plinth-${zone}`, shadow, { roughness: 1 }) });
    this.box(group, { w: b.width * 1.02, h: m(0.14), d: m(0.12), y: Math.max(m(1.2), b.height - m(0.24)), z: frontZ - m(0.01), mat: this.mat(`top-trim-${zone}`, trim, { roughness: 0.96 }) });
    if (b.height > m(8)) {
      const bands = Math.min(4, Math.floor(b.height / m(7)));
      for (let i = 1; i <= bands; i++) {
        const y = i * (b.height / (bands + 1));
        this.box(group, { w: b.width * 0.96, h: m(0.07), d: m(0.10), y, z: frontZ - m(0.006), mat: this.mat(`facade-band-${zone}`, this.tint(trim, -12), { roughness: 0.98 }) });
      }
    }
    if (b.width > m(10)) {
      const colMat = this.mat(`corner-${zone}`, this.tint(trim, -18), { roughness: 0.98 });
      this.box(group, { w: m(0.18), h: Math.max(m(2), b.height - m(0.3)), d: m(0.10), x: -b.width * 0.47, y: Math.max(m(1), b.height * 0.5), z: frontZ - m(0.006), mat: colMat });
      this.box(group, { w: m(0.18), h: Math.max(m(2), b.height - m(0.3)), d: m(0.10), x: b.width * 0.47, y: Math.max(m(1), b.height * 0.5), z: frontZ - m(0.006), mat: colMat });
    }
    if (zone === 'residential' && b.depth > m(9)) {
      this.box(group, { w: b.width * 0.42, h: m(0.06), d: b.depth * 0.42, x: -b.width * 0.18, y: m(0.055), z: sideZ * 0.22, mat: this.mat('yard-concrete', 0x8b867b, { roughness: 0.99 }) });
    }
    const stainMat = this.mat(`stain-${zone}`, 0x1f211e, { roughness: 1, transparent: true, opacity: zone === 'industrial' ? 0.20 : 0.13 });
    const stainCount = Math.min(5, Math.max(2, Math.floor(b.width / m(6.5))));
    for (let i = 0; i < stainCount; i++) {
      const x = -b.width * 0.40 + i * (b.width * 0.80 / Math.max(1, stainCount - 1));
      const h = Math.min(m(2.6), Math.max(m(0.9), b.height * this.randRange(b.seed + i * 19, 0.10, 0.24)));
      this.box(group, { w: this.randRange(b.seed + i * 23, m(0.14), m(0.38)), h, d: m(0.035), x, y: b.height - h * 0.5 - m(0.18), z: frontZ - m(0.02), mat: stainMat, cast: false, receive: false });
    }
  }


  addContactShadow(group, b) {
    const shadow = new this.THREE.Mesh(
      new this.THREE.PlaneGeometry(b.width * 1.18, b.depth * 1.18),
      new this.THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.14, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = m(0.035);
    shadow.renderOrder = 1;
    group.add(shadow);
  }


  addLotProps(group, b, zone = 'residential') {
    const propMat = this.mat(`lot-prop-${zone}`, zone === 'industrial' ? 0x6c705f : 0x8d877a, { roughness: 0.94 });
    const greenMat = this.mat(`lot-green-${zone}`, 0x7e9a63, { roughness: 1 });
    if (zone !== 'industrial') {
      this.box(group, { w: Math.min(m(1.8), b.width * 0.14), h: m(0.12), d: Math.min(m(1.5), b.depth * 0.10), x: b.width * 0.30, y: m(0.06), z: b.depth * 0.28, mat: greenMat, cast: false });
      if (b.width > m(8)) this.box(group, { w: m(1.5), h: m(0.18), d: m(0.35), x: -b.width * 0.26, y: m(0.09), z: b.depth * 0.30, mat: propMat, cast: false });
    } else {
      this.box(group, { w: m(4.2), h: m(0.18), d: m(2.2), x: b.width * 0.24, y: m(0.09), z: b.depth * 0.30, mat: propMat, cast: false });
      this.box(group, { w: m(0.10), h: m(2.2), d: m(0.10), x: b.width * 0.39, y: m(1.10), z: -b.depth * 0.20, mat: this.mat('yard-post', 0x454947) });
    }
  }


  updateVisualState({ weather = {}, isNight = false } = {}) {
    this.visualState = { weather, isNight, rain: Math.max(0, Math.min(1, weather?.rain || 0)) };
    const rain = this.visualState.rain;
    const warmLight = new this.THREE.Color(0xf6d79a);
    const coolGlass = new this.THREE.Color(0x26313a);
    for (const material of this.materialCache.values()) {
      const cat = material.userData?.category || 'generic';
      const baseR = material.userData?.baseRoughness ?? material.roughness;
      const baseM = material.userData?.baseMetalness ?? material.metalness;
      if (cat === 'window') {
        material.emissive = material.emissive || new this.THREE.Color(0x000000);
        material.emissive.copy(isNight ? warmLight : coolGlass);
        material.emissiveIntensity = isNight ? 0.34 : 0.04;
        material.roughness = isNight ? 0.22 : 0.30;
        material.opacity = isNight ? 0.86 : (material.userData?.baseOpacity ?? 0.78);
      } else if (cat === 'roof' || cat === 'wall' || cat === 'ground') {
        material.roughness = Math.max(0.26, baseR - rain * (cat === 'ground' ? 0.10 : 0.24));
        material.metalness = Math.min(0.18, baseM + rain * (cat === 'roof' ? 0.08 : 0.04));
      }
      material.needsUpdate = true;
    }
  }

  tint(color, amount) {
    const r = Math.max(0, Math.min(255, ((color >> 16) & 255) + amount));
    const g = Math.max(0, Math.min(255, ((color >> 8) & 255) + amount));
    const b = Math.max(0, Math.min(255, (color & 255) + amount));
    return (r << 16) | (g << 8) | b;
  }
}
