// InfoPanels — transplante adaptado dos painéis de dados do jogo antigo (SIMURB)
// para o NewCore. Mantém o idioma visual original (info-grid, bar-row, line-card,
// abas e mini-gráficos), mas lê EXCLUSIVAMENTE o estado real do NewCore. Nenhum
// gráfico de mundo (sol/sombra/fog) é importado — isto é só interface.

const PANELS = [
  { key: 'population', icon: '👥', label: 'População & RCI', title: 'Estatísticas de população' },
  { key: 'finance', icon: '💹', label: 'Finanças', title: 'Finanças da cidade' },
  { key: 'transport', icon: '📊', label: 'Transporte', title: 'Estatísticas de transporte' },
  { key: 'lines', icon: '🚍', label: 'Linhas', title: 'Linhas de transporte' },
  { key: 'vehicles', icon: '🚐', label: 'Veículos', title: 'Frota em operação' },
  { key: 'traffic', icon: '🚦', label: 'Tráfego', title: 'Mapa de tráfego' },
  { key: 'graphs', icon: '📈', label: 'Gráficos', title: 'Séries históricas' }
];

export class InfoPanels {
  constructor({ gameShell }) {
    this.game = gameShell;
    this.active = null;
    this.tabState = {};
    this.buildDom();
    this.game.addEventListener('statechange', () => { if (this.active) this.render(); this.syncDock(); });
    this.syncDock();
  }

  buildDom() {
    const dock = document.createElement('div');
    dock.className = 'tn-info-dock';
    dock.id = 'tnInfoDock';
    const inspect = document.createElement('button');
    inspect.className = 'tn-info-tool tn-inspect-tool';
    inspect.dataset.tool = 'inspect';
    inspect.title = 'Inspecionar';
    inspect.innerHTML = '<span class="ico">i</span>';
    inspect.addEventListener('click', () => {
      this.close();
      this.game.setTool(this.game.state.selectedTool === 'inspect' ? null : 'inspect');
    });
    dock.appendChild(inspect);
    const sep = document.createElement('div');
    sep.className = 'tn-info-sep';
    dock.appendChild(sep);
    for (const p of PANELS) {
      const btn = document.createElement('button');
      btn.className = 'tn-info-tool';
      btn.dataset.panel = p.key;
      btn.title = p.title;
      btn.innerHTML = `<span class="ico">${p.icon}</span>`;
      btn.addEventListener('click', () => this.toggle(p.key));
      dock.appendChild(btn);
    }
    document.body.appendChild(dock);
    this.dock = dock;

    const panel = document.createElement('section');
    panel.className = 'tn-info-panel hidden';
    panel.id = 'tnInfoPanel';
    document.body.appendChild(panel);
    this.panel = panel;
  }

  toggle(key) {
    if (this.active === key) { this.close(); return; }
    this.active = key;
    this.panel.classList.remove('hidden');
    this.render();
    this.syncDock();
  }

  close() {
    this.active = null;
    this.panel.classList.add('hidden');
    this.syncDock();
  }

  syncDock() {
    const cityMode = this.game.state.mode === 'city';
    this.dock.classList.toggle('hidden', !cityMode);
    this.dock.querySelectorAll('[data-panel]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.panel === this.active);
    });
    this.dock.querySelectorAll('[data-tool="inspect"]').forEach(btn => {
      btn.classList.toggle('active', this.game.state.selectedTool === 'inspect');
    });
  }

  // ---------- helpers de formatação no idioma do jogo antigo ----------
  fmt(n) { return Math.round(n || 0).toLocaleString('pt-BR'); }
  pct(n) { return `${Math.round(n || 0)}%`; }
  money(n) { return `R$ ${this.fmt(n)}`; }
  signed(n) { return `${(n || 0) >= 0 ? '+' : '-'}R$ ${this.fmt(Math.abs(n || 0))}`; }
  hexColor(c) { return '#' + (((c >>> 0) || 0x8fd36b).toString(16).padStart(6, '0')); }

  stat(label, value, color) {
    const style = color ? ` style="color:${color}"` : '';
    return `<div class="info-stat"><span>${label}</span><strong${style}>${value}</strong></div>`;
  }
  bar(label, value01, color) {
    const w = Math.max(0, Math.min(100, Math.round((value01 || 0) * 100)));
    const fill = color ? `;background:${color}` : '';
    const vc = color ? ` style="color:${color}"` : '';
    return `<div class="bar-row"><span>${label}</span><div class="bar"><i style="width:${w}%${fill}"></i></div><b${vc}>${w}%</b></div>`;
  }
  grid(items, small = false) { return `<div class="info-grid${small ? ' small' : ''}">${items.join('')}</div>`; }
  hint(text) { return `<p class="info-hint">${text}</p>`; }
  h4(text) { return `<h4>${text}</h4>`; }

  tabs(panelKey, sections, fallback) {
    const cur = this.tabState[panelKey] || fallback || sections[0]?.key;
    const head = sections.map(s =>
      `<button class="info-tab${s.key === cur ? ' active' : ''}" data-info-tab="${s.key}">${s.label}</button>`
    ).join('');
    const body = sections.find(s => s.key === cur)?.html || '';
    return `<div class="info-tabs">${head}</div><div class="info-tab-body">${body}</div>`;
  }

  render() {
    const key = this.active;
    if (!key) return;
    const meta = PANELS.find(p => p.key === key);
    let html = `<header class="info-panel-header"><strong>${meta.icon} ${meta.label}</strong><button class="info-close" data-act="close" title="Fechar">✕</button></header>`;
    html += this[`panel_${key}`]?.() || this.hint('Painel indisponível.');
    this.panel.innerHTML = html;
    this.bind(key);
  }

  bind(key) {
    this.panel.querySelector('[data-act="close"]')?.addEventListener('click', () => this.close());
    this.panel.querySelectorAll('[data-info-tab]').forEach(btn => {
      btn.addEventListener('click', () => { this.tabState[key] = btn.dataset.infoTab; this.render(); });
    });
    // Tarifa por linha (painel finanças)
    this.panel.querySelectorAll('[data-fare-line]').forEach(input => {
      input.addEventListener('input', (e) => {
        const line = (this.game.state.transitLines || []).find(l => l.id === input.dataset.fareLine);
        if (!line) return;
        line.fare = Number(e.target.value);
        const disp = this.panel.querySelector(`[data-fare-disp="${input.dataset.fareLine}"]`);
        if (disp) disp.textContent = `R$ ${line.fare.toFixed(2)}`;
        this.game.systems.simulation?.recalculateStats?.();
        this.game.emitChange();
      });
    });
  }

  // ===================== POPULAÇÃO & RCI =====================
  panel_population() {
    const sim = this.game.state.simulation;
    const buildings = this.game.state.buildings || [];
    const counts = { residential: 0, commercial: 0, industrial: 0 };
    const levels = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const b of buildings) { counts[b.zone] = (counts[b.zone] || 0) + 1; levels[Math.max(1, Math.min(5, b.level || 1))]++; }
    const empColor = (sim.employmentRate || 0) >= 60 ? '#6ae08a' : '#e0a93a';
    const unempColor = (sim.unemploymentRate || 0) > 20 ? '#e2663b' : '#9fb0bb';
    const satColor = (sim.satisfaction || 0) > 66 ? '#6ae08a' : (sim.satisfaction || 0) > 40 ? '#e0a93a' : '#e2663b';
    const favelaColor = (sim.favelaPressure || 0) > 30 ? '#e2663b' : (sim.favelaPressure || 0) > 0 ? '#e0a93a' : '#6ae08a';

    const overview = this.grid([
      this.stat('População', this.fmt(sim.population)),
      this.stat('Empregos', this.fmt(sim.jobs)),
      this.stat('Taxa de emprego', this.pct(sim.employmentRate), empColor),
      this.stat('Desemprego', this.pct(sim.unemploymentRate), unempColor),
      this.stat('Satisfação média', this.pct(sim.satisfaction), satColor),
      this.stat('Valor médio do solo', this.fmt(sim.landValue)),
      this.stat('Congestionamento', this.pct(sim.congestion)),
      this.stat('Passageiros/h', this.fmt(sim.passengersPerHour)),
      this.stat('Lotes', this.fmt((this.game.state.zoning || []).length)),
      this.stat('Construções', this.fmt(buildings.length))
    ]);

    const rci = [
      this.h4('Demanda RCI'),
      this.bar('Residencial', sim.demand?.residential, '#63a45a'),
      this.bar('Comercial', sim.demand?.commercial, '#4387df'),
      this.bar('Industrial', sim.demand?.industrial, '#d19c36'),
      this.h4('Satisfação da cidade'),
      this.bar('Satisfação', (sim.satisfaction || 0) / 100, satColor),
      this.hint('Satisfação combina acesso viário, cobertura de transporte, congestionamento e oferta de empregos.'),
      this.h4('Pressão por crescimento informal'),
      this.bar('Risco de favela', (sim.favelaPressure || 0) / 100, favelaColor),
      this.hint(`Desemprego acima de ${Math.round((this.game.systems.simulation?.getBalance?.().unemploymentThreshold || 0.15) * 100)}% aumenta a pressão por ocupações informais.`)
    ].join('');

    const buildingsTab = [
      this.h4('Construções por zona'),
      this.grid([
        this.stat('Residencial', counts.residential),
        this.stat('Comercial', counts.commercial),
        this.stat('Industrial', counts.industrial)
      ], true),
      this.h4('Construções por nível'),
      this.grid([
        this.stat('Nível 1', levels[1]), this.stat('Nível 2', levels[2]),
        this.stat('Nível 3', levels[3]), this.stat('Nível 4', levels[4]),
        this.stat('Nível 5', levels[5])
      ], true),
      this.hint(`Evoluções acumuladas: ${this.fmt(sim.upgradedBuildings)}.`)
    ].join('');

    return this.tabs('population', [
      { key: 'overview', label: 'Visão geral', html: overview },
      { key: 'rci', label: 'RCI e satisfação', html: rci },
      { key: 'buildings', label: 'Construções', html: buildingsTab }
    ], 'overview');
  }

  // ===================== FINANÇAS =====================
  panel_finance() {
    const sim = this.game.state.simulation;
    const cashColor = (sim.money || 0) < 0 ? '#e2663b' : '';
    const netColor = (sim.netIncomeHourly || 0) >= 0 ? '#6ae08a' : '#e2663b';
    const tbColor = (sim.transitBalanceHourly || 0) >= 0 ? '#6ae08a' : '#e2663b';

    const cash = [
      this.h4('Caixa e saldo horário'),
      this.grid([
        this.stat('Caixa', this.money(sim.money), cashColor),
        this.stat('Saldo/h', this.signed(sim.netIncomeHourly), netColor),
        this.stat('Impostos/h', this.money(sim.taxIncomeHourly), '#6ae08a'),
        this.stat('Tarifas/h', this.money(sim.fareRevenueHourly), '#6ae08a'),
        this.stat('Infraestrutura/h', this.money(sim.infrastructureExpensesHourly), '#e2663b'),
        this.stat('Serviços/h', this.money(sim.serviceExpensesHourly), '#e2663b'),
        this.stat('Transporte/h', this.money(sim.transitExpensesHourly), '#e2663b'),
        this.stat('Saldo do transporte/h', this.signed(sim.transitBalanceHourly), tbColor)
      ]),
      (sim.money || 0) < 0 ? this.hint('⚠ Caixa negativo. Reduza frota/obras ou aumente tarifas e impostos.') : ''
    ].join('');

    const transit = [
      this.h4('Transporte público — receita × custo'),
      this.grid([
        this.stat('Tarifa ônibus/h', this.money(sim.busFareRevenueHourly), '#6ae08a'),
        this.stat('Custo ônibus/h', this.money(sim.busTransitExpensesHourly), '#e2663b'),
        this.stat('Tarifa trilho/h', this.money(sim.railFareRevenueHourly), '#6ae08a'),
        this.stat('Custo trilho/h', this.money(sim.railExpensesHourly), '#e2663b')
      ]),
      this.hint('Regra do .md: receita = passageiros transportados × tarifa; custo = frota + manutenção + energia + salários.')
    ].join('');

    const lines = this.game.state.transitLines || [];
    let fares = this.h4('Tarifa por linha');
    if (!lines.length) fares += this.hint('Nenhuma linha criada ainda.');
    else for (const l of lines) {
      const hex = this.hexColor(l.color);
      const fare = (l.fare || 4.4);
      fares += `<div class="line-card" style="border-left:5px solid ${hex}">
        <div class="line-head"><b>${l.name || 'Linha'}</b> <span class="line-sub">${l.mode === 'rail' ? '🚆 trilho' : '🚌 ônibus'}</span></div>
        <div class="fare-row">
          <label>R$</label>
          <input type="range" min="0" max="20" step="0.5" value="${fare}" data-fare-line="${l.id}" />
          <span class="fare-label" data-fare-disp="${l.id}">R$ ${fare.toFixed(2)}</span>
        </div>
        <div class="info-grid small">
          ${this.stat('Receita/h', this.money(l.revenueHourly))}
          ${this.stat('Custo/h', this.money(l.expenseHourly))}
        </div>
      </div>`;
    }

    return this.tabs('finance', [
      { key: 'cash', label: 'Caixa', html: cash },
      { key: 'transit', label: 'Transporte', html: transit },
      { key: 'fares', label: 'Tarifas', html: fares }
    ], 'cash');
  }

  // ===================== TRANSPORTE =====================
  panel_transport() {
    const sim = this.game.state.simulation;
    const m = sim.modalShare || { car: 100, transit: 0, bike: 0 };

    const modal = [
      this.h4('Escolha modal'),
      this.bar('🚗 Carro', (m.car || 0) / 100, '#e0a93a'),
      this.bar('🚌 Transporte público', (m.transit || 0) / 100, '#4cc78a'),
      this.bar('🚴 Bicicleta', (m.bike || 0) / 100, '#4aa3ff'),
      this.hint('Boa cobertura, intervalo curto e baixa lotação reduzem o uso do carro.'),
      this.grid([
        this.stat('Conforto TP (penalidade)', this.pct(sim.comfortPenalty), (sim.comfortPenalty || 0) > 0 ? '#e0a93a' : '#6ae08a'),
        this.stat('Cobertura de transporte', this.pct(sim.transitCoverage))
      ])
    ].join('');

    const coverage = [
      this.h4('Rede de transporte'),
      this.grid([
        this.stat('Paradas de ônibus', this.fmt(sim.transitStops || (this.game.state.transitStops || []).length)),
        this.stat('Linhas de ônibus', this.fmt(sim.busLines)),
        this.stat('Estações de trilho', this.fmt(sim.railStations || (this.game.state.railStations || []).length)),
        this.stat('Linhas de trilho', this.fmt(sim.railLines)),
        this.stat('Lotação ônibus', this.pct(sim.transitOccupancy)),
        this.stat('Lotação trilho', this.pct(sim.railOccupancy)),
        this.stat('Passageiros ônibus/h', this.fmt(sim.transitRidership)),
        this.stat('Passageiros trilho/h', this.fmt(sim.railRidership))
      ]),
      this.bar('Cobertura geral', (sim.transitCoverage || 0) / 100, '#4cc78a')
    ].join('');

    const traffic = [
      this.h4('Tráfego'),
      this.grid([
        this.stat('Veículos em circulação', this.fmt(sim.trafficVehicles || (this.game.state.vehicles || []).length)),
        this.stat('Ônibus ativos', this.fmt(sim.activeBuses)),
        this.stat('Trens ativos', this.fmt(sim.activeTrains)),
        this.stat('Velocidade média', `${this.fmt(sim.avgTrafficSpeed)} km/h`),
        this.stat('Congestionamento', this.pct(sim.congestion), (sim.congestion || 0) > 60 ? '#e2663b' : '#9fb0bb'),
        this.stat('Passageiros/h', this.fmt(sim.passengersPerHour))
      ])
    ].join('');

    return this.tabs('transport', [
      { key: 'modal', label: 'Escolha modal', html: modal },
      { key: 'coverage', label: 'Cobertura', html: coverage },
      { key: 'traffic', label: 'Tráfego', html: traffic }
    ], 'modal');
  }

  // ===================== LINHAS =====================
  panel_lines() {
    const lines = this.game.state.transitLines || [];
    if (!lines.length) {
      return [
        this.grid([this.stat('Linhas ativas', '0')]),
        this.hint('Nenhuma linha criada. Use a ferramenta "Linha bus" / "Linha trilho" ou os atalhos de auto-linha.')
      ].join('');
    }
    const totalRidership = lines.reduce((s, l) => s + (l.ridershipHourly || 0), 0);
    const totalRevenue = lines.reduce((s, l) => s + (l.revenueHourly || 0), 0);
    let html = this.grid([
      this.stat('Linhas ativas', lines.length),
      this.stat('Passageiros/h', this.fmt(totalRidership)),
      this.stat('Receita/h', this.money(totalRevenue))
    ]);
    html += this.h4('Linhas');
    for (const l of lines) {
      const hex = this.hexColor(l.color);
      const occColor = (l.occupancy || 0) > 100 ? '#e2663b' : (l.occupancy || 0) > 70 ? '#e0a93a' : '#6ae08a';
      const stops = (l.stopIds || l.stationIds || []).length;
      html += `<div class="line-card" style="border-left:5px solid ${hex}">
        <div class="line-head"><b>${l.name || 'Linha'}</b><span class="line-sub">${l.mode === 'rail' ? '🚆 trilho' : '🚌 ônibus'} · ${stops} ${l.mode === 'rail' ? 'estações' : 'paradas'}</span></div>
        <div class="info-grid small">
          ${this.stat('Passageiros/h', this.fmt(l.ridershipHourly))}
          ${this.stat('Lotação', this.pct(l.occupancy), occColor)}
          ${this.stat('Intervalo', `${this.fmt(l.frequencyMin)} min`)}
          ${this.stat('Extensão', `${(((l.length || 0) / 1000) || 0).toFixed(1)} km`)}
          ${this.stat('Cobre pop.', this.fmt(l.coveredPopulation))}
          ${this.stat('Cobre empregos', this.fmt(l.coveredJobs))}
          ${this.stat('Receita/h', this.money(l.revenueHourly))}
          ${this.stat('Custo/h', this.money(l.expenseHourly))}
        </div>
        ${l.overcrowded ? this.hint('⚠ Linha superlotada — adicione veículos ou crie linha paralela.') : ''}
      </div>`;
    }
    return html;
  }

  // ===================== VEÍCULOS =====================
  panel_vehicles() {
    const vehicles = this.game.state.vehicles || [];
    const byType = {};
    for (const v of vehicles) byType[v.type || 'car'] = (byType[v.type || 'car'] || 0) + 1;
    const labels = { car: '🚗 Carros', bus: '🚌 Ônibus', train: '🚆 Trens', truck: '🚚 Caminhões' };
    const items = Object.entries(byType).map(([t, n]) => this.stat(labels[t] || t, this.fmt(n)));
    let html = this.grid([
      this.stat('Veículos em circulação', this.fmt(vehicles.length)),
      ...items
    ]);
    const lines = this.game.state.transitLines || [];
    if (lines.length) {
      html += this.h4('Frota por linha');
      for (const l of lines) {
        const hex = this.hexColor(l.color);
        html += `<div class="line-card" style="border-left:4px solid ${hex}">
          <div class="line-head"><b>${l.name || 'Linha'}</b><span class="line-sub">${l.mode === 'rail' ? '🚆 trilho' : '🚌 ônibus'}</span></div>
          <div class="info-grid small">
            ${this.stat('Veículos', this.fmt(l.vehicles || 1))}
            ${this.stat('Cap. sentados', this.fmt(l.capacitySeated))}
            ${this.stat('Cap. em pé', this.fmt(l.capacityStanding))}
            ${this.stat('Capacidade/h', this.fmt(l.capacityHourly))}
          </div>
        </div>`;
      }
    } else {
      html += this.hint('Crie linhas de transporte para alocar veículos dedicados. O tráfego de fundo é gerado automaticamente.');
    }
    return html;
  }

  // ===================== TRÁFEGO =====================
  panel_traffic() {
    const sim = this.game.state.simulation;
    const roads = this.game.state.networks.roads || [];
    const cong = Math.max(0, Math.min(100, sim.congestion || 0));
    const free = Math.max(0, 100 - cong);
    let html = this.grid([
      this.stat('Segmentos de via', this.fmt(roads.length)),
      this.stat('Veículos', this.fmt(sim.trafficVehicles || (this.game.state.vehicles || []).length)),
      this.stat('Velocidade média', `${this.fmt(sim.avgTrafficSpeed)} km/h`)
    ]);
    html += this.h4('Nível de congestionamento');
    html += this.bar('🔴 Carga atual', cong / 100, cong > 60 ? '#e2663b' : cong > 30 ? '#e08a3a' : '#4cc78a');
    html += this.bar('🟢 Folga da rede', free / 100, '#4cc78a');
    html += this.hint('O congestionamento combina carga estrutural (população por via) e a densidade real de veículos nos segmentos.');
    const tc = this.game.systems.traffic?.summary?.();
    if (tc) {
      html += this.h4('Controle de tráfego (gestor)');
      html += this.grid([
        this.stat('Semáforos', this.fmt(tc.signals)),
        this.stat('Pare/Preferencial', this.fmt(tc.priority)),
        this.stat('Restrições de faixa', this.fmt(tc.restrictions))
      ], true);
    }
    const events = this.game.systems.events?.summary?.();
    if (events) {
      html += this.h4('Eventos operacionais');
      html += this.grid([
        this.stat('Ativos', this.fmt(events.active)),
        this.stat('Acidentes', this.fmt(events.byType.accident || 0)),
        this.stat('Obras', this.fmt(events.byType.works || 0)),
        this.stat('Carga crítica', this.fmt(events.byType.congestion || 0))
      ], true);
    }
    return html;
  }

  // ===================== GRÁFICOS =====================
  panel_graphs() {
    const hist = this.game.state.simulation.history || [];
    let summary = this.grid([
      this.stat('Pontos coletados', `${hist.length}/${this.game.systems.simulation?.historyLimit || 48}`),
      this.stat('Intervalo', '1h de jogo'),
      this.stat('População atual', this.fmt(this.game.state.simulation.population)),
      this.stat('Caixa atual', this.money(this.game.state.simulation.money))
    ]);
    if (hist.length < 2) summary += this.hint('Os gráficos aparecem após algumas horas simuladas.');

    let series = '';
    if (hist.length >= 2) {
      const defs = [
        { key: 'population', label: 'População', color: '#6ae08a', fmt: v => this.fmt(v) },
        { key: 'passengersPerHour', label: 'Passageiros/hora', color: '#4aa3ff', fmt: v => this.fmt(v) },
        { key: 'transitShare', label: '% Transporte público', color: '#4cc78a', fmt: v => `${Math.round(v)}%` },
        { key: 'congestion', label: '% Congestionamento', color: '#e2663b', fmt: v => `${Math.round(v)}%` },
        { key: 'money', label: 'Caixa (R$)', color: '#a0c4ff', fmt: v => this.money(v) },
        { key: 'netIncomeHourly', label: 'Saldo/hora (R$)', color: '#c0f0b0', fmt: v => this.signed(v), allowNeg: true }
      ];
      series += this.h4(`Linha do tempo (últimas ${hist.length}h de jogo)`);
      for (const d of defs) series += this.miniChart(hist, d.key, d.label, d.color, d.fmt, d.allowNeg);
    } else {
      series = this.hint('Sem histórico suficiente para desenhar séries.');
    }

    return this.tabs('graphs', [
      { key: 'summary', label: 'Resumo', html: summary },
      { key: 'series', label: 'Séries', html: series }
    ], 'summary');
  }

  miniChart(history, key, label, color, fmtFn, allowNeg = false) {
    const pts = history.map(h => Number(h[key]) || 0);
    if (pts.length < 2) return '';
    let min = Math.min(...pts), max = Math.max(...pts);
    if (allowNeg) { min = Math.min(min, 0); max = Math.max(max, 0); }
    if (max - min < 1e-6) { max += 1; min -= 1; }
    const W = 248, H = 54, pad = 3;
    const x = i => pad + (i / (pts.length - 1)) * (W - pad * 2);
    const y = v => H - pad - ((v - min) / (max - min)) * (H - pad * 2);
    const path = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = `${path} L${x(pts.length - 1).toFixed(1)},${(H - pad).toFixed(1)} L${x(0).toFixed(1)},${(H - pad).toFixed(1)} Z`;
    const zeroLine = (allowNeg && min < 0 && max > 0) ? `<line x1="${pad}" y1="${y(0).toFixed(1)}" x2="${W - pad}" y2="${y(0).toFixed(1)}" stroke="rgba(255,255,255,.18)" stroke-dasharray="3 3"/>` : '';
    const last = pts[pts.length - 1];
    return `<div class="mini-chart">
      <div class="mini-chart-head"><span>${label}</span><b style="color:${color}">${fmtFn(last)}</b></div>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        ${zeroLine}
        <path d="${area}" fill="${color}" opacity="0.14"/>
        <path d="${path}" fill="none" stroke="${color}" stroke-width="1.6"/>
        <circle cx="${x(pts.length - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="2.4" fill="${color}"/>
      </svg>
    </div>`;
  }
}
