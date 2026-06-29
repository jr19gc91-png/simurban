import { clamp, dist2D, makeId, polylineLength, safeDisposeObject } from '../utils/MathUtils.js';
import { GAME_BALANCE, normalCapacity, maxCapacity, comfortPenaltyFromOccupancy, comfortScoreFromOccupancy } from '../utils/GameBalance.js';
import { m, meters } from '../utils/Scale.js';

export class TransitSystem {
  constructor({ game, roadSystem, materials }) {
    this.game = game;
    this.roads = roadSystem;
    this.map = game.map;
    this.THREE = game.mapCore.THREE;
    this.materials = materials;
    this.group = game.groups.transit;
    this.previewGroup = game.groups.construction;
    this.preview = null;
    this.lineRoutes = new Map();
    this.stopSnapRadius = m(32);
    this.coverageRadius = m(850);
  }

  rebuild() {
    this.cleanupInvalidTransit();
    this.render();
    this.updateMetrics();
  }

  cleanupInvalidTransit() {
    const roadIds = new Set(this.game.state.networks.roads.map(s => s.id));
    this.game.state.transitStops = (this.game.state.transitStops || []).filter(stop => roadIds.has(stop.roadId));
    const stopIds = new Set(this.game.state.transitStops.map(stop => stop.id));
    for (const line of this.game.state.transitLines || []) {
      if (line.mode !== 'bus') continue;
      line.stopIds = (line.stopIds || []).filter(id => stopIds.has(id));
    }
    this.game.state.transitLines = (this.game.state.transitLines || []).filter(line => line.mode !== 'bus' || (line.stopIds || []).length >= 2);
    if (!this.game.state.transitDraft) this.game.state.transitDraft = { mode: 'bus', stopIds: [] };
    this.game.state.transitDraft.stopIds = (this.game.state.transitDraft.stopIds || []).filter(id => stopIds.has(id));
    this.lineRoutes.clear();
  }

  handleStopClick(point) {
    const created = this.createStop(point, { charge: true });
    if (!created) {
      this.game.state.inspector.text = 'Parada bloqueada: clique perto de uma via térrea válida.';
      this.game.emitChange();
      return false;
    }
    this.game.state.inspector.text = `Parada criada: ${created.name}.`;
    this.rebuild();
    this.game.rebuildCitySystems({ vehicles: true, noSimRecalc: false });
    this.game.emitChange();
    return true;
  }

  handleLineClick(point) {
    let stop = this.findNearestStop(point, 34);
    if (!stop) stop = this.createStop(point, { charge: true, quiet: true });
    if (!stop) {
      this.game.state.inspector.text = 'Linha: clique em uma parada ou perto de uma via para criar parada.';
      this.game.emitChange();
      return false;
    }
    const draft = this.ensureDraft();
    const ids = draft.stopIds;
    if (ids.length >= 2 && stop.id === ids[0]) {
      this.finishDraftLine({ loop: true });
      return true;
    }
    if (ids[ids.length - 1] !== stop.id) ids.push(stop.id);
    this.game.state.inspector.text = `Linha em edição: ${ids.length} parada(s). Clique na primeira parada para fechar ou use “Concluir linha”.`;
    this.render();
    this.game.emitChange();
    return true;
  }

  finishDraftLine({ loop = false } = {}) {
    const draft = this.ensureDraft();
    const ids = [...new Set(draft.stopIds || [])];
    if (ids.length < 2) {
      this.game.state.inspector.text = 'Linha precisa de pelo menos 2 paradas.';
      this.game.emitChange();
      return false;
    }
    const line = this.createLineFromStops(ids, { loop, auto: false });
    draft.stopIds = [];
    if (!line) {
      this.game.state.inspector.text = 'Não consegui montar rota de ônibus entre essas paradas.';
      this.render();
      this.game.emitChange();
      return false;
    }
    this.game.state.simulation.money -= 1800 + ids.length * 240;
    this.game.state.inspector.text = `${line.name} criada com ${ids.length} paradas.`;
    this.rebuild();
    this.game.rebuildCitySystems({ vehicles: true, noSimRecalc: false });
    this.game.emitChange();
    return true;
  }

  clearDraft() {
    this.ensureDraft().stopIds = [];
    this.clearPreview();
    this.render();
    this.game.emitChange();
  }

