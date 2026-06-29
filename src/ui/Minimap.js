// Minimap — transplante adaptado do minimapa do jogo antigo para o NewCore.
// Desenha o terreno do GERADOR NOVO (amostrando altura/água do mapa atual) como
// fundo e sobrepõe vias, trilhos, zonas, construções, paradas/estações, linhas e
// veículos lidos do estado real. Clique reposiciona a câmera. Nenhuma luz/sombra
// do jogo antigo é importada — é só um mapa esquemático 2D.

const SIZE = 196;          // px do canvas do minimapa
const TERRAIN_SAMPLES = 96; // resolução da amostragem do terreno

export class Minimap {
  constructor({ gameShell }) {
    this.game = gameShell;
    this.terrainSig = null;
    this.buildDom();
    this.bind();
    this._raf = null;
    this._lastDraw = 0;
    this.game.addEventListener('statechange', () => {
      this.wrap.classList.toggle('hidden', this.game.state.mode !== 'city');
      this.syncToggles();
    });
    this.loop();
  }

  buildDom() {
    const wrap = document.createElement('aside');
    wrap.className = 'tn-minimap hidden';
    wrap.id = 'tnMinimap';
    wrap.innerHTML = `
      <div class="tn-minimap-head"><b>Minimapa</b><span id="tnMinimapMeta">--</span></div>
      <canvas id="tnMinimapCanvas" width="${SIZE}" height="${SIZE}"></canvas>
      <div class="tn-minimap-dock tn-minimap-dock-main">
        <button data-ui-toggle="ui" title="Mostrar/ocultar interface">Interface</button>
        <button data-view-toggle="grid" title="Mostrar/ocultar grade">Grade</button>
        <button data-view-toggle="buildings" title="Mostrar/ocultar construções">Edifícios</button>
        <button data-view-toggle="vehicles" title="Mostrar/ocultar veículos">Veículos</button>
      </div>`;
    document.body.appendChild(wrap);
    this.wrap = wrap;
    this.canvas = wrap.querySelector('#tnMinimapCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.meta = wrap.querySelector('#tnMinimapMeta');
    this.terrainCanvas = document.createElement('canvas');
    this.terrainCanvas.width = SIZE;
    this.terrainCanvas.height = SIZE;
  }

  bind() {
    this.canvas.addEventListener('click', (e) => this.onClick(e));
    this.wrap.querySelectorAll('[data-view-toggle]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.game.toggleViewLayer?.(btn.dataset.viewToggle);
        this.syncToggles();
      });
    });
    this.wrap.querySelectorAll('[data-ui-toggle]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.setInterfaceCollapsed(!document.body.classList.contains('ui-collapsed'));
        this.syncToggles();
      });
    });
  }


  setInterfaceCollapsed(collapsed) {
    document.body.classList.toggle('ui-collapsed', !!collapsed);
    const ids = ['topbar', 'classicLeftPanel', 'toolPanel', 'bottombar'];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.style.display = collapsed ? 'none' : '';
    }
    document.querySelectorAll('.pill,.tn-info-dock,.tn-info-panel,.tmpe-panel').forEach(el => { el.style.display = collapsed ? 'none' : ''; });
    if (this.wrap) {
      this.wrap.classList.toggle('minimap-ui-collapsed', !!collapsed);
      this.wrap.style.display = 'block';
      this.wrap.style.right = '16px';
      this.wrap.style.bottom = collapsed ? '16px' : '76px';
    }
  }

  syncToggles() {
    const layers = this.game.state.viewLayers || {};
    this.wrap.querySelectorAll('[data-view-toggle]').forEach(btn => {
      const on = layers[btn.dataset.viewToggle] !== false;
      btn.classList.toggle('off', !on);
    });
    this.wrap.querySelectorAll('[data-ui-toggle]').forEach(btn => {
      btn.classList.toggle('off', document.body.classList.contains('ui-collapsed'));
    });
  }

  w2c(x, z) {
    const half = this.game.map.getHalfWorldSize();
    return {
      x: ((x + half) / (half * 2)) * SIZE,
      y: ((z + half) / (half * 2)) * SIZE
    };
  }

  c2w(cx, cy) {
    const half = this.game.map.getHalfWorldSize();
    return {
      x: (cx / SIZE) * half * 2 - half,
      z: (cy / SIZE) * half * 2 - half
    };
  }

  onClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * SIZE;
    const cy = ((e.clientY - rect.top) / rect.height) * SIZE;
    const w = this.c2w(cx, cy);
    const map = this.game.map;
    const cam = map.camera, controls = map.controls;
    if (!cam || !controls) return;
    const y = map.getHeightAt(w.x, w.z);
    const target = controls.target;
    const dx = w.x - target.x, dz = w.z - target.z, dy = y - target.y;
    cam.position.x += dx; cam.position.y += dy; cam.position.z += dz;
    target.set(w.x, y, w.z);
    controls.update?.();
  }

  ensureTerrain() {
    const cfg = this.game.map.getConfig?.() || {};
    const stats = this.game.map.getStats?.() || {};
    const sig = JSON.stringify({ s: cfg.seed, k: stats.mapSizeKm, w: stats.worldSize });
    if (sig === this.terrainSig) return;
    this.terrainSig = sig;
    this.meta.textContent = `${stats.mapSizeKm || '--'}km`;

    const map = this.game.map;
    const sea = stats.seaLevel ?? 0;
    const half = map.getHalfWorldSize();
    const tctx = this.terrainCanvas.getContext('2d');
    const img = tctx.createImageData(SIZE, SIZE);
    // pré-amostra alturas numa grade e interpola para preencher os pixels
    const grid = TERRAIN_SAMPLES;
    const heights = new Float32Array(grid * grid);
    const water = new Uint8Array(grid * grid);
    let minH = Infinity, maxH = -Infinity;
    for (let j = 0; j < grid; j++) for (let i = 0; i < grid; i++) {
      const x = (i / (grid - 1)) * half * 2 - half;
      const z = (j / (grid - 1)) * half * 2 - half;
      const h = map.getHeightAt(x, z);
      heights[j * grid + i] = h;
      water[j * grid + i] = map.isWaterAt(x, z) ? 1 : 0;
      if (h < minH) minH = h; if (h > maxH) maxH = h;
    }
    const span = Math.max(1, maxH - minH);
    const sample = (px, py) => {
      const gx = (px / (SIZE - 1)) * (grid - 1);
      const gy = (py / (SIZE - 1)) * (grid - 1);
      const i0 = Math.min(grid - 1, Math.floor(gx)), j0 = Math.min(grid - 1, Math.floor(gy));
      const idx = j0 * grid + i0;
      return { h: heights[idx], w: water[idx] };
    };
    for (let py = 0; py < SIZE; py++) for (let px = 0; px < SIZE; px++) {
      const { h, w } = sample(px, py);
      const o = (py * SIZE + px) * 4;
      let r, g, b;
      if (w || h <= sea + 1.2) {
        // água — tons de azul esverdeado
        const depth = Math.max(0, Math.min(1, (sea - h) / 22));
        r = 38 - depth * 16; g = 86 - depth * 24; b = 120 - depth * 20;
      } else {
        const t = Math.max(0, Math.min(1, (h - minH) / span));
        if (t < 0.40) { r = 70 + t * 40; g = 120 + t * 60; b = 64 + t * 20; }      // planície verde
        else if (t < 0.72) { r = 118 + (t - 0.4) * 80; g = 132 + (t - 0.4) * 30; b = 74; } // morro
        else { const u = (t - 0.72) / 0.28; r = 150 + u * 80; g = 142 + u * 80; b = 120 + u * 90; } // serra/rocha
      }
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
    tctx.putImageData(img, 0, 0);
  }

  loop() {
    this._raf = requestAnimationFrame(() => this.loop());
    const cityMode = this.game.state.mode === 'city';
    this.wrap.classList.toggle('hidden', !cityMode);
    if (cityMode) {
      // força contra overrides legados que escondiam o minimapa em 1366px,
      // respeitando o modo de interface recolhida.
      const collapsed = document.body.classList.contains('ui-collapsed');
      this.wrap.classList.toggle('minimap-ui-collapsed', collapsed);
      this.wrap.style.display = 'block';
      this.wrap.style.visibility = 'visible';
      this.wrap.style.opacity = '1';
      this.wrap.style.right = '12px';
      this.wrap.style.bottom = collapsed ? '16px' : '76px';
      this.wrap.style.left = 'auto';
      this.wrap.style.zIndex = '80';
    } else {
      this.wrap.style.display = '';
    }
    if (!cityMode) return;
    const now = performance.now();
    if (now - this._lastDraw < 80) return; // ~12fps é suficiente para um minimapa
    this._lastDraw = now;
    this.draw();
  }

  draw() {
    this.ensureTerrain();
    this.syncToggles();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(this.terrainCanvas, 0, 0);
    const st = this.game.state;
    const layers = st.viewLayers || {};

    // grade
    if (layers.grid !== false) {
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 8; i++) {
        const p = (i / 8) * SIZE;
        ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, SIZE); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(SIZE, p); ctx.stroke();
      }
    }

    // zonas (lotes)
    if (layers.zones !== false) {
      const zc = { residential: 'rgba(99,164,90,0.85)', commercial: 'rgba(67,135,223,0.85)', industrial: 'rgba(209,156,54,0.85)' };
      for (const lot of st.zoning || []) {
        const p = this.w2c(lot.x, lot.z);
        ctx.fillStyle = zc[lot.zone] || 'rgba(200,200,200,0.7)';
        ctx.fillRect(p.x - 1.4, p.y - 1.4, 2.8, 2.8);
      }
    }

    // vias
    ctx.strokeStyle = 'rgba(232,234,235,0.92)';
    this.drawNetwork(st.networks.roads, st.networks.roadNodes, this.game.systems.roads, 1.4);
    // trilhos
    ctx.strokeStyle = 'rgba(255,180,90,0.95)';
    this.drawNetwork(st.networks.rails, st.networks.railNodes, this.game.systems.rails, 1.1, true);

    // linhas de transporte
    for (const line of st.transitLines || []) {
      const ids = line.mode === 'rail' ? (line.stationIds || []) : (line.stopIds || []);
      const getter = line.mode === 'rail'
        ? id => (st.railStations || []).find(s => s.id === id)
        : id => (st.transitStops || []).find(s => s.id === id);
      const pts = ids.map(getter).filter(Boolean);
      if (pts.length < 2) continue;
      ctx.strokeStyle = '#' + (((line.color >>> 0) || 0x8fd36b).toString(16).padStart(6, '0'));
      ctx.lineWidth = 1.6; ctx.globalAlpha = 0.85;
      ctx.beginPath();
      pts.forEach((s, i) => { const p = this.w2c(s.x, s.z); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
      ctx.stroke(); ctx.globalAlpha = 1;
    }

    // construções
    if (layers.buildings !== false) {
      const bc = { residential: '#7fd06b', commercial: '#5aa6ff', industrial: '#e0b84a' };
      for (const b of st.buildings || []) {
        const p = this.w2c(b.x, b.z);
        ctx.fillStyle = bc[b.zone] || '#ccc';
        ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
      }
    }

    // paradas/estações
    for (const s of st.transitStops || []) { const p = this.w2c(s.x, s.z); ctx.fillStyle = '#ffe08a'; ctx.beginPath(); ctx.arc(p.x, p.y, 1.6, 0, 7); ctx.fill(); }
    for (const s of st.railStations || []) { const p = this.w2c(s.x, s.z); ctx.fillStyle = '#ffb45a'; ctx.fillRect(p.x - 2, p.y - 2, 4, 4); }

    // veículos (posições ao vivo vêm das instâncias do VehicleSystem)
    if (layers.vehicles !== false) {
      const instances = this.game.systems.vehicles?.instances || [];
      for (const v of instances) {
        const m = v.mesh; if (!m) continue;
        const p = this.w2c(m.position.x, m.position.z);
        ctx.fillStyle = v.type === 'bus' ? '#ffd86b' : v.type === 'train' ? '#ff9a4a' : '#ffffff';
        ctx.fillRect(p.x - 0.7, p.y - 0.7, 1.6, 1.6);
      }
    }

    // marcador de câmera (ponto observado + posição)
    const cam = this.game.map.camera, controls = this.game.map.controls;
    if (cam && controls) {
      const t = this.w2c(controls.target.x, controls.target.z);
      const c = this.w2c(cam.position.x, cam.position.z);
      ctx.strokeStyle = 'rgba(143,211,107,0.95)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(t.x, t.y); ctx.stroke();
      ctx.fillStyle = 'rgba(143,211,107,0.95)';
      ctx.beginPath(); ctx.arc(t.x, t.y, 3.2, 0, 7); ctx.fill();
      ctx.strokeStyle = '#0c100f'; ctx.lineWidth = 1; ctx.stroke();
    }

    // borda
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.strokeRect(0.5, 0.5, SIZE - 1, SIZE - 1);
  }

  drawNetwork(segments, nodes, system, width, dashed = false) {
    if (!segments?.length) return;
    const ctx = this.ctx;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    if (dashed) ctx.setLineDash([2, 2]); else ctx.setLineDash([]);
    for (const seg of segments) {
      let samples = null;
      try { samples = system.getSegmentSamples ? system.getSegmentSamples(seg, 8) : null; } catch { samples = null; }
      if (!samples) {
        const a = system.getNode?.(seg.a) || nodes?.find(n => n.id === seg.a);
        const b = system.getNode?.(seg.b) || nodes?.find(n => n.id === seg.b);
        if (!a || !b) continue;
        samples = [a, b];
      }
      ctx.beginPath();
      samples.forEach((s, i) => { const p = this.w2c(s.x, s.z); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  dispose() { if (this._raf) cancelAnimationFrame(this._raf); }
}
