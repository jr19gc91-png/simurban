import { dist2D, polylineLength } from '../utils/MathUtils.js';

export class RailGeometry {
  constructor(system) {
    this.system = system;
    this.map = system.map;
    this.THREE = system.THREE;
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
        uv.push(side < 0 ? 0 : 1, distance / Math.max(16, width * 1.6));
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
    const mat = material?.clone ? material.clone() : material;
    if (mat) {
      mat.side = this.THREE.DoubleSide;
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -1.5;
      mat.polygonOffsetUnits = -1.5;
    }
    const mesh = new this.THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
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

  pointAlong(samples, distance) {
    if (!samples.length) return null;
    let remaining = distance;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1], b = samples[i];
      const seg = dist2D(a, b);
      if (remaining <= seg) {
        const t = seg <= 0.0001 ? 0 : remaining / seg;
        return {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          z: a.z + (b.z - a.z) * t,
          heading: Math.atan2(b.z - a.z, b.x - a.x),
          segmentId: b.segmentId || a.segmentId,
          segment: b.segment || a.segment
        };
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

  length(samples) {
    return polylineLength(samples);
  }
}
