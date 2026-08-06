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
  faRenderChains();
  faRenderFilesTable();
}

// ── RENDER BITMAP / FAT ──
function faRenderBitmapArea() {
  const area = document.getElementById('faBitmapArea');
  if (!area) return;
  const bitmap = faBuildBitmap();
  // mostrar en grupos de 8 para legibilidad
  const groups = [];
  for (let i = 0; i < bitmap.length; i += 8) groups.push(bitmap.slice(i, i + 8));
  area.textContent = groups.map((g, idx) => `${String(idx * 8).padStart(3,' ')}: ${g}`).join('\n');
}

// Nota: la UI de la Tabla FAT fue eliminada por preferencia del usuario.

// integrar renders adicionales
function faRenderAll() {
  faRenderDisk();
  faRenderChains();
  faRenderFilesTable();
  faRenderBitmapArea();
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