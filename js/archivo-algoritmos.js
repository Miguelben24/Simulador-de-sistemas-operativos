// ══════════════════════════════════════════════════════════
//  archivo-algoritmos.js — Métodos de Asignación de Archivos
//  MÓDULO NUEVO E INDEPENDIENTE.
//  No modifica ni depende de app.js, cpu-algoritmos.js ni
//  mem-algoritmos.js. Todas las variables y funciones usan
//  el prefijo "fa" (File Allocation) para no chocar con nada
//  del código existente. Cárgalo DESPUÉS de css/styles.css
//  y (opcionalmente) después de app.js en el <script>.
// ══════════════════════════════════════════════════════════

// ── PALETA PROPIA (independiente de COLORS de app.js) ──
const FA_COLORS = [
  '#4f9cf9', '#f97b4f', '#34d399', '#a78bfa',
  '#f59e0b', '#fb7185', '#2dd4bf', '#c084fc',
  '#38bdf8', '#a3e635', '#e879f9', '#fb923c'
];

// ── ESTADO GLOBAL DEL MÓDULO ──
let faDisk        = [];      // [{ index, free, fileId, role }]  role: 'data' | 'index' | null
let faFiles        = [];     // [{ id, name, method, color, sizeBlocks, dataBlocks:[idx..], indexBlock:idx|null, chainOrder:[idx..] }]
let faFileCounter  = 1;
let faTotalBlocks  = 64;
let faMethod       = 'contiguous'; // 'contiguous' | 'linked' | 'indexed'

// ── INICIALIZACIÓN DEL DISCO ──
function faInitDisk(total) {
  faTotalBlocks = Math.max(4, Math.min(512, parseInt(total, 10) || 64));
  faDisk = Array.from({ length: faTotalBlocks }, (_, i) => ({
    index: i, free: true, fileId: null, role: null
  }));
  faFiles = [];
  faFileCounter = 1;
}

function faResetDisk() {
  const totalInput = document.getElementById('faTotalBlocksInput');
  const total = totalInput ? totalInput.value : 64;
  faInitDisk(total);
  faRenderAll();
  faLog(`Disco reiniciado: ${faTotalBlocks} bloques libres.`, 'trace-ok');
}

function faSetMethod(m) {
  faMethod = m;
  document.querySelectorAll('#faMethodTabs .fa-atab')
    .forEach(t => t.classList.toggle('active', t.dataset.val === m));
}

// ── BÚSQUEDA DE ESPACIO LIBRE ──

// Contigua: primer bloque de huecos consecutivos de tamaño 'size'
function faFindContiguous(size) {
  let run = 0, start = -1;
  for (let i = 0; i < faDisk.length; i++) {
    if (faDisk[i].free) {
      if (run === 0) start = i;
      run++;
      if (run === size) return start;
    } else {
      run = 0;
    }
  }
  return -1;
}

// Enlazada / Indexada: primeros 'n' bloques libres, en cualquier posición
function faFindNFree(n) {
  const found = [];
  for (let i = 0; i < faDisk.length && found.length < n; i++) {
    if (faDisk[i].free) found.push(i);
  }
  return found.length === n ? found : null;
}

// ── CREACIÓN DE ARCHIVO ──
function faCreateFile() {
  const nameEl = document.getElementById('faFileNameInput');
  const sizeEl = document.getElementById('faFileSizeInput');

  const name = (nameEl.value.trim()) || `archivo${faFileCounter}.dat`;
  const size = parseInt(sizeEl.value, 10);

  if (!size || size < 1) {
    faLog('Tamaño de archivo inválido (debe ser ≥ 1 bloque).', 'trace-err');
    return;
  }

  const id = 'F' + faFileCounter;
  const color = FA_COLORS[(faFileCounter - 1) % FA_COLORS.length];
  let dataBlocks = [];
  let indexBlock = null;
  let chainOrder = [];

  if (faMethod === 'contiguous') {
    const start = faFindContiguous(size);
    if (start === -1) {
      faLog(`✕ "${faEsc(name)}": no hay ${size} bloques contiguos libres.`, 'trace-err');
      return;
    }
    dataBlocks = Array.from({ length: size }, (_, k) => start + k);

  } else if (faMethod === 'linked') {
    const found = faFindNFree(size);
    if (!found) {
      faLog(`✕ "${faEsc(name)}": no hay ${size} bloques libres en el disco.`, 'trace-err');
      return;
    }
    dataBlocks = found;
    chainOrder = found.slice(); // orden de la cadena (bloque -> siguiente)

  } else if (faMethod === 'indexed') {
    const found = faFindNFree(size + 1); // +1 para el bloque de índice
    if (!found) {
      faLog(`✕ "${faEsc(name)}": se necesitan ${size + 1} bloques (índice + datos) y no hay suficientes libres.`, 'trace-err');
      return;
    }
    indexBlock = found[0];
    dataBlocks = found.slice(1);
  }

  // Marcar bloques como ocupados
  dataBlocks.forEach(idx => {
    faDisk[idx].free = false;
    faDisk[idx].fileId = id;
    faDisk[idx].role = 'data';
  });
  if (indexBlock !== null) {
    faDisk[indexBlock].free = false;
    faDisk[indexBlock].fileId = id;
    faDisk[indexBlock].role = 'index';
  }

  faFiles.push({
    id, name, method: faMethod, color,
    sizeBlocks: size, dataBlocks, indexBlock, chainOrder
  });
  faFileCounter++;

  const methodLbl = { contiguous: 'Contigua', linked: 'Enlazada', indexed: 'Indexada' }[faMethod];
  faLog(`✓ "${faEsc(name)}" creado (${methodLbl}, ${size} bloques) → [${dataBlocks.join(', ')}]${indexBlock !== null ? ` · índice en bloque ${indexBlock}` : ''}`, 'trace-ok');

  if (nameEl) nameEl.value = '';
  faRenderAll();
}

// ── ELIMINACIÓN DE ARCHIVO ──
function faDeleteFile(fileId) {
  const file = faFiles.find(f => f.id === fileId);
  if (!file) return;

  file.dataBlocks.forEach(idx => {
    faDisk[idx].free = true;
    faDisk[idx].fileId = null;
    faDisk[idx].role = null;
  });
  if (file.indexBlock !== null) {
    faDisk[file.indexBlock].free = true;
    faDisk[file.indexBlock].fileId = null;
    faDisk[file.indexBlock].role = null;
  }

  faFiles = faFiles.filter(f => f.id !== fileId);
  faLog(`↩ "${faEsc(file.name)}" eliminado. Bloques liberados.`, 'trace-info');
  faRenderAll();
}

// ── RENDER: GRID DEL DISCO ──
function faRenderDisk() {
  const area = document.getElementById('faDiskArea');
  if (!area) return;

  let html = `<div class="fa-disk-grid">`;
  faDisk.forEach(block => {
    if (block.free) {
      html += `<div class="fa-block fa-free" data-tip="Bloque ${block.index} — libre">${block.index}</div>`;
      return;
    }
    const file = faFiles.find(f => f.id === block.fileId);
    const color = file ? file.color : '#888';
    const isIndex = block.role === 'index';
    let badge = '';
    let tip = `Bloque ${block.index} — ${file ? faEsc(file.name) : ''}`;

    if (isIndex) {
      tip += ' (bloque índice)';
      html += `<div class="fa-block fa-index" style="background:${color}" data-tip="${tip}">IDX</div>`;
    } else {
      if (file && file.method === 'linked') {
        const order = file.chainOrder.indexOf(block.index) + 1;
        badge = `<span class="fa-order-badge">${order}</span>`;
        tip += ` (bloque ${order} de la cadena)`;
      }
      html += `<div class="fa-block" style="background:${color}" data-tip="${tip}">${block.index}${badge}</div>`;
    }
  });
  html += `</div>`;

  const freeCount = faDisk.filter(b => b.free).length;
  html += `<div class="fa-disk-legend">
    <span><span class="fa-legend-swatch fa-free" style="background:repeating-linear-gradient(45deg,#d4d8e0,#d4d8e0 3px,#e4e7ed 3px,#e4e7ed 7px)"></span>Libre (${freeCount})</span>
    <span><span class="fa-legend-swatch" style="background:var(--text)"></span>Bloque índice</span>
    <span>Total: ${faTotalBlocks} bloques · Ocupados: ${faTotalBlocks - freeCount}</span>
  </div>`;

  area.innerHTML = html;
}

