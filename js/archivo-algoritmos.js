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
let faMethod       = 'contiguous'; // 'contiguous' | 'linked' | 'indexed' | 'bitmap' | 'fat' | 'extension' | 'multinivel'
let faFatTable     = [];      // tabla FAT para el método FAT
const PUNTEROS_POR_BLOQUE = 4; // bloques por índice 2do nivel en Multinivel

function rango(a, b) {
  const arr = [];
  for (let i = a; i <= b; i++) arr.push(i);
  return arr;
}

// ── INICIALIZACIÓN DEL DISCO ──
function faInitDisk(total) {
  faTotalBlocks = Math.max(4, Math.min(512, parseInt(total, 10) || 64));
  faDisk = Array.from({ length: faTotalBlocks }, (_, i) => ({
    index: i, free: true, fileId: null, role: null
  }));
  faFatTable = new Array(faTotalBlocks).fill(-2);
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
  document.querySelectorAll('.fa-struct-panel')
    .forEach(p => p.classList.toggle('active', p.id === 'faStruct-' + m));
  faRenderMethodStructure();
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

function faBuildBitmap() {
  return faDisk.map(b => (b.free ? '0' : '1')).join('');
}

function faFindFreeRunBitmap(size) {
  const bitmap = faBuildBitmap();
  let run = 0;
  let start = -1;
  for (let i = 0; i < bitmap.length; i++) {
    if (bitmap[i] === '0') {
      if (run === 0) start = i;
      run++;
      if (run === size) return start;
    } else {
      run = 0;
      start = -1;
    }
  }
  return -1;
}

function faAllocateBitmap(size) {
  const start = faFindFreeRunBitmap(size);
  if (start === -1) return { ok: false, error: `No hay ${size} bloques contiguos libres según el mapa de bits.` };
  const blocks = rango(start, start + size - 1);
  blocks.forEach(idx => {
    faDisk[idx].free = false;
    faDisk[idx].fileId = null;
    faDisk[idx].role = 'data';
  });
  return { ok: true, bloques: blocks };
}

function faInitFAT(totalBlocks) {
  return new Array(totalBlocks).fill(-2);
}

function faAllocateFAT(size) {
  const libres = [];
  for (let i = 0; i < faDisk.length && libres.length < size; i++) {
    if (faDisk[i].free) libres.push(i);
  }
  if (libres.length < size) {
    return { ok: false, error: `No hay suficientes bloques libres (${size}) para FAT.` };
  }
  for (let i = 0; i < libres.length; i++) {
    const bloque = libres[i];
    faDisk[bloque].free = false;
    faDisk[bloque].fileId = null;
    faDisk[bloque].role = 'data';
    faFatTable[bloque] = (i === libres.length - 1) ? -1 : libres[i + 1];
  }
  return { ok: true, primerBloque: libres[0], bloques: libres };
}

function faFreeFAT(file) {
  let actual = file.primerBloque;
  while (actual !== -1 && actual !== undefined) {
    const siguiente = faFatTable[actual];
    faDisk[actual].free = true;
    faDisk[actual].fileId = null;
    faDisk[actual].role = null;
    faFatTable[actual] = -2;
    actual = siguiente;
  }
}

function faBuildFATTrace(primerBloque) {
  const pasos = [];
  let actual = primerBloque;
  while (actual !== -1 && actual !== undefined) {
    pasos.push(actual);
    actual = faFatTable[actual];
  }
  return pasos.join(' → ') + ' → FIN';
}

function faAllocateExtent(size) {
  const extents = [];
  let restantes = size;
  let i = 0;
  while (restantes > 0 && i < faDisk.length) {
    if (faDisk[i].free) {
      const start = i;
      let len = 0;
      while (i < faDisk.length && faDisk[i].free && len < restantes) {
        len++;
        i++;
      }
      extents.push({ inicio: start, longitud: len });
      restantes -= len;
    } else {
      i++;
    }
  }
  if (restantes > 0) {
    return { ok: false, error: `No hay suficiente espacio libre fragmentado para ${size} bloques.` };
  }
  extents.forEach(ext => {
    for (let b = ext.inicio; b < ext.inicio + ext.longitud; b++) {
      faDisk[b].free = false;
      faDisk[b].fileId = null;
      faDisk[b].role = 'data';
    }
  });
  return { ok: true, extents };
}

function faFreeExtent(file) {
  file.extents.forEach(ext => {
    for (let b = ext.inicio; b < ext.inicio + ext.longitud; b++) {
      faDisk[b].free = true;
      faDisk[b].fileId = null;
      faDisk[b].role = null;
    }
  });
}

function faAllocateMultilevel(size) {
  const numL2 = Math.ceil(size / PUNTEROS_POR_BLOQUE);
  const bloquesNecesarios = 1 + numL2 + size;
  const libres = [];
  for (let i = 0; i < faDisk.length && libres.length < bloquesNecesarios; i++) {
    if (faDisk[i].free) libres.push(i);
  }
  if (libres.length < bloquesNecesarios) {
    return { ok: false, error: `No hay suficientes bloques libres para Multinivel (${bloquesNecesarios}).` };
  }
  const idx1 = libres[0];
  const idx2Blocks = libres.slice(1, 1 + numL2);
  const dataBlocks = libres.slice(1 + numL2);
  faDisk[idx1].free = false;
  faDisk[idx1].fileId = null;
  faDisk[idx1].role = 'index1';
  idx2Blocks.forEach(b => {
    faDisk[b].free = false;
    faDisk[b].fileId = null;
    faDisk[b].role = 'index2';
  });
  dataBlocks.forEach(b => {
    faDisk[b].free = false;
    faDisk[b].fileId = null;
    faDisk[b].role = 'data';
  });
  const tablaL2 = idx2Blocks.map((idx2Block, k) => ({
    bloqueIndice: idx2Block,
    datos: dataBlocks.slice(k * PUNTEROS_POR_BLOQUE, (k + 1) * PUNTEROS_POR_BLOQUE)
  }));
  return { ok: true, idx1, tablaL2, dataBlocks };
}

function faFreeMultilevel(file) {
  faDisk[file.idx1].free = true;
  faDisk[file.idx1].fileId = null;
  faDisk[file.idx1].role = null;
  file.tablaL2.forEach(nivel => {
    faDisk[nivel.bloqueIndice].free = true;
    faDisk[nivel.bloqueIndice].fileId = null;
    faDisk[nivel.bloqueIndice].role = null;
    nivel.datos.forEach(b => {
      faDisk[b].free = true;
      faDisk[b].fileId = null;
      faDisk[b].role = null;
    });
  });
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

  faLog(`Creando: "${faEsc(name)}" · ${size} bloques · Método: ${faMethod}`,'trace-info');

  const id = 'F' + faFileCounter;
  const color = FA_COLORS[(faFileCounter - 1) % FA_COLORS.length];
  let dataBlocks = [];
  let indexBlock = null;
  let chainOrder = [];
  let primerBloque = null;
  let extents = null;
  let tablaL2 = null;
  let idx1 = null;

  if (faMethod === 'contiguous') {
    faLog(`Buscando ${size} bloques contiguos (First Fit)...`, 'trace-info');
    const start = faFindContiguous(size);
    if (start === -1) {
      faLog(`✕ "${faEsc(name)}": no hay ${size} bloques contiguos libres.`, 'trace-err');
      return;
    }
    faLog(`Hueco encontrado desde ${start} hasta ${start + size - 1}`, 'trace-ok');
    dataBlocks = Array.from({ length: size }, (_, k) => start + k);
    dataBlocks.forEach(idx => { faDisk[idx].free = false; faDisk[idx].fileId = id; faDisk[idx].role = 'data'; });

  } else if (faMethod === 'linked') {
    faLog(`Buscando ${size} bloques libres en cualquier posición (Enlazada)...`, 'trace-info');
    const found = faFindNFree(size);
    if (!found) {
      faLog(`✕ "${faEsc(name)}": no hay ${size} bloques libres en el disco.`, 'trace-err');
      return;
    }
    faLog(`Bloques seleccionados: [${found.join(', ')}]`, 'trace-ok');
    dataBlocks = found; chainOrder = found.slice();
    dataBlocks.forEach(idx => { faDisk[idx].free = false; faDisk[idx].fileId = id; faDisk[idx].role = 'data'; });

  } else if (faMethod === 'indexed') {
    faLog(`Buscando ${size + 1} bloques libres (1 índice + ${size} datos) (Indexada)...`, 'trace-info');
    const found = faFindNFree(size + 1);
    if (!found) {
      faLog(`✕ "${faEsc(name)}": se necesitan ${size + 1} bloques (índice + datos) y no hay suficientes libres.`, 'trace-err');
      return;
    }
    indexBlock = found[0];
    dataBlocks = found.slice(1);
    indexBlock = found[0];
    faLog(`Índice en bloque ${indexBlock}; datos en [${dataBlocks.join(', ')}]`, 'trace-ok');
    dataBlocks.forEach(idx => { faDisk[idx].free = false; faDisk[idx].fileId = id; faDisk[idx].role = 'data'; });
    faDisk[indexBlock].free = false; faDisk[indexBlock].fileId = id; faDisk[indexBlock].role = 'index';

  } else if (faMethod === 'bitmap') {
    faLog(`Usando mapa de bits: buscando ${size} bloques contiguos según bitmap...`, 'trace-info');
    const res = faAllocateBitmap(size);
    if (!res.ok) {
      faLog(`✕ "${faEsc(name)}": ${res.error}`, 'trace-err');
      return;
    }
    dataBlocks = res.bloques;
    faLog(`Bloques asignados según bitmap: [${dataBlocks.join(', ')}]`, 'trace-ok');
    dataBlocks.forEach(idx => { faDisk[idx].fileId = id; faDisk[idx].free = false; faDisk[idx].role = 'data'; });

  } else if (faMethod === 'fat') {
    faLog(`Asignando con FAT: buscando ${size} bloques libres y enlazándolos...`, 'trace-info');
    const res = faAllocateFAT(size);
    if (!res.ok) {
      faLog(`✕ "${faEsc(name)}": ${res.error}`, 'trace-err');
      return;
    }
    primerBloque = res.primerBloque;
    dataBlocks = res.bloques;
    faLog(`FAT primer bloque: ${primerBloque}; secuencia: [${dataBlocks.join(', ')}]`, 'trace-ok');
    dataBlocks.forEach(idx => { faDisk[idx].fileId = id; faDisk[idx].free = false; faDisk[idx].role = 'data'; });
    chainOrder = res.bloques.slice();

  } else if (faMethod === 'extension') {
    faLog(`Asignación por extents: buscando fragmentos hasta completar ${size} bloques...`, 'trace-info');
    const res = faAllocateExtent(size);
    if (!res.ok) {
      faLog(`✕ "${faEsc(name)}": ${res.error}`, 'trace-err');
      return;
    }
    extents = res.extents;
    faLog(`Extents asignados: ${extents.map(e => `[${e.inicio}:${e.longitud}]`).join(', ')}`, 'trace-ok');
    dataBlocks = extents.flatMap(ext => rango(ext.inicio, ext.inicio + ext.longitud - 1));
    dataBlocks.forEach(idx => { faDisk[idx].fileId = id; faDisk[idx].free = false; faDisk[idx].role = 'data'; });

  } else if (faMethod === 'multinivel') {
    faLog(`Asignación multinivel: reservando índice de primer nivel + L2 + datos...`, 'trace-info');
    const res = faAllocateMultilevel(size);
    if (!res.ok) {
      faLog(`✕ "${faEsc(name)}": ${res.error}`, 'trace-err');
      return;
    }
    idx1 = res.idx1;
    tablaL2 = res.tablaL2;
    dataBlocks = res.dataBlocks;
    faLog(`IDX1: ${idx1}; L2: ${tablaL2.map(n=>n.bloqueIndice).join(', ')}; datos: [${dataBlocks.join(', ')}]`, 'trace-ok');
    dataBlocks.forEach(idx => { faDisk[idx].fileId = id; faDisk[idx].free = false; faDisk[idx].role = 'data'; });
    faDisk[idx1].fileId = id; tablaL2.forEach(nivel => { faDisk[nivel.bloqueIndice].fileId = id; });

  } else {
    faLog(`✕ Método de asignación desconocido: ${faMethod}`, 'trace-err');
    return;
  }

  faFiles.push({
    id, name, method: faMethod, color,
    sizeBlocks: size, dataBlocks, indexBlock, chainOrder,
    primerBloque, extents, idx1, tablaL2
  });
  faFileCounter++;

  const methodLbl = {
    contiguous: 'Contigua', linked: 'Enlazada', indexed: 'Indexada',
    bitmap: 'Bitmap', fat: 'FAT', extension: 'Extensión', multinivel: 'Multinivel'
  }[faMethod];
  const location = faMethod === 'indexed'
    ? ` · índice en bloque ${indexBlock}`
    : faMethod === 'fat'
      ? ` · primer bloque ${primerBloque}`
      : faMethod === 'extension'
        ? ` · extents ${extents.map(e => `[${e.inicio}:${e.longitud}]`).join(', ')}`
        : faMethod === 'multinivel'
          ? ` · IDX1 ${idx1}`
          : '';

  faLog(`✓ "${faEsc(name)}" creado (${methodLbl}, ${size} bloques) → [${dataBlocks.join(', ')}]${location}`, 'trace-ok');

  if (nameEl) nameEl.value = '';
  faRenderAll();
}

// ── ELIMINACIÓN DE ARCHIVO ──
function faDeleteFile(fileId) {
  const file = faFiles.find(f => f.id === fileId);
  if (!file) return;
  // Liberar según el método para respetar estructuras (FAT, multinivel, extents)
  if (file.method === 'fat') {
    if (typeof faFreeFAT === 'function') faFreeFAT(file);
  } else if (file.method === 'multinivel') {
    if (typeof faFreeMultilevel === 'function') faFreeMultilevel(file);
  } else if (file.method === 'extension') {
    if (typeof faFreeExtent === 'function') faFreeExtent(file);
  } else {
    // Caso por defecto (contigua, enlazada, indexada, bitmap): liberar bloques listados
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
  }

  faFiles = faFiles.filter(f => f.id !== fileId);
  faLog(`↩ "${faEsc(file.name)}" eliminado. Bloques liberados.`, 'trace-info');
  faRenderAll();
}

// ── RENDER: GRID DEL DISCO ──
function faRenderDisk() {
  const area = document.getElementById('faDiskArea');
  if (!area) return;

  let html = `<div class="fa-disk-grid-wrap"><div class="fa-disk-grid">`;
  faDisk.forEach(block => {
    if (block.free) {
      html += `<div class="fa-block fa-free" data-idx="${block.index}" data-tip="Bloque ${block.index} — libre">${block.index}</div>`;
      return;
    }
    const file = faFiles.find(f => f.id === block.fileId);
    const color = file ? file.color : '#888';
    let badge = '';
    let tip = `Bloque ${block.index} — ${file ? faEsc(file.name) : ''}`;

    if (block.role === 'index') {
      tip += ' (bloque índice)';
      html += `<div class="fa-block fa-index" style="background:${color}" data-idx="${block.index}" data-tip="${tip}">IDX</div>`;
    } else if (block.role === 'index1') {
      tip += ' (índice principal)';
      html += `<div class="fa-block fa-index" style="background:${color}" data-idx="${block.index}" data-tip="${tip}">IDX1</div>`;
    } else if (block.role === 'index2') {
      tip += ' (índice de 2do nivel)';
      html += `<div class="fa-block fa-index" style="background:${color}" data-idx="${block.index}" data-tip="${tip}">IDX2</div>`;
    } else {
      if (file && file.method === 'linked') {
        const order = file.chainOrder.indexOf(block.index) + 1;
        badge = `<span class="fa-order-badge">${order}</span>`;
        tip += ` (bloque ${order} de la cadena)`;
      } else if (file && file.method === 'fat') {
        const order = file.dataBlocks.indexOf(block.index) + 1;
        badge = `<span class="fa-order-badge">${order}</span>`;
        tip += ` (bloque ${order} de la cadena FAT)`;
      }
      html += `<div class="fa-block" style="background:${color}" data-idx="${block.index}" data-tip="${tip}">${block.index}${badge}</div>`;
    }
  });
  html += `</div><svg class="fa-disk-arrows" id="faDiskArrows"></svg></div>`;

  const freeCount = faDisk.filter(b => b.free).length;
  html += `<div class="fa-disk-legend">
    <span><span class="fa-legend-swatch fa-free" style="background:repeating-linear-gradient(45deg,#d4d8e0,#d4d8e0 3px,#e4e7ed 3px,#e4e7ed 7px)"></span>Libre (${freeCount})</span>
    <span><span class="fa-legend-swatch" style="background:var(--text)"></span>Bloque índice</span>
    <span><span class="fa-legend-swatch" style="background:linear-gradient(90deg,#4f9cf9,#f97b4f)"></span>→ Puntero al siguiente bloque</span>
    <span>Total: ${faTotalBlocks} bloques · Ocupados: ${faTotalBlocks - freeCount}</span>
  </div>`;

  area.innerHTML = html;
  faRenderDiskArrows();
}

// ── RENDER: FLECHAS DE PUNTEROS SOBRE EL MAPA DEL DISCO ──
// Dibuja, encima de la grilla, las flechas de puntero de cada archivo
// cuyo método realmente usa punteros/índices: Enlazada, Indexada, FAT
// y Multinivel. En Extensión dibuja una flecha punteada solo cuando el
// archivo quedó dividido en más de un extent (salto entre extents).
function faColorSlug(color) {
  return color.replace('#', '');
}

function faRenderDiskArrows() {
  const wrap = document.querySelector('#faDiskArea .fa-disk-grid-wrap');
  const grid = document.querySelector('#faDiskArea .fa-disk-grid');
  const svg = document.getElementById('faDiskArrows');
  if (!wrap || !grid || !svg) return;

  const wrapRect = wrap.getBoundingClientRect();
  if (wrapRect.width === 0 || wrapRect.height === 0) return;
  svg.setAttribute('width', wrapRect.width);
  svg.setAttribute('height', wrapRect.height);
  svg.setAttribute('viewBox', `0 0 ${wrapRect.width} ${wrapRect.height}`);

  function centerOf(idx) {
    const el = grid.querySelector(`[data-idx="${idx}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2 - wrapRect.left, y: r.top + r.height / 2 - wrapRect.top };
  }

  const pairs = [];
  const colorsUsed = new Set();

  faFiles.forEach(f => {
    if (f.method === 'linked') {
      for (let i = 0; i < f.chainOrder.length - 1; i++) {
        pairs.push({ from: f.chainOrder[i], to: f.chainOrder[i + 1], color: f.color });
      }
    } else if (f.method === 'fat') {
      for (let i = 0; i < f.dataBlocks.length - 1; i++) {
        pairs.push({ from: f.dataBlocks[i], to: f.dataBlocks[i + 1], color: f.color });
      }
    } else if (f.method === 'indexed') {
      f.dataBlocks.forEach(d => pairs.push({ from: f.indexBlock, to: d, color: f.color }));
    } else if (f.method === 'multinivel') {
      f.tablaL2.forEach(nivel => {
        pairs.push({ from: f.idx1, to: nivel.bloqueIndice, color: f.color });
        nivel.datos.forEach(d => pairs.push({ from: nivel.bloqueIndice, to: d, color: f.color }));
      });
    } else if (f.method === 'extension' && f.extents.length > 1) {
      for (let i = 0; i < f.extents.length - 1; i++) {
        const finPrev = f.extents[i].inicio + f.extents[i].longitud - 1;
        const iniNext = f.extents[i + 1].inicio;
        pairs.push({ from: finPrev, to: iniNext, color: f.color, dashed: true });
      }
    }
    colorsUsed.add(f.color);
  });

  if (pairs.length === 0) { svg.innerHTML = ''; return; }

  let defs = '<defs>';
  colorsUsed.forEach(c => {
    defs += `<marker id="faArrow-${faColorSlug(c)}" viewBox="0 0 10 10" refX="8" refY="5"
      markerWidth="5" markerHeight="5" orient="auto-start-reverse" markerUnits="strokeWidth">
      <path d="M0,0 L10,5 L0,10 z" fill="#fff" stroke="${c}" stroke-width="1.4"></path>
    </marker>`;
  });
  defs += '</defs>';

  let paths = '';
  pairs.forEach(p => {
    const a = centerOf(p.from), b = centerOf(p.to);
    if (!a || !b) return;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const curve = Math.min(26, dist * 0.22);
    const nx = -dy / dist * curve, ny = dx / dist * curve;
    const cx = mx + nx, cy = my + ny;
    const dash = p.dashed ? ' stroke-dasharray="5,4"' : '';
    const bgPath = `<path d="M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}" fill="none"
      stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" opacity="0.45"${dash}></path>`;
    const fgPath = `<path d="M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}" fill="none"
      stroke="${p.color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.98"${dash}
      marker-end="url(#faArrow-${faColorSlug(p.color)})"></path>`;
    paths += bgPath + fgPath;
  });

  svg.innerHTML = defs + paths;
}

window.addEventListener('resize', () => { if (faFiles.length) faRenderDiskArrows(); });

// ── RENDER: TABLA DE ARCHIVOS ──
function faRenderFilesTable() {
  const wrap = document.getElementById('faFilesTableWrap');
  const select = document.getElementById('faDeleteSelect');
  if (!wrap) return;
  if (faFiles.length === 0) {
    wrap.innerHTML = `<table class="data-table fa-files-table"><tbody><tr><td colspan="6" class="empty-cell">Sin archivos creados aún</td></tr></tbody></table>`;
  } else {
    const methodLbl = { contiguous: 'Contigua', linked: 'Enlazada', indexed: 'Indexada', bitmap: 'Bitmap', fat: 'FAT', extension: 'Extensión', multinivel: 'Multinivel' };
    let rows = faFiles.map(f => {
      let blocksTxt = '';
      switch (f.method) {
        case 'indexed': blocksTxt = `IDX:${f.indexBlock} · [${f.dataBlocks.join(', ')}]`; break;
        case 'fat': blocksTxt = `P:${f.primerBloque} · [${(f.dataBlocks||[]).join(', ')}]`; break;
        case 'extension': blocksTxt = `Ext: ${f.extents ? f.extents.map(e => `[${e.inicio}:${e.longitud}]`).join(', ') : ''}`; break;
        case 'multinivel': blocksTxt = `IDX1:${f.idx1} · L2:${f.tablaL2 ? f.tablaL2.map(n=>n.bloqueIndice).join(', ') : ''} · [${(f.dataBlocks||[]).join(', ')}]`; break;
        default: blocksTxt = `[${(f.dataBlocks||[]).join(', ')}]`; break;
      }
      return `<tr>
        <td><span class="fa-color-dot" style="background:${f.color}"></span>${faEsc(f.name)}</td>
        <td>${f.id}</td>
        <td><span class="fa-method-badge ${f.method}">${methodLbl[f.method] || f.method}</span></td>
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
  faRenderFilesTable();
  faRenderMethodStructure();
}

// ══════════════════════════════════════════════════════════
//  ESTRUCTURA Y PROCEDIMIENTO — un apartado por cada método.
//  Solo se pinta el que corresponde al método actualmente
//  seleccionado en #faMethodTabs (ver faSetMethod).
// ══════════════════════════════════════════════════════════
function faRenderMethodStructure() {
  switch (faMethod) {
    case 'contiguous': faRenderStructContiguous(); break;
    case 'linked':     faRenderStructLinked();     break;
    case 'indexed':    faRenderStructIndexed();    break;
    case 'bitmap':     faRenderStructBitmap();     break;
    case 'fat':        faRenderStructFAT();        break;
    case 'extension':  faRenderStructExtension();  break;
    case 'multinivel': faRenderStructMultilevel(); break;
  }
}

function faPlaceholder(el, msg) {
  el.innerHTML = `<div class="trace-placeholder">${msg}</div>`;
}

// ── I. CONTIGUA — bloque inicial + longitud ──
function faRenderStructContiguous() {
  const el = document.getElementById('faStruct-contiguous');
  if (!el) return;
  const files = faFiles.filter(f => f.method === 'contiguous');
  if (files.length === 0) {
    faPlaceholder(el, 'Crea un archivo con método Contigua para ver su bloque inicial, su longitud y el procedimiento de lectura.');
    return;
  }
  let html = `<div class="fa-struct-title">📏 Asignación Contigua — bloque inicial y longitud</div>`;
  html += `<table class="data-table"><thead><tr><th>Archivo</th><th>Inicio</th><th>Longitud</th><th>Bloques</th></tr></thead><tbody>`;
  files.forEach(f => {
    const ini = f.dataBlocks[0];
    html += `<tr><td><span class="fa-color-dot" style="background:${f.color}"></span>${faEsc(f.name)}</td>
      <td class="hi">B${ini}</td><td>${f.sizeBlocks} bloques</td>
      <td style="font-family:var(--mono)">${f.dataBlocks.map(b => 'B' + b).join(' → ')}</td></tr>`;
  });
  html += `</tbody></table><div class="fa-proc-box"><b>¿Cómo abre el archivo el sistema operativo?</b>`;
  files.forEach(f => {
    const ini = f.dataBlocks[0], fin = f.dataBlocks[f.dataBlocks.length - 1];
    html += `<div class="fa-proc-file">
      <span class="fa-proc-step"><b class="fa-step-n">1</b> Lee el directorio de "${faEsc(f.name)}": Inicio = B${ini}, Longitud = ${f.sizeBlocks}.</span>
      <span class="fa-proc-step"><b class="fa-step-n">2</b> Empieza a leer en B${ini} y continúa de forma consecutiva: ${f.dataBlocks.map(b => 'B' + b).join(' → ')}.</span>
      <span class="fa-proc-step"><b class="fa-step-n">3</b> Termina en B${fin}. No fue necesario consultar ninguna tabla: los bloques están uno junto al otro.</span>
    </div>`;
  });
  html += `</div>`;
  el.innerHTML = html;
}

// ── II. ENLAZADA — cadena de punteros ──
function faRenderStructLinked() {
  const el = document.getElementById('faStruct-linked');
  if (!el) return;
  const files = faFiles.filter(f => f.method === 'linked');
  if (files.length === 0) {
    faPlaceholder(el, 'Crea un archivo con método Enlazada para ver su cadena de punteros y el procedimiento de lectura.');
    return;
  }
  let html = `<div class="fa-struct-title">🔗 Asignación Enlazada — cada bloque apunta al siguiente</div>`;
  html += `<div class="fa-chains-wrap">`;
  files.forEach(f => {
    html += `<div class="fa-chain-line"><span class="fa-chain-dot" style="background:${f.color}"></span><b>${faEsc(f.name)}</b>:`;
    f.chainOrder.forEach((idx) => {
      html += ` <span class="fa-chain-node">B${idx}</span>`;
      html += `<span class="fa-chain-arrow">→</span>`;
    });
    html += ` <span class="fa-chain-null">FIN</span></div>`;
  });
  html += `</div><div class="fa-proc-box"><b>¿Cómo abre el archivo el sistema operativo?</b>`;
  files.forEach(f => {
    html += `<div class="fa-proc-file">
      <span class="fa-proc-step"><b class="fa-step-n">1</b> El directorio de "${faEsc(f.name)}" solo guarda el primer bloque: Inicio = B${f.chainOrder[0]}.</span>
      <span class="fa-proc-step"><b class="fa-step-n">2</b> Lee B${f.chainOrder[0]}; dentro encuentra un puntero al siguiente bloque, y así sucesivamente: ${f.chainOrder.map(b => 'B' + b).join(' → ')} → FIN.</span>
      <span class="fa-proc-step"><b class="fa-step-n">3</b> El sistema nunca conoce de antemano el último bloque: debe recorrer toda la cadena hasta encontrar FIN.</span>
    </div>`;
  });
  html += `</div>`;
  el.innerHTML = html;
}

// ── III. INDEXADA SIMPLE — bloque índice ──
function faRenderStructIndexed() {
  const el = document.getElementById('faStruct-indexed');
  if (!el) return;
  const files = faFiles.filter(f => f.method === 'indexed');
  if (files.length === 0) {
    faPlaceholder(el, 'Crea un archivo con método Indexada para ver su bloque índice y el procedimiento de lectura.');
    return;
  }
  let html = `<div class="fa-struct-title">📇 Asignación Indexada Simple — un bloque índice con todas las direcciones</div>`;
  html += `<div class="fa-chains-wrap">`;
  files.forEach(f => {
    html += `<div class="fa-chain-line"><span class="fa-chain-dot" style="background:${f.color}"></span><b>${faEsc(f.name)}</b>:
      <span class="fa-chain-idx">IDX B${f.indexBlock}</span> <span class="fa-chain-arrow">⇒</span>`;
    f.dataBlocks.forEach(idx => { html += ` <span class="fa-chain-node">B${idx}</span>`; });
    html += `</div>`;
  });
  html += `</div><div class="fa-proc-box"><b>¿Cómo abre el archivo el sistema operativo?</b>`;
  files.forEach(f => {
    html += `<div class="fa-proc-file">
      <span class="fa-proc-step"><b class="fa-step-n">1</b> Busca el bloque índice de "${faEsc(f.name)}": B${f.indexBlock}.</span>
      <span class="fa-proc-step"><b class="fa-step-n">2</b> Lee todas las direcciones guardadas dentro: [${f.dataBlocks.join(', ')}].</span>
      <span class="fa-proc-step"><b class="fa-step-n">3</b> Accede directamente a cada bloque de datos, sin seguir una cadena.</span>
    </div>`;
  });
  html += `</div>`;
  el.innerHTML = html;
}

// ── V. BITMAP — mapa de bits del disco completo ──
function faRenderStructBitmap() {
  const el = document.getElementById('faStruct-bitmap');
  if (!el) return;
  const bitmap = faBuildBitmap();
  const groups = [];
  for (let i = 0; i < bitmap.length; i += 8) groups.push(bitmap.slice(i, i + 8));
  const coloredRows = groups.map((g, idx) => {
    const bits = g.split('').map(b => `<span class="${b === '1' ? 'bit1' : 'bit0'}">${b}</span>`).join(' ');
    return `${String(idx * 8).padStart(3, ' ')}: ${bits}`;
  }).join('\n');

  const files = faFiles.filter(f => f.method === 'bitmap');
  let html = `<div class="fa-struct-title">💠 Mapa de Bits — 1 bit por bloque (1 = ocupado, 0 = libre)</div>`;
  html += `<pre class="fa-bitmap-pre">${coloredRows}</pre>`;
  html += `<div class="fa-proc-box"><b>¿Cómo busca y reserva espacio el sistema operativo?</b>`;
  if (files.length === 0) {
    html += `<span class="fa-proc-step"><b class="fa-step-n">1</b> Lee la secuencia de bits del disco.</span>
      <span class="fa-proc-step"><b class="fa-step-n">2</b> Busca bits en 0 (libres) hasta juntar los bloques que necesita el archivo.</span>
      <span class="fa-proc-step"><b class="fa-step-n">3</b> Marca esos bits como 1 (ocupado). Crea un archivo con este método para ver un ejemplo real.</span>`;
  } else {
    files.forEach(f => {
      html += `<div class="fa-proc-file">
        <span class="fa-proc-step"><b class="fa-step-n">1</b> Para "${faEsc(f.name)}" (${f.sizeBlocks} bloques) el sistema leyó el bitmap y buscó bits en 0.</span>
        <span class="fa-proc-step"><b class="fa-step-n">2</b> Encontró y reservó: [${f.dataBlocks.map(b => 'B' + b).join(', ')}].</span>
        <span class="fa-proc-step"><b class="fa-step-n">3</b> Marcó esos bits como 1 (ocupado) en el mapa de arriba.</span>
      </div>`;
    });
  }
  html += `</div>`;
  el.innerHTML = html;
}

// ── IV. FAT — Tabla de Asignación de Archivos ──
function faRenderStructFAT() {
  const el = document.getElementById('faStruct-fat');
  if (!el) return;
  const entries = [];
  for (let i = 0; i < faFatTable.length; i++) {
    if (faFatTable[i] !== -2) {
      entries.push({ bloque: i, siguiente: faFatTable[i] === -1 ? 'FIN' : faFatTable[i] });
    }
  }
  let html = `<div class="fa-struct-title">📋 Tabla FAT — cada bloque "conoce" cuál es el siguiente</div>`;
  html += `<div class="fa-fat-wrap"><div class="fa-fat-table-box">`;
  if (entries.length === 0) {
    html += `<div class="trace-placeholder">La tabla FAT está vacía. Crea un archivo con método FAT para llenarla.</div>`;
  } else {
    html += `<table class="data-table"><thead><tr><th>Bloque</th><th>Siguiente bloque</th></tr></thead><tbody>`;
    entries.forEach(e => {
      html += `<tr><td class="hi">B${e.bloque}</td><td>${e.siguiente === 'FIN' ? '<span class="hi-err">FIN</span>' : 'B' + e.siguiente}</td></tr>`;
    });
    html += `</tbody></table>`;
  }
  html += `</div></div>`;

  const files = faFiles.filter(f => f.method === 'fat');
  html += `<div class="fa-proc-box"><b>¿Cómo abre el archivo el sistema operativo?</b>`;
  if (files.length === 0) {
    html += `<span class="fa-proc-step"><b class="fa-step-n">1</b> Busca el primer bloque del archivo en el directorio.</span>
      <span class="fa-proc-step"><b class="fa-step-n">2</b> Consulta la FAT para saber cuál es el siguiente bloque.</span>
      <span class="fa-proc-step"><b class="fa-step-n">3</b> Repite hasta llegar a FIN. Crea un archivo con este método para ver un ejemplo real.</span>`;
  } else {
    files.forEach(f => {
      html += `<div class="fa-proc-file">
        <span class="fa-proc-step"><b class="fa-step-n">1</b> El directorio de "${faEsc(f.name)}" guarda: Inicio = B${f.primerBloque}.</span>
        <span class="fa-proc-step"><b class="fa-step-n">2</b> Lee B${f.primerBloque} y consulta la FAT en cada paso: ${faBuildFATTrace(f.primerBloque).split(' → ').map(b => b === 'FIN' ? b : 'B' + b).join(' → ')}.</span>
        <span class="fa-proc-step"><b class="fa-step-n">3</b> La FAT indica FIN: el archivo ya fue leído por completo.</span>
      </div>`;
    });
  }
  html += `</div>`;
  el.innerHTML = html;
}

// ── VI. BASADO EN EXTENSIONES — bloques contiguos (extents) ──
function faRenderStructExtension() {
  const el = document.getElementById('faStruct-extension');
  if (!el) return;
  const files = faFiles.filter(f => f.method === 'extension');
  if (files.length === 0) {
    faPlaceholder(el, 'Crea un archivo con método Extensión para ver sus extents (grupos de bloques contiguos).');
    return;
  }
  let html = `<div class="fa-struct-title">📦 Asignación por Extensiones — grupos de bloques contiguos (extents)</div>`;
  files.forEach(f => {
    html += `<div style="margin-bottom:8px"><b>${faEsc(f.name)}</b><div class="fa-extent-row">`;
    f.extents.forEach((ext, i) => {
      const fin = ext.inicio + ext.longitud - 1;
      html += `<span class="fa-extent-chip">Extent ${i + 1}: B${ext.inicio}–B${fin} (${ext.longitud} bloques)</span>`;
    });
    html += `</div></div>`;
  });
  html += `<div class="fa-proc-box"><b>¿Cómo abre el archivo el sistema operativo?</b>`;
  files.forEach(f => {
    html += `<div class="fa-proc-file">
      <span class="fa-proc-step"><b class="fa-step-n">1</b> Lee la información de "${faEsc(f.name)}": ${f.extents.length} extent(s), cada uno con (inicio, longitud) en vez de una dirección por bloque.</span>
      <span class="fa-proc-step"><b class="fa-step-n">2</b> Lee cada extent de forma continua: ${f.extents.map(e => `B${e.inicio}..B${e.inicio + e.longitud - 1}`).join(', luego ')}.</span>
      <span class="fa-proc-step"><b class="fa-step-n">3</b> ${f.extents.length === 1 ? 'Al ser un solo extent, la lectura fue en línea recta.' : 'Al necesitar varios extents, el disco tuvo que saltar entre ellos, aunque cada uno se lee de forma continua.'}</span>
    </div>`;
  });
  html += `</div>`;
  el.innerHTML = html;
}

// ── VII. INDEXADA POR MULTINIVEL — árbol de índices ──
function faRenderStructMultilevel() {
  const el = document.getElementById('faStruct-multinivel');
  if (!el) return;
  const files = faFiles.filter(f => f.method === 'multinivel');
  if (files.length === 0) {
    faPlaceholder(el, 'Crea un archivo con método Multinivel para ver el índice principal, los índices secundarios y los datos.');
    return;
  }
  let html = `<div class="fa-struct-title">🗂 Indexada por Multinivel — índices organizados en varios niveles</div>`;
  files.forEach(f => {
    html += `<div style="margin-bottom:14px"><b>${faEsc(f.name)}</b>
      <div class="fa-ml-tree">
        <div class="fa-ml-root">Índice Principal · B${f.idx1}</div>
        <div class="fa-ml-l2-row">`;
    f.tablaL2.forEach((nivel, i) => {
      html += `<div class="fa-ml-l2-box">
        <div class="fa-ml-l2-head">Índice L2 #${i + 1} · B${nivel.bloqueIndice}</div>
        ${nivel.datos.map(d => `<span class="fa-ml-data-chip">B${d}</span>`).join('')}
      </div>`;
    });
    html += `</div></div></div>`;
  });
  html += `<div class="fa-proc-box"><b>¿Cómo abre el archivo el sistema operativo?</b>`;
  files.forEach(f => {
    const primerL2 = f.tablaL2[0];
    html += `<div class="fa-proc-file">
      <span class="fa-proc-step"><b class="fa-step-n">1</b> Busca "${faEsc(f.name)}" y encuentra su índice principal: B${f.idx1}.</span>
      <span class="fa-proc-step"><b class="fa-step-n">2</b> El índice principal indica a qué índice secundario ir, por ejemplo B${primerL2.bloqueIndice} (Índice L2 #1).</span>
      <span class="fa-proc-step"><b class="fa-step-n">3</b> Abre ese índice secundario y ahí sí lee los bloques de datos: [${primerL2.datos.join(', ')}]${f.tablaL2.length > 1 ? ', y repite el proceso con los demás índices L2' : ''}.</span>
      <span class="fa-proc-step"><b class="fa-step-n">4</b> Este archivo usa ${f.tablaL2.length} índice(s) de segundo nivel para administrar sus ${f.sizeBlocks} bloques de datos.</span>
    </div>`;
  });
  html += `</div>`;
  el.innerHTML = html;
}

// ── FORMATEAR DISCO / CREAR EJEMPLOS ──
let faFormatType = 'default';

function faFormatDisk() {
  const total = parseInt(document.getElementById('faTotalBlocksInput')?.value, 10) || 64;
  const selected = document.getElementById('faFormatSelect')?.value || 'default';
  faFormatType = selected;
  faInitDisk(total);
  if (selected === 'fat') {
    // inicializar FAT vacío
    faFatTable = faInitFAT(faTotalBlocks);
  }
  faRenderAll();
  faLog(`🧹 Disco formateado (${faTotalBlocks} bloques) — formato: ${selected}`, 'trace-ok');
}

function faCreateFileWithParams(name, size, method) {
  faLog(`Creando (ejemplo): "${faEsc(name)}" · ${size} bloques · Método: ${method || faMethod}`,'trace-info');
  const prevMethod = faMethod;
  faMethod = method || faMethod;
  // reutilizar parte de faCreateFile pero sin tocar inputs
  const id = 'F' + faFileCounter;
  const color = FA_COLORS[(faFileCounter - 1) % FA_COLORS.length];
  let dataBlocks = [];
  let indexBlock = null;
  let chainOrder = [];
  let primerBloque = null;
  let extents = null;
  let tablaL2 = null;
  let idx1 = null;

  const sizeN = parseInt(size, 10);
  if (!sizeN || sizeN < 1) {
    faLog(`Tamaño inválido para ejemplo: ${size}`, 'trace-err');
    faMethod = prevMethod;
    return false;
  }

  // asignación similar a faCreateFile
  if (faMethod === 'contiguous') {
    faLog(`Buscando ${sizeN} bloques contiguos (First Fit)...`, 'trace-info');
    const start = faFindContiguous(sizeN);
    if (start === -1) { faMethod = prevMethod; return false; }
    faLog(`Hueco encontrado: ${start}..${start + sizeN - 1}`, 'trace-ok');
    dataBlocks = Array.from({ length: sizeN }, (_, k) => start + k);
    dataBlocks.forEach(idx => { faDisk[idx].free = false; faDisk[idx].fileId = id; faDisk[idx].role = 'data'; });
  } else if (faMethod === 'linked') {
    faLog(`Buscando ${sizeN} bloques libres (Enlazada)...`, 'trace-info');
    const found = faFindNFree(sizeN); if (!found) { faMethod = prevMethod; return false; }
    faLog(`Bloques: [${found.join(', ')}]`, 'trace-ok');
    dataBlocks = found; chainOrder = found.slice(); dataBlocks.forEach(idx => { faDisk[idx].free = false; faDisk[idx].fileId = id; faDisk[idx].role = 'data'; });
  } else if (faMethod === 'indexed') {
    faLog(`Buscando ${sizeN + 1} bloques (Indexada: 1 índice + ${sizeN} datos)...`, 'trace-info');
    const found = faFindNFree(sizeN + 1); if (!found) { faMethod = prevMethod; return false; }
    indexBlock = found[0]; dataBlocks = found.slice(1);
    faLog(`Índice: ${indexBlock}; datos: [${dataBlocks.join(', ')}]`, 'trace-ok');
    dataBlocks.forEach(idx => { faDisk[idx].free = false; faDisk[idx].fileId = id; faDisk[idx].role = 'data'; });
    faDisk[indexBlock].free = false; faDisk[indexBlock].fileId = id; faDisk[indexBlock].role = 'index';
  } else if (faMethod === 'bitmap') {
    faLog(`Asignando vía bitmap (${sizeN} bloques)...`, 'trace-info');
    const res = faAllocateBitmap(sizeN); if (!res.ok) { faMethod = prevMethod; return false; }
    dataBlocks = res.bloques; faLog(`Bloques bitmap: [${dataBlocks.join(', ')}]`, 'trace-ok');
    dataBlocks.forEach(idx => { faDisk[idx].fileId = id; faDisk[idx].free = false; faDisk[idx].role = 'data'; });
  } else if (faMethod === 'fat') {
    faLog(`Asignando vía FAT (${sizeN} bloques)...`, 'trace-info');
    const res = faAllocateFAT(sizeN); if (!res.ok) { faMethod = prevMethod; return false; }
    primerBloque = res.primerBloque; dataBlocks = res.bloques; faLog(`FAT: primer ${primerBloque}; secuencia [${dataBlocks.join(', ')}]`, 'trace-ok');
    dataBlocks.forEach(idx => { faDisk[idx].fileId = id; faDisk[idx].free = false; faDisk[idx].role = 'data'; }); chainOrder = res.bloques.slice();
  } else if (faMethod === 'extension') {
    faLog(`Asignando vía extents (${sizeN} bloques)...`, 'trace-info');
    const res = faAllocateExtent(sizeN); if (!res.ok) { faMethod = prevMethod; return false; }
    extents = res.extents; faLog(`Extents: ${extents.map(e=>`[${e.inicio}:${e.longitud}]`).join(', ')}`, 'trace-ok');
    dataBlocks = extents.flatMap(ext => rango(ext.inicio, ext.inicio + ext.longitud - 1)); dataBlocks.forEach(idx => { faDisk[idx].fileId = id; faDisk[idx].free = false; faDisk[idx].role = 'data'; });
  } else if (faMethod === 'multinivel') {
    faLog(`Asignación multinivel (${sizeN})...`, 'trace-info');
    const res = faAllocateMultilevel(sizeN); if (!res.ok) { faMethod = prevMethod; return false; }
    idx1 = res.idx1; tablaL2 = res.tablaL2; dataBlocks = res.dataBlocks; faLog(`IDX1: ${idx1}; L2: ${tablaL2.map(n=>n.bloqueIndice).join(', ')}`, 'trace-ok');
    dataBlocks.forEach(idx => { faDisk[idx].fileId = id; faDisk[idx].free = false; faDisk[idx].role = 'data'; }); faDisk[idx1].fileId = id; tablaL2.forEach(nivel => { faDisk[nivel.bloqueIndice].fileId = id; });
  } else {
    faMethod = prevMethod; return false;
  }

  faFiles.push({ id, name, method: faMethod, color, sizeBlocks: sizeN, dataBlocks, indexBlock, chainOrder, primerBloque, extents, idx1, tablaL2 });
  faFileCounter++;
  faLog(`✓ Ejemplo: "${faEsc(name)}" creado (${faMethod}, ${sizeN} bloques)`, 'trace-ok');
  faMethod = prevMethod;
  return true;
}

function faCreateSampleFiles() {
  // crea 3 archivos de ejemplo con distintos tamaños y métodos
  const prevTotal = faTotalBlocks;
  const prevMethod = faMethod;
  faFormatDisk();
  const examples = [
    { name: 'datos.txt', size: 4, method: 'contiguous' },
    { name: 'log.txt', size: 8, method: 'linked' },
    { name: 'indice.db', size: 6, method: 'indexed' }
  ];
  examples.forEach(ex => {
    faCreateFileWithParams(ex.name, ex.size, ex.method);
  });
  faLog('✨ Archivos de ejemplo creados.', 'trace-ok');
  faRenderAll();
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