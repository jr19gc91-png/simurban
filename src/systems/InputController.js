import { m } from '../utils/Scale.js';

export class InputController {
  constructor({ game }) {
    this.game = game;
    this.THREE = game.mapCore.THREE;
    this.raycaster = new this.THREE.Raycaster();
    this.pointer = new this.THREE.Vector2();
    this.dragStart = null;
    this.lastZonePaint = null;
    this.lastTerrainPaint = null;
    this.pointerDownHandledBuild = false;
    this.enabled = true;
    this.bind();
  }

  bind() {
    const canvas = this.game.mapCore.renderer.domElement;
    const capture = { capture: true };
    canvas.addEventListener('contextmenu', (event) => {
      if (['road', 'rail'].includes(this.game.state.selectedTool)) event.preventDefault();
    });
    canvas.addEventListener('pointerdown', (event) => this.onPointerDown(event), capture);
    canvas.addEventListener('pointermove', (event) => this.onPointerMove(event), capture);
    canvas.addEventListener('pointerup', (event) => this.onPointerUp(event), capture);
    canvas.addEventListener('pointercancel', () => this.onPointerCancel(), capture);
    canvas.addEventListener('dblclick', (event) => this.onDoubleClick(event), capture);
    window.addEventListener('keydown', (event) => this.onKeyDown(event));
  }

  onPointerDown(event) {
    if (!this.shouldHandle(event)) return;
    const tool = this.game.state.selectedTool;

    // Ferramentas lineares no padrão clássico: clique esquerdo cria o próximo nó;
    // clique direito conclui/cancela o traçado atual e limpa o nó pendente, como no jogo antigo.
    if ((tool === 'road' || tool === 'rail') && (event.button === 0 || event.button === 2)) {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget?.setPointerCapture?.(event.pointerId);
      event.stopImmediatePropagation?.();
      this.pointerDownHandledBuild = true;
      this.dragStart = null;
      const point = this.pickTerrainPoint(event);
      const system = tool === 'road' ? this.game.systems.roads : this.game.systems.rails;
      if (event.button === 2) {
        system.resetInteraction?.();
        this.game.state.inspector.text = tool === 'road' ? 'Construção de via concluída.' : 'Construção de trilho concluída.';
        this.game.emitChange?.();
        return;
      }
      if (point) system.handleClick(point);
      return;
    }

    event.preventDefault();
    event.currentTarget?.setPointerCapture?.(event.pointerId);
    this.dragStart = { x: event.clientX, y: event.clientY, button: event.button };
    this.lastZonePaint = null;
    this.lastTerrainPaint = null;
    if (tool === 'zone') {
      const point = this.pickTerrainPoint(event);
      if (point) this.paintZone(point);
    } else if (tool === 'terrain') {
      const point = this.pickTerrainPoint(event);
      if (point) this.game.handleTerrainBrush(point);
    }
  }

  onPointerUp(event) {
    if (this.pointerDownHandledBuild) {
      this.pointerDownHandledBuild = false;
      this.lastZonePaint = null;
      this.lastTerrainPaint = null;
      return;
    }
    if (event && this.dragStart && this.dragStart.button === 0) {
      this.handlePrimaryPointerUp(event);
      event.currentTarget?.releasePointerCapture?.(event.pointerId);
    }
    this.lastZonePaint = null;
    this.lastTerrainPaint = null;
  }

  onPointerCancel() {
    this.dragStart = null;
    this.lastZonePaint = null;
  }

  onDoubleClick(event) {
    if (!this.shouldHandle(event)) return;
    const tool = this.game.state.selectedTool;
    if (tool !== 'road' && tool !== 'rail') return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    const system = tool === 'road' ? this.game.systems.roads : this.game.systems.rails;
    system.resetInteraction?.();
    this.game.emitChange?.();
  }

