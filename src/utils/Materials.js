function makeCanvasTexture(THREE, size, painter, repeatX = 1, repeatY = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  painter(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function asphaltTexture(THREE) {
  return makeCanvasTexture(THREE, 512, (ctx, s) => {
    ctx.fillStyle = '#303538';
    ctx.fillRect(0, 0, s, s);
    // Agregado fino: asfalto escuro com leitura em câmera baixa e alta.
    for (let i = 0; i < 52000; i++) {
      const v = 24 + Math.random() * 58;
      const a = 0.09 + Math.random() * 0.20;
      ctx.fillStyle = `rgba(${v},${v + 2},${v + 3},${a})`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 0.8 + Math.random() * 2.4, 0.8 + Math.random() * 2.4);
    }
    // Manchas longas e remendos discretos, sem parecer ruído colorido.
    for (let i = 0; i < 220; i++) {
      const x = Math.random() * s;
      const y = Math.random() * s;
      const len = 20 + Math.random() * 120;
      const a = (Math.random() - 0.5) * 0.45;
      ctx.strokeStyle = Math.random() > 0.52 ? 'rgba(255,255,255,.028)' : 'rgba(0,0,0,.090)';
      ctx.lineWidth = 0.8 + Math.random() * 2.3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + Math.cos(a) * len * .35, y + Math.sin(a) * len * .30, x + Math.cos(a) * len * .72, y + Math.sin(a) * len * .55, x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
    }
    for (let i = 0; i < 42; i++) {
      const x = Math.random() * s, y = Math.random() * s;
      const w = 18 + Math.random() * 86, h = 8 + Math.random() * 34;
      ctx.fillStyle = Math.random() > .5 ? 'rgba(10,12,13,.075)' : 'rgba(70,73,72,.055)';
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((Math.random() - .5) * .5);
      ctx.fillRect(-w/2, -h/2, w, h);
      ctx.restore();
    }
  }, 1, 11);
}

function concreteTexture(THREE) {
  return makeCanvasTexture(THREE, 256, (ctx, s) => {
    ctx.fillStyle = '#918b81';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 15000; i++) {
      const v = 115 + Math.random() * 70;
      ctx.fillStyle = `rgba(${v},${v - 3},${v - 12},${0.08 + Math.random() * 0.12})`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 2.5, 1 + Math.random() * 2.5);
    }
    for (let y = 0; y < s; y += 32) {
      ctx.strokeStyle = 'rgba(45,42,38,.14)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y + .5);
      ctx.lineTo(s, y + .5);
      ctx.stroke();
    }
  }, 1, 5);
}

function dirtRoadTexture(THREE) {
  return makeCanvasTexture(THREE, 384, (ctx, s) => {
    ctx.fillStyle = '#7c674b';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 28000; i++) {
      const r = 92 + Math.random() * 70;
      const g = 70 + Math.random() * 50;
      const b = 45 + Math.random() * 32;
      ctx.fillStyle = `rgba(${r},${g},${b},${0.10 + Math.random() * 0.18})`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 4.2, 1 + Math.random() * 4.2);
    }
    for (let i = 0; i < 90; i++) {
      ctx.strokeStyle = Math.random() > .5 ? 'rgba(45,31,18,.16)' : 'rgba(170,143,98,.10)';
      ctx.lineWidth = 1 + Math.random() * 3.4;
      const x = Math.random() * s;
      const y = Math.random() * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + 20, y + Math.random()*28-14, x + 70, y + Math.random()*36-18, x + 130, y + Math.random()*40-20);
      ctx.stroke();
    }
  }, 1, 10);
}

function ballastTexture(THREE) {
  return makeCanvasTexture(THREE, 384, (ctx, s) => {
    ctx.fillStyle = '#343230';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 36000; i++) {
      const v = 40 + Math.random() * 95;
      const w = 1 + Math.random() * 4.5;
      const h = 1 + Math.random() * 4.5;
      ctx.fillStyle = Math.random() > 0.55
        ? `rgba(${v + 24},${v + 20},${v + 14},.38)`
        : `rgba(${v},${v},${v},.38)`;
      ctx.fillRect(Math.random() * s, Math.random() * s, w, h);
    }
    for (let i = 0; i < 120; i++) {
      ctx.strokeStyle = 'rgba(10,9,8,.18)';
      ctx.lineWidth = .6 + Math.random() * 1.8;
      const x = Math.random() * s, y = Math.random() * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.random() * 60 - 30, y + Math.random() * 30 - 15);
      ctx.stroke();
    }
  }, 1, 9);
}

export function makeMaterialSet(THREE) {
  const asphalt = asphaltTexture(THREE);
  const concrete = concreteTexture(THREE);
  const dirtRoad = dirtRoadTexture(THREE);
  const ballast = ballastTexture(THREE);
  return {
    road: new THREE.MeshStandardMaterial({ map: asphalt, color: 0xb0b5b0, roughness: 0.992, metalness: 0.002, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    dirtRoad: new THREE.MeshStandardMaterial({ map: dirtRoad, color: 0x9c8058, roughness: 0.998, metalness: 0.0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    roadWear: new THREE.MeshBasicMaterial({ color: 0x090c0d, transparent: true, opacity: 0.145, depthWrite: false, side: THREE.DoubleSide }),
    dirtRut: new THREE.MeshBasicMaterial({ color: 0x2f241a, transparent: true, opacity: 0.20, depthWrite: false, side: THREE.DoubleSide }),
    roadPatch: new THREE.MeshBasicMaterial({ color: 0x101313, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide }),
    roadBase: new THREE.MeshStandardMaterial({ color: 0x202628, roughness: 0.998, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    roadEdge: new THREE.MeshStandardMaterial({ color: 0x22292b, roughness: 0.99, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1.5, polygonOffsetUnits: -1.5 }),
    roadGutter: new THREE.MeshBasicMaterial({ color: 0x07090a, transparent: true, opacity: 0.16, depthWrite: false, depthTest: true, side: THREE.DoubleSide }),
    curb: new THREE.MeshStandardMaterial({ color: 0x91887c, roughness: 0.985, metalness: 0.0 }),
    roadMedian: new THREE.MeshStandardMaterial({ color: 0x4d653e, roughness: 0.995, metalness: 0.0, flatShading: true }),
    roadMedianCurb: new THREE.MeshStandardMaterial({ color: 0x8f887d, roughness: 0.985, metalness: 0.0 }),
    bridgeConcrete: new THREE.MeshStandardMaterial({ map: concrete, color: 0x8f887d, roughness: 0.965, metalness: 0.0 }),
    bridgeBarrier: new THREE.MeshStandardMaterial({ color: 0x9f978c, roughness: 0.95, metalness: 0.005 }),
    bridgeShadow: new THREE.MeshBasicMaterial({ color: 0x050607, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
    tunnelPortal: new THREE.MeshStandardMaterial({ color: 0x2b2a28, roughness: 0.98, metalness: 0.0 }),
    tunnelGhost: new THREE.MeshBasicMaterial({ color: 0x61c7ff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
    laneWhite: new THREE.MeshBasicMaterial({ color: 0xd8d3c5, transparent: true, opacity: 0.66, depthWrite: false, depthTest: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -12, polygonOffsetUnits: -12 }),
    laneEdgeWhite: new THREE.MeshBasicMaterial({ color: 0xc6c0b2, transparent: true, opacity: 0.24, depthWrite: false, depthTest: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -11, polygonOffsetUnits: -11 }),
    laneYellow: new THREE.MeshBasicMaterial({ color: 0xd5a334, transparent: true, opacity: 0.82, depthWrite: false, depthTest: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -13, polygonOffsetUnits: -13 }),
    crosswalk: new THREE.MeshBasicMaterial({ color: 0xf0eadc, transparent: true, opacity: 0.66, depthWrite: false, depthTest: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -14, polygonOffsetUnits: -14 }),
    stopLine: new THREE.MeshBasicMaterial({ color: 0xf2eadc, transparent: true, opacity: 0.78, depthWrite: false, depthTest: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -14, polygonOffsetUnits: -14 }),
    arrow: new THREE.MeshBasicMaterial({ color: 0xded8c8, transparent: true, opacity: 0.52, depthWrite: false, depthTest: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -15, polygonOffsetUnits: -15 }),
    busLane: new THREE.MeshBasicMaterial({ color: 0xad2d2c, transparent: true, opacity: 0.46, depthWrite: false, side: THREE.DoubleSide }),
    emergencyLane: new THREE.MeshBasicMaterial({ color: 0xd84a3a, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide }),
    serviceLane: new THREE.MeshBasicMaterial({ color: 0x7a6b93, transparent: true, opacity: 0.34, depthWrite: false, side: THREE.DoubleSide }),
    mixedLane: new THREE.MeshBasicMaterial({ color: 0x3e7f88, transparent: true, opacity: 0.34, depthWrite: false, side: THREE.DoubleSide }),
    bikeLane: new THREE.MeshBasicMaterial({ color: 0x4a9f5c, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide }),
    parkingLane: new THREE.MeshBasicMaterial({ color: 0x5d6264, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide }),
    sidewalk: new THREE.MeshStandardMaterial({ map: concrete, color: 0x928a7f, roughness: 0.992, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -0.8, polygonOffsetUnits: -0.8 }),
    sidewalkJoint: new THREE.MeshBasicMaterial({ color: 0x3f3a34, transparent: true, opacity: 0.13, depthWrite: false, depthTest: true, side: THREE.DoubleSide }),
    zoneResidential: new THREE.MeshBasicMaterial({ color: 0x3f9c58, transparent: true, opacity: 0.125, side: THREE.DoubleSide, depthWrite: false }),
    zoneCommercial: new THREE.MeshBasicMaterial({ color: 0x3d7fc7, transparent: true, opacity: 0.125, side: THREE.DoubleSide, depthWrite: false }),
    zoneIndustrial: new THREE.MeshBasicMaterial({ color: 0xb88635, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false }),
    zoneInvalid: new THREE.MeshBasicMaterial({ color: 0xff5858, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
    node: new THREE.MeshStandardMaterial({ color: 0xf2c66a, roughness: 0.8, emissive: 0x221500, emissiveIntensity: 0.12 }),
    preview: new THREE.MeshBasicMaterial({ color: 0x8fd36b, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }),
    demolish: new THREE.MeshBasicMaterial({ color: 0xff5d5d, transparent: true, opacity: 0.48, side: THREE.DoubleSide, depthWrite: false }),
    upgradeHighlight: new THREE.MeshBasicMaterial({ color: 0x8fd36b, transparent: true, opacity: 0.34, side: THREE.DoubleSide, depthWrite: false }),
    railBed: new THREE.MeshStandardMaterial({ map: ballast, color: 0xb8b0a4, roughness: 0.99, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    railSleeper: new THREE.MeshStandardMaterial({ color: 0x241d17, roughness: 0.94, metalness: 0.0, side: THREE.DoubleSide }),
    railMetal: new THREE.MeshStandardMaterial({ color: 0xaeb4b5, roughness: 0.36, metalness: 0.52, side: THREE.DoubleSide }),
    railRust: new THREE.MeshStandardMaterial({ color: 0x6d4b35, roughness: 0.72, metalness: 0.10, side: THREE.DoubleSide }),
    transitStopPole: new THREE.MeshStandardMaterial({ color: 0x2c3235, roughness: 0.82, metalness: 0.12 }),
    transitStopSign: new THREE.MeshStandardMaterial({ color: 0x2d73d8, roughness: 0.68, emissive: 0x06152b, emissiveIntensity: 0.12 }),
    transitShelter: new THREE.MeshStandardMaterial({ color: 0x4b5457, roughness: 0.72, metalness: 0.08, transparent: true, opacity: 0.86 }),
    transitLine: new THREE.MeshBasicMaterial({ color: 0x2d73d8, transparent: true, opacity: 0.44, side: THREE.DoubleSide, depthWrite: false }),
    transitDraft: new THREE.MeshBasicMaterial({ color: 0x8fd36b, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false }),
    transitCoverage: new THREE.MeshBasicMaterial({ color: 0x2d73d8, transparent: true, opacity: 0.075, side: THREE.DoubleSide, depthWrite: false }),
    busBody: new THREE.MeshStandardMaterial({ color: 0xe6e4dc, roughness: 0.78, metalness: 0.015 }),
    busStripe: new THREE.MeshStandardMaterial({ color: 0x2368bd, roughness: 0.76 }),
    carBody: new THREE.MeshStandardMaterial({ color: 0xc04038, roughness: 0.75 }),
    trainBody: new THREE.MeshStandardMaterial({ color: 0xbfc6c9, roughness: 0.68, metalness: 0.07 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x152633, roughness: 0.36, metalness: 0.06, transparent: true, opacity: 0.68 })
  };
}
