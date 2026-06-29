import { safeDisposeObject } from '../utils/MathUtils.js';
import { RailGeometry } from './RailGeometry.js';
import { m } from '../utils/Scale.js';

export class RailRenderer {
  constructor(system) {
    this.system = system;
    this.game = system.game;
    this.map = system.map;
    this.THREE = system.THREE;
    this.materials = system.materials;
    this.group = system.group;
    this.geometry = new RailGeometry(system);
  }

  render() {
    safeDisposeObject(this.group);
    this.group.clear();
    this.system.lineRouteCache.clear();
    this.renderCoverage();
    for (const segment of this.game.state.networks.rails) this.renderSegment(segment);
    this.renderRailJoints();
    for (const line of this.game.state.transitLines || []) if (line.mode === 'rail') this.renderLine(line);
    this.renderDraftLine();
    for (const station of this.game.state.railStations || []) this.renderStation(station);
    for (const node of this.game.state.networks.railNodes) this.renderNode(node, node.id === this.system.pendingNodeId);
  }

  renderSegment(segment) {
    const samples = this.system.getSegmentSamples(segment);
    if (samples.length < 2) return;
    const isDouble = (segment.kind || 'double') !== 'single';
    const mode = segment.mode || 'train';
    const modeScale = mode === 'vlt' ? 0.82 : mode === 'metro' ? 0.95 : 1.0;
    // v2.4.13: recalibração visual dos trilhos para 5m/u.
    // A versão anterior ainda parecia larga demais perto das avenidas.
    const bedWidth = (isDouble ? m(8.8) : m(5.4)) * modeScale;
    const shoulderWidth = bedWidth + (isDouble ? m(1.2) : m(0.9));
    const trackCenters = isDouble ? [-m(2.15) * modeScale, m(2.15) * modeScale] : [0];

    const bedBase = this.geometry.buildRibbon(samples, shoulderWidth, this.materials.roadBase || this.materials.railBed, -0.04);
    bedBase.name = `rail-base-${segment.id}`;
    bedBase.receiveShadow = true;
    bedBase.renderOrder = 3;
    this.group.add(bedBase);

    const ballastMat = mode === 'vlt' ? (this.materials.sidewalk || this.materials.railBed) : this.materials.railBed;
    const ballast = this.geometry.buildRibbon(samples, bedWidth, ballastMat, 0.08);
    ballast.name = `rail-ballast-${segment.id}`;
    ballast.receiveShadow = true;
    ballast.renderOrder = 5;
    this.group.add(ballast);

    for (const side of [-1, 1]) {
      const edge = this.geometry.buildOffsetRibbon(samples, side * (shoulderWidth / 2 - m(0.48)), m(0.26), this.materials.railRust || this.materials.railBed, m(0.16));
      edge.renderOrder = 6;
      this.group.add(edge);
    }

    if (isDouble) {
      const median = this.geometry.buildOffsetRibbon(samples, 0, m(0.42), this.materials.railRust || this.materials.railBed, m(0.18));
      median.renderOrder = 6;
      this.group.add(median);
    }

    for (const center of trackCenters) {
      this.group.add(this.buildSleepers(samples, center, isDouble ? m(2.35) : m(2.55)));
      for (const railOffset of [-m(0.44), m(0.44)]) {
        const off = center + railOffset;
        const rust = this.geometry.buildOffsetRibbon(samples, off, m(0.18), this.materials.railRust || this.materials.railMetal, m(0.38));
        rust.renderOrder = 8;
        const metal = this.geometry.buildOffsetRibbon(samples, off, m(0.10), this.materials.railMetal, m(0.54));
        metal.renderOrder = 10;
        this.group.add(rust, metal);
      }
    }
  }

  renderRailJoints() {
    const rails = this.game.state.networks.rails || [];
    for (const node of this.game.state.networks.railNodes || []) {
      const connected = rails.filter(seg => seg.a === node.id || seg.b === node.id);
      if (connected.length < 2) continue;
      const isDouble = connected.some(seg => (seg.kind || 'double') !== 'single');
      const r = isDouble ? m(4.8) : m(3.3);
      const geo = new this.THREE.CircleGeometry(r, 28);
      geo.rotateX(-Math.PI / 2);
      const mat = (this.materials.railBed || this.materials.roadBase)?.clone?.() || this.materials.railBed || this.materials.roadBase;
      if (mat) {
        mat.side = this.THREE.DoubleSide;
        mat.polygonOffset = true;
        mat.polygonOffsetFactor = -2;
        mat.polygonOffsetUnits = -2;
      }
      const mesh = new this.THREE.Mesh(geo, mat);
      mesh.position.set(node.x, this.map.getHeightAt(node.x, node.z) + m(0.84), node.z);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.renderOrder = 9;
      this.group.add(mesh);
    }
  }

  buildSleepers(samples, offset = 0, width = 10) {
    const group = new this.THREE.Group();
    const geo = new this.THREE.BoxGeometry(width, m(0.16), m(0.32));
    const length = this.geometry.length(samples);
    const count = Math.max(2, Math.min(180, Math.floor(length / m(3.2))));
    for (let i = 0; i <= count; i++) {
      const d = (length * i) / Math.max(1, count);
      const p = this.geometry.pointAlong(samples, d);
      if (!p) continue;
      const center = this.geometry.offsetPointByHeading(p, offset);
      const sleeper = new this.THREE.Mesh(geo, this.materials.railSleeper || this.materials.railBed);
      sleeper.rotation.y = -p.heading + Math.PI / 2;
      sleeper.position.set(center.x, center.y + m(0.22), center.z);
      sleeper.castShadow = true;
      sleeper.receiveShadow = true;
      sleeper.renderOrder = 7;
      group.add(sleeper);
    }
    return group;
  }

  renderCoverage() {
    const geo = new this.THREE.CircleGeometry(this.system.coverageRadius, 36);
    const mat = this.materials.transitCoverage || this.materials.preview;
    for (const station of this.game.state.railStations || []) {
      const mesh = new this.THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(station.x, this.map.getHeightAt(station.x, station.z) + m(0.18), station.z);
      mesh.renderOrder = 2;
      this.group.add(mesh);
    }
  }

  renderLine(line) {
    const route = this.system.buildRouteForLine(line);
    if (!route?.samples?.length) return;
    const mat = new this.THREE.MeshBasicMaterial({ color: new this.THREE.Color(line.color || '#e2b64b'), transparent: true, opacity: 0.52, side: this.THREE.DoubleSide, depthWrite: false });
    const ribbon = this.geometry.buildRibbon(route.samples, m(3.4), mat, m(1.15));
    ribbon.renderOrder = 24;
    this.group.add(ribbon);
  }

  renderDraftLine() {
    const ids = this.system.ensureDraft().stationIds || [];
    if (ids.length < 2) return;
    const fake = { id: '__draft_rail__', mode: 'rail', stationIds: ids, loop: false };
    const route = this.system.buildRouteForLine(fake);
    if (!route?.samples?.length) return;
    const ribbon = this.geometry.buildRibbon(route.samples, m(3.8), this.materials.transitDraft || this.materials.preview, m(1.35));
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
    const platformA = new this.THREE.Mesh(new this.THREE.BoxGeometry(len, m(0.36), m(3.2)), platformMat);
    platformA.position.set(0, m(0.18), -m(5.8));
    const platformB = new this.THREE.Mesh(new this.THREE.BoxGeometry(len, m(0.36), m(3.2)), platformMat);
    platformB.position.set(0, m(0.18), m(5.8));
    const roofMat = this.materials.transitShelter || this.materials.bridgeConcrete;
    const roofA = new this.THREE.Mesh(new this.THREE.BoxGeometry(len * 0.62, m(0.42), m(3.6)), roofMat);
    roofA.position.set(0, m(3.1), -m(5.8));
    const roofB = new this.THREE.Mesh(new this.THREE.BoxGeometry(len * 0.62, m(0.42), m(3.6)), roofMat);
    roofB.position.set(0, m(3.1), m(5.8));
    const sign = new this.THREE.Mesh(new this.THREE.BoxGeometry(m(6.2), m(1.7), m(0.24)), this.materials.transitStopSign || this.materials.preview);
    sign.position.set(-len * 0.32, m(2.05), -m(8.0));
    const bridge = new this.THREE.Mesh(new this.THREE.BoxGeometry(m(6.0), m(0.45), m(12.5)), this.materials.bridgeConcrete || platformMat);
    bridge.position.set(len * 0.22, m(3.0), 0);
    for (const x of [-len * 0.26, 0, len * 0.26]) {
      const colA = new this.THREE.Mesh(new this.THREE.CylinderGeometry(m(0.18), m(0.22), m(3.0), 8), this.materials.transitStopPole);
      colA.position.set(x, m(1.55), -m(5.8));
      const colB = new this.THREE.Mesh(new this.THREE.CylinderGeometry(m(0.18), m(0.22), m(3.0), 8), this.materials.transitStopPole);
      colB.position.set(x, m(1.55), m(5.8));
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
}
