import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'legacy' || entry.name === 'vendor') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
}
walk(path.join(root, 'src'));
const rows = files.map(file => {
  const rel = path.relative(root, file);
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).length;
  return { rel, lines };
}).sort((a, b) => b.lines - a.lines);
const total = rows.reduce((sum, item) => sum + item.lines, 0);
const max = rows[0]?.lines || 0;
const oversized = rows.filter(item => item.lines > 5000);
console.log('Terra Nova NewCore module audit');
console.log(`modules=${rows.length} totalLines=${total} maxModuleLines=${max}`);
for (const item of rows) console.log(`${String(item.lines).padStart(5)} ${item.rel}`);
if (fs.existsSync(path.join(root, 'game.js'))) {
  console.error('ERRO: game.js monolítico encontrado na raiz.');
  process.exit(2);
}
if (oversized.length) {
  console.warn('AVISO: módulos muito grandes (>5000 linhas), considerar modularizar por manutenção:', oversized.map(o => o.rel).join(', '));
}