  createAutoLine() {
    if ((this.game.state.transitStops || []).length < 2) this.createAutomaticStops();
    const stops = this.orderStopsForLine(this.game.state.transitStops || []);
    if (stops.length < 2) {
      this.game.state.inspector.text = 'Auto linha precisa de vias e/ou construções próximas para criar paradas.';
      this.game.emitChange();
      return false;
    }
    const ids = stops.slice(0, Math.min(8, stops.length)).map(s => s.id);
    const line = this.createLineFromStops(ids, { loop: true, auto: true });
    if (!line) {
      this.game.state.inspector.text = 'Auto linha não encontrou rota compatível para ônibus.';
      this.game.emitChange();
      return false;
    }
    this.game.state.simulation.money -= 2400 + ids.length * 180;
    this.game.state.inspector.text = `${line.name} criada automaticamente com ${ids.length} paradas.`;
    this.rebuild();
    this.game.rebuildCitySystems({ vehicles: true, noSimRecalc: false });
    this.game.emitChange();
    return true;
  }

  createAutomaticStops() {
    const anchors = [];
    const buildings = [...(this.game.state.buildings || [])];
    const homes = buildings.filter(b => (b.residents || 0) > 0);
    const jobs = buildings.filter(b => (b.jobs || 0) > 0);
    for (const b of [homes[0], homes[Math.floor(homes.length / 2)], homes[homes.length - 1], jobs[0], jobs[Math.floor(jobs.length / 2)], jobs[jobs.length - 1]]) {
      if (b && !anchors.some(a => dist2D(a, b) < 130)) anchors.push(b);
    }
    if (anchors.length < 2) {
      for (const path of this.roads.getAllRoadPaths().filter(p => p.length > 90).slice(0, 8)) {
        const mid = path.samples[Math.floor(path.samples.length / 2)];
        if (mid && !anchors.some(a => dist2D(a, mid) < 170)) anchors.push(mid);
      }
    }
    for (const anchor of anchors.slice(0, 8)) this.createStop(anchor, { charge: false, quiet: true });
  }

  createStop(point, { charge = false, quiet = false } = {}) {
    if (!point) return null;
    const hit = this.roads.findNearestSegment(point, this.stopSnapRadius);
    if (!hit || !hit.segment || (hit.segment.elevation || 0) !== 0) return null;
    const allowed = this.roads.getAllowedVehicles(hit.segment);
    if (!allowed.includes('bus')) return null;
    const samples = hit.samples || this.roads.getSegmentSamples(hit.segment);
    const sample = samples[Math.max(0, Math.min(samples.length - 1, hit.index || 0))] || hit;
    const next = samples[Math.max(0, Math.min(samples.length - 1, (hit.index || 0) + 1))] || sample;
    const heading = Math.atan2(next.z - sample.z, next.x - sample.x);
    const width = 10 + (hit.segment.lanes || 2) * 6;
    const side = ((this.game.state.transitStops || []).length % 2 === 0) ? -1 : 1;
    const offset = side * (width / 2 + 5.2);
    const x = hit.x - Math.sin(heading) * offset;
    const z = hit.z + Math.cos(heading) * offset;
    if (this.map.isWaterAt(x, z)) return null;
    const duplicate = (this.game.state.transitStops || []).find(stop => dist2D(stop, { x, z }) < 34);
    if (duplicate) return duplicate;
    const stop = {
      id: makeId('stop'),
      name: `Parada ${(this.game.state.transitStops || []).length + 1}`,
      mode: 'bus',
      x,
      z,
      y: this.map.getHeightAt(x, z),
      roadId: hit.segment.id,
      heading,
      side,
      createdAtDay: this.game.state.simulation.day
    };
    this.game.state.transitStops.push(stop);
    if (charge) this.game.state.simulation.money -= 650;
    if (!quiet) this.game.state.inspector.text = `${stop.name} criada.`;
    return stop;
  }

  createLineFromStops(stopIds, { loop = false, auto = false } = {}) {
    const uniqueIds = stopIds.filter(Boolean);
    if (uniqueIds.length < 2) return null;
    const temp = { id: '__test__', stopIds: uniqueIds, mode: 'bus', loop };
    const route = this.buildRouteForLine(temp);
    if (!route || route.length < 80) return null;
    const index = (this.game.state.transitLines || []).filter(l => l.mode === 'bus').length + 1;
    const line = {
      id: makeId('busline'),
      name: auto ? `Linha Auto ${index}` : `Linha ${index}`,
      mode: 'bus',
      color: this.pickLineColor(index),
      fare: GAME_BALANCE.fare.bus,
      vehicles: clamp(Math.round(route.length / 850), 1, 6),
      vehicleModel: 'busStandard',
      stopIds: uniqueIds,
      loop,
      auto,
      length: Math.round(route.length),
      ridershipHourly: 0,
      occupancy: 0,
      revenueHourly: 0,
      expenseHourly: 0
    };
    this.game.state.transitLines.push(line);
    this.lineRoutes.set(line.id, route);
    this.updateLineMetrics(line);
    return line;
  }

  pickLineColor(index = 1) {
    const colors = ['#2d73d8', '#3fa45a', '#d85c4a', '#d9ad43', '#8b5fd6', '#2f9f9f'];
    return colors[(index - 1) % colors.length];
  }

  orderStopsForLine(stops) {
    const available = [...stops];
    if (available.length <= 2) return available;
    available.sort((a, b) => (a.x + a.z) - (b.x + b.z));
    const ordered = [available.shift()];
    while (available.length) {
      const last = ordered[ordered.length - 1];
      let bestIdx = 0, bestD = Infinity;
      for (let i = 0; i < available.length; i++) {
        const d = dist2D(last, available[i]);
        if (d < bestD) { bestD = d; bestIdx = i; }
      }
      ordered.push(available.splice(bestIdx, 1)[0]);
    }
    return ordered;
  }

  ensureDraft() {
    if (!this.game.state.transitDraft) this.game.state.transitDraft = { mode: 'bus', stopIds: [] };
    if (!Array.isArray(this.game.state.transitDraft.stopIds)) this.game.state.transitDraft.stopIds = [];
    return this.game.state.transitDraft;
  }

  buildRouteForLine(line) {
    if (line.id !== '__test__' && this.lineRoutes.has(line.id)) return this.lineRoutes.get(line.id);
    const stops = (line.stopIds || []).map(id => this.getStop(id)).filter(Boolean);
    if (stops.length < 2) return null;
    const allSamples = [];
    const allSegmentIds = [];
    const allBreaks = [];
    let distance = 0;
    const pairs = [];
    for (let i = 1; i < stops.length; i++) pairs.push([stops[i - 1], stops[i]]);
    if (line.loop && stops.length > 2) pairs.push([stops[stops.length - 1], stops[0]]);
    for (const [a, b] of pairs) {
      const route = this.roads.findVehicleRouteBetweenPoints(a, b, 'bus');
      if (!route?.samples?.length) continue;
      const stamped = route.samples.map(s => ({ ...s, segmentId: s.segmentId, roadSegment: s.roadSegment }));
      if (allSamples.length) stamped.shift();
      allSamples.push(...stamped);
      for (const id of route.segmentIds || []) if (!allSegmentIds.includes(id)) allSegmentIds.push(id);
      for (const br of route.segmentBreaks || []) allBreaks.push({ ...br, startDistance: br.startDistance + distance, endDistance: br.endDistance + distance });
      distance += route.length || polylineLength(route.samples);
    }
    if (allSamples.length < 2) return null;
    const result = { samples: allSamples, length: polylineLength(allSamples), segmentIds: allSegmentIds, segmentBreaks: allBreaks, vehicleType: 'bus', lineId: line.id, stops };
    if (line.id !== '__test__') this.lineRoutes.set(line.id, result);
    return result;
  }

  getStop(id) {
    return (this.game.state.transitStops || []).find(stop => stop.id === id) || null;
  }

  findNearestStop(point, radius = 24) {
    let best = null;
    for (const stop of this.game.state.transitStops || []) {
      const d = dist2D(point, stop);
      if (d <= radius && (!best || d < best.d)) best = { stop, d };
    }
    return best?.stop || null;
  }

  updateMetrics() {
    const sim = this.game.state.simulation;
    this.lineRoutes.clear();
    let totalRidership = 0;
    let totalRevenue = 0;
    let totalExpenses = 0;
    let weightedOccupancy = 0;
    let buses = 0;
    for (const line of this.game.state.transitLines || []) {
      if (line.mode !== 'bus') continue;
      this.updateLineMetrics(line);
      totalRidership += line.ridershipHourly || 0;
      totalRevenue += line.revenueHourly || 0;
      totalExpenses += line.expenseHourly || 0;
      weightedOccupancy += (line.occupancy || 0) * (line.vehicles || 1);
      buses += line.vehicles || 1;
    }
    sim.transitStops = (this.game.state.transitStops || []).length;
    sim.busLines = (this.game.state.transitLines || []).filter(l => l.mode === 'bus').length;
    sim.transitRidership = Math.round(totalRidership);
    sim.passengersPerHour = Math.round(totalRidership);
    sim.busFareRevenueHourly = Math.round(totalRevenue);
    sim.busTransitExpensesHourly = Math.round(totalExpenses);
    sim.fareRevenueHourly = Math.round((sim.busFareRevenueHourly || 0) + (sim.railFareRevenueHourly || 0));
    sim.transitExpensesHourly = Math.round((sim.busTransitExpensesHourly || 0) + (sim.railExpensesHourly || 0));
    sim.transitOccupancy = buses ? Math.round(weightedOccupancy / buses) : 0;
    sim.transitCoverage = this.computeCoveragePercent();
  }