  onPointerMove(event) {
    if (!this.shouldHandle(event, true)) return;
    const point = this.pickTerrainPoint(event);
    if (!point) return;
    const tool = this.game.state.selectedTool;
    if (tool === 'road') {
      this.game.systems.roads.clearHighlight();
      this.game.systems.roads.handlePointerMove(point);
    }
    else if (tool === 'rail' || tool === 'rail-station' || tool === 'rail-line') {
      this.game.systems.roads.clearHighlight();
      this.game.systems.rails.handlePointerMove(point);
    }
    else if (tool === 'bus-stop' || tool === 'bus-line') {
      this.game.systems.roads.clearHighlight();
      this.game.systems.transit.handlePointerMove(point);
    }
    else if (tool === 'zone' && this.dragStart && (event.buttons & 1)) {
      this.game.systems.roads.clearHighlight();
      this.paintZone(point);
    }
    else if (tool === 'terrain' && this.dragStart && (event.buttons & 1)) {
      this.game.systems.roads.clearHighlight();
      if (!this.lastTerrainPaint || Math.hypot(point.x - this.lastTerrainPaint.x, point.z - this.lastTerrainPaint.z) > 18) {
        this.game.handleTerrainBrush(point);
        this.lastTerrainPaint = { x: point.x, z: point.z };
      }
    }
    else if (tool === 'upgrade') {
      this.game.systems.roads.clearPreview();
      this.game.systems.roads.drawSegmentHighlight(point, 'upgrade');
    }
    else if (tool === 'demolish') {
      this.game.systems.roads.clearPreview();
      this.game.systems.roads.drawSegmentHighlight(point, 'demolish');
    }
    else {
      this.game.systems.roads.clearPreview();
      this.game.systems.roads.clearHighlight();
    }
  }

  onKeyDown(event) {
    if (this.isTypingTarget(event)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.game.setTool(null);
      this.game.systems.roads.resetInteraction();
      this.game.systems.rails.resetInteraction();
      this.game.systems.transit.clearPreview?.();
      return;
    }
    if (event.code === 'Space') {
      event.preventDefault();
      this.game.togglePause();
      return;
    }
    const toolHotkeys = {
      Digit2: 'road',
      Digit4: 'rail',
      Digit5: 'transport',
      Digit6: 'zone',
      Digit7: 'terrain',
      Digit8: 'demolish',
      Digit9: 'tmpe',
      Digit0: 'inspect'
    };
    if (this.game.state.mode === 'city' && toolHotkeys[event.code]) {
      event.preventDefault();
      this.game.setTool(this.game.state.selectedTool === toolHotkeys[event.code] ? null : toolHotkeys[event.code]);
      return;
    }
    const speedMap = { Digit1: 1, Digit2: 3, Digit3: 5 };
    if (speedMap[event.code]) this.game.setSpeed(speedMap[event.code]);
    if (event.code === 'Enter' && this.game.state.selectedTool === 'bus-line') {
      event.preventDefault();
      this.game.systems.transit.finishDraftLine({ loop: true });
    }
    if (event.code === 'Enter' && this.game.state.selectedTool === 'rail-line') {
      event.preventDefault();
      this.game.systems.rails.finishDraftLine({ loop: true });
    }
    if ((event.code === 'PageUp' || event.code === 'PageDown') && ['road', 'rail'].includes(this.game.state.selectedTool)) {
      event.preventDefault();
      const delta = event.code === 'PageUp' ? 1 : -1;
      const tool = this.game.state.selectedTool;
      if (tool === 'rail') {
        const current = this.game.state.buildOptions?.railElevation || 0;
        const railElevation = Math.max(-5, Math.min(5, current + delta));
        this.game.setRailOptions({ railElevation });
        this.game.state.inspector.text = `Nível do trilho: ${railElevation} (PageUp/PageDown)`;
      } else {
        const current = this.game.state.buildOptions?.roadElevation || 0;
        const roadElevation = Math.max(-5, Math.min(5, current + delta));
        this.game.setRoadOptions({ roadElevation });
        this.game.state.inspector.text = `Nível da via: ${roadElevation} (PageUp/PageDown)`;
      }
      this.game.emitChange?.();
    }
  }

  handlePrimaryPointerUp(event) {
    if (!this.shouldHandle(event)) return;
    if (this.dragStart && Math.hypot(event.clientX - this.dragStart.x, event.clientY - this.dragStart.y) > 7) { this.dragStart = null; return; }
    const point = this.pickTerrainPoint(event);
    if (!point) return;
    const tool = this.game.state.selectedTool;
    if (tool === 'road') this.game.systems.roads.handleClick(point);
    else if (tool === 'rail') this.game.systems.rails.handleClick(point);
    else if (tool === 'rail-station') this.game.systems.rails.handleStationClick(point);
    else if (tool === 'rail-line') this.game.systems.rails.handleLineClick(point);
    else if (tool === 'zone') this.game.systems.zoning.handleClick(point, this.game.state.selectedZoneType, this.game.state.buildOptions?.zoneSide || 'both');
    else if (tool === 'terrain') this.game.handleTerrainBrush(point);
    else if (tool === 'bus-stop') this.game.systems.transit.handleStopClick(point);
    else if (tool === 'bus-line') this.game.systems.transit.handleLineClick(point);
    else if (tool === 'upgrade') this.game.systems.roads.handleUpgrade(point);
    else if (tool === 'demolish') {
      if (this.game.systems.roads.handleDemolish(point)) return;
      if (this.game.systems.rails.handleDemolish(point)) return;
      this.game.systems.zoning.clearZoneAt(point);
    }
    else if (tool === 'inspect') this.game.inspectAt(point);
    else if (tool === 'tmpe') this.game.handleTrafficControlClick(point, this.game.state.tmpeMode || 'signals');
    this.dragStart = null;
  }