// ── RENDER: CADENAS E ÍNDICES ──
function faRenderChains() {
  const area = document.getElementById('faChainsArea');
  if (!area) return;

  const relevant = faFiles.filter(f => f.method !== 'contiguous');
  if (relevant.length === 0) {
    area.innerHTML = `<div class="trace-placeholder">Crea un archivo Enlazado o Indexado para ver su estructura de punteros.</div>`;
    return;
  }

  let html = `<div class="fa-chains-wrap">`;
  relevant.forEach(f => {
    html += `<div class="fa-chain-line">
      <span class="fa-chain-dot" style="background:${f.color}"></span>
      <b>${faEsc(f.name)}</b>:`;
    if (f.method === 'linked') {
      f.chainOrder.forEach((idx, i) => {
        html += ` <span class="fa-chain-node">${idx}</span>`;
        html += i < f.chainOrder.length - 1 ? `<span class="fa-chain-arrow">→</span>` : '';
      });
      html += ` <span class="fa-chain-arrow">→</span> <span class="fa-chain-null">NULL</span>`;
    } else if (f.method === 'indexed') {
      html += ` <span class="fa-chain-idx">IDX ${f.indexBlock}</span> <span class="fa-chain-arrow">⇒</span>`;
      f.dataBlocks.forEach(idx => {
        html += ` <span class="fa-chain-node">${idx}</span>`;
      });
    }
    html += `</div>`;
  });
  html += `</div>`;
  area.innerHTML = html;
}

// ── RENDER: TABLA DE ARCHIVOS ──
function faRenderFilesTable() {
  const wrap = document.getElementById('faFilesTableWrap');
  const select = document.getElementById('faDeleteSelect');
  if (!wrap) return;

  if (faFiles.length === 0) {
    wrap.innerHTML = `<table class="data-table fa-files-table"><tbody><tr><td colspan="6" class="empty-cell">Sin archivos creados aún</td></tr></tbody></table>`;
  } else {
    const methodLbl = { contiguous: 'Contigua', linked: 'Enlazada', indexed: 'Indexada' };
    let rows = faFiles.map(f => {
      const blocksTxt = f.indexBlock !== null
        ? `IDX:${f.indexBlock} · [${f.dataBlocks.join(', ')}]`
        : `[${f.dataBlocks.join(', ')}]`;
      return `<tr>
        <td><span class="fa-color-dot" style="background:${f.color}"></span>${faEsc(f.name)}</td>
        <td>${f.id}</td>
        <td><span class="fa-method-badge ${f.method}">${methodLbl[f.method]}</span></td>
        <td>${f.sizeBlocks}</td>
        <td style="font-family:var(--mono);font-size:10px">${blocksTxt}</td>
        <td><button class="fa-btn-del" onclick="faDeleteFile('${f.id}')">✕ Eliminar</button></td>
      </tr>`;
    }).join('');
    wrap.innerHTML = `<table class="data-table fa-files-table">
      <thead><tr><th>Archivo</th><th>ID</th><th>Método</th><th>Bloques</th><th>Ubicación</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  if (select) {
    select.innerHTML = `<option value="">-- Seleccionar archivo --</option>` +
      faFiles.map(f => `<option value="${f.id}">${faEsc(f.name)} (${f.id})</option>`).join('');
  }
}

// ── TRACE / LOG ──
function faLog(msg, cls) {
  const box = document.getElementById('faTraceArea');
  if (!box) return;
  const placeholder = box.querySelector('.trace-placeholder');
  if (placeholder) placeholder.remove();
  const line = document.createElement('div');
  line.className = cls || 'trace-info';
  line.textContent = msg;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}

// ── HELPERS ──
function faEsc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function faRenderAll() {
  faRenderDisk();
  faRenderChains();
  faRenderFilesTable();
}

// ── TAB PROPIO DE VISTA (no modifica showView() de app.js) ──
// Si existe la función showView original (cpu/mem/both), la reutilizamos
// para esos casos; para 'files' activamos manualmente este panel.
function faShowView(name) {
  document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.vtab').forEach(t => t.classList.remove('active'));
  if (name === 'files') {
    document.getElementById('view-files')?.classList.add('active');
    document.getElementById('faTabBtn')?.classList.add('active');
  } else if (typeof showView === 'function') {
    showView(name);
  }
}

// ── INIT ──
window.addEventListener('load', () => {
  faInitDisk(64);
  faSetMethod('contiguous');
  faRenderAll();
});