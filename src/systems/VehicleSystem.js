import { clamp, dist2D, pointAlongPolyline, polylineLength, safeDisposeObject } from '../utils/MathUtils.js';
import { GAME_BALANCE } from '../utils/GameBalance.js';
import { m, UNITS_PER_METER } from '../utils/Scale.js';

export class VehicleSystem {
  constructor({ game, roadSystem, railSystem, materials }) {
    this.game = game;
    this.roads = roadSystem;
    this.rails = railSystem;
    this.THREE = game.mapCore.THREE;
    this.materials = materials;
    this.group = game.groups.vehicles;
    this.instances = [];
    this.routePool = [];
    this.busRoutePool = [];
    this.pedRoutePool = [];
    this.segmentLoads = new Map();
    this.spawnTimer = 0;
    this.telemetryTimer = 0;
    this.maxVehicles = 180;
  }

  rebuild() {
    safeDisposeObject(this.group);
    this.group.clear();
    this.instances = [];
    this.routePool = [];
    this.busRoutePool = [];
    this.pedRoutePool = [];
    this.segmentLoads = new Map();
    this.rebuildRoutePools();
    this.spawnAmbientTraffic({ initial: true });
    this.spawnTransitVehicles();
    this.spawnTrains();
    this.updateTelemetry();
  }

  rebuildRoutePools() {
    const buildings = this.game.state.buildings || [];
    const homes = buildings.filter(b => (b.residents || 0) > 0);
    const jobs = buildings.filter(b => (b.jobs || 0) > 0);
    const maxPairs = Math.min(42, homes.length * Math.max(1, jobs.length));
    const pairs = [];

    if (homes.length && jobs.length) {
      for (let i = 0; i < maxPairs; i++) {
        const home = homes[(i * 7) % homes.length];
        const job = jobs[(i * 11 + 3) % jobs.length];
        if (!home || !job || dist2D(home, job) < m(45)) continue;
        pairs.push([home, job]);
        if (i % 3 === 0) pairs.push([job, home]);
      }
    }

    for (const [a, b] of pairs) {
      const route = this.roads.findVehicleRouteBetweenPoints(a, b, 'car');
      if (route?.length > m(45)) this.routePool.push({ ...route, purpose: a.zone === 'residential' ? 'commute' : 'return' });
      if (this.routePool.length >= 52) break;
    }

    if (!this.routePool.length && this.testTrafficEnabled()) {
      const paths = this.roads.getAllRoadPaths().filter(path => this.canVehicleUsePath(path, 'car'));
      for (const p of paths.slice(0, 36)) {
        const forward = this.makeVehiclePathFromRoadPath(p, false, 'car');
        if (forward) this.routePool.push(forward);
        // mão dupla precisa gerar fluxo nos dois sentidos; antes o fallback só andava de A→B.
        const reverse = (p.segment?.direction || 'twoWay') !== 'oneWay' ? this.makeVehiclePathFromRoadPath(p, true, 'car') : null;
        if (reverse) this.routePool.push(reverse);
      }
    }

    this.busRoutePool = this.buildBusRoutes();
    this.pedRoutePool = this.buildPedestrianRoutes();
  }

  buildPedestrianRoutes() {
    const paths = this.roads.getAllRoadPaths().filter(p => p.segment?.zoneable !== false && (p.segment?.elevation || 0) === 0 && p.segment?.kind !== 'dirt' && p.length > m(45));
    const routes = [];
    for (const p of paths.slice(0, 24)) {
      const forward = this.makeVehiclePathFromRoadPath(p, false, 'ped');
      const reverse = this.makeVehiclePathFromRoadPath(p, true, 'ped');
      if (forward) routes.push(forward);
      if (reverse) routes.push(reverse);
    }
    return routes;
  }

  spawnPedestrians() {
    if (!this.pedRoutePool.length) return;
    const target = Math.min(48, Math.max(10, Math.round(this.game.state.buildings.length * 1.15)));
    for (let i = 0; i < target; i++) {
      const route = this.pedRoutePool[i % this.pedRoutePool.length];
      if (!route) continue;
      this.addVehicle({ type: 'ped', path: route, speed: 1.0 + Math.random() * 0.45, distance: (route.length / target) * i, looping: true });
    }
  }

  buildBusRoutes() {
    const routes = [];
    const buildings = this.game.state.buildings || [];
    const homes = buildings.filter(b => (b.residents || 0) > 0);
    const destinations = buildings.filter(b => (b.jobs || 0) > 0);
    if (homes.length && destinations.length) {
      const anchors = [
        [homes[0], destinations[destinations.length - 1]],
        [homes[Math.floor(homes.length / 2)], destinations[Math.floor(destinations.length / 2)]],
        [homes[homes.length - 1], destinations[0]]
      ];
      for (const [a, b] of anchors) {
        const route = this.roads.findVehicleRouteBetweenPoints(a, b, 'bus');
        const back = this.roads.findVehicleRouteBetweenPoints(b, a, 'bus');
        const loop = this.mergeRoutes(route, back);
        if (loop?.length > m(80)) routes.push(loop);
      }
    }
    if (!routes.length && this.testTrafficEnabled()) {
      const paths = this.roads.getAllRoadPaths().filter(p => p.length > m(60) && this.canVehicleUsePath(p, 'bus'));
      const base = paths.sort((a, b) => b.length - a.length)[0];
      if (base) {
        const forward = this.makeVehiclePathFromRoadPath(base, false, 'bus');
        const reverse = (base.segment?.direction || 'twoWay') !== 'oneWay' ? this.makeVehiclePathFromRoadPath(base, true, 'bus') : null;
        const route = reverse ? this.mergeRoutes(forward, reverse) : forward;
        if (route) routes.push(route);
      }
    }
    return routes.slice(0, 3);
  }

  mergeRoutes(a, b) {
    if (!a && !b) return null;
    if (!a) return b;
    if (!b) return a;
    const samples = [...a.samples, ...b.samples.slice(1)];
    const segmentIds = [...(a.segmentIds || []), ...(b.segmentIds || [])];
    const length = polylineLength(samples);
    const segmentBreaks = [...(a.segmentBreaks || [])];
    const offset = a.length || polylineLength(a.samples);
    for (const br of b.segmentBreaks || []) segmentBreaks.push({ ...br, startDistance: br.startDistance + offset, endDistance: br.endDistance + offset });
    return { samples, length, segmentIds, segmentBreaks, segment: a.segment, vehicleType: a.vehicleType || b.vehicleType || 'bus' };
  }

  spawnAmbientTraffic({ initial = false } = {}) {
    if (!this.routePool.length) return;
    const sim = this.game.state.simulation;
    const population = sim.population || 0;
    const jobs = sim.jobs || 0;
    const cityDemand = Math.floor((population + jobs) / 7);
    const sandboxTraffic = this.testTrafficEnabled() ? this.game.state.networks.roads.length * 2 : 0;
    const minTraffic = this.testTrafficEnabled() ? 8 : 0;
    const baseTarget = Math.min(this.maxVehicles, Math.max(minTraffic, cityDemand + sandboxTraffic));
    const target = initial ? Math.min(baseTarget, 70) : baseTarget;
    let guard = 0;
    while (this.countType('car') < target && guard++ < 18) this.spawnSingleTrip('car');
  }

  spawnSingleTrip(type = 'car') {
    if (!this.routePool.length) return false;
    const route = this.routePool[Math.floor(Math.random() * this.routePool.length)];
    if (!route) return false;
    const speed = this.pickVehicleSpeed(type, route);
    this.addVehicle({ type, path: route, speed, distance: Math.random() * Math.min(20, route.length * 0.25), looping: false });
    return true;
  }

  spawnTransitVehicles() {
    const plans = this.game.systems.transit?.getBusVehiclePlan?.() || [];
    if (!plans.length && this.busRoutePool.length && this.testTrafficEnabled()) {
      if (!this.game.state.transitLines.some(l => l.mode === 'bus')) {
        this.game.state.transitLines.push({ id: 'auto-bus-line-1', name: 'Linha Azul', mode: 'bus', color: '#2d73d8', fare: GAME_BALANCE.fare.bus, vehicles: 2, auto: true, stopIds: [] });
      }
      const fallbackLine = this.game.state.transitLines.find(l => l.mode === 'bus');
      const route = this.busRoutePool[0];
      if (fallbackLine && route) {
        for (let i = 0; i < (fallbackLine.vehicles || 2); i++) this.addVehicle({ type: 'bus', lineId: fallbackLine.id, path: route, speed: 10.5, distance: (route.length / (fallbackLine.vehicles || 2)) * i, looping: true });
      }
      return;
    }
    for (const plan of plans) {
      const route = plan.route;
      const line = plan.line;
      if (!route?.length) continue;
      for (let i = 0; i < plan.vehicles; i++) {
        this.addVehicle({ type: 'bus', lineId: line.id, path: route, speed: 10.5, distance: (route.length / plan.vehicles) * i, looping: true });
      }
    }
  }

  spawnTrains() {
    const plans = this.rails.getRailVehiclePlan?.() || [];
    if (!plans.length && this.testTrafficEnabled()) {
      const railPaths = this.rails.getAllRailPaths().filter(p => p.length > 90);
      if (!railPaths.length) return;
      const route = this.composeRailRoute(railPaths);
      if (!route) return;
      this.addVehicle({ type: 'train', path: route, speed: 18.5, distance: 0, lineId: 'debug-rail-free-run', looping: true });
      return;
    }
    for (const plan of plans) {
      const route = plan.route;
      const line = plan.line;
      if (!route?.length) continue;
      const vehicles = Math.max(1, Math.min(6, plan.vehicles || line.vehicles || 1));
      for (let i = 0; i < vehicles; i++) {
        this.addVehicle({ type: 'train', path: route, speed: 20.5, distance: (route.length / vehicles) * i, lineId: line.id, looping: true });
      }
    }
  }

  canVehicleUsePath(path, type = 'car') {
    const allowed = this.roads.getAllowedVehicles(path?.segment || {});
    return allowed.includes(type) || (allowed.includes('service') && type === 'bus');
  }

  makeVehiclePathFromRoadPath(path, reversed = false, vehicleType = 'car') {
    if (!path?.samples?.length || !path.segment) return null;
    const samples = (reversed ? [...path.samples].reverse() : path.samples).map(p => ({
      ...p,
      segmentId: path.segment.id,
      roadSegment: path.segment
    }));
    const length = polylineLength(samples);
    return {
      ...path,
      samples,
      length,
      segmentIds: [path.segment.id],
      segmentBreaks: [{
        segmentId: path.segment.id,
        from: reversed ? path.segment.b : path.segment.a,
        to: reversed ? path.segment.a : path.segment.b,
        startDistance: 0,
        endDistance: length,
        segment: path.segment
      }],
      vehicleType
    };
  }

  composeRoadRoute(paths, vehicleType = 'car') {
    if (!paths.length) return null;
    const selected = paths.slice(0, Math.min(8, paths.length));
    const samples = [];
    const segmentIds = [];
    const segmentBreaks = [];
    let distance = 0;
    for (const p of selected) {
      const stamped = p.samples.map(s => ({ ...s, segmentId: p.segment.id, roadSegment: p.segment }));
      if (samples.length) stamped.shift();
      samples.push(...stamped);
      segmentIds.push(p.segment.id);
      segmentBreaks.push({ segmentId: p.segment.id, startDistance: distance, endDistance: distance + p.length, segment: p.segment });
      distance += p.length;
    }
    const length = polylineLength(samples);
    return { samples, length, segmentIds, segmentBreaks, segment: selected[0].segment, vehicleType };
  }

  composeRailRoute(paths) {
    const samples = [];
    for (const p of paths.slice(0, Math.min(5, paths.length))) samples.push(...(samples.length ? p.samples.slice(1) : p.samples));
    return { samples, length: polylineLength(samples), segment: paths[0]?.segment };
  }

  addVehicle({ type, path, speed, distance = 0, lineId = null, looping = true }) {
    if (!path?.samples?.length || path.length <= 0) return;
    if (this.instances.length >= this.maxVehicles + 12 && (type === 'car' || type === 'service')) return;
    const mesh = this.createMesh(type, { lineId, path });
    this.group.add(mesh);
    const capacity = this.getVehicleCapacity(type, lineId);
    this.instances.push({
      type, mesh, path, baseSpeed: speed, speed, distance, lineId, looping,
      phase: Math.random() * 1000,
      laneIndex: 0,
      desiredLaneIndex: 0,
      lateralCurrent: 0,
      lateralTarget: 0,
      lateralJitter: (Math.random() - 0.5) * m(0.22),
      lastSegmentId: null, stoppedTime: 0, stopControlId: null, stopTimer: 0, stopPassedAt: {},
      capacitySeated: capacity.seated,
      capacityStanding: capacity.standing,
      passengersOnBoard: type === 'car' ? 1 + Math.floor(Math.random() * 3) : 0,
      maintenanceLevel: 100,
      fuelLevel: 100,
      headlightsOn: this.isNight(),
      gyroflexActive: type === 'emergency',
      isChangingLane: false,
      sidewalkSide: Math.random() > 0.5 ? 1 : -1,
      wetness: 0
    });
  }

  getVehicleCapacity(type, lineId = null) {
    if (type === 'bus') return GAME_BALANCE.vehicleCapacities.busStandard;
    if (type === 'train') {
      const line = this.game.state.transitLines?.find(l => l.id === lineId);
      const cars = this.getRailCarsPerTrain(line);
      return {
        seated: GAME_BALANCE.vehicleCapacities.railCar.seated * cars,
        standing: GAME_BALANCE.vehicleCapacities.railCar.standing * cars
      };
    }
    if (type === 'emergency') return { seated: 2, standing: 0 };
    return { seated: 4, standing: 0 };
  }

  getRailCarsPerTrain(line = null) {
    const mode = line?.railMode || line?.submode || line?.vehicleModel || 'train';
    if (mode === 'vlt') return 4;
    if (mode === 'metro') return 6;
    return 12;
  }

  isNight() {
    const hour = this.game.state.simulation?.hour ?? 12;
    return hour >= 19 || hour < 5;
  }

  isSandboxMode() {
    return (this.game.state.settings?.gameMode || 'sandbox') === 'sandbox';
  }

  testTrafficEnabled() {
    const settings = this.game.state.settings || {};
    return this.isSandboxMode() && settings.testTrafficEnabled !== false;
  }

  removeVehicle(v) {
    this.group.remove(v.mesh);
    safeDisposeObject(v.mesh);
    const idx = this.instances.indexOf(v);
    if (idx >= 0) this.instances.splice(idx, 1);
  }

  spawnEmergencyResponses() {
    const active = this.game.state.events?.active || [];
    if (!active.length) return;
    const existing = new Set(this.instances.filter(v => v.type === 'emergency').map(v => v.lineId));
    const origins = (this.game.state.buildings || []).filter(b => b.zone === 'commercial' || b.zone === 'industrial');
    const fallbackNode = this.game.state.networks.roadNodes?.[0];
    for (const event of active.slice(0, 4)) {
      const key = `evt:${event.id}`;
      if (existing.has(key)) continue;
      const origin = origins[(event.id?.length || 0) % Math.max(1, origins.length)] || fallbackNode;
      if (!origin) continue;
      const route = this.roads.findVehicleRouteBetweenPoints(origin, event, 'emergency') || this.routePool[0];
      if (route?.length) this.addVehicle({ type: 'emergency', lineId: key, path: route, speed: 16.5, looping: false });
    }
  }

  createMesh(type, options = {}) {
    const group = new this.THREE.Group();
    const wheelMat = new this.THREE.MeshStandardMaterial({ color: 0x121416, roughness: 0.92, flatShading: true });
    const lightMat = new this.THREE.MeshBasicMaterial({ color: 0xe8dfb7, transparent: true, opacity: 0.72 });
    const tailMat = new this.THREE.MeshBasicMaterial({ color: 0x9b2422, transparent: true, opacity: 0.68 });
    const addWheel = (x, z, r = 0.42, w = 0.34) => {
      const wheel = new this.THREE.Mesh(new this.THREE.CylinderGeometry(r, r, w, 10), wheelMat);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(x, 0.62, z);
      group.add(wheel);
      return wheel;
    };
    const addLights = (frontX, rearX, z = 1.12, y = 1.38) => {
      const hg = new this.THREE.BoxGeometry(0.10, 0.22, 0.34);
      const tg = new this.THREE.BoxGeometry(0.10, 0.22, 0.30);
      for (const side of [-1, 1]) {
        const h = new this.THREE.Mesh(hg, lightMat); h.position.set(frontX, y, side * z); group.add(h);
        const t = new this.THREE.Mesh(tg, tailMat); t.position.set(rearX, y, side * z); group.add(t);
      }
    };
    if (type === 'bus') {
      const body = new this.THREE.Mesh(new this.THREE.BoxGeometry(12, 3.05, 4.05), this.materials.busBody);
      body.position.y = 2.05;
      const stripe = new this.THREE.Mesh(new this.THREE.BoxGeometry(12.15, 0.42, 4.16), this.materials.busStripe);
      stripe.position.y = 2.05;
      const front = new this.THREE.Mesh(new this.THREE.BoxGeometry(0.85, 1.75, 3.72), this.materials.glass);
      front.position.set(5.95, 2.68, 0);
      const sideGlass = new this.THREE.Mesh(new this.THREE.BoxGeometry(8.2, 0.92, 4.18), this.materials.glass);
      sideGlass.position.set(-0.8, 3.05, 0);
      group.add(body, stripe, front, sideGlass);
      for (const x of [-4.4, 4.1]) for (const z of [-2.18, 2.18]) addWheel(x, z, 0.56, 0.42);
      addLights(6.08, -6.08, 1.62, 1.65);
    } else if (type === 'train') {
      const line = this.game.state.transitLines?.find(l => l.id === options.lineId);
      const cars = this.getRailCarsPerTrain(line);
      const trainCars = [];
      for (let i = 0; i < cars; i++) {
        const car = new this.THREE.Group();
        car.position.x = (i - 1) * -m(19.6);
        car.userData.trainCarIndex = i;
        const body = new this.THREE.Mesh(new this.THREE.BoxGeometry(m(18.2), m(3.8), m(3.82)), this.materials.trainBody);
        body.position.y = m(2.7);
        const win = new this.THREE.Mesh(new this.THREE.BoxGeometry(m(14.6), m(0.76), m(4.02)), this.materials.glass);
        win.position.y = m(3.28);
        const stripe = new this.THREE.Mesh(new this.THREE.BoxGeometry(m(18.45), m(0.30), m(4.04)), this.materials.busStripe || this.materials.trainBody);
        stripe.position.y = m(2.02);
        car.add(body, win, stripe);
        trainCars.push(car);
        group.add(car);
      }
      const couplers = [];
      for (let i = 0; i < cars - 1; i++) {
        const c = new this.THREE.Mesh(new this.THREE.BoxGeometry(1, m(0.34), m(0.72)), this.materials.railMetal || this.materials.trainBody);
        c.userData.trainCouplerIndex = i;
        c.visible = false;
        couplers.push(c);
        group.add(c);
      }
      group.userData.trainCars = trainCars;
      group.userData.trainCouplers = couplers;
      group.userData.articulatedTrain = true;
    } else if (type === 'emergency') {
      const emergencyMat = new this.THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.78, metalness: 0.02, flatShading: true });
      const redMat = new this.THREE.MeshBasicMaterial({ color: 0xd12d2d });
      const blueMat = new this.THREE.MeshBasicMaterial({ color: 0x2368d8 });
      const body = new this.THREE.Mesh(new this.THREE.BoxGeometry(5.0, 1.65, 2.35), emergencyMat);
      body.position.y = 1.18;
      const cabin = new this.THREE.Mesh(new this.THREE.BoxGeometry(2.0, 0.95, 2.05), this.materials.glass);
      cabin.position.set(0.25, 1.90, 0);
      const stripeA = new this.THREE.Mesh(new this.THREE.BoxGeometry(5.08, 0.28, 0.08), redMat);
      stripeA.position.set(0, 1.38, 1.21);
      const stripeB = stripeA.clone(); stripeB.position.z = -1.21;
      const giroA = new this.THREE.Mesh(new this.THREE.BoxGeometry(0.52, 0.22, 0.36), redMat);
      giroA.position.set(0.15, 2.52, 0.25);
      const giroB = new this.THREE.Mesh(new this.THREE.BoxGeometry(0.52, 0.22, 0.36), blueMat);
      giroB.position.set(0.15, 2.52, -0.25);
      group.add(body, cabin, stripeA, stripeB, giroA, giroB);
      for (const x of [-1.65, 1.65]) for (const z of [-1.12, 1.12]) addWheel(x, z, 0.36, 0.26);
      addLights(2.55, -2.55, 0.82, 1.25);
    } else if (type === 'service') {
      const body = new this.THREE.Mesh(new this.THREE.BoxGeometry(6.2, 2.1, 2.85), this.materials.serviceLane);
      body.position.y = 1.5;
      const cab = new this.THREE.Mesh(new this.THREE.BoxGeometry(2.35, 1.18, 2.55), this.materials.glass);
      cab.position.set(1.35, 2.48, 0);
      group.add(body, cab);
      for (const x of [-2.1, 2.0]) for (const z of [-1.5, 1.5]) addWheel(x, z, 0.42, 0.30);
      addLights(3.15, -3.15, 1.05, 1.22);
    } else if (type === 'ped') {
      const shirtColors = [0x5278a5, 0xa55d52, 0x548365, 0xd0b460, 0x8a6cad, 0x7c7c7c];
      const pantsColors = [0x2b2c32, 0x465a70, 0x5a5047, 0x4b5d48];
      const shirt = new this.THREE.MeshStandardMaterial({ color: shirtColors[Math.floor(Math.random() * shirtColors.length)], roughness: 0.92, flatShading: true });
      const pants = new this.THREE.MeshStandardMaterial({ color: pantsColors[Math.floor(Math.random() * pantsColors.length)], roughness: 0.94, flatShading: true });
      const skin = new this.THREE.MeshStandardMaterial({ color: [0xe0b58c, 0xc78d65, 0x8f613f][Math.floor(Math.random() * 3)], roughness: 0.92, flatShading: true });
      const torso = new this.THREE.Mesh(new this.THREE.BoxGeometry(0.45, 0.7, 0.28), shirt);
      torso.position.y = 1.15;
      const legs = new this.THREE.Mesh(new this.THREE.BoxGeometry(0.34, 0.72, 0.24), pants);
      legs.position.y = 0.45;
      const head = new this.THREE.Mesh(new this.THREE.BoxGeometry(0.28, 0.28, 0.28), skin);
      head.position.y = 1.68;
      group.add(legs, torso, head);
      group.userData.pedestrian = true;
    } else {
      const colors = [0x8f332f, 0x2d5786, 0xbeb9ad, 0x2d3034, 0x4d7650, 0xaa7832, 0x6e6258, 0x777f84];
      const mat = new this.THREE.MeshStandardMaterial({ color: colors[Math.floor(Math.random() * colors.length)], roughness: 0.82, metalness: 0.01, flatShading: true });
      const isPickup = Math.random() > 0.74;
      const body = new this.THREE.Mesh(new this.THREE.BoxGeometry(isPickup ? 5.35 : 4.35, 1.45, isPickup ? 2.55 : 2.34), mat);
      body.position.y = 1.18;
      const cabin = new this.THREE.Mesh(new this.THREE.BoxGeometry(2.05, 0.95, 2.02), this.materials.glass);
      cabin.position.set(isPickup ? 0.72 : 0.18, 2.02, 0);
      const hood = new this.THREE.Mesh(new this.THREE.BoxGeometry(1.34, 0.50, isPickup ? 2.46 : 2.22), mat);
      hood.position.set(1.55, 1.73, 0);
      group.add(body, cabin, hood);
      for (const x of [-1.62, 1.62]) for (const z of [-1.28, 1.28]) addWheel(x, z, 0.36, 0.26);
      addLights(isPickup ? 2.74 : 2.28, isPickup ? -2.74 : -2.28, 0.82, 1.27);
    }
    group.scale.setScalar(group.userData.articulatedTrain ? 1 : m(1));
    group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return group;
  }

  update(dt) {
    if (this.game.state.mode !== 'city' || this.game.state.simulation.paused) return;
    const speedScale = this.game.state.simulation.speed || 1;
    this.updateVisualState();
    this.spawnTimer += dt * speedScale;
    this.telemetryTimer += dt;

    if (this.spawnTimer >= 1.25) {
      this.spawnTimer = 0;
      this.spawnAmbientTraffic({ initial: false });
      if (this.countType('service') < Math.min(6, Math.floor(this.game.state.buildings.length / 14))) {
        const route = this.routePool[Math.floor(Math.random() * this.routePool.length)];
        if (route) this.addVehicle({ type: 'service', path: route, speed: 8.5 + Math.random() * 4, looping: false });
      }
      this.spawnEmergencyResponses();
    }

    const nextLoads = new Map();
    const toRemove = [];
    let speedSum = 0;
    let moving = 0;

    // Controle de tráfego (semáforo/pare/preferencial) — poucos nós, custo baixo.
    const traffic = this.game.systems.traffic;
    const ctrlNodes = traffic ? traffic.controlledNodesWorld() : [];
    const simTime = traffic ? traffic.simTime : 0;

    for (const v of this.instances) {
      if (!v.path?.length) continue;
      const current = this.getPointAlongRoute(v.path, v.distance);
      const segment = current?.segment || v.path.segment;
      const load = segment ? (this.segmentLoads.get(segment.id) || 0) : 0;
      const capacity = this.getSegmentCapacity(segment, v.type);
      const congestionFactor = clamp(1 - Math.max(0, load - capacity * 0.55) / Math.max(8, capacity * 1.8), 0.22, 1);
      const speedLimit = segment ? Math.max(20, Number(segment.speedKmh) || 50) / 3.6 : v.baseSpeed;
      const typeFactor = v.type === 'bus' ? 0.78 : v.type === 'train' ? 1.0 : v.type === 'service' ? 0.72 : v.type === 'emergency' ? 1.02 : 0.92;
      const eventFactor = this.game.systems.events?.segmentSpeedFactor?.(segment?.id) ?? 1;
      v.speed = Math.min(v.baseSpeed, speedLimit * typeFactor) * congestionFactor * eventFactor;

      // aplica controle de cruzamento se houver nó controlado à frente (carros/ônibus/serviço)
      if (v.type !== 'train' && ctrlNodes.length && current) {
        const ctrl = this.nearestApproachingControl(current, ctrlNodes);
        if (ctrl) {
          const res = traffic.redForHeading(ctrl.id, current.heading, simTime, segment);
          if (res.stopSign) {
            const last = v.stopPassedAt?.[ctrl.id] || -999;
            if (ctrl.dist < m(14) && v.stopControlId !== ctrl.id && simTime - last > 12) {
              v.stopControlId = ctrl.id;
              v.stopTimer = Math.max(v.stopTimer || 0, 0.75);
            }
            if (v.stopControlId === ctrl.id) {
              v.speed = 0;
              v.stopTimer -= dt * speedScale;
              if (v.stopTimer <= 0) {
                v.stopPassedAt[ctrl.id] = simTime;
                v.stopControlId = null;
              }
            } else if (ctrl.dist < m(22)) {
              v.speed *= 0.32;
            }
          } else if (res.stop && ctrl.dist < m(13)) v.speed = 0;
          else if (res.stop && ctrl.dist < m(24)) v.speed *= 0.12;
          else if (res.slow < 1 && ctrl.dist < m(20)) v.speed *= res.slow;
        }
      }

      // Conectores faixa-a-faixa: antes do nó, o veículo mira a faixa permitida do próximo segmento.
      // Se a conversão estiver bloqueada no TMPE, o veículo freia na aproximação e a rota nova já evita o giro.
      const transition = v.type !== 'train' && v.type !== 'ped' && traffic ? this.getUpcomingRouteTransition(v.path, v.distance) : null;
      if (transition?.nextSegment) {
        const targetLane = traffic.getConnectorTargetLane?.(transition.nodeId, transition.prevSegment, transition.nextSegment, v.desiredLaneIndex ?? 0, v.type);
        if (Number.isFinite(targetLane) && transition.distanceToNode < m(95)) v.desiredLaneIndex = targetLane;
        const allowedTurn = traffic.isTransitionAllowed?.(transition.nodeId, transition.prevSegment, transition.nextSegment, v.type, v.desiredLaneIndex ?? 0);
        if (!allowedTurn && transition.distanceToNode < m(24)) v.speed *= 0.04;
        else if (!allowedTurn && transition.distanceToNode < m(48)) v.speed *= 0.20;
      }

      if (v.type !== 'train' && v.type !== 'ped') v.speed *= this.getFollowingSpeedFactor(v, current, segment);

      v.distance += v.speed * UNITS_PER_METER * dt * speedScale * (GAME_BALANCE.vehicleMotionScale || 1);

      if (v.distance >= v.path.length) {
        if (v.looping) v.distance %= v.path.length;
        else { toRemove.push(v); continue; }
      }

      const p = this.getPointAlongRoute(v.path, v.distance);
      if (!p) continue;
      const activeSegment = p.segment || segment;
      const previousSegmentId = v.lastSegmentId;
      const nowSegmentId = p.segmentId || activeSegment?.id || null;
      if (v.type !== 'train' && activeSegment && previousSegmentId !== nowSegmentId) {
        v.desiredLaneIndex = this.pickLaneIndexForVehicle(v.type, activeSegment, p);
      }
      if (v.type === 'train') {
        this.updateTrainConsist(v);
        if (v.lastSegmentId) nextLoads.set(v.lastSegmentId, (nextLoads.get(v.lastSegmentId) || 0) + this.getVehicleLoadWeight(v.type));
        speedSum += v.speed * 3.6;
        moving++;
        continue;
      }

      if (v.type === 'ped') {
        const pedOffset = this.getPedestrianLateral(activeSegment, v);
        const nx = -Math.sin(p.heading), nz = Math.cos(p.heading);
        const worldX = p.x + nx * pedOffset;
        const worldZ = p.z + nz * pedOffset;
        const worldY = this.mapY(worldX, worldZ);
        v.mesh.position.set(worldX, worldY + m(0.02), worldZ);
        v.mesh.rotation.order = 'YXZ';
        v.mesh.rotation.set(0, -p.heading, 0);
        v.lastSegmentId = nowSegmentId;
        speedSum += v.speed * 3.6;
        moving++;
        continue;
      }

      const targetLateral = this.getVehicleLateral(v.type, activeSegment, v);
      v.lateralTarget = targetLateral;
      v.lateralCurrent += (targetLateral - (v.lateralCurrent || 0)) * Math.min(1, dt * speedScale * 3.2);
      const lateral = v.lateralCurrent;
      const nx = -Math.sin(p.heading), nz = Math.cos(p.heading);
      const worldX = p.x + nx * lateral;
      const worldZ = p.z + nz * lateral;
      const worldY = this.sampleVehicleRoadY(worldX, worldZ, activeSegment, p);
      const pitch = this.sampleRoutePitch(v.path, v.distance, v.looping);
      v.mesh.position.set(worldX, worldY + m(0.82), worldZ);
      v.mesh.rotation.order = 'YXZ';
      v.mesh.rotation.set(pitch, -p.heading, 0);
      v.lastSegmentId = nowSegmentId;
      if (v.lastSegmentId) nextLoads.set(v.lastSegmentId, (nextLoads.get(v.lastSegmentId) || 0) + this.getVehicleLoadWeight(v.type));
      speedSum += v.speed * 3.6;
      moving++;
    }

    for (const v of toRemove) this.removeVehicle(v);
    this.segmentLoads = nextLoads;

    if (this.telemetryTimer >= 0.75) {
      this.telemetryTimer = 0;
      this.updateTelemetry(speedSum, moving);
    }
  }

  getFollowingSpeedFactor(v, current, segment) {
    if (!current || !segment || !v.path) return 1;
    let bestGap = Infinity;
    const lane = v.desiredLaneIndex ?? v.laneIndex ?? 0;
    for (const other of this.instances) {
      if (other === v || other.type === 'train' || other.type === 'ped') continue;
      if (other.path !== v.path) continue;
      const otherLane = other.desiredLaneIndex ?? other.laneIndex ?? 0;
      if (Math.abs(otherLane - lane) > 0.5) continue;
      let gap = other.distance - v.distance;
      if (v.looping && gap < 0) gap += v.path.length;
      if (gap <= 0 || gap > m(30)) continue;
      bestGap = Math.min(bestGap, gap);
    }
    if (bestGap < m(6)) return 0;
    if (bestGap < m(12)) return 0.24;
    if (bestGap < m(22)) return 0.62;
    return 1;
  }

  getUpcomingRouteTransition(path, distance) {
    if (!path?.segmentBreaks?.length) return null;
    let activeIndex = -1;
    for (let i = 0; i < path.segmentBreaks.length; i++) {
      const br = path.segmentBreaks[i];
      if (distance >= br.startDistance && distance <= br.endDistance + 0.001) { activeIndex = i; break; }
    }
    if (activeIndex < 0) return null;
    const current = path.segmentBreaks[activeIndex];
    const next = path.segmentBreaks[activeIndex + 1];
    if (!current || !next || !current.to) return null;
    const distanceToNode = Math.max(0, current.endDistance - distance);
    return {
      nodeId: current.to,
      prevSegment: current.segment,
      nextSegment: next.segment,
      distanceToNode
    };
  }

  // Nó controlado mais próximo que o veículo está se aproximando (dentro de ~26u).
  nearestApproachingControl(current, ctrlNodes) {
    const dirX = Math.cos(current.heading), dirZ = Math.sin(current.heading);
    let best = null;
    for (const n of ctrlNodes) {
      const dx = n.x - current.x, dz = n.z - current.z;
      const dy = Number.isFinite(n.y) && Number.isFinite(current.y) ? Math.abs(n.y - current.y) : 0;
      if (dy > m(5.5)) continue; // evita semáforo de superfície afetar elevado/túnel sobreposto
      const dist = Math.hypot(dx, dz);
      if (dist > m(26) || dist < 0.001) continue;
      const dot = (dx / dist) * dirX + (dz / dist) * dirZ;
      if (dot < 0.25) continue; // só conta se o nó está à frente
      if (!best || dist < best.dist) best = { id: n.id, dist, type: n.type };
    }
    return best;
  }

  getPointAlongRoute(path, distance) {
    const point = pointAlongPolyline(path.samples, distance);
    if (!point) return null;
    let active = null;
    for (const br of path.segmentBreaks || []) {
      if (distance >= br.startDistance && distance <= br.endDistance + 0.001) { active = br; break; }
    }
    if (!active && path.segmentBreaks?.length) active = path.segmentBreaks[path.segmentBreaks.length - 1];
    return { ...point, segmentId: active?.segmentId || path.segment?.id || null, segment: active?.segment || path.segment || null };
  }

  sampleVehicleRoadY(x, z, segment = null, fallbackPoint = null) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return fallbackPoint?.y || 0;
    const level = Number.isFinite(segment?.elevation) ? segment.elevation : 0;
    const bridgeH = this.roads?.bridgeLevelHeight || 10;
    const groundY = this.game.map.getHeightAt(x, z) + 0.42 + level * bridgeH;
    if (!fallbackPoint || !Number.isFinite(fallbackPoint.y)) return groundY;
    return groundY * 0.25 + fallbackPoint.y * 0.75;
  }

  sampleRoutePitch(path, distance, looping = false, probe = 6.5) {
    if (!path?.samples?.length) return 0;
    const a = this.getPointAlongRoute(path, this.normalizeRouteDistance(path, distance - probe, looping));
    const b = this.getPointAlongRoute(path, this.normalizeRouteDistance(path, distance + probe, looping));
    if (!a || !b) return 0;
    const horiz = Math.max(0.001, Math.hypot(b.x - a.x, b.z - a.z));
    return clamp(Math.atan2(b.y - a.y, horiz), -0.24, 0.24);
  }

  getSegmentCapacity(segment, type = 'car') {
    if (!segment) return 8;
    const lanes = Math.max(1, segment.lanes || 1);
    const cls = this.roads.getPrimaryLaneClass?.(segment) || this.roads.normalizeLaneClass(segment.laneClass || 'general');
    let cap = lanes * 6.5;
    if (cls === 'parking') cap *= 0.70;
    if (cls === 'bus' && type !== 'bus') cap *= 0.38;
    if (cls === 'mixed') cap *= 1.08;
    if ((segment.direction || 'twoWay') === 'oneWay') cap *= 1.12;
    return cap;
  }

  getVehicleLoadWeight(type) {
    if (type === 'bus') return 2.4;
    if (type === 'train') return 0;
    if (type === 'service') return 1.4;
    if (type === 'emergency') return 1.1;
    return 1;
  }

  pickVehicleSpeed(type, route) {
    const seg = route?.segment;
    const limit = seg ? Math.max(30, Number(seg.speedKmh) || 50) / 3.6 : 12;
    if (type === 'bus') return limit * 0.72;
    if (type === 'service') return limit * 0.68;
    if (type === 'emergency') return limit * 0.95;
    return limit * (0.74 + Math.random() * 0.22);
  }


  pickLaneIndexForVehicle(type, segment, point = null) {
    if (!segment) return 0;
    const lanes = Math.max(1, Math.min(5, segment.lanes || 1));
    const cls = this.roads.getPrimaryLaneClass?.(segment) || this.roads.normalizeLaneClass(segment.laneClass || 'general');
    if (lanes <= 1 || segment.kind === 'dirt') return 0;
    const laneClasses = Array.from({ length: lanes }, (_, i) => this.roads.getLaneClassForLane?.(segment, i) || cls);
    if (type === 'bus') {
      const idx = laneClasses.findIndex(c => c === 'bus' || c === 'mixed');
      if (idx >= 0) return idx;
    }
    if (type === 'service') {
      const idx = laneClasses.findIndex(c => c === 'service' || c === 'emergency');
      if (idx >= 0) return idx;
    }
    if (type === 'emergency') {
      const idx = laneClasses.findIndex(c => c === 'emergency' || c === 'service' || c === 'mixed');
      if (idx >= 0) return idx;
    }
    if (cls === 'parking') return Math.max(0, lanes - 2);
    const phase = Math.abs(Math.sin(((point?.x || 0) * 0.013) + ((point?.z || 0) * 0.017) + (segment.id || '').length));
    return Math.max(0, Math.min(lanes - 1, Math.floor(phase * lanes)));
  }

  getVehicleLateral(type, segmentOrClass = 'general', vehicle = null) {
    const segment = typeof segmentOrClass === 'object' ? segmentOrClass : null;
    const laneClass = this.roads.normalizeLaneClass(segment?.laneClass || segmentOrClass || 'general');
    if (!segment) return 0;

    const width = this.roads.getSegmentWidth(segment);
    const layout = this.roads.getLaneLayout(segment, width);
    const lane = Math.max(0, Math.min(layout.lanes - 1, vehicle?.desiredLaneIndex ?? vehicle?.laneIndex ?? 0));
    const jitter = vehicle?.lateralJitter || 0;

    // Convenção v2.3.2: caminho já vem orientado no sentido real de viagem.
    // Em via mão dupla, offset positivo sempre representa o lado direito relativo ao heading do veículo.
    // Antes alternava por seno/random e jogava carros na contramão/faixa oposta.
    if (layout.direction === 'oneWay') {
      let laneIndex = lane;
      if (type === 'bus' && (laneClass === 'bus' || laneClass === 'mixed')) laneIndex = 0;
      if (type === 'service' && laneClass === 'service') laneIndex = 0;
      return (layout.forwardCenters?.[laneIndex] ?? layout.forwardCenters?.[0] ?? 0) + jitter;
    }

    let laneFromCenter = lane;
    if (type === 'bus' || laneClass === 'bus' || laneClass === 'mixed' || laneClass === 'parking') laneFromCenter = layout.lanes - 1;
    if (type === 'service' && laneClass === 'service') laneFromCenter = Math.min(layout.lanes - 1, 0);
    return (layout.forwardCenters?.[laneFromCenter] ?? layout.forwardCenters?.[0] ?? 0) + jitter;
  }

  normalizeRouteDistance(path, distance, looping = false) {
    const length = Math.max(1, path?.length || 1);
    if (looping) return ((distance % length) + length) % length;
    return clamp(distance, 0, length);
  }

  updateTrainConsist(v) {
    const cars = v.mesh.userData.trainCars || v.mesh.children.filter(c => Number.isFinite(c.userData?.trainCarIndex));
    if (!cars.length) return false;
    const couplers = v.mesh.userData.trainCouplers || [];
    const spacing = m(19.6);
    const carProbe = m(7.2);
    v.mesh.position.set(0, 0, 0);
    v.mesh.rotation.set(0, 0, 0);
    let leadPoint = null;
    const centers = [];
    for (let i = 0; i < cars.length; i++) {
      const centerD = this.normalizeRouteDistance(v.path, v.distance - i * spacing, v.looping);
      const p = this.getPointAlongRoute(v.path, centerD);
      const front = this.getPointAlongRoute(v.path, this.normalizeRouteDistance(v.path, centerD + carProbe, v.looping));
      const rear = this.getPointAlongRoute(v.path, this.normalizeRouteDistance(v.path, centerD - carProbe, v.looping));
      if (!p) continue;
      if (i === 0) leadPoint = p;
      const heading = front && rear ? Math.atan2(front.z - rear.z, front.x - rear.x) : p.heading;
      const pitch = front && rear ? clamp(Math.atan2(front.y - rear.y, Math.max(0.001, Math.hypot(front.x - rear.x, front.z - rear.z))), -0.18, 0.18) : 0;
      const car = cars[i];
      car.visible = true;
      car.position.set(p.x, p.y + m(0.46), p.z);
      car.rotation.order = 'YXZ';
      car.rotation.set(pitch, -heading, 0);
      centers[i] = { x: p.x, y: p.y + m(0.55), z: p.z, heading, pitch };
    }
    for (let i = 0; i < couplers.length; i++) {
      const a = centers[i];
      const b = centers[i + 1];
      const c = couplers[i];
      if (!a || !b || !c) continue;
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.max(m(1.8), Math.hypot(dx, dz) - m(14.8));
      c.visible = true;
      c.position.set((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5);
      const couplerPitch = clamp(Math.atan2(b.y - a.y, Math.max(0.001, Math.hypot(dx, dz))), -0.18, 0.18);
      c.rotation.order = 'YXZ';
      c.rotation.set(couplerPitch, -Math.atan2(dz, dx), 0);
      c.scale.set(len, 1, 1);
    }
    if (leadPoint) v.lastSegmentId = leadPoint.segmentId || leadPoint.segment?.id || v.lastSegmentId;
    return true;
  }

  getPedestrianLateral(segment, v) {
    const width = segment ? this.roads.getSegmentWidth(segment) : m(16);
    const sidewalk = Math.max(m(2.8), this.roads.sidewalkWidth || m(3.5));
    return (width * 0.5 + sidewalk * 0.58) * (v.sidewalkSide || 1);
  }

  mapY(x, z) {
    return this.game.map.getHeightAt(x, z) + m(0.18);
  }

  updateVisualState() {
    const weather = this.game.mapCore.getWeatherState?.() || { rain: 0 };
    const rain = Math.max(0, Math.min(1, weather.rain || 0));
    const night = this.isNight();
    for (const v of this.instances) {
      v.wetness = rain;
      v.mesh.traverse(obj => {
        if (!obj.isMesh || !obj.material) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of mats) {
          if (mat.userData?.baseRoughness == null && typeof mat.roughness === 'number') mat.userData.baseRoughness = mat.roughness;
          if (mat.userData?.baseMetalness == null && typeof mat.metalness === 'number') mat.userData.baseMetalness = mat.metalness;
          if (typeof mat.roughness === 'number') mat.roughness = Math.max(0.18, (mat.userData.baseRoughness || 0.8) - rain * 0.18);
          if (typeof mat.metalness === 'number') mat.metalness = Math.min(0.24, (mat.userData.baseMetalness || 0.02) + rain * 0.06);
          if (mat.emissiveIntensity != null && (v.type === 'car' || v.type === 'service' || v.type === 'bus' || v.type === 'emergency')) mat.emissiveIntensity = night ? Math.max(mat.emissiveIntensity || 0, 0.12) : Math.min(mat.emissiveIntensity || 0.08, 0.10);
          mat.needsUpdate = true;
        }
      });
    }
  }

  updateTelemetry(speedSum = null, moving = null) {
    const sim = this.game.state.simulation;
    const roadVehicles = this.instances.filter(v => v.type !== 'train' && v.type !== 'ped');
    let weightedCongestion = 0;
    let segmentsWithLoad = 0;
    for (const [segmentId, load] of this.segmentLoads.entries()) {
      const seg = this.game.state.networks.roads.find(s => s.id === segmentId);
      if (!seg) continue;
      weightedCongestion += clamp((load / Math.max(1, this.getSegmentCapacity(seg))) * 100, 0, 160);
      segmentsWithLoad++;
    }
    const congestion = segmentsWithLoad ? Math.round(Math.min(100, weightedCongestion / segmentsWithLoad)) : 0;
    sim.trafficVehicles = roadVehicles.length;
    sim.activeBuses = this.countType('bus');
    sim.activeTrains = this.countType('train');
    sim.activeEvents = this.game.state.events?.active?.length || 0;
    sim.growthEvents = sim.activeEvents;
    sim.avgTrafficSpeed = moving ? Math.round(speedSum / Math.max(1, moving)) : Math.round(sim.avgTrafficSpeed || 0);
    sim.vehicleCongestion = congestion;
    const structural = Math.min(100, Math.round(((sim.population || 0) / Math.max(1, this.game.state.networks.roads.length * 120)) * 100));
    sim.congestion = Math.max(structural, congestion);
    this.game.state.vehicles = this.instances.map(v => ({ type: v.type, lineId: v.lineId, segmentId: v.lastSegmentId }));
  }

  countType(type) {
    return this.instances.filter(v => v.type === type).length;
  }
}