  paintZone(point) {
    if (!point) return;
    if (this.lastZonePaint && Math.hypot(point.x - this.lastZonePaint.x, point.z - this.lastZonePaint.z) < m(30)) return;
    const created = this.game.systems.zoning.paintAt(point, this.game.state.selectedZoneType, this.game.state.buildOptions?.zoneSide || 'both');
    this.lastZonePaint = { x: point.x, z: point.z };
    if (created > 0) {
      const profile = this.game.systems.zoning.getProfile(this.game.state.selectedZoneType);
      this.game.state.simulation.money -= created * profile.cost;
      this.game.state.inspector.text = `Pintura de zona: ${created} lote(s) criados.`;
      this.game.rebuildCitySystems({ zoning: true, buildings: true, vehicles: true });
      this.game.emitChange();
    }
  }

  shouldHandle(event, allowMove = false) {
    if (!this.enabled || this.game.state.mode !== 'city') return false;
    const tool = this.game.state.selectedTool;
    if (!allowMove && event.button !== 0 && !(event.button === 2 && ['road', 'rail'].includes(tool))) return false;
    // Topbar, dashboard esquerdo, bottombar e submenus compactos são UI. Todo o resto do canvas
    // é terreno de construção, como no modo antigo.
    if (event.target.closest?.('#topbar,#ui,#bottombar,#toast,#tnInfoDock,#tnInfoPanel,.panel,.tool-panel,.tn-shortcuts-modal,.tn-shortcuts-btn')) return false;
    return true;
  }

  isTypingTarget(event) {
    const tag = (event.target?.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || event.target?.isContentEditable;
  }

  pickTerrainPoint(event) {
    const rect = this.game.mapCore.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    this.raycaster.setFromCamera(this.pointer, this.game.map.camera);

    // v2.3.17.2: não usar mais o plano y=0. Em terreno com morros, isso deslocava o ponto
    // clicado e o segundo clique parecia falhar. Intersectamos a superfície procedural
    // por bisseção ao longo do raio, ignorando árvores/rochas/previews/estradas.
    let hit = this.intersectProceduralTerrain();
    if (!hit) hit = this.intersectFallbackPlane();
    if (!hit) return null;
    const half = this.game.map.getHalfWorldSize();
    const x = Math.max(-half, Math.min(half, hit.x));
    const z = Math.max(-half, Math.min(half, hit.z));
    const y = this.game.map.getHeightAt(x, z);
    return { x, y, z };
  }

  intersectFallbackPlane() {
    const plane = new this.THREE.Plane(new this.THREE.Vector3(0, 1, 0), 0);
    const out = new this.THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, out) ? out : null;
  }

  intersectProceduralTerrain() {
    const ray = this.raycaster.ray;
    const half = this.game.map.getHalfWorldSize();
    const maxT = Math.max(2500, this.game.map.getWorldSize?.() || half * 2);
    const evalAt = (t) => {
      const p = ray.at(t, new this.THREE.Vector3());
      const clampedX = Math.max(-half, Math.min(half, p.x));
      const clampedZ = Math.max(-half, Math.min(half, p.z));
      return { p, d: p.y - this.game.map.getHeightAt(clampedX, clampedZ) };
    };

    let prevT = 1;
    let prev = evalAt(prevT);
    const steps = 96;
    for (let i = 1; i <= steps; i++) {
      const t = 1 + (maxT - 1) * (i / steps);
      const cur = evalAt(t);
      if ((prev.d >= 0 && cur.d <= 0) || (prev.d <= 0 && cur.d >= 0)) {
        let lo = prevT, hi = t;
        for (let j = 0; j < 18; j++) {
          const mid = (lo + hi) * 0.5;
          const m = evalAt(mid);
          if ((prev.d >= 0 && m.d >= 0) || (prev.d <= 0 && m.d <= 0)) lo = mid;
          else hi = mid;
        }
        return ray.at((lo + hi) * 0.5, new this.THREE.Vector3());
      }
      prevT = t;
      prev = cur;
    }

    // Fallback: plano y=0 só se a bisseção não encontrar terreno.
    const plane = new this.THREE.Plane(new this.THREE.Vector3(0, 1, 0), 0);
    const fallback = new this.THREE.Vector3();
    return ray.intersectPlane(plane, fallback) ? fallback : null;
  }
}
