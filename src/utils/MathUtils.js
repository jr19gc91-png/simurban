export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / Math.max(0.000001, e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function dist2D(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function makeId(prefix = 'id') {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36).slice(-5)}`;
}

export function segmentPointDistance2D(point, a, b) {
  const vx = b.x - a.x;
  const vz = b.z - a.z;
  const wx = point.x - a.x;
  const wz = point.z - a.z;
  const len2 = vx * vx + vz * vz;
  const t = len2 <= 0.0001 ? 0 : clamp((wx * vx + wz * vz) / len2, 0, 1);
  const x = a.x + vx * t;
  const z = a.z + vz * t;
  return { distance: Math.hypot(point.x - x, point.z - z), t, x, z };
}

export function closestPointOnPolyline(point, samples) {
  let best = null;
  for (let i = 0; i < samples.length - 1; i++) {
    const hit = segmentPointDistance2D(point, samples[i], samples[i + 1]);
    if (!best || hit.distance < best.distance) best = { ...hit, index: i };
  }
  return best;
}

export function polylineLength(samples) {
  let total = 0;
  for (let i = 1; i < samples.length; i++) total += dist2D(samples[i - 1], samples[i]);
  return total;
}

export function pointAlongPolyline(samples, distance) {
  if (!samples.length) return null;
  if (distance <= 0) return samples[0];
  let remaining = distance;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const seg = dist2D(a, b);
    if (remaining <= seg) {
      const t = seg <= 0.0001 ? 0 : remaining / seg;
      return {
        x: lerp(a.x, b.x, t),
        y: lerp(a.y, b.y, t),
        z: lerp(a.z, b.z, t),
        heading: Math.atan2(b.z - a.z, b.x - a.x)
      };
    }
    remaining -= seg;
  }
  const last = samples[samples.length - 1];
  const prev = samples[Math.max(0, samples.length - 2)];
  return { ...last, heading: Math.atan2(last.z - prev.z, last.x - prev.x) };
}

export function safeDisposeObject(object) {
  // Sistemas NewCore reutilizam materiais compartilhados. Aqui descartamos só geometrias
  // transitórias para evitar quebrar materiais globais entre rebuilds.
  object?.traverse?.(child => {
    if (child.geometry) child.geometry.dispose();
  });
}
