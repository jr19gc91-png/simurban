import { ROAD_RENDER } from './RoadMaterials.js';
import { m } from '../utils/Scale.js';

export class RoadIntersections {
  constructor(renderer) {
    this.renderer = renderer;
    this.signalMaterials = null;
  }

  get system() { return this.renderer.system; }
  get THREE() { return this.renderer.THREE; }
  get group() { return this.renderer.group; }
  get map() { return this.renderer.map; }
  get materials() { return this.renderer.materials; }

  renderIntersection(node) {
    const connected = this.system.game.state.networks.roads.filter(seg => seg.a === node.id || seg.b === node.id);
    if (connected.length < 2) return;
    const byLevel = new Map();
    for (const seg of connected) {
      const level = seg.elevation || 0;
      if (!byLevel.has(level)) byLevel.set(level, []);
      byLevel.get(level).push(seg);
    }
    for (const [level, roads] of byLevel.entries()) {
      if (roads.length < 2) continue;
      if (roads.length === 2) {
        // Nó com dois braços é continuação/curva. No solo, aplica uma junta curta
        // só para cobrir o corte das ribbons e manter curvas/avenidas/terra sem fatiar.
        // Em elevado, não cria placa/pad no nó para não gerar lajes quebradas.
        if (level === 0 && !this.isThroughJoint(node, roads)) this.buildSegmentJoint(node, roads, level);
        continue;
      }
      this.buildIntersectionPad(node, roads, level);
      if (level === 0) this.renderCrosswalks(node, roads);
    }
  }

  isThroughJoint(node, connected) {
    const arms = this.getIntersectionArms(node, connected);
    if (arms.length !== 2) return false;
    const delta = Math.abs(Math.atan2(Math.sin(arms[0].angle - arms[1].angle), Math.cos(arms[0].angle - arms[1].angle)));
    // Só trata como emenda simples quando é praticamente uma continuação reta.
    return Math.abs(Math.PI - delta) < 0.42;
  }

  buildSegmentJoint(node, connected, level = 0) {
    const arms = this.getIntersectionArms(node, connected);
    if (arms.length !== 2) return;
    const maxWidth = Math.max(...arms.map(arm => arm.width), m(12));
    const surfaceMaterial = connected.every(r => r.kind === 'dirt') ? (this.materials.dirtRoad || this.materials.road) : this.materials.road;
    const radius = Math.max(m(2.6), Math.min(m(7.2), maxWidth * 0.42));

    const base = this.makeCircleMesh(node, level, radius + m(0.55), this.materials.roadBase || this.materials.roadEdge, ROAD_RENDER.intersectionBaseYOffset + 0.015, 34);
    base.name = `road-curve-joint-base-${node.id}`;
    this.group.add(base);

    const surface = this.makeCircleMesh(node, level, radius, surfaceMaterial, ROAD_RENDER.intersectionSurfaceYOffset + 0.055, 43);
    surface.name = `road-curve-joint-surface-${node.id}`;
    this.group.add(surface);
  }

  buildIntersectionPad(node, connected, level = 0) {
    const arms = this.getIntersectionArms(node, connected);
    if (arms.length < 3) return;
    const maxWidth = Math.max(...arms.map(arm => arm.width), m(12));
    const surfaceMaterial = connected.every(r => r.kind === 'dirt') ? (this.materials.dirtRoad || this.materials.road) : this.materials.road;
    const radius = Math.max(m(6.0), Math.min(m(14.0), maxWidth * 0.72));

    // v2.4.13: pad simples e circular. O hull procedural anterior gerava triângulos
    // e manchas em T/X, curvas, avenidas e elevado. Render order alto cobre as
    // marcações dos segmentos no miolo e deixa o cruzamento limpo.
    const base = this.makeCircleMesh(node, level, radius + m(1.0), this.materials.roadBase || this.materials.roadEdge, ROAD_RENDER.intersectionBaseYOffset, 38);
    base.name = `road-junction-base-${node.id}`;
    base.userData.intersectionNodeId = node.id;
    this.group.add(base);

    const surface = this.makeCircleMesh(node, level, radius, surfaceMaterial, ROAD_RENDER.intersectionSurfaceYOffset + 0.065, 42);
    surface.name = `road-junction-surface-${node.id}`;
    surface.userData.intersectionNodeId = node.id;
    this.group.add(surface);

    if (level === 0) this.renderCompactIntersectionGuides(node, arms, radius);
  }

  makeCircleMesh(node, level, radius, material, yNudge, renderOrder) {
    const geo = new this.THREE.CircleGeometry(radius, 40);
    geo.rotateX(-Math.PI / 2);
    const mat = material?.clone ? material.clone() : material;
    if (mat) {
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -3;
      mat.polygonOffsetUnits = -3;
      mat.side = this.THREE.DoubleSide;
    }
    const mesh = new this.THREE.Mesh(geo, mat);
    mesh.position.set(node.x, this.groundY(node.x, node.z, level) + yNudge, node.z);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.renderOrder = renderOrder;
    mesh.frustumCulled = false;
    return mesh;
  }

  renderCompactIntersectionGuides(node, arms, radius) {
    // Caixa amarela BR: contorno + diagonais, como referência de cruzamento urbano.
    if (arms.length < 4 || !this.materials.laneYellow) return;
    const y = this.groundY(node.x, node.z, 0) + ROAD_RENDER.markingYOffset + 0.22;
    const size = Math.max(m(8.0), Math.min(m(15), radius * 1.55));
    const lineW = m(0.10);
    const pieces = [
      { x: 0, z: -size * 0.5, a: 0, len: size },
      { x: 0, z: size * 0.5, a: 0, len: size },
      { x: -size * 0.5, z: 0, a: Math.PI / 2, len: size },
      { x: size * 0.5, z: 0, a: Math.PI / 2, len: size },
      { x: 0, z: 0, a: Math.PI / 4, len: size * 1.38 },
      { x: 0, z: 0, a: -Math.PI / 4, len: size * 1.38 }
    ];
    for (const p of pieces) {
      const mesh = this.renderer.buildFlatRect({ x: node.x + p.x, y, z: node.z + p.z }, p.a, p.len, lineW, this.materials.laneYellow, 0.08);
      mesh.name = `road-box-junction-${node.id}`;
      mesh.renderOrder = 46;
      this.group.add(mesh);
    }
  }

  renderBrazilianBoxJunction(node, arms, maxWidth) {
    return;
    const y = this.groundY(node.x, node.z, 0) + ROAD_RENDER.markingYOffset + 0.055;
    const size = Math.max(m(9), Math.min(m(20), maxWidth * 1.45));
    const lineW = m(0.22);
    const mat = this.materials.laneYellow;
    const pieces = [
      { a: Math.PI / 4, len: size * 1.42 },
      { a: -Math.PI / 4, len: size * 1.42 },
      { a: 0, len: size },
      { a: Math.PI / 2, len: size }
    ];
    for (const item of pieces) {
      const mesh = this.renderer.buildFlatRect({ x: node.x, y, z: node.z }, item.a, item.len, lineW, mat, 0.08);
      mesh.name = `road-box-junction-${node.id}`;
      mesh.renderOrder = 33;
      this.group.add(mesh);
    }
  }

  addCentralRoadPatch(node, level, material, radius, renderOrder = 9) {
    const pts = [];
    const count = 28;
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count;
      pts.push({ x: node.x + Math.cos(a) * radius, z: node.z + Math.sin(a) * radius });
    }
    const patch = this.makeGroundPolygonMesh(pts, level, material, ROAD_RENDER.intersectionSurfaceYOffset + 0.06, renderOrder);
    patch.userData.intersectionNodeId = node.id;
    patch.name = `road-node-patch-${node.id}`;
    this.group.add(patch);
  }

  getIntersectionArms(node, connected) {
    return connected.map(seg => {
      const otherId = seg.a === node.id ? seg.b : seg.a;
      const other = this.system.getNode(otherId);
      if (!other) return null;
      const angle = Math.atan2(other.z - node.z, other.x - node.x);
      return {
        segment: seg,
        angle,
        width: this.system.getSegmentWidth(seg),
        lanes: seg.lanes || 1,
        direction: seg.direction || 'twoWay'
      };
    }).filter(Boolean).sort((a, b) => a.angle - b.angle);
  }

  junctionOutlineWorld(x, z, arms, maxWidth, extra = 0) {
    if (!arms?.length) return [];
    const points = [];
    for (const arm of arms) {
      const width = arm.width || maxWidth;
      const half = width * 0.5 + extra;
      const reach = Math.max(width * 0.78, half + m(8)) + extra * 0.85;
      const dir = { x: Math.cos(arm.angle), z: Math.sin(arm.angle) };
      const side = { x: -Math.sin(arm.angle), z: Math.cos(arm.angle) };
      points.push({ x: x + dir.x * reach - side.x * half, z: z + dir.z * reach - side.z * half });
      points.push({ x: x + dir.x * reach + side.x * half, z: z + dir.z * reach + side.z * half });
    }
    return this.sortRadialPoints(x, z, this.dedupePoints(points));
  }

  sortRadialPoints(x, z, points) {
    return [...points].sort((a, b) => Math.atan2(a.z - z, a.x - x) - Math.atan2(b.z - z, b.x - x));
  }

  dedupePoints(points) {
    const unique = [];
    const seen = new Set();
    for (const p of points) {
      const key = `${Math.round(p.x * 100)}:${Math.round(p.z * 100)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(p);
    }
    return unique;
  }

  junctionHullWorld(x, z, arms, maxWidth, extra = 0) {
    if (!arms?.length) return [];
    const ordered = [...arms].sort((a, b) => a.angle - b.angle);
    const candidates = [];
    for (let i = 0; i < ordered.length; i++) {
      const arm = ordered[i];
      const nextArm = ordered[(i + 1) % ordered.length];
      const armWidth = arm.width || maxWidth;
      const dir = { x: Math.cos(arm.angle), z: Math.sin(arm.angle) };
      const side = { x: -Math.sin(arm.angle), z: Math.cos(arm.angle) };
      const halfWidth = armWidth * 0.5 + extra * 0.64;
      const frontReach = Math.max(armWidth * 0.78, halfWidth + 8) + extra * 1.35;
      const backReach = Math.max(armWidth * 0.18, 5) + extra * 0.35;
      candidates.push({ x: x + dir.x * frontReach + side.x * halfWidth, z: z + dir.z * frontReach + side.z * halfWidth });
      candidates.push({ x: x + dir.x * frontReach - side.x * halfWidth, z: z + dir.z * frontReach - side.z * halfWidth });
      candidates.push({ x: x + dir.x * backReach + side.x * halfWidth * 0.72, z: z + dir.z * backReach + side.z * halfWidth * 0.72 });
      candidates.push({ x: x + dir.x * backReach - side.x * halfWidth * 0.72, z: z + dir.z * backReach - side.z * halfWidth * 0.72 });

      let midAngle = (arm.angle + nextArm.angle) * 0.5;
      if (nextArm.angle < arm.angle) midAngle += Math.PI;
      const cornerR = Math.max(8, ((armWidth + (nextArm.width || maxWidth)) * 0.5) * 0.42 + extra * 0.8);
      candidates.push({ x: x + Math.cos(midAngle) * cornerR, z: z + Math.sin(midAngle) * cornerR });
    }
    return convexHull2D(candidates);
  }

  makeGroundPolygonMesh(worldPts, level, material, yNudge, renderOrder) {
    const cx = worldPts.reduce((sum, p) => sum + p.x, 0) / worldPts.length;
    const cz = worldPts.reduce((sum, p) => sum + p.z, 0) / worldPts.length;
    const cy = this.groundY(cx, cz, level);
    const positions = [cx, cy + yNudge, cz];
    const uvs = [cx / 32, cz / 32];
    for (const p of worldPts) {
      const y = level === 0 ? this.groundY(p.x, p.z, level) : cy;
      positions.push(p.x, y + yNudge, p.z);
      uvs.push(p.x / 32, p.z / 32);
    }
    const indices = [];
    for (let i = 1; i <= worldPts.length; i++) indices.push(0, i, i === worldPts.length ? 1 : i + 1);
    const geo = new this.THREE.BufferGeometry();
    geo.setAttribute('position', new this.THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new this.THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new this.THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.renderOrder = renderOrder;
    return mesh;
  }

  groundY(x, z, level = 0) {
    return this.map.getHeightAt(x, z) + level * this.system.bridgeLevelHeight;
  }

  renderIntersectionCoreGuide(node, connected, level = 0) {
    // v2.3.21: no-op. O guia escuro antigo criava manchas/triângulos pretos nos cruzamentos.
    return;
  }

  renderCrosswalks(node, connected) {
    const signalCandidates = [];
    const maxWidth = Math.max(...connected.map(seg => this.system.getSegmentWidth(seg)), m(12));
    const junctionRadius = Math.max(m(6.0), Math.min(m(14.0), maxWidth * 0.72));
    for (const segment of connected) {
      if (segment.zoneable === false || (segment.elevation || 0) !== 0 || segment.kind === 'dirt') continue;
      const samples = this.system.getSegmentSamples(segment, 16);
      if (samples.length < 2) continue;
      const fromStart = segment.a === node.id;
      const p0 = fromStart ? samples[0] : samples[samples.length - 1];
      const p1 = fromStart ? samples[Math.min(2, samples.length - 1)] : samples[Math.max(0, samples.length - 3)];
      const heading = Math.atan2(p1.z - p0.z, p1.x - p0.x);
      const width = this.system.getSegmentWidth(segment);
      const layout = this.getCrosswalkLayout(width, junctionRadius);
      this.renderPedestrianCrosswalk(node, segment, heading, width, layout);
      this.renderStopLine(node, segment, heading, width, layout);
      this.renderApproachLaneGuides(node, segment, heading, width, Math.max(m(10), width * 0.82), layout);
      signalCandidates.push({ segment, heading, width });
    }
    if (signalCandidates.length >= 3) this.renderProceduralTrafficLights(node, signalCandidates);
  }

  getCrosswalkLayout(width, junctionRadius) {
    const stripeAlongRoad = m(0.58);
    const stripeGapAlong = m(0.54);
    const stripeCount = 5;
    const crossDepth = stripeCount * stripeAlongRoad + (stripeCount - 1) * stripeGapAlong;
    const crossStart = junctionRadius + m(1.55);
    const crossEnd = crossStart + crossDepth;
    return {
      crossStart,
      crossEnd,
      crossDepth,
      stripeAlongRoad,
      stripeGapAlong,
      stripeCount,
      crossWidth: Math.max(width * 0.90, m(7.2)),
      stopDistance: crossEnd + m(1.85),
      guideStart: crossEnd + m(3.0)
    };
  }

  renderPedestrianCrosswalk(node, segment, heading, width, layout = this.getCrosswalkLayout(width, Math.max(m(6.0), Math.min(m(14.0), width * 0.72)))) {
    const dir = { x: Math.cos(heading), z: Math.sin(heading) };
    const nodeY = this.groundY(node.x, node.z, segment.elevation || 0) + ROAD_RENDER.crosswalkYOffset;
    // Zebra BR correta: cada barra é comprida no sentido da travessia do pedestre
    // (atravessa a largura da pista) e estreita no sentido do tráfego.
    for (let i = 0; i < layout.stripeCount; i++) {
      const d = layout.crossStart + layout.stripeAlongRoad * 0.5 + i * (layout.stripeAlongRoad + layout.stripeGapAlong);
      const center = { x: node.x + dir.x * d, y: nodeY, z: node.z + dir.z * d };
      const stripe = this.renderer.buildFlatRect(center, heading, layout.stripeAlongRoad, layout.crossWidth, this.materials.crosswalk, 0.13);
      stripe.name = `road-crosswalk-${node.id}-${segment.id}-${i}`;
      stripe.renderOrder = 54;
      this.group.add(stripe);
    }
  }

  renderStopLine(node, segment, heading, width, layout = this.getCrosswalkLayout(width, Math.max(m(6.0), Math.min(m(14.0), width * 0.72)))) {
    const dir = { x: Math.cos(heading), z: Math.sin(heading) };
    const nodeY = this.groundY(node.x, node.z, segment.elevation || 0) + ROAD_RENDER.crosswalkYOffset;
    // Linha de retenção antes da faixa, sem invadir zebra nem miolo do cruzamento.
    const stopCenter = { x: node.x + dir.x * layout.stopDistance, y: nodeY, z: node.z + dir.z * layout.stopDistance };
    const stop = this.renderer.buildFlatRect(stopCenter, heading, m(0.42), Math.max(width * 0.76, m(6.2)), this.materials.stopLine, 0.13);
    stop.name = `road-stopline-${node.id}-${segment.id}`;
    stop.renderOrder = 53;
    this.group.add(stop);
  }

  renderProceduralTrafficLights(node, arms) {
    const signalGroup = new this.THREE.Group();
    signalGroup.name = `traffic-signals-${node.id}`;
    for (let i = 0; i < arms.length; i++) {
      const arm = arms[i];
      this.addTrafficSignalPair(signalGroup, node, arm, i);
    }
    this.group.add(signalGroup);
  }

  addTrafficSignalPair(parent, node, arm, index = 0) {
    const dir = { x: Math.cos(arm.heading), z: Math.sin(arm.heading) };
    const side = { x: -dir.z, z: dir.x };
    const baseD = Math.max(m(9.0), arm.width * 0.64);
    const sideD = arm.width * 0.5 + m(2.4);
    for (const sideSign of [-1, 1]) {
      const x = node.x + dir.x * baseD + side.x * sideD * sideSign;
      const z = node.z + dir.z * baseD + side.z * sideD * sideSign;
      const y = this.groundY(x, z, 0);
      const signal = this.makeTrafficSignal(arm.heading + Math.PI + (sideSign < 0 ? 0.05 : -0.05), index);
      signal.position.set(x, y + 0.08, z);
      signal.name = `traffic-signal-${node.id}-${arm.segment.id}-${sideSign}`;
      parent.add(signal);
    }
  }

  makeTrafficSignal(heading, index = 0) {
    const group = new this.THREE.Group();
    group.rotation.y = -heading;
    const mats = this.getTrafficSignalMaterials();
    const red = index % 2 === 0 ? mats.redOn : mats.redDim;
    const green = index % 2 === 1 ? mats.greenOn : mats.greenDim;

    const pole = new this.THREE.Mesh(new this.THREE.CylinderGeometry(m(0.13), m(0.17), m(4.5), 8), mats.metal);
    pole.position.y = m(2.25);
    pole.castShadow = true;
    group.add(pole);

    const arm = new this.THREE.Mesh(new this.THREE.BoxGeometry(m(2.4), m(0.16), m(0.16)), mats.metal);
    arm.position.set(m(0.9), m(4.22), 0);
    arm.castShadow = true;
    group.add(arm);

    const head = new this.THREE.Mesh(new this.THREE.BoxGeometry(m(0.52), m(1.36), m(0.34)), mats.dark);
    head.position.set(m(2.05), m(3.84), 0);
    head.castShadow = true;
    group.add(head);

    const lightGeo = new this.THREE.CylinderGeometry(m(0.13), m(0.13), m(0.045), 16);
    const lightMats = [red, mats.yellow, green];
    const ys = [m(4.18), m(3.84), m(3.50)];
    for (let i = 0; i < 3; i++) {
      const bulb = new this.THREE.Mesh(lightGeo, lightMats[i]);
      bulb.rotation.x = Math.PI / 2;
      bulb.position.set(m(2.24), ys[i], -m(0.18));
      group.add(bulb);
    }
    return group;
  }

  getTrafficSignalMaterials() {
    if (this.signalMaterials) return this.signalMaterials;
    this.signalMaterials = {
      metal: new this.THREE.MeshStandardMaterial({ color: 0x222629, roughness: 0.74, metalness: 0.32 }),
      dark: new this.THREE.MeshStandardMaterial({ color: 0x111416, roughness: 0.62, metalness: 0.18 }),
      redOn: new this.THREE.MeshStandardMaterial({ color: 0x4a1010, emissive: 0xff2020, emissiveIntensity: 0.42, roughness: 0.45 }),
      redDim: new this.THREE.MeshStandardMaterial({ color: 0x4a1010, emissive: 0xff2020, emissiveIntensity: 0.12, roughness: 0.45 }),
      yellow: new this.THREE.MeshStandardMaterial({ color: 0x5c4414, emissive: 0xffc02e, emissiveIntensity: 0.10, roughness: 0.45 }),
      greenOn: new this.THREE.MeshStandardMaterial({ color: 0x123c22, emissive: 0x32ff70, emissiveIntensity: 0.48, roughness: 0.45 }),
      greenDim: new this.THREE.MeshStandardMaterial({ color: 0x123c22, emissive: 0x32ff70, emissiveIntensity: 0.14, roughness: 0.45 })
    };
    return this.signalMaterials;
  }

  renderApproachLaneGuides(node, segment, heading, width, length, crosswalkLayout = null) {
    if (length < m(8)) return;
    const dir = { x: Math.cos(heading), z: Math.sin(heading) };
    const samples = [];
    const radius = Math.max(m(6.0), Math.min(m(14.0), width * 0.72));
    const startD = Math.max(crosswalkLayout?.guideStart ?? (radius + m(7.2)), m(6.8));
    const endD = Math.max(startD + m(3.2), startD + length);
    for (const d of [startD, endD]) {
      const x = node.x + dir.x * d;
      const z = node.z + dir.z * d;
      samples.push({ x, y: this.map.getHeightAt(x, z) + ROAD_RENDER.crosswalkYOffset, z, heading });
    }
    const layout = this.system.getLaneLayout(segment, width);
    if (layout.direction === 'oneWay') {
      for (let i = 1; i < layout.lanes; i++) {
        const centers = layout.forwardCenters || [];
        const offset = centers[i] != null && centers[i - 1] != null ? (centers[i] + centers[i - 1]) * 0.5 : -layout.innerHalf + i * layout.laneWidth;
        const guide = this.renderer.markings.stampOnTop(this.renderer.markings.buildDashedMarking(samples, offset, Math.max(0.045, ROAD_RENDER.laneDashWidth * 0.72), this.materials.laneWhite, 0.085, { dash: m(2.1), gap: m(6.6) }), 48);
        this.group.add(guide);
      }
      return;
    }
    if (layout.kind !== 'avenue') {
      const a = this.renderer.markings.stampOnTop(this.renderer.markings.buildMarking(samples, -layout.centerLineOffset, Math.max(0.15, ROAD_RENDER.centerLineWidth * 0.78), this.materials.laneYellow, 0.085), 48);
      const b = this.renderer.markings.stampOnTop(this.renderer.markings.buildMarking(samples, layout.centerLineOffset, Math.max(0.15, ROAD_RENDER.centerLineWidth * 0.78), this.materials.laneYellow, 0.085), 48);
      this.group.add(a, b);
    }
    if (layout.lanes <= 1) return;
    for (let i = 1; i < layout.lanes; i++) {
      const offset = layout.forwardCenters?.[i] != null && layout.forwardCenters?.[i - 1] != null ? (layout.forwardCenters[i] + layout.forwardCenters[i - 1]) * 0.5 : layout.centerLineOffset + i * layout.laneWidth;
      const reverseOffset = layout.reverseCenters?.[i] != null && layout.reverseCenters?.[i - 1] != null ? (layout.reverseCenters[i] + layout.reverseCenters[i - 1]) * 0.5 : -offset;
      if (i === layout.lanes - 1 && layout.lanes <= 2) continue;
      const f = this.renderer.markings.stampOnTop(this.renderer.markings.buildDashedMarking(samples, offset, Math.max(0.045, ROAD_RENDER.laneDashWidth * 0.72), this.materials.laneWhite, 0.085, { dash: m(2.1), gap: m(6.6) }), 48);
      const r = this.renderer.markings.stampOnTop(this.renderer.markings.buildDashedMarking(samples, reverseOffset, Math.max(0.045, ROAD_RENDER.laneDashWidth * 0.72), this.materials.laneWhite, 0.085, { dash: m(2.1), gap: m(6.6) }), 48);
      this.group.add(f, r);
    }
  }
}

function convexHull2D(points) {
  const unique = [];
  const seen = new Set();
  for (const p of points) {
    const key = `${Math.round(p.x * 1000)}:${Math.round(p.z * 1000)}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(p);
    }
  }
  unique.sort((a, b) => a.x === b.x ? a.z - b.z : a.x - b.x);
  if (unique.length <= 2) return unique;
  const cross = (o, a, b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower = [];
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}
