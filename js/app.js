// ══════════════════════════════════════════════════════
//  app.js — Controlador principal
//  Una sola entrada → simula CPU y Memoria juntos
// ══════════════════════════════════════════════════════

const COLORS = [
  '#4f9cf9','#f97b4f','#34d399','#a78bfa',
  '#f59e0b','#60a5fa','#f472b6','#2dd4bf',
  '#fb7185','#a3e635','#38bdf8','#c084fc',
  '#fb923c','#4ade80','#e879f9','#22d3ee'
];

// ── ESTADO GLOBAL ──────────────────────────────────────
let processes       = [];          // [{ id, arrival, burst, mem, color }]
let autoIdCounter   = 1;

let cpuAlgo         = 'fcfs';
let memAlgo         = 'first';
let memType         = 'dynamic';
let animSpeedMs     = 50;

// Resultados guardados para la vista combinada
let lastCpuResult   = null;
let lastMemResult   = null;
let lastCpuMetrics  = null;
let lastMemStats    = null;

// Estado de memoria en vivo (para liberar procesos)
let liveBlocks      = [];
let liveMemResult   = null;

// ── INIT ──────────────────────────────────────────────

window.addEventListener('load', () => {
  setCpuAlgo('fcfs');
  setMemAlgo('first');
  setMemType('dynamic');
  onSpeedChange();
});

document.addEventListener('DOMContentLoaded', () => {
  ['inBurst', 'inMem'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') addProcess(); });
  });
  document.getElementById('inArr')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('inBurst')?.focus();
  });
});

// ── VISTAS ────────────────────────────────────────────

function showView(name) {
  document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.vtab').forEach(t => t.classList.remove('active'));
  document.getElementById(`view-${name}`)?.classList.add('active');
  const tabs = document.querySelectorAll('.vtab');
  const map = { cpu: 0, mem: 1, both: 2 };
  if (tabs[map[name]]) tabs[map[name]].classList.add('active');
}

// ── VELOCIDAD ─────────────────────────────────────────

function onSpeedChange() {
  const val = parseInt(document.getElementById('speedSlider').value, 10);
  animSpeedMs = Math.round(180 - (val - 1) * (180 - 8) / 9);
  document.getElementById('speedVal').textContent = `×${val}`;
}

// ── ALGORITMOS ────────────────────────────────────────

function setCpuAlgo(a) {
  cpuAlgo = a;
  document.querySelectorAll('#cpuTabs .atab')
    .forEach(t => t.classList.toggle('active', t.dataset.val === a));
  document.getElementById('quantumRow').style.display = a === 'rr' ? 'flex' : 'none';
}

function setMemAlgo(a) {
  memAlgo = a;
  document.querySelectorAll('#memTabs .atab')
    .forEach(t => t.classList.toggle('active', t.dataset.val === a));
  const isBuddy = a === 'buddy';
  const typeRow = document.getElementById('memTypeRow');
  const buddyNote = document.getElementById('buddyNote');
  const fixedCfg  = document.getElementById('fixedConfig');
  if (typeRow)    typeRow.style.opacity      = isBuddy ? '.4' : '1';
  if (typeRow)    typeRow.style.pointerEvents= isBuddy ? 'none' : 'auto';
  if (buddyNote)  buddyNote.style.display    = isBuddy ? 'block' : 'none';
  if (fixedCfg)   fixedCfg.style.display     = (memType === 'fixed' && !isBuddy) ? 'block' : 'none';
}

function setMemType(t) {
  memType = t;
  document.querySelectorAll('.type-btn')
    .forEach(b => b.classList.toggle('active', b.dataset.val === t));
  const fixedCfg = document.getElementById('fixedConfig');
  if (fixedCfg) fixedCfg.style.display = (t === 'fixed' && memAlgo !== 'buddy') ? 'block' : 'none';
}

// ── PROCESOS ──────────────────────────────────────────

