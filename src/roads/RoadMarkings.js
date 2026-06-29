import { dist2D, pointAlongPolyline, polylineLength } from '../utils/MathUtils.js';
import { ROAD_RENDER } from './RoadMaterials.js';
import { legacyTrimSamplesAtJunctions } from './LegacyRoadCore5m.js';
import { m } from '../utils/Scale.js';

export class RoadMarkings {
  constructor(renderer) {
    this.renderer = renderer;
  }

  get system() { return this.renderer.system; }
  get THREE() { return this.renderer.THREE; }
  get group() { return this.renderer.group; }
  get materials() { return this.renderer.materials; }

  stampOnTop(object, order = 24) {
    if (!object) return object;
    object.renderOrder = order;
    object.frustumCulled = false;
    if (object.traverse) {
      object.traverse(child => {
        child.renderOrder = order;
        child.frustumCulled = false;
      });
    }
    return object;
  }

  renderLaneClassOverlay(segment, samples, width) {
    samples = this.trimSamplesAtJunctions(segment, samples, width);
    if (samples.length < 2) return;
    const layout = this.system.getLaneLayout(segment, width);
    const customClasses = Array.isArray(segment.laneClasses) ? segment.laneClasses.map(c => this.system.normalizeLaneClass(c)) : [];
    if (customClasses.some(c => c !== 'general') && segment.kind !== 'dirt') {
      const laneWidth = Math.max(m(2.8), layout.laneWidth * 0.82);
      const materialFor = (cls) => ({ bus: this.materials.busLane, emergency: this.materials.emergencyLane, service: this.materials.serviceLane, mixed: this.materials.mixedLane, bike: this.materials.bikeLane, parking: this.materials.parkingLane })[cls];
      for (let i = 0; i < layout.lanes; i++) {
        const cls = customClasses[i] || 'general';
        const mat = materialFor(cls);
        if (!mat) continue;
        if (layout.direction === 'oneWay') {
          const off = layout.forwardCenters?.[i] ?? (-layout.innerHalf + layout.laneWidth * (i + 0.5));
          this.group.add(this.renderer.buildOffsetRibbon(samples, off, laneWidth, mat, ROAD_RENDER.markingYOffset + 0.018));
        } else {
          const off = layout.forwardCenters?.[i] ?? (layout.centerLineOffset + layout.laneWidth * (i + 0.5));
          const rev = layout.reverseCenters?.[i] ?? -off;
          this.group.add(this.renderer.buildOffsetRibbon(samples, off, laneWidth, mat, ROAD_RENDER.markingYOffset + 0.018));
          this.group.add(this.renderer.buildOffsetRibbon(samples, rev, laneWidth, mat, ROAD_RENDER.markingYOffset + 0.018));
        }
      }
      return;
    }
    const cls = this.system.normalizeLaneClass(segment.laneClass || 'general');
    if (cls === 'general') return;
    const laneWidth = Math.max(m(2.8), layout.laneWidth * 0.86);
    const outerRight = layout.forwardCenters?.[0] ?? (-layout.innerHalf + layout.laneWidth * 0.5);
    const outerLeft = layout.direction === 'oneWay' ? outerRight : (layout.reverseCenters?.[0] ?? (layout.innerHalf - layout.laneWidth * 0.5));
    const bothEdges = layout.direction === 'oneWay' ? [outerRight] : [outerRight, outerLeft];

    if (cls === 'bus') {
      for (const offset of bothEdges) {
        this.group.add(this.renderer.buildOffsetRibbon(samples, offset, laneWidth, this.materials.busLane, ROAD_RENDER.markingYOffset + 0.015));
        this.group.add(this.buildMarking(samples, offset - Math.sign(offset || 1) * laneWidth * 0.43, Math.max(m(0.045), m(0.16)), this.materials.laneWhite, ROAD_RENDER.markingYOffset + 0.035));
      }
      return;
    }
    if (cls === 'emergency') {
      for (const offset of bothEdges) this.group.add(this.renderer.buildOffsetRibbon(samples, offset, laneWidth * 0.82, this.materials.emergencyLane, ROAD_RENDER.markingYOffset + 0.015));
      return;
    }
    if (cls === 'service') {
      this.group.add(this.renderer.buildOffsetRibbon(samples, 0, Math.max(m(2.8), width * 0.20), this.materials.serviceLane, ROAD_RENDER.markingYOffset + 0.01));
      return;
    }
    if (cls === 'mixed') {
      this.group.add(this.renderer.buildOffsetRibbon(samples, 0, Math.max(m(3.2), width * 0.24), this.materials.mixedLane, ROAD_RENDER.markingYOffset + 0.01));
      return;
    }
    if (cls === 'bike') {
      for (const offset of bothEdges) {
        const bikeWidth = laneWidth * 0.68;
        this.group.add(this.renderer.buildOffsetRibbon(samples, offset, bikeWidth, this.materials.bikeLane, ROAD_RENDER.markingYOffset + 0.02));
        this.group.add(this.buildDashedMarking(samples, offset - Math.sign(offset || 1) * bikeWidth * 0.54, m(0.18), this.materials.laneWhite, ROAD_RENDER.markingYOffset + 0.04, { dash: m(4), gap: m(7) }));
      }
      return;
    }
    if (cls === 'parking') {
      for (const offset of bothEdges) {
        this.group.add(this.renderer.buildOffsetRibbon(samples, offset, laneWidth, this.materials.parkingLane, ROAD_RENDER.markingYOffset + 0.005));
        this.group.add(this.buildMarking(samples, offset - Math.sign(offset || 1) * laneWidth * 0.46, Math.max(m(0.045), m(0.18)), this.materials.laneEdgeWhite, ROAD_RENDER.markingYOffset + 0.04));
        this.renderParkingStallTicks(samples, offset, laneWidth);
      }
      this.renderParkedCars(segment, samples, width, laneWidth);
    }
  }

  renderLaneMarkings(segment, samples, width) {
    if (segment.kind === 'dirt') return;
    samples = this.trimSamplesAtJunctions(segment, samples, width);
    if (samples.length < 2) return;
    const layout = this.system.getLaneLayout(segment, width);
    const { lanes, direction, laneWidth, innerHalf } = layout;

    if (direction === 'oneWay') {
      // Sem linhas brancas nas bordas externas: a borda agora é lida pelo meio-fio/ombro escuro.
      for (let i = 1; i < lanes; i++) {
        const centers = layout.forwardCenters || [];
        const offset = centers[i] != null && centers[i - 1] != null ? (centers[i] + centers[i - 1]) * 0.5 : -innerHalf + i * laneWidth;
        this.group.add(this.buildDashedMarking(samples, offset, ROAD_RENDER.laneDashWidth, this.materials.laneWhite, ROAD_RENDER.markingYOffset, {
          dash: ROAD_RENDER.laneDash,
          gap: ROAD_RENDER.laneGap
        }));
      }
      return;
    }

    if (layout.kind !== 'avenue') {
      this.group.add(this.buildMarking(samples, -layout.centerLineOffset, ROAD_RENDER.centerLineWidth, this.materials.laneYellow, ROAD_RENDER.markingYOffset));
      this.group.add(this.buildMarking(samples, layout.centerLineOffset, ROAD_RENDER.centerLineWidth, this.materials.laneYellow, ROAD_RENDER.markingYOffset));
    }

    // Sem marcação branca nas bordas externas: evita visual poluído e mantém padrão urbano mais realista.

    for (let i = 1; i < lanes; i++) {
      const offset = layout.forwardCenters?.[i] != null && layout.forwardCenters?.[i - 1] != null ? (layout.forwardCenters[i] + layout.forwardCenters[i - 1]) * 0.5 : layout.centerLineOffset + i * laneWidth;
      const reverseOffset = layout.reverseCenters?.[i] != null && layout.reverseCenters?.[i - 1] != null ? (layout.reverseCenters[i] + layout.reverseCenters[i - 1]) * 0.5 : -offset;
      this.group.add(this.buildDashedMarking(samples, offset, ROAD_RENDER.laneDashWidth, this.materials.laneWhite, ROAD_RENDER.markingYOffset, {
        dash: ROAD_RENDER.laneDash,
        gap: ROAD_RENDER.laneGap
      }));
      this.group.add(this.buildDashedMarking(samples, reverseOffset, ROAD_RENDER.laneDashWidth, this.materials.laneWhite, ROAD_RENDER.markingYOffset, {
        dash: ROAD_RENDER.laneDash,
        gap: ROAD_RENDER.laneGap
      }));
    }
  }

  renderDirectionArrows(segment, samples, width) {
    if (segment.kind === 'dirt') return;
    samples = this.trimSamplesAtJunctions(segment, samples, width);
    if (samples.length < 2) return;
    const length = polylineLength(samples);
    if (length < m(30)) return;
    const layout = this.system.getLaneLayout(segment, width);
    const arrowCount = Math.max(0, Math.min(2, Math.floor(length / m(180)))); // setas discretas e menos repetidas
    const configs = [];
    if (layout.direction === 'oneWay') {
      for (let i = 0; i < layout.lanes; i++) configs.push({ offset: layout.forwardCenters?.[i] ?? (-layout.innerHalf + layout.laneWidth * (i + 0.5)), sign: 1 });
    } else {
      for (let i = 0; i < layout.lanes; i++) {
        const off = layout.forwardCenters?.[i] ?? (layout.centerLineOffset + layout.laneWidth * (i + 0.5));
        const rev = layout.reverseCenters?.[i] ?? -off;
        configs.push({ offset: off, sign: 1 });
        configs.push({ offset: rev, sign: -1 });
      }
    }
    for (let i = 0; i < arrowCount; i++) {
      const d = length * ((i + 1) / (arrowCount + 1));
      if (d < m(14) || d > length - m(14)) continue;
      const base = pointAlongPolyline(samples, d);
      if (!base) continue;
      for (const cfg of configs) {
        const center = this.renderer.offsetPointByHeading(base, cfg.offset);
        center.y += ROAD_RENDER.arrowYOffset;
        this.group.add(this.buildArrowMarker(center, base.heading, cfg.sign, Math.max(m(1.35), Math.min(m(2.25), layout.laneWidth * 0.38)), this.materials.arrow));
      }
    }
  }

  renderAsphaltWear(segment, samples, width) {
    if (segment.kind === 'dirt') return;
    if (!this.materials.roadWear) return;
    samples = this.trimSamplesAtJunctions(segment, samples, width);
    if (samples.length < 2) return;
    const layout = this.system.getLaneLayout(segment, width);
    const offsets = [];
    if (layout.direction === 'oneWay') {
      for (let i = 0; i < layout.lanes; i++) offsets.push(layout.forwardCenters?.[i] ?? (-layout.innerHalf + layout.laneWidth * (i + 0.5)));
    } else {
      for (let i = 0; i < layout.lanes; i++) {
        const off = layout.forwardCenters?.[i] ?? (layout.centerLineOffset + layout.laneWidth * (i + 0.5));
        offsets.push(off, layout.reverseCenters?.[i] ?? -off);
      }
    }
    for (const offset of offsets) {
      const trail = this.renderer.buildOffsetRibbon(samples, offset, Math.min(m(1.10), layout.laneWidth * 0.24), this.materials.roadWear, ROAD_RENDER.wearYOffset);
      trail.renderOrder = 7;
      this.group.add(trail);
    }
    const length = polylineLength(samples);
    // Patches retangulares desativados nesta rodada: estavam sendo lidos como placas/artefatos.
    return;
  }

  renderParkingStallTicks(samples, offset, laneWidth) {
    const length = polylineLength(samples);
    if (length < m(42)) return;
    for (let d = m(18); d < length - m(8); d += ROAD_RENDER.parkingTickSpacing) {
      const base = pointAlongPolyline(samples, d);
      if (!base) continue;
      const center = this.renderer.offsetPointByHeading(base, offset);
      center.y += ROAD_RENDER.markingYOffset + 0.02;
      this.group.add(this.renderer.buildFlatRect(center, base.heading, m(0.36), laneWidth * 0.78, this.materials.laneEdgeWhite, 0.02));
    }
  }

  trimSamplesAtJunctions(segment, samples, width) {
    return legacyTrimSamplesAtJunctions(this.system, segment, samples, width);
  }

  renderParkedCars(segment, samples, width, laneWidth) {
    if ((segment.elevation || 0) !== 0 || samples.length < 3) return;
    const length = polylineLength(samples);
    if (length < m(58)) return;
    const carGeo = new this.THREE.BoxGeometry(m(4.6), m(1.35), m(2.1));
    const mats = [0x8d3a33, 0x2f5f8e, 0xa9a79e, 0x303437, 0x526e4f, 0xaa7c3a].map(color => new this.THREE.MeshStandardMaterial({ color, roughness: 0.78, flatShading: true }));
    const count = Math.min(12, Math.floor(length / m(42)));
    for (let i = 0; i < count; i++) {
      const distance = m(28) + i * m(42);
      const base = pointAlongPolyline(samples, distance);
      if (!base) continue;
      const sideSign = i % 2 === 0 ? -1 : 1;
      if ((segment.direction || 'twoWay') === 'oneWay' && sideSign > 0) continue;
      const offset = sideSign * (width / 2 - laneWidth * 0.55);
      const center = this.renderer.offsetPointByHeading(base, offset);
      const car = new this.THREE.Mesh(carGeo, mats[i % mats.length]);
      car.position.set(center.x, center.y + m(1.16), center.z);
      car.rotation.y = -base.heading;
      car.castShadow = true;
      car.receiveShadow = true;
      this.group.add(car);
    }
  }

  renderDirtRoadRuts(samples, width) {
    if (!this.materials.dirtRut || samples.length < 2) return;
    const offsets = [-width * 0.22, width * 0.22];
    for (const offset of offsets) {
      const rut = this.renderer.buildOffsetRibbon(samples, offset, Math.max(m(0.26), width * 0.055), this.materials.dirtRut, ROAD_RENDER.wearYOffset + 0.012);
      rut.name = 'road-dirt-rut';
      rut.renderOrder = 8;
      this.group.add(rut);
    }
  }

  buildMarking(samples, offset, width, material, yOffset = ROAD_RENDER.markingYOffset) {
    return this.stampOnTop(this.renderer.buildOffsetRibbon(samples, offset, width, material, yOffset), 26);
  }

  buildDashedMarking(samples, offset, width, material, yOffset = ROAD_RENDER.markingYOffset, options = {}) {
    const group = new this.THREE.Group();
    const dash = options.dash ?? 8.5;
    const gap = options.gap ?? 9.5;
    const period = Math.max(m(1), dash + gap);
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
          if (dist2D(s0, s1) > m(0.4)) group.add(this.buildMarking([s0, s1], offset, width, material, yOffset));
          local += Math.max(len, m(0.5));
        } else {
          local += Math.max(period - phase, m(0.5));
        }
      }
      accumulated += segLen;
    }
    return this.stampOnTop(group, 27);
  }

  buildArrowMarker(center, heading, dirSign = 1, size = 5, material = this.materials.arrow) {
    const length = size * 2.12;
    const width = size * 0.96;
    const shape = new this.THREE.Shape();
    const halfL = length * 0.5;
    const halfW = width * 0.5;
    const shaftEnd = halfL * 0.08;
    const shaftHalf = halfW * 0.32;
    shape.moveTo(-halfL, -shaftHalf);
    shape.lineTo(shaftEnd, -shaftHalf);
    shape.lineTo(shaftEnd, -halfW);
    shape.lineTo(halfL, 0);
    shape.lineTo(shaftEnd, halfW);
    shape.lineTo(shaftEnd, shaftHalf);
    shape.lineTo(-halfL, shaftHalf);
    shape.closePath();
    const geo = new this.THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    const dirHeading = heading + (dirSign < 0 ? Math.PI : 0);
    geo.rotateY(-dirHeading);
    geo.translate(center.x, center.y, center.z);
    const mesh = new this.THREE.Mesh(geo, material);
    mesh.renderOrder = 30;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    return mesh;
  }
}
