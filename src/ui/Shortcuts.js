// Shortcuts — overlay de atalhos de teclado (transplante do conceito do jogo
// antigo, adaptado ao NewCore). Cria botão + modal próprios. Só interface.

const GROUPS = [
  {
    title: 'Geral',
    rows: [
      ['Esc', 'Cancela a ferramenta atual'],
      ['Espaço', 'Pausar / retomar simulação'],
      ['1 – 5', 'Velocidade da simulação'],
      ['?', 'Abrir/fechar esta ajuda']
    ]
  },
  {
    title: 'Construção de vias',
    rows: [
      ['Clique', 'Cria nós / segmentos de via'],
      ['Enter', 'Fecha a linha em construção (bus/trilho)'],
      ['PageUp / PageDown', 'Sobe/baixa o nível de via/trilho']
    ]
  },
  {
    title: 'Gestor de tráfego (Tráfego)',
    rows: [
      ['Clique no nó', 'Alterna sem controle → semáforo → pare → preferencial'],
      ['Modo classe segmento', 'Clique na via alterna a classe do segmento']
    ]
  },
  {
    title: 'Mapa & visualização',
    rows: [
      ['Clique no minimapa', 'Reposiciona a câmera'],
      ['Botões do minimapa', 'Mostrar/ocultar edifícios, zonas, veículos, grade'],
      ['Arrastar / scroll', 'Orbitar e dar zoom (controles do mapa)']
    ]
  }
];

export class Shortcuts {
  constructor() {
    this.buildDom();
    window.addEventListener('keydown', (e) => {
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;
        e.preventDefault();
        this.toggle();
      }
      if (e.key === 'Escape' && this.open) this.close();
    });
  }

  buildDom() {
    const btn = document.createElement('button');
    btn.id = 'tnShortcutsBtn';
    btn.className = 'tn-shortcuts-btn';
    btn.title = 'Atalhos de teclado (?)';
    btn.textContent = '?';
    btn.addEventListener('click', () => this.toggle());
    document.body.appendChild(btn);

    const modal = document.createElement('div');
    modal.className = 'tn-shortcuts-modal hidden';
    modal.id = 'tnShortcutsModal';
    let html = '<div class="tn-shortcuts-card"><header><strong>Atalhos de teclado</strong><button class="tn-sc-close" title="Fechar">✕</button></header><div class="tn-shortcuts-body">';
    for (const g of GROUPS) {
      html += `<div class="tn-sc-group"><h4>${g.title}</h4>`;
      for (const [k, d] of g.rows) html += `<div class="tn-sc-row"><kbd>${k}</kbd><span>${d}</span></div>`;
      html += '</div>';
    }
    html += '</div></div>';
    modal.innerHTML = html;
    modal.addEventListener('click', (e) => { if (e.target === modal) this.close(); });
    modal.querySelector('.tn-sc-close').addEventListener('click', () => this.close());
    document.body.appendChild(modal);
    this.modal = modal;
    this.open = false;
  }

  toggle() { this.open ? this.close() : this.show(); }
  show() { this.modal.classList.remove('hidden'); this.open = true; }
  close() { this.modal.classList.add('hidden'); this.open = false; }
}