function addProcess() {
  const idEl    = document.getElementById('inId');
  const arrEl   = document.getElementById('inArr');
  const burstEl = document.getElementById('inBurst');
  const memEl   = document.getElementById('inMem');

  const id    = (idEl.value.trim())    || ('P' + autoIdCounter);
  const arr   = parseFloat(arrEl.value);
  const burst = parseFloat(burstEl.value);
  const mem   = parseFloat(memEl.value);

  if (isNaN(arr)   || arr < 0)      { showAlert('⚠ El tiempo de llegada no puede ser negativo.'); return; }
  if (isNaN(burst) || burst <= 0)   { showAlert('⚠ La duración de CPU debe ser mayor a 0.'); return; }
  if (isNaN(mem)   || mem <= 0)     { showAlert('⚠ La memoria requerida debe ser mayor a 0.'); return; }
  if (processes.find(p => p.id === id)) { showAlert(`⚠ Ya existe un proceso con ID "${id}".`); return; }

  const memTotal = parseInt(document.getElementById('memTotalInput').value) || 4096;
  if (mem > memTotal) { showAlert(`⚠ La memoria (${mem} MB) supera la memoria total del sistema (${memTotal} MB).`); return; }

  clearAlert();
  processes.push({ id, arrival: arr, burst, mem, color: COLORS[processes.length % COLORS.length] });
  autoIdCounter++;
  idEl.value    = 'P' + autoIdCounter;
  arrEl.value   = 0;
  burstEl.value = '';
  memEl.value   = '';
  burstEl.focus();
  renderProcTable();
  document.getElementById('btnSim').disabled = false;
}

function removeProc(id) {
  processes = processes.filter(p => p.id !== id);
  renderProcTable();
  if (!processes.length) document.getElementById('btnSim').disabled = true;
}

function clearAll() {
  processes = [];
  autoIdCounter = 1;
  document.getElementById('inId').value   = 'P1';
  document.getElementById('fileName').textContent = '—';
  document.getElementById('procTableWrap').innerHTML = '';
  document.getElementById('btnSim').disabled = true;
  clearAlert();
}

function resetAll() {
  clearAll();
  liveBlocks = [];
  liveMemResult = null;
  lastCpuResult = lastMemResult = lastCpuMetrics = lastMemStats = null;

  const empties = [
    ['ganttArea',       '<div class="empty-state">Aquí aparecerá el diagrama de Gantt</div>'],
    ['ganttArea2',      '<div class="empty-state">Sin datos</div>'],
    ['memMapArea',      '<div class="empty-state">Aquí aparecerá el mapa de memoria</div>'],
    ['memMapArea2',     '<div class="empty-state">Sin datos</div>'],
    ['cpuStatsBar',     ''],
    ['memStatsBar',     ''],
    ['cpuAvgCards',     ''],
    ['memAvgCards',     ''],
    ['combinedAvg',     ''],
    ['cpuTraceArea',    '<div class="trace-placeholder">Después de simular aparecerá el registro.</div>'],
    ['memTraceArea',    '<div class="trace-placeholder">Después de simular aparecerá el registro.</div>'],
    ['memHolesList',    '<div class="trace-placeholder">—</div>'],
    ['cpuBadge',        ''],
    ['cpuBadge2',       ''],
    ['memBadge',        ''],
    ['memBadge2',       ''],
  ];
  empties.forEach(([id, html]) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  });

  setTableEmpty('cpuResultsTable', 7);
  setTableEmpty('memResultsTable', 7);
  setTableEmpty('combinedTable', 9);

  document.getElementById('memRemoveSelect').innerHTML = '<option value="">-- Seleccionar proceso --</option>';
}

function setTableEmpty(id, cols) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = `<tbody><tr><td colspan="${cols}" class="empty-cell">Sin resultados aún</td></tr></tbody>`;
}

function renderProcTable() {
  const wrap = document.getElementById('procTableWrap');
  if (!processes.length) { wrap.innerHTML = ''; return; }
  let html = `<table class="proc-table">
    <thead><tr>
      <th>ID</th><th>Llegada</th><th>Duración</th><th>Memoria</th><th></th>
    </tr></thead><tbody>`;
  processes.forEach(p => {
    html += `<tr>
      <td><span class="dot" style="background:${p.color}"></span><b>${p.id}</b></td>
      <td style="font-family:var(--mono)">${p.arrival}</td>
      <td style="font-family:var(--mono)">${p.burst} ut</td>
      <td style="font-family:var(--mono)">${p.mem} MB</td>
      <td><button class="del-btn" onclick="removeProc('${p.id}')">×</button></td>
    </tr>`;
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

function showAlert(msg) {
  document.getElementById('inputAlert').innerHTML = `<div class="alert-box">${msg}</div>`;
}
function clearAlert() {
  document.getElementById('inputAlert').innerHTML = '';
}
function clearElem(id) {
  document.getElementById(id).innerHTML = '<div class="trace-placeholder">Registro limpiado.</div>';
}

// ── CARGA DE ARCHIVO ──────────────────────────────────

function loadFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  document.getElementById('fileName').textContent = file.name;
  const reader = new FileReader();
  reader.onload = ev => {
    const result = parseInputFile(ev.target.result.trim());
    if (result.error) { showAlert(result.error); return; }
    result.procs.forEach((p, i) => {
      p.color = COLORS[(processes.length + i) % COLORS.length];
    });
    processes = [...processes, ...result.procs];
    autoIdCounter = processes.length + 1;
    clearAlert();
    renderProcTable();
    document.getElementById('btnSim').disabled = false;
  };
  reader.readAsText(file);
}

// ── SIMULACIÓN PRINCIPAL ──────────────────────────────

function simulate() {
  if (!processes.length) return;

  const memTotal = parseInt(document.getElementById('memTotalInput').value) || 4096;
  const numParts = parseInt(document.getElementById('numPartsInput').value)  || 8;
  const quantum  = parseInt(document.getElementById('quantumInput').value)   || 2;

  // ── 1. SIMULAR CPU ──────────────────────────────────
  // Los procesos para CPU solo necesitan: id, arrival, burst, color
  const cpuProcs = processes.map(p => ({ ...p }));
  let cpuRaw;
  if      (cpuAlgo === 'fcfs') cpuRaw = fcfs(cpuProcs);
  else if (cpuAlgo === 'sjf')  cpuRaw = sjf(cpuProcs);
  else if (cpuAlgo === 'srt')  cpuRaw = srt(cpuProcs);
  else                          cpuRaw = rr(cpuProcs, quantum);

  const cpuTimeline = mergeTimeline(cpuRaw.timeline);
  const cpuMetrics  = computeCpuMetrics(processes, cpuTimeline);
  const cpuUtil     = computeCpuUtil(cpuTimeline);
  const expulsions  = countExpulsions(cpuRaw.timeline);

  lastCpuResult  = { timeline: cpuTimeline, trace: cpuRaw.trace, util: cpuUtil, expulsions };
  lastCpuMetrics = cpuMetrics;

  // ── 2. SIMULAR MEMORIA ─────────────────────────────
  // Los procesos para memoria necesitan: id, name, size, color
  // Usamos mem como size; name = id
  const memProcs = processes.map(p => ({ id: p.id, name: p.id, size: p.mem, color: p.color }));
  const memResult = runMemAlgorithm(memAlgo, memType, memProcs, memTotal, numParts);
  const memStats  = computeMemMetrics(memResult, memResult.type === 'buddy' ? memResult.memSize : memTotal);

  lastMemResult = memResult;
  lastMemStats  = memStats;
  liveBlocks    = [...memResult.blocks];
  liveMemResult = { ...memResult };

  // ── 3. RENDERIZAR TODO ─────────────────────────────
  const cpuLabels = { fcfs: 'FCFS', sjf: 'SJF / SPN', srt: 'SRT', rr: `RR (Q=${quantum})` };
  const memLabels = { first: 'First Fit', best: 'Best Fit', worst: 'Worst Fit', buddy: 'Buddy System' };
  const cpuLabel  = cpuLabels[cpuAlgo] || cpuAlgo.toUpperCase();
  const memLabel  = memLabels[memAlgo] + (memResult.type === 'buddy' ? ' · Dinám.' : memType === 'fixed' ? ' · Fija' : ' · Dinám.');

  // CPU view
  renderGantt('ganttArea', cpuTimeline, lastCpuResult.expulsions);
  renderGantt('ganttArea2', cpuTimeline, lastCpuResult.expulsions);
  renderCpuResults(cpuMetrics, cpuUtil);
  renderTrace('cpuTraceArea', cpuRaw.trace, 'cpu');
  renderCpuStatsBar(cpuUtil, processes.length, expulsions, quantum);
  document.getElementById('cpuBadge').textContent  = cpuLabel;
  document.getElementById('cpuBadge2').textContent = cpuLabel;

  // Memory view
  const displayTotal = memResult.type === 'buddy' ? memResult.memSize : memTotal;
  renderMemMap('memMapArea', memResult, displayTotal);
  renderMemMap('memMapArea2', memResult, displayTotal);
  renderMemResults(memResult, memStats);
  renderTrace('memTraceArea', memResult.trace, 'mem');
  renderMemStatsBar(memStats, displayTotal);
  renderHoles(memResult.blocks);
  populateRemoveSelect(memResult.blocks);
  document.getElementById('memBadge').textContent  = memLabel;
  document.getElementById('memBadge2').textContent = memLabel;

  // Combined view
  renderCombinedTable(cpuMetrics, memResult.metrics);

  // Mostrar vista CPU por defecto
  showView('cpu');
}

// ── GANTT ─────────────────────────────────────────────

function renderGantt(targetId, tl, expulsions) {
  const container = document.getElementById(targetId);
  if (!container || !tl.length) return;

  const maxT   = Math.max(...tl.map(s => s.end));
  const availW = (container.clientWidth || 500) - 32 - 8;

  // Eje de ticks
  const stepCands = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500];
  const maxTicks  = Math.max(2, Math.floor(availW / 30));
  const step      = stepCands.find(s => Math.ceil(maxT / s) <= maxTicks) || 500;

  let html = `<div class="gantt-wrap">
    <div class="gantt-axis-row">
      <div class="gantt-lbl-col"></div>
      <div class="gantt-axis-track">`;
  for (let t = 0; t <= maxT; t += step) {
    html += `<div class="gantt-tick" style="left:${(t / maxT * 100).toFixed(2)}%">${t}</div>`;
  }
  html += `</div></div>
    <div class="gantt-cpu-row">
      <div class="gantt-cpu-lbl">CPU</div>
      <div class="gantt-track">`;

  tl.forEach((s, idx) => {
    const w = ((s.end - s.start) / maxT * 100).toFixed(3);
    const l = (s.start / maxT * 100).toFixed(3);
    const dur = (s.end - s.start) / maxT * availW;
    const label = dur > 16 ? s.id : '';
    html += `<div class="gantt-block" id="${targetId}-gb-${idx}"
      style="left:${l}%;width:${w}%;background:${s.color};"
      data-tip="${s.id}  [t=${s.start} → t=${s.end}, dur=${s.end - s.start}]">${label}</div>`;
  });
  html += `</div></div>`;

  // Expulsiones
  const switches = [];
  for (let i = 1; i < tl.length; i++) {
    if (tl[i].id !== 'IDLE' && tl[i - 1].id !== 'IDLE' && tl[i].id !== tl[i - 1].id) {
      switches.push({ at: tl[i].start, from: tl[i - 1].id, to: tl[i].id, color: tl[i].color });
    }
  }
  if (switches.length) {
    html += `<div class="gantt-exp-row">
      <span class="exp-label">↩ Cambios de contexto:</span>`;
    switches.forEach(s => {
      html += `<span class="exp-badge" style="background:${s.color}">${s.from}→${s.to} @t=${s.at}</span>`;
    });
    html += `</div>`;
  }

  html += `</div>`;
  container.innerHTML = html;

  // Animación
  const minStart = Math.min(...tl.map(s => s.start));
  tl.forEach((s, idx) => {
    const delay = Math.max(0, (s.start - minStart) * animSpeedMs);
    setTimeout(() => {
      const el = document.getElementById(`${targetId}-gb-${idx}`);
      if (el) el.style.opacity = '1';
    }, delay);
  });
}

// ── RESULTADOS CPU ────────────────────────────────────

function renderCpuResults(metrics, util) {
  let html = `<thead><tr>
    <th>Proceso</th><th>Llegada</th><th>Duración</th>
    <th>Inicio</th><th>Fin</th>
    <th>T. Retorno</th><th>T. Espera</th>
  </tr></thead><tbody>`;
  metrics.forEach(m => {
    html += `<tr>
      <td><span class="dot" style="background:${m.color}"></span><b>${m.id}</b></td>
      <td style="font-family:var(--mono)">${m.arrival}</td>
      <td style="font-family:var(--mono)">${m.burst}</td>
      <td style="font-family:var(--mono)">${m.cpuStart}</td>
      <td style="font-family:var(--mono)">${m.cpuEnd}</td>
      <td class="hi">${m.tr}</td>
      <td class="${m.te === 0 ? 'hi-ok' : 'hi-warn'}">${m.te}</td>
    </tr>`;
  });
  html += '</tbody>';
  document.getElementById('cpuResultsTable').innerHTML = html;

  const avgTR = (metrics.reduce((a, m) => a + m.tr, 0) / metrics.length).toFixed(2);
  const avgTE = (metrics.reduce((a, m) => a + m.te, 0) / metrics.length).toFixed(2);
  document.getElementById('cpuAvgCards').innerHTML = `
    <div class="avg-card"><div class="val" style="color:var(--cpu)">${avgTR}</div><div class="lbl">Prom. T. Retorno</div></div>
    <div class="avg-card"><div class="val" style="color:var(--warn)">${avgTE}</div><div class="lbl">Prom. T. Espera</div></div>
    <div class="avg-card"><div class="val" style="color:var(--ok)">${util.util}%</div><div class="lbl">Utilización CPU</div></div>`;
}

function renderCpuStatsBar(util, procCount, expulsions, quantum) {
  document.getElementById('cpuStatsBar').innerHTML = `
    <div class="stat-card">
      <div class="stat-val cpu">${procCount}</div>
      <div class="stat-lbl">Procesos</div>
    </div>
    <div class="stat-card">
      <div class="stat-val warn">${expulsions}</div>
      <div class="stat-lbl">Expulsiones</div>
    </div>
    <div class="stat-card">
      <div class="stat-val ok">${util.util}%</div>
      <div class="stat-lbl">CPU Util.</div>
      <div class="bar-mini"><div class="bar-fill cpu" style="width:${util.util}%"></div></div>
    </div>
    <div class="stat-card">
      <div class="stat-val cpu">${util.total} ut</div>
      <div class="stat-lbl">T. Total</div>
    </div>
    <div class="stat-card">
      <div class="stat-val">${util.busy} ut</div>
      <div class="stat-lbl">T. Ocupado</div>
    </div>
    <div class="stat-card">
      <div class="stat-val" style="color:var(--light)">${util.idle} ut</div>
      <div class="stat-lbl">T. Inactivo</div>
    </div>`;
}

// ── MAPA DE MEMORIA ───────────────────────────────────

function renderMemMap(targetId, result, totalSize) {
  const { blocks, type } = result;
  if (!blocks || !blocks.length) return;

  let html = `<div class="mem-bar-container">`;
  blocks.forEach(b => {
    const pct = (b.size / totalSize * 100).toFixed(3);
    if (b.free) {
      const lbl = b.size > totalSize * 0.05 ? `${b.size} MB` : '';
      html += `<div class="mem-block free" style="width:${pct}%"
        data-tip="Libre [${b.start}–${b.end ?? b.start + b.size - 1}] ${b.size} MB">${lbl}</div>`;
    } else {
      const lbl = b.size > totalSize * 0.03 ? (b.processId || '') : '';
      html += `<div class="mem-block" style="width:${pct}%;background:${b.color}"
        data-tip="${b.processId} [${b.start}–${b.end ?? b.start + b.size - 1}] ${b.size} MB">${lbl}</div>`;
    }
  });
  html += `</div>`;

  // Escala
  html += `<div class="mem-scale">`;
  for (let i = 0; i <= 5; i++) {
    html += `<span>${Math.round(totalSize * i / 5)} MB</span>`;
  }
  html += `</div>`;

  // Particiones fijas
  if (type === 'fixed') {
    html += `<div class="part-badges">`;
    blocks.forEach((b, i) => {
      const cls = b.free ? '' : 'occ';
      const lbl = b.free ? `P${i}: libre` : `P${i}: ${b.processId}`;
      html += `<span class="part-badge ${cls}">${lbl} (${b.size} MB)</span>`;
    });
    html += `</div>`;
  }

  // Árbol Buddy
  if (type === 'buddy' && result.buddyMap) {
    html += renderBuddyTree(result.buddyMap, result.memSize);
  }

  document.getElementById(targetId).innerHTML = html;
}

function renderBuddyTree(buddyMap, memSize) {
  const maxLevel = Math.log2(memSize);
  let html = `<div class="buddy-tree-wrap">
    <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;margin-top:10px;">Árbol Buddy</div>`;
  for (let level = 0; level <= maxLevel; level++) {
    const blockSize = memSize / Math.pow(2, level);
    const nodes = buddyMap.filter(b => b.size === blockSize).sort((a, b) => a.start - b.start);
    if (!nodes.length) continue;
    const nodeW = Math.max(18, Math.min(100, Math.floor(580 / nodes.length) - 4));
    html += `<div class="buddy-level-lbl">Nivel ${level} — ${blockSize} MB</div>
      <div class="buddy-level">`;
    nodes.forEach(n => {
      const tip = n.free ? `Libre ${n.size} MB [${n.start}]` : `${n.processId} ${n.size} MB [${n.start}]`;
      const lbl = nodeW > 30 ? (n.free ? `${n.size}` : n.processId) : '';
      html += `<div class="${n.free ? 'buddy-node free-node' : 'buddy-node'}"
        style="width:${nodeW}px;${n.free ? '' : `background:${n.color};`}"
        data-tip="${tip}">${lbl}</div>`;
    });
    html += `</div>`;
  }
  html += `</div>`;
  return html;
}

// ── RESULTADOS MEMORIA ────────────────────────────────

function renderMemResults(result, stats) {
  const { metrics, type, partSize } = result;
  const isFixed = type === 'fixed';
  const isBuddy = type === 'buddy';

  let html = `<thead><tr>
    <th>Proceso</th><th>Tamaño Req.</th>
    ${isFixed || isBuddy ? '<th>Bloque Asig.</th>' : ''}
    <th>Inicio</th><th>Fin</th>
    <th>Frag. Interna</th>
    ${isFixed ? '<th>Partición</th>' : ''}
    <th>Estado</th>
  </tr></thead><tbody>`;

  (metrics || []).forEach(m => {
    const fc = m.internalFrag === 0 ? 'hi-ok' : m.internalFrag > 100 ? 'hi-warn' : '';
    html += `<tr>
      <td><span class="dot" style="background:${m.color}"></span><b>${m.id}</b></td>
      <td class="hi">${m.size} MB</td>
      ${isFixed || isBuddy ? `<td class="hi-mem">${m.allocSize || partSize || m.size} MB</td>` : ''}
      <td style="font-family:var(--mono)">${m.start}</td>
      <td style="font-family:var(--mono)">${m.end}</td>
      <td class="${fc}">${m.internalFrag} MB</td>
      ${isFixed ? `<td class="hi-mem">P${m.partition}</td>` : ''}
      <td><span style="color:var(--ok);font-weight:700">✓ OK</span></td>
    </tr>`;
  });

  (result.rejected || []).forEach(r => {
    html += `<tr style="opacity:.5">
      <td><span class="dot" style="background:var(--err)"></span><b>${r.id}</b></td>
      <td class="hi-err">${r.size} MB</td>
      ${isFixed || isBuddy ? '<td>—</td>' : ''}
      <td>—</td><td>—</td><td>—</td>
      ${isFixed ? '<td>—</td>' : ''}
      <td><span style="color:var(--err);font-weight:700">✗ Rechazado</span></td>
    </tr>`;
  });

  html += '</tbody>';
  document.getElementById('memResultsTable').innerHTML = html;

  document.getElementById('memAvgCards').innerHTML = `
    <div class="avg-card"><div class="val" style="color:var(--cpu)">${stats.utilPct}%</div><div class="lbl">Utilización</div></div>
    <div class="avg-card"><div class="val" style="color:var(--warn)">${stats.totalIntFrag} MB</div><div class="lbl">Frag. Interna</div></div>
    <div class="avg-card"><div class="val" style="color:${stats.extFrag > 30 ? 'var(--warn)' : 'var(--ok)'}">${stats.extFrag}%</div><div class="lbl">Frag. Externa</div></div>
    <div class="avg-card"><div class="val" style="color:var(--err)">${stats.rejectedCount}</div><div class="lbl">Rechazados</div></div>`;
}

function renderMemStatsBar(stats, totalSize) {
  document.getElementById('memStatsBar').innerHTML = `
    <div class="stat-card">
      <div class="stat-val mem">${stats.allocCount}</div>
      <div class="stat-lbl">Asignados</div>
    </div>
    <div class="stat-card">
      <div class="stat-val err">${stats.rejectedCount}</div>
      <div class="stat-lbl">Rechazados</div>
    </div>
    <div class="stat-card">
      <div class="stat-val ok">${stats.utilPct}%</div>
      <div class="stat-lbl">Utilización</div>
      <div class="bar-mini"><div class="bar-fill mem" style="width:${stats.utilPct}%"></div></div>
    </div>
    <div class="stat-card">
      <div class="stat-val mem">${stats.usedSize} MB</div>
      <div class="stat-lbl">Mem. Usada</div>
    </div>
    <div class="stat-card">
      <div class="stat-val" style="color:var(--light)">${stats.freeSize} MB</div>
      <div class="stat-lbl">Mem. Libre</div>
    </div>
    <div class="stat-card">
      <div class="stat-val warn">${stats.holeCount}</div>
      <div class="stat-lbl">Huecos</div>
    </div>`;
}

// ── HUECOS ────────────────────────────────────────────

function renderHoles(blocks) {
  const holes = (blocks || []).filter(b => b.free);
  const area  = document.getElementById('memHolesList');
  if (!holes.length) { area.innerHTML = '<div class="trace-placeholder">No hay huecos libres.</div>'; return; }

  const totalFree = holes.reduce((s, b) => s + b.size, 0);
  const maxHole   = Math.max(...holes.map(b => b.size));
  let html = '<div class="holes-list">';
  holes.forEach(h => {
    const isMax = h.size === maxHole;
    html += `<div class="hole-item">
      <span class="hole-range">[${h.start} – ${h.end ?? h.start + h.size - 1}]</span>
      <span class="hole-size" style="${isMax ? 'color:var(--ok)' : ''}">${h.size} MB${isMax ? ' ★' : ''}</span>
    </div>`;
  });
  html += `</div><div style="margin-top:6px;font-size:11px;color:var(--muted);">
    Total libre: <b style="color:var(--text)">${totalFree} MB</b> en ${holes.length} hueco(s) —
    Mayor contiguo: <b style="color:var(--ok)">${maxHole} MB</b>
  </div>`;
  area.innerHTML = html;
}

// ── LIBERAR PROCESO ───────────────────────────────────

function populateRemoveSelect(blocks) {
  const sel = document.getElementById('memRemoveSelect');
  const occupied = (blocks || []).filter(b => !b.free && b.processId);
  sel.innerHTML = '<option value="">-- Seleccionar proceso --</option>' +
    occupied.map(b => `<option value="${b.processId}">${b.processId} (${b.size} MB)</option>`).join('');
}

function freeProcess() {
  const sel = document.getElementById('memRemoveSelect').value;
  if (!sel || !liveMemResult) return;

  const memTotal = parseInt(document.getElementById('memTotalInput').value) || 4096;
  const displayTotal = liveMemResult.type === 'buddy' ? liveMemResult.memSize : memTotal;

  liveBlocks = freeProcessFromMemory(liveBlocks, sel, liveMemResult.type);
  liveMemResult = { ...liveMemResult, blocks: liveBlocks };

  const stats = computeMemMetrics(liveMemResult, displayTotal);

  renderMemMap('memMapArea', liveMemResult, displayTotal);
  renderMemMap('memMapArea2', liveMemResult, displayTotal);
  renderHoles(liveBlocks);
  populateRemoveSelect(liveBlocks);
  renderMemStatsBar(stats, displayTotal);

  const area = document.getElementById('memTraceArea');
  area.innerHTML += `<div class="trace-info">↩ Proceso ${sel} liberado. Huecos fusionados si eran adyacentes.</div>`;
  area.scrollTop = area.scrollHeight;
}

// ── TRAZA ─────────────────────────────────────────────

function renderTrace(targetId, trace, mode) {
  const area = document.getElementById(targetId);
  if (!trace || !trace.length) {
    area.innerHTML = '<div class="trace-placeholder">Sin pasos registrados.</div>';
    return;
  }
  const html = trace.map(t => {
    const type = typeof t === 'object' ? t.type : '';
    const text = typeof t === 'object' ? t.text : t;
    const cls  = { ok: 'trace-ok', err: 'trace-err', info: 'trace-info', idle: 'trace-idle', fin: 'trace-fin' }[type] || '';
    return `<div class="${cls}">${text}</div>`;
  }).join('');
  area.innerHTML = html;
  area.scrollTop = 0;
}

// ── TABLA COMBINADA ───────────────────────────────────

function renderCombinedTable(cpuMetrics, memMetrics) {
  let html = `<thead><tr>
    <th>ID</th>
    <th>Llegada</th>
    <th>Duración CPU</th>
    <th>Mem. Req.</th>
    <th>Inicio CPU</th>
    <th>Fin CPU</th>
    <th>T. Retorno</th>
    <th>T. Espera</th>
    <th>Dirección Mem.</th>
  </tr></thead><tbody>`;

  cpuMetrics.forEach(cm => {
    const mm = (memMetrics || []).find(m => m.id === cm.id);
    const memAddr = mm ? `[${mm.start}–${mm.end}]` : '—';
    const memStatus = mm
      ? `<span style="color:var(--ok)">✓ ${mm.size} MB</span>`
      : `<span style="color:var(--err)">✗ Sin asignar</span>`;
    html += `<tr>
      <td><span class="dot" style="background:${cm.color}"></span><b>${cm.id}</b></td>
      <td style="font-family:var(--mono)">${cm.arrival}</td>
      <td style="font-family:var(--mono)">${cm.burst} ut</td>
      <td>${memStatus}</td>
      <td style="font-family:var(--mono)">${cm.cpuStart}</td>
      <td style="font-family:var(--mono)">${cm.cpuEnd}</td>
      <td class="hi">${cm.tr}</td>
      <td class="${cm.te === 0 ? 'hi-ok' : 'hi-warn'}">${cm.te}</td>
      <td style="font-family:var(--mono);font-size:10px;color:var(--muted)">${memAddr}</td>
    </tr>`;
  });
  html += '</tbody>';
  document.getElementById('combinedTable').innerHTML = html;

  // Averages combinados
  const avgTR   = (cpuMetrics.reduce((a, m) => a + m.tr, 0) / cpuMetrics.length).toFixed(2);
  const avgTE   = (cpuMetrics.reduce((a, m) => a + m.te, 0) / cpuMetrics.length).toFixed(2);
  const cpuUtil = lastCpuResult?.util?.util ?? 0;
  const memUtil = lastMemStats?.utilPct ?? 0;
  document.getElementById('combinedAvg').innerHTML = `
    <div class="avg-card"><div class="val" style="color:var(--cpu)">${avgTR}</div><div class="lbl">Prom. T. Retorno</div></div>
    <div class="avg-card"><div class="val" style="color:var(--warn)">${avgTE}</div><div class="lbl">Prom. T. Espera</div></div>
    <div class="avg-card"><div class="val" style="color:var(--ok)">${cpuUtil}%</div><div class="lbl">Util. CPU</div></div>
    <div class="avg-card"><div class="val" style="color:var(--mem)">${memUtil}%</div><div class="lbl">Util. Memoria</div></div>`;
}

// Re-render Gantt en resize
let _rsTimer;
window.addEventListener('resize', () => {
  clearTimeout(_rsTimer);
  _rsTimer = setTimeout(() => {
    if (lastCpuResult?.timeline?.length) {
      renderGantt('ganttArea',  lastCpuResult.timeline, lastCpuResult.expulsions);
      renderGantt('ganttArea2', lastCpuResult.timeline, lastCpuResult.expulsions);
    }
  }, 150);
});