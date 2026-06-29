import { dist2D, pointAlongPolyline, polylineLength, safeDisposeObject } from '../utils/MathUtils.js';
import { ROAD_RENDER } from './RoadMaterials.js';
import { RoadIntersections } from './RoadIntersections.js';
import { RoadMarkings } from './RoadMarkings.js';
import { m } from '../utils/Scale.js';

export class RoadRenderer {
  constructor(system) {
    this.system = system;
    this.game = system.game;
    this.map = system.map;
    this.THREE = system.THREE;
    this.materials = system.materials;
    this.group = system.group;
    this.markings = new RoadMarkings(this);
    this.intersections = new RoadIntersections(this);
  }

  render() {
    safeDisposeObject(this.group);
    this.group.clear();
    for (const segment of this.game.state.networks.roads) this.renderSegment(segment);
    for (const node of this.game.state.networks.roadNodes) this.intersections.renderIntersection(node);
    for (const node of this.game.state.networks.roadNodes) this.renderNode(node, node.id === this.system.pendingNodeId);
  }

  renderSegment(segment) {
    const samples = this.system.getSegmentSamples(segment);
    if (samples.length < 2) return;
    const width = this.system.getSegmentWidth(segment);
    const level = segment.elevation || 0;
    const isTunnel = level < 0;

    // v2.4.13: renderer estabilizado. O taper por nó criava placas/triângulos em
    // curvas, elevados, terra, mão única e avenidas. A costura agora fica por conta
    // do pad de cruzamento, e os segmentos são ribbons contínuas.
    const baseMesh = this.buildRibbon(samples, width + ROAD_RENDER.shoulderWidth, this.materials.roadBase || this.materials.roadEdge, ROAD_RENDER.baseYOffset);
    baseMesh.name = `road-base-${segment.id}`;
    baseMesh.receiveShadow = true;
    baseMesh.renderOrder = 3;
    this.group.add(baseMesh);

    const roadMaterial = segment.kind === 'dirt' ? (this.materials.dirtRoad || this.materials.road) : (isTunnel ? this.materials.tunnelPortal : this.materials.road);
    const roadMesh = this.buildRibbon(samples, width, roadMaterial, ROAD_RENDER.surfaceYOffset);
    roadMesh.name = segment.kind === 'dirt' ? `road-dirt-${segment.id}` : `road-asphalt-${segment.id}`;
    roadMesh.userData.segmentId = segment.id;
    roadMesh.castShadow = false;
    roadMesh.receiveShadow = true;
    roadMesh.renderOrder = 5;
    this.group.add(roadMesh);

    if (segment.kind === 'dirt') {
      this.renderDirtShoulders(samples, width);
      this.markings.renderDirtRoadRuts(samples, width);
      if (level > 0) this.renderBridgeDetails(segment, samples, width);
      return;
    }

    this.markings.renderAsphaltWear(segment, samples, width);
    this.renderRoadEdges(segment, samples, width);
    this.renderRoadMedian(segment, samples, width);
    this.markings.renderLaneClassOverlay(segment, samples, width);
    if (this.shouldRenderSidewalk(segment)) this.renderSidewalks(segment, samples, width);
    this.markings.renderLaneMarkings(segment, samples, width);
    this.markings.renderDirectionArrows(segment, samples, width);

    if (level > 0) this.renderBridgeDetails(segment, samples, width);
    else if (level < 0) this.renderTunnelDetails(segment, samples, width);
  }

  renderRoadMedian(segment, samples, width) {
    if ((segment.kind || 'street') !== 'avenue' || (segment.direction || 'twoWay') === 'oneWay') return;
    const medianSamples = this.trimMedianSamples(segment, samples, width);
    if (medianSamples.length < 2) return;
    const layout = this.system.getLaneLayout(segment, width);
    const medianWidth = Math.max(m(4.2), layout.centerGap * 0.78);
    const curbWidth = m(0.34);
    const median = this.buildOffsetRibbon(medianSamples, 0, medianWidth, this.materials.roadMedian || this.materials.roadEdge, ROAD_RENDER.markingYOffset + 0.08);
    median.name = `road-median-${segment.id}`;
    median.renderOrder = 9;
    this.group.add(median);
    const edge = medianWidth * 0.5 - curbWidth * 0.5;
    const leftCurb = this.buildOffsetRibbon(medianSamples, edge, curbWidth, this.materials.roadMedianCurb || this.materials.curb, ROAD_RENDER.markingYOffset + 0.20);
    const rightCurb = this.buildOffsetRibbon(medianSamples, -edge, curbWidth, this.materials.roadMedianCurb || this.materials.curb, ROAD_RENDER.markingYOffset + 0.20);
    leftCurb.renderOrder = rightCurb.renderOrder = 10;
    this.group.add(leftCurb, rightCurb);
    this.renderMedianDecor(segment, medianSamples, medianWidth);
  }

  renderMedianDecor(segment, samples, medianWidth) {
    if ((segment.elevation || 0) !== 0 || !samples?.length || samples.length < 2) return;
    const length = polylineLength(samples);
    if (length < m(58) || medianWidth < m(4.0)) return;
    const mats = this.getRoadDecorMaterials();
    const every = m(42);
    const maxItems = Math.min(18, Math.floor(length / every));
    const trunkGeo = new this.THREE.CylinderGeometry(m(0.10), m(0.14), m(1.55), 6);
    const crownGeo = new this.THREE.ConeGeometry(m(0.82), m(1.35), 7);
    for (let i = 0; i < maxItems; i++) {
      const d = m(24) + i * every;
      if (d > length - m(18)) break;
      const p = pointAlongPolyline(samples, d);
      if (!p) continue;
      const group = new this.THREE.Group();
      const y = this.map.getHeightAt(p.x, p.z);
      const trunk = new this.THREE.Mesh(trunkGeo, mats.trunk);
      trunk.position.y = m(0.82);
      trunk.castShadow = true;
      const crown = new this.THREE.Mesh(crownGeo, mats.crown);
      crown.position.y = m(1.92);
      crown.rotation.y = (i * 1.71) % Math.PI;
      crown.castShadow = true;
      group.add(trunk, crown);
      group.position.set(p.x, y + ROAD_RENDER.markingYOffset + m(0.10), p.z);
      group.name = `road-median-tree-${segment.id}-${i}`;
      this.group.add(group);
    }
  }

  getRoadDecorMaterials() {
    if (this.decorMaterials) return this.decorMaterials;
    this.decorMaterials = {
      trunk: new this.THREE.MeshStandardMaterial({ color: 0x4f3a28, roughness: 0.92, flatShading: true }),
      crown: new this.THREE.MeshStandardMaterial({ color: 0x3f6b37, roughness: 0.98, flatShading: true })
    };
    return this.decorMaterials;
  }

  trimMedianSamples(segment, samples, width) {
    const length = polylineLength(samples);
    if (length < m(34)) return [];
    const level = segment.elevation || 0;
    const degreeAt = (nodeId) => this.game.state.networks.roads.filter(seg => (seg.elevation || 0) === level && (seg.a === nodeId || seg.b === nodeId)).length;
    const startTrim = degreeAt(segment.a) >= 3 ? Math.max(m(12), width * 0.62) : Math.max(m(2.5), width * 0.10);
    const endTrim = degreeAt(segment.b) >= 3 ? Math.max(m(12), width * 0.62) : Math.max(m(2.5), width * 0.10);
    if (length <= startTrim + endTrim + m(8)) return [];
    const start = pointAlongPolyline(samples, startTrim);
    const end = pointAlongPolyline(samples, length - endTrim);
    const out = [];
    if (start) out.push(start);
    let walked = 0;
    for (let i = 1; i < samples.length - 1; i++) {
      walked += dist2D(samples[i - 1], samples[i]);
      if (walked > startTrim && walked < length - endTrim) out.push(samples[i]);
    }
    if (end) out.push(end);
    return out;
  }

  renderDirtShoulders(samples, width) {
    const edgeOffset = width / 2 - m(0.55);
    const left = this.buildOffsetRibbon(samples, edgeOffset, m(1.05), this.materials.roadBase || this.materials.roadEdge, 0.09);
    const right = this.buildOffsetRibbon(samples, -edgeOffset, m(1.05), this.materials.roadBase || this.materials.roadEdge, 0.09);
    left.renderOrder = right.renderOrder = 6;
    this.group.add(left, right);
  }

  renderMedian(segment, samples, width) {
    const layout = this.system.getLaneLayout(segment, width);
    if (layout.kind !== 'avenue' || layout.direction === 'oneWay') return;
    const medianWidth = Math.max(m(2.4), layout.centerGap - m(1.15));
    const grass = this.buildOffsetRibbon(samples, 0, medianWidth, this.materials.roadMedian || this.materials.roadEdge, 0.27);
    grass.renderOrder = 9;
    this.group.add(grass);
    const curbW = m(0.42);
    const left = this.buildOffsetRibbon(samples, medianWidth / 2 + curbW * 0.5, curbW, this.materials.roadMedianCurb || this.materials.curb, 0.37);
    const right = this.buildOffsetRibbon(samples, -(medianWidth / 2 + curbW * 0.5), curbW, this.materials.roadMedianCurb || this.materials.curb, 0.37);
    left.renderOrder = right.renderOrder = 10;
    this.group.add(left, right);
  }

  renderRoadEdges(segment, samples, width) {
    const edgeOffset = width / 2 - ROAD_RENDER.edgeInset;
    const leftEdge = this.buildOffsetRibbon(samples, edgeOffset, m(0.78), this.materials.roadEdge, 0.17);
    const rightEdge = this.buildOffsetRibbon(samples, -edgeOffset, m(0.78), this.materials.roadEdge, 0.17);
    leftEdge.renderOrder = rightEdge.renderOrder = 8;
    this.group.add(leftEdge, rightEdge);
    if (this.materials.roadGutter && (segment.elevation || 0) === 0) {
      const gutterOffset = Math.max(m(0.65), edgeOffset - m(0.62));
      const leftGutter = this.buildOffsetRibbon(samples, gutterOffset, m(0.28), this.materials.roadGutter, ROAD_RENDER.markingYOffset - 0.035);
      const rightGutter = this.buildOffsetRibbon(samples, -gutterOffset, m(0.28), this.materials.roadGutter, ROAD_RENDER.markingYOffset - 0.035);
      leftGutter.renderOrder = rightGutter.renderOrder = 8;
      this.group.add(leftGutter, rightGutter);
    }
    // v2.3.2: removidas as faixas tracejadas nas bordas. A borda agora é só guia/curb escuro,
    // e as marcações brancas ficam apenas dentro da pista.
  }

  renderSidewalks(segment, samples, width) {
    const walkOffset = width / 2 + this.system.sidewalkWidth / 2 + ROAD_RENDER.sidewalkGap;
    const curbOffset = width / 2 + m(0.45);
    const leftWalk = this.buildOffsetRibbon(samples, walkOffset, this.system.sidewalkWidth, this.materials.sidewalk, ROAD_RENDER.sidewalkYOffset);
    const rightWalk = this.buildOffsetRibbon(samples, -walkOffset, this.system.sidewalkWidth, this.materials.sidewalk, ROAD_RENDER.sidewalkYOffset);
    const leftCurb = this.buildOffsetRibbon(samples, curbOffset, ROAD_RENDER.curbWidth, this.materials.curb || this.materials.sidewalk, ROAD_RENDER.curbYOffset);
    const rightCurb = this.buildOffsetRibbon(samples, -curbOffset, ROAD_RENDER.curbWidth, this.materials.curb || this.materials.sidewalk, ROAD_RENDER.curbYOffset);
    leftWalk.renderOrder = rightWalk.renderOrder = 4;
    leftCurb.renderOrder = rightCurb.renderOrder = 8;
    this.group.add(leftWalk, rightWalk, leftCurb, rightCurb);
    this.renderSidewalkJointHints(samples, walkOffset, this.system.sidewalkWidth);
  }

  renderSidewalkJointHints(samples, walkOffset, sidewalkWidth) {
    if (!this.materials.sidewalkJoint || samples.length < 2) return;
    const length = polylineLength(samples);
    if (length < m(38)) return;
    const every = m(12);
    const maxTicks = Math.min(34, Math.floor(length / every));
    for (const sideSign of [-1, 1]) {
      for (let i = 1; i <= maxTicks; i++) {
        const p = pointAlongPolyline(samples, i * every);
        if (!p) continue;
        const center = this.offsetPointByHeading(p, walkOffset * sideSign);
        center.y += ROAD_RENDER.sidewalkYOffset + 0.035;
        const joint = this.buildFlatRect(center, p.heading + Math.PI / 2, sidewalkWidth * 0.74, m(0.08), this.materials.sidewalkJoint, 0.025);
        joint.name = 'road-sidewalk-joint';
        joint.renderOrder = 9;
        this.group.add(joint);
      }
    }
  }

  shouldRenderSidewalk(segment) {
    if (segment.kind === 'dirt') return false;
    if (segment.zoneable === false) return false;
    if ((segment.elevation || 0) !== 0) return false;
    return true;
  }

  renderBridgeDetails(segment, samples, width) {
    this.renderBridgeGroundShadow(samples, width);
    const leftBarrier = this.buildOffsetRibbon(samples, width / 2 + m(0.95), m(0.95), this.materials.bridgeBarrier, m(0.95));
    const rightBarrier = this.buildOffsetRibbon(samples, -(width / 2 + m(0.95)), m(0.95), this.materials.bridgeBarrier, m(0.95));
    this.group.add(leftBarrier, rightBarrier);

    const pillarGeo = new this.THREE.CylinderGeometry(m(0.55), m(0.72), 1, 10);
    const length = this.system.getSegmentLength(segment);
    const every = Math.max(3, Math.floor(samples.length / Math.max(2, Math.ceil(length / m(90)))));
    for (let i = every; i < samples.length - 1; i += every) {
      const p = samples[i];
      const ground = this.map.getHeightAt(p.x, p.z);
      const clearance = p.y - ground;
      if (clearance < m(3.2)) continue;
      const h = Math.max(m(2.8), clearance - m(0.42));
      const pillar = new this.THREE.Mesh(pillarGeo, this.materials.bridgeConcrete);
      pillar.scale.set(1, h, 1);
      pillar.position.set(p.x, ground + h / 2, p.z);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      this.group.add(pillar);
    }
  }

  renderBridgeGroundShadow(samples, width) {
    if (!samples?.length || !this.materials.bridgeShadow) return;
    const groundSamples = samples
      .filter(p => (p.y - this.map.getHeightAt(p.x, p.z)) > m(2.4))
      .map(p => ({ ...p, y: this.map.getHeightAt(p.x, p.z) + m(0.035) }));
    if (groundSamples.length < 2) return;
    const shadow = this.buildRibbon(groundSamples, width + m(4.2), this.materials.bridgeShadow, 0);
    shadow.name = 'road-bridge-ground-shadow';
    shadow.renderOrder = 2;
    this.group.add(shadow);
  }

  renderTunnelDetails(segment, samples, width) {
    const ghost = this.markings.buildDashedMarking(samples.map(p => ({
      ...p,
      y: this.map.getHeightAt(p.x, p.z) + 0.72
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
    mesh.position.set(node.x, this.map.getHeightAt(node.x, node.z) + m(1.12) + (node.elevation || 0) * this.system.bridgeLevelHeight, node.z);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 28;
    this.group.add(mesh);
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

  buildFlatRect(center, heading, lengthAlong, widthAcross, material, yOffset = 0.2) {
    const dir = { x: Math.cos(heading), z: Math.sin(heading) };
    const side = { x: -dir.z, z: dir.x };
    const hl = lengthAlong * 0.5;
    const hw = widthAcross * 0.5;
    const baseDelta = center.y - this.map.getHeightAt(center.x, center.z);
    const pts = [
      [-hl, -hw], [hl, -hw], [-hl, hw], [hl, hw]
    ].map(([lx, lz]) => {
      const x = center.x + dir.x * lx + side.x * lz;
      const z = center.z + dir.z * lx + side.z * lz;
      return { x, y: this.map.getHeightAt(x, z) + baseDelta + yOffset, z };
    });
    const geo = new this.THREE.BufferGeometry();
    geo.setAttribute('position', new this.THREE.Float32BufferAttribute([
      pts[0].x, pts[0].y, pts[0].z,
      pts[1].x, pts[1].y, pts[1].z,
      pts[2].x, pts[2].y, pts[2].z,
      pts[3].x, pts[3].y, pts[3].z
    ], 3));
    geo.setAttribute('uv', new this.THREE.Float32BufferAttribute([
      0, 0,
      1, 0,
      0, 1,
      1, 1
    ], 2));
    geo.setIndex([0, 2, 1, 1, 2, 3]);
    geo.computeVertexNormals();
    const mesh = new this.THREE.Mesh(geo, material);
    mesh.renderOrder = 28;
    mesh.frustumCulled = false;
    return mesh;
  }

  buildTaperedRibbon(segment, samples, width, material, yOffset = 0) {
    // Mantido apenas por compatibilidade com chamadas antigas. O taper visual foi
    // desligado porque era a principal origem das placas quebradas nos nós.
    return this.buildRibbon(samples, width, material, yOffset);
    if (!segment || samples.length < 2) return this.buildRibbon(samples, width, material, yOffset);
    const length = polylineLength(samples);
    if (length < m(18)) return this.buildRibbon(samples, width, material, yOffset);
    const startWidth = this.nodeTransitionWidth(segment, segment.a, width);
    const endWidth = this.nodeTransitionWidth(segment, segment.b, width);
    if (Math.abs(startWidth - width) < 0.6 && Math.abs(endWidth - width) < 0.6) return this.buildRibbon(samples, width, material, yOffset);
    const taperLen = Math.min(length * 0.42, Math.max(m(18), Math.min(m(58), width * 1.35)));
    const pos = [], uv = [], idx = [];
    let distance = 0;
    for (let i = 0; i < samples.length; i++) {
      const p = samples[i];
      const prev = samples[Math.max(0, i - 1)];
      const next = samples[Math.min(samples.length - 1, i + 1)];
      if (i > 0) distance += dist2D(samples[i - 1], p);
      const heading = Math.atan2(next.z - prev.z, next.x - prev.x);
      const nx = -Math.sin(heading), nz = Math.cos(heading);
      const sT = Math.max(0, 1 - distance / Math.max(m(1), taperLen));
      const eT = Math.max(0, 1 - (length - distance) / Math.max(m(1), taperLen));
      let localWidth = width;
      localWidth = localWidth + (startWidth - localWidth) * (sT * sT * (3 - 2 * sT));
      localWidth = localWidth + (endWidth - localWidth) * (eT * eT * (3 - 2 * eT));
      localWidth = Math.max(Math.min(width, m(5.0)), localWidth);
      const centerClearance = p.y - this.map.getHeightAt(p.x, p.z);
      for (const side of [-1, 1]) {
        const x = p.x + nx * localWidth * 0.5 * side;
        const z = p.z + nz * localWidth * 0.5 * side;
        const y = this.map.getHeightAt(x, z) + centerClearance + yOffset;
        pos.push(x, y, z);
        uv.push(side < 0 ? 0 : 1, distance / Math.max(m(18), Math.max(localWidth, width) * 1.35));
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
    const mesh = new this.THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    mesh.userData.taperedRoad = true;
    return mesh;
  }

  nodeTransitionWidth(segment, nodeId, width) {
    return width;
    if (!nodeId) return width;
    const level = segment.elevation || 0;
    const connected = (this.game.state.networks.roads || []).filter(seg => seg.id !== segment.id && (seg.elevation || 0) === level && (seg.a === nodeId || seg.b === nodeId));
    if (!connected.length) return width;
    const widths = connected.map(seg => this.system.getSegmentWidth(seg)).filter(Number.isFinite);
    if (!widths.length) return width;
    widths.push(width);
    const minW = Math.min(...widths);
    const maxW = Math.max(...widths);
    if (maxW - minW < m(3.2)) return width;
    const avg = widths.reduce((a, b) => a + b, 0) / widths.length;
    const target = width + (avg - width) * 0.72;
    return Math.max(minW * 0.92, Math.min(maxW * 1.02, target));
  }

  buildRibbon(samples, width, material, yOffset = 0) {
    const pos = [], uv = [], idx = [];
    let distance = 0;
    for (let i = 0; i < samples.length; i++) {
      const p = samples[i];
      const prev = samples[Math.max(0, i - 1)];
      const next = samples[Math.min(samples.length - 1, i + 1)];
      if (i > 0) distance += dist2D(samples[i - 1], p);
      const heading = Math.atan2(next.z - prev.z, next.x - prev.x);
      const nx = -Math.sin(heading), nz = Math.cos(heading);
      const centerClearance = p.y - this.map.getHeightAt(p.x, p.z);
      for (const side of [-1, 1]) {
        const x = p.x + nx * width * 0.5 * side;
        const z = p.z + nz * width * 0.5 * side;
        const y = this.map.getHeightAt(x, z) + centerClearance + yOffset;
        pos.push(x, y, z);
        uv.push(side < 0 ? 0 : 1, distance / Math.max(m(18), width * 1.35));
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
    const mesh = new this.THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    return mesh;
  }

  buildOffsetRibbon(samples, offset, width, material, yOffset = 0) {
    return this.buildRibbon(this.offsetSamples(samples, offset), width, material, yOffset);
  }

  offsetSamples(samples, offset) {
    return samples.map((p, i) => {
      const prev = samples[Math.max(0, i - 1)];
      const next = samples[Math.min(samples.length - 1, i + 1)];
      const heading = Math.atan2(next.z - prev.z, next.x - prev.x);
      const nx = -Math.sin(heading), nz = Math.cos(heading);
      const x = p.x + nx * offset;
      const z = p.z + nz * offset;
      const baseDelta = p.y - this.map.getHeightAt(p.x, p.z);
      return { ...p, x, z, y: this.map.getHeightAt(x, z) + baseDelta };
    });
  }
}