  updateLineMetrics(line) {
    const route = this.buildRouteForLine(line);
    const stops = (line.stopIds || []).map(id => this.getStop(id)).filter(Boolean);
    let coveredPop = 0;
    let coveredJobs = 0;
    const covered = new Set();
    for (const b of this.game.state.buildings || []) {
      for (const stop of stops) {
        if (dist2D(b, stop) <= this.coverageRadius) {
          if (!covered.has(b.id)) {
            covered.add(b.id);
            coveredPop += b.residents || 0;
            coveredJobs += b.jobs || 0;
          }
          break;
        }
      }
    }
    const vehicles = Math.max(1, line.vehicles || 1);
    const lengthKm = meters(route?.length || line.length || 0) / 1000;
    const vehicleCapacity = GAME_BALANCE.vehicleCapacities[line.vehicleModel || 'busStandard'] || GAME_BALANCE.vehicleCapacities.busStandard;
    const normalPerVehicle = normalCapacity(vehicleCapacity);
    const maxPerVehicle = maxCapacity(vehicleCapacity);
    const cycleMinutes = Math.max(8, (lengthKm / 22) * 60 * 2 + stops.length * 0.55);
    const departuresPerHour = Math.max(1, vehicles * 60 / cycleMinutes);
    const capacityHourly = Math.max(1, Math.round(departuresPerHour * normalPerVehicle));
    const maxCapacityHourly = Math.max(capacityHourly, Math.round(departuresPerHour * maxPerVehicle));
    const demand = Math.min(coveredPop, coveredJobs + Math.round(coveredPop * 0.35)) * (0.22 + Math.min(0.36, stops.length * 0.035));
    const service = clamp(departuresPerHour / Math.max(1, lengthKm * 0.9), 0.45, 1.45);
    const rawRidership = Math.round(demand * service);
    const ridership = Math.min(rawRidership, maxCapacityHourly);
    line.length = Math.round(route?.length || 0);
    line.frequencyMin = Math.round(60 / departuresPerHour);
    line.capacitySeated = vehicleCapacity.seated;
    line.capacityStanding = vehicleCapacity.standing;
    line.capacityHourly = capacityHourly;
    line.maxCapacityHourly = maxCapacityHourly;
    line.ridershipHourly = Math.max(0, ridership);
    line.leftBehindHourly = Math.max(0, rawRidership - maxCapacityHourly);
    line.occupancy = capacityHourly ? Math.min(140, Math.round((ridership / capacityHourly) * 100)) : 0;
    line.overcrowded = line.occupancy > 100;
    line.comfortPenalty = Math.round(comfortPenaltyFromOccupancy(line.occupancy) * 100);
    line.qualityScore = comfortScoreFromOccupancy(line.occupancy);
    line.revenueHourly = Math.round(line.ridershipHourly * (line.fare || GAME_BALANCE.fare.bus));
    line.expenseHourly = Math.round(vehicles * (GAME_BALANCE.hourlyOperatingCost.busDriverSalary + GAME_BALANCE.hourlyOperatingCost.busMaintenance) + lengthKm * GAME_BALANCE.hourlyOperatingCost.busFuelPerKm + stops.length * 1.2);
    line.coveredPopulation = coveredPop;
    line.coveredJobs = coveredJobs;
    return line;
  }

  computeCoveragePercent() {
    const buildings = this.game.state.buildings || [];
    if (!buildings.length) return 0;
    let covered = 0;
    for (const b of buildings) {
      if ((this.game.state.transitStops || []).some(stop => dist2D(b, stop) <= this.coverageRadius)) covered++;
    }
    return Math.round((covered / buildings.length) * 100);
  }

  getBusVehiclePlan() {
    this.updateMetrics();
    const plans = [];
    for (const line of this.game.state.transitLines || []) {
      if (line.mode !== 'bus') continue;
      const route = this.buildRouteForLine(line);
      if (route?.length > 50) plans.push({ line, route, vehicles: Math.max(1, Math.min(8, line.vehicles || 1)) });
    }
    return plans;
  }

  render() {
    safeDisposeObject(this.group);
    this.group.clear();
    this.lineRoutes.clear();
    this.renderCoverage();
    for (const line of this.game.state.transitLines || []) if (line.mode === 'bus') this.renderLine(line);
    this.renderDraftLine();
    for (const stop of this.game.state.transitStops || []) this.renderStop(stop);
  }

  renderCoverage() {
    const geo = new this.THREE.CircleGeometry(this.coverageRadius, 36);
    for (const stop of this.game.state.transitStops || []) {
      const mesh = new this.THREE.Mesh(geo, this.materials.transitCoverage);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(stop.x, this.map.getHeightAt(stop.x, stop.z) + m(0.24), stop.z);
      mesh.renderOrder = 2;
      this.group.add(mesh);
    }
  }

  renderLine(line) {
    const route = this.buildRouteForLine(line);
    if (!route?.samples?.length) return;
    const mat = (this.materials.transitLine || this.materials.preview).clone();
    mat.color = new this.THREE.Color(line.color || '#2d73d8');
    mat.opacity = 0.42;
    const ribbon = this.roads.buildOffsetRibbon(route.samples, -Math.max(m(3.8), m(8)), m(1.25), mat, m(0.62));
    ribbon.renderOrder = 24;
    ribbon.userData.transitLineId = line.id;
    this.group.add(ribbon);
  }

  renderDraftLine() {
    const ids = this.ensureDraft().stopIds || [];
    if (ids.length < 2) return;
    const fake = { id: '__draft__', stopIds: ids, mode: 'bus', loop: false };
    const route = this.buildRouteForLine(fake);
    if (!route?.samples?.length) return;
    const ribbon = this.roads.buildOffsetRibbon(route.samples, m(8), m(1.05), this.materials.transitDraft || this.materials.preview, m(0.82));
    ribbon.renderOrder = 28;
    this.group.add(ribbon);
  }

  renderStop(stop) {
    const group = new this.THREE.Group();
    const y = this.map.getHeightAt(stop.x, stop.z);
    group.position.set(stop.x, y, stop.z);
    group.rotation.y = -stop.heading;
    const pole = new this.THREE.Mesh(new this.THREE.CylinderGeometry(m(0.16), m(0.2), m(4.6), 8), this.materials.transitStopPole);
    pole.position.set(0, m(2.3), 0);
    const sign = new this.THREE.Mesh(new this.THREE.BoxGeometry(m(1.7), m(1.15), m(0.18)), this.materials.transitStopSign);
    sign.position.set(0, m(4.65), 0);
    const slab = new this.THREE.Mesh(new this.THREE.BoxGeometry(m(5.2), m(0.22), m(2.4)), this.materials.sidewalk);
    slab.position.set(0, m(0.08), 0);
    const shelterBack = new this.THREE.Mesh(new this.THREE.BoxGeometry(m(4.4), m(2.2), m(0.18)), this.materials.transitShelter);
    shelterBack.position.set(0, m(1.45), m(0.92));
    const roof = new this.THREE.Mesh(new this.THREE.BoxGeometry(m(4.9), m(0.25), m(2.1)), this.materials.transitShelter);
    roof.position.set(0, m(2.75), m(0.15));
    const bench = new this.THREE.Mesh(new this.THREE.BoxGeometry(m(2.8), m(0.32), m(0.55)), this.materials.bridgeConcrete);
    bench.position.set(0, m(0.78), m(0.22));
    group.add(slab, pole, sign, shelterBack, roof, bench);
    group.traverse(obj => { if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = true; } });
    group.userData.transitStopId = stop.id;
    this.group.add(group);
  }

  handlePointerMove(point) {
    this.clearPreview();
    const hit = this.roads.findNearestSegment(point, this.stopSnapRadius);
    if (!hit?.segment || (hit.segment.elevation || 0) !== 0 || !this.roads.getAllowedVehicles(hit.segment).includes('bus')) return;
    const stop = { x: hit.x, z: hit.z, y: this.map.getHeightAt(hit.x, hit.z), heading: 0 };
    const marker = new this.THREE.Mesh(new this.THREE.CircleGeometry(m(7), 24), this.materials.transitDraft || this.materials.preview);
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(stop.x, stop.y + m(0.8), stop.z);
    marker.renderOrder = 32;
    this.preview = marker;
    this.previewGroup.add(marker);
  }

  clearPreview() {
    if (!this.preview) return;
    this.previewGroup.remove(this.preview);
    safeDisposeObject(this.preview);
    this.preview = null;
  }
}
