// ══════════════════════════════════════════════════════
//  mem-algoritmos.js — Algoritmos de Gestión de Memoria
//  First Fit · Best Fit · Worst Fit · Buddy System
//
//  NOTA IMPORTANTE sobre el bug "todos dan el mismo resultado":
//  Ocurría porque el estado de los bloques se mutaba entre ejecuciones.
//  Aquí siempre se genera un estado inicial FRESCO antes de cada asignación.
// ══════════════════════════════════════════════════════

// ─── HELPERS ─────────────────────────────────────────

function freshFreeBlock(totalSize) {
  // Siempre genera un nuevo bloque libre fresco — NO reutiliza estado previo
  return [{ id: 'free-0', start: 0, end: totalSize - 1, size: totalSize, free: true }];
}

function splitBlock(blocks, idx, processSize, proc) {
  // Divide el bloque en [proceso][hueco restante] y retorna nuevo array
  const hole = blocks[idx];
  const newBlocks = blocks.slice(0, idx);
  newBlocks.push({
    id: proc.id,
    start: hole.start,
    end: hole.start + processSize - 1,
    size: processSize,
    free: false,
    processId: proc.id,
    color: proc.color,
    name: proc.name
  });
  const remaining = hole.size - processSize;
  if (remaining > 0) {
    newBlocks.push({
      id: `free-${hole.start + processSize}`,
      start: hole.start + processSize,
      end: hole.end,
      size: remaining,
      free: true
    });
  }
  return newBlocks.concat(blocks.slice(idx + 1));
}

// ═══════════════════════════════════════════════════════
//  MEMORIA DINÁMICA
// ═══════════════════════════════════════════════════════

function firstFitDynamic(processes, totalSize) {
  // Estado FRESCO — clave para que no se "pegue" el resultado anterior
  let blocks = freshFreeBlock(totalSize);
  const trace = [], metrics = [], allocated = [], rejected = [];

  processes.forEach(p => {
    const idx = blocks.findIndex(b => b.free && b.size >= p.size);
    if (idx === -1) {
      trace.push({ type: 'err', text: `✗ ${p.id} (${p.name}, ${p.size} MB) → Sin hueco disponible` });
      rejected.push(p);
      return;
    }
    const hole = blocks[idx];
    blocks = splitBlock(blocks, idx, p.size, p);
    trace.push({ type: 'ok', text: `✓ ${p.id} (${p.name}, ${p.size} MB) → [${hole.start}–${hole.start + p.size - 1}] (First Fit, hueco era ${hole.size} MB)` });
    allocated.push(p);
    metrics.push({ ...p, start: hole.start, end: hole.start + p.size - 1, internalFrag: 0, allocSize: p.size });
  });

  return { blocks, allocated, rejected, trace, metrics, type: 'dynamic' };
}

function bestFitDynamic(processes, totalSize) {
  let blocks = freshFreeBlock(totalSize);
  const trace = [], metrics = [], allocated = [], rejected = [];

  processes.forEach(p => {
    // Ordenar por desperdicio menor (tamaño del hueco - tamaño del proceso)
    const candidates = blocks
      .map((b, i) => ({ ...b, _idx: i }))
      .filter(b => b.free && b.size >= p.size)
      .sort((a, b) => (a.size - p.size) - (b.size - p.size));

    if (!candidates.length) {
      trace.push({ type: 'err', text: `✗ ${p.id} (${p.name}, ${p.size} MB) → Sin hueco disponible` });
      rejected.push(p);
      return;
    }
    const best = candidates[0];
    const idx = best._idx;
    const hole = blocks[idx];
    blocks = splitBlock(blocks, idx, p.size, p);
    trace.push({ type: 'ok', text: `✓ ${p.id} (${p.name}, ${p.size} MB) → [${hole.start}–${hole.start + p.size - 1}] (Best Fit, hueco era ${hole.size} MB, desperdicio ${hole.size - p.size} MB)` });
    allocated.push(p);
    metrics.push({ ...p, start: hole.start, end: hole.start + p.size - 1, internalFrag: 0, allocSize: p.size });
  });

  return { blocks, allocated, rejected, trace, metrics, type: 'dynamic' };
}

function worstFitDynamic(processes, totalSize) {
  let blocks = freshFreeBlock(totalSize);
  const trace = [], metrics = [], allocated = [], rejected = [];

  processes.forEach(p => {
    // Ordenar por mayor desperdicio (hueco más grande)
    const candidates = blocks
      .map((b, i) => ({ ...b, _idx: i }))
      .filter(b => b.free && b.size >= p.size)
      .sort((a, b) => b.size - a.size);

    if (!candidates.length) {
      trace.push({ type: 'err', text: `✗ ${p.id} (${p.name}, ${p.size} MB) → Sin hueco disponible` });
      rejected.push(p);
      return;
    }
    const worst = candidates[0];
    const idx = worst._idx;
    const hole = blocks[idx];
    blocks = splitBlock(blocks, idx, p.size, p);
    trace.push({ type: 'ok', text: `✓ ${p.id} (${p.name}, ${p.size} MB) → [${hole.start}–${hole.start + p.size - 1}] (Worst Fit, hueco era ${hole.size} MB, desperdicio ${hole.size - p.size} MB)` });
    allocated.push(p);
    metrics.push({ ...p, start: hole.start, end: hole.start + p.size - 1, internalFrag: 0, allocSize: p.size });
  });

  return { blocks, allocated, rejected, trace, metrics, type: 'dynamic' };
}

// ═══════════════════════════════════════════════════════
//  MEMORIA FIJA
// ═══════════════════════════════════════════════════════

function makeFixedPartitions(numParts, totalSize) {
  const partSize = Math.floor(totalSize / numParts);
  return Array.from({ length: numParts }, (_, i) => ({
    id: `part-${i}`,
    partIndex: i,
    start: i * partSize,
    end: (i + 1) * partSize - 1,
    size: partSize,
    free: true,
    processId: null,
    color: null,
    name: null,
    internalFrag: 0
  }));
}

function firstFitFixed(processes, numParts, totalSize) {
  const parts = makeFixedPartitions(numParts, totalSize);
  const trace = [], metrics = [], allocated = [], rejected = [];
  const partSize = parts[0]?.size || 0;

  processes.forEach(p => {
    if (p.size > partSize) {
      trace.push({ type: 'err', text: `✗ ${p.id} (${p.name}, ${p.size} MB) → Excede tamaño de partición (${partSize} MB)` });
      rejected.push(p);
      return;
    }
    const idx = parts.findIndex(b => b.free);
    if (idx === -1) {
      trace.push({ type: 'err', text: `✗ ${p.id} (${p.name}, ${p.size} MB) → Sin partición libre` });
      rejected.push(p);
      return;
    }
    const frag = parts[idx].size - p.size;
    parts[idx] = { ...parts[idx], free: false, processId: p.id, color: p.color, name: p.name, internalFrag: frag };
    trace.push({ type: 'ok', text: `✓ ${p.id} (${p.name}, ${p.size} MB) → Partición ${idx} [${parts[idx].start}–${parts[idx].end}], frag. interna: ${frag} MB` });
    allocated.push(p);
    metrics.push({ ...p, start: parts[idx].start, end: parts[idx].end, partition: idx, internalFrag: frag, allocSize: partSize });
  });

  return { blocks: parts, allocated, rejected, trace, metrics, type: 'fixed', partSize };
}

function bestFitFixed(processes, numParts, totalSize) {
  const parts = makeFixedPartitions(numParts, totalSize);
  const trace = [], metrics = [], allocated = [], rejected = [];
  const partSize = parts[0]?.size || 0;

  processes.forEach(p => {
    // Con particiones iguales best/first/worst son equivalentes en cuanto a qué partición queda libre
    // pero Best Fit elige la que tenga menor desperdicio → como todas son del mismo tamaño, misma lógica
    // La diferencia real se da si hubiera particiones de distintos tamaños; lo implementamos correctamente:
    const candidates = parts
      .map((b, i) => ({ ...b, _idx: i }))
      .filter(b => b.free && b.size >= p.size)
      .sort((a, b) => (a.size - p.size) - (b.size - p.size));

    if (!candidates.length) {
      trace.push({ type: 'err', text: `✗ ${p.id} (${p.name}, ${p.size} MB) → Sin partición libre adecuada` });
      rejected.push(p);
      return;
    }
    const best = candidates[0];
    const idx = best._idx;
    const frag = parts[idx].size - p.size;
    parts[idx] = { ...parts[idx], free: false, processId: p.id, color: p.color, name: p.name, internalFrag: frag };
    trace.push({ type: 'ok', text: `✓ ${p.id} (${p.name}, ${p.size} MB) → Partición ${idx} (Best Fit), frag. interna: ${frag} MB` });
    allocated.push(p);
    metrics.push({ ...p, start: parts[idx].start, end: parts[idx].end, partition: idx, internalFrag: frag, allocSize: partSize });
  });

  return { blocks: parts, allocated, rejected, trace, metrics, type: 'fixed', partSize };
}

function worstFitFixed(processes, numParts, totalSize) {
  const parts = makeFixedPartitions(numParts, totalSize);
  const trace = [], metrics = [], allocated = [], rejected = [];
  const partSize = parts[0]?.size || 0;

  processes.forEach(p => {
    const candidates = parts
      .map((b, i) => ({ ...b, _idx: i }))
      .filter(b => b.free && b.size >= p.size)
      .sort((a, b) => b.size - a.size);

    if (!candidates.length) {
      trace.push({ type: 'err', text: `✗ ${p.id} (${p.name}, ${p.size} MB) → Sin partición libre adecuada` });
      rejected.push(p);
      return;
    }
    const worst = candidates[0];
    const idx = worst._idx;
    const frag = parts[idx].size - p.size;
    parts[idx] = { ...parts[idx], free: false, processId: p.id, color: p.color, name: p.name, internalFrag: frag };
    trace.push({ type: 'ok', text: `✓ ${p.id} (${p.name}, ${p.size} MB) → Partición ${idx} (Worst Fit), frag. interna: ${frag} MB` });
    allocated.push(p);
    metrics.push({ ...p, start: parts[idx].start, end: parts[idx].end, partition: idx, internalFrag: frag, allocSize: partSize });
  });

  return { blocks: parts, allocated, rejected, trace, metrics, type: 'fixed', partSize };
}

// ═══════════════════════════════════════════════════════
//  BUDDY SYSTEM
// ═══════════════════════════════════════════════════════

function nextPow2(n) {
  if (n <= 1) return 1;
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function buddySystem(processes, totalSize) {
  const memSize = nextPow2(totalSize);
  const trace = [], metrics = [], allocated = [], rejected = [];

  // Estado mutable del buddy — array de bloques
  // Cada bloque: { id, start, size, free, processId, color, name }
  let buddyMap = [{ id: 'b0', start: 0, size: memSize, free: true, processId: null, color: null, name: null }];

  processes.forEach(p => {
    const needed = nextPow2(p.size);
    const result = buddyAlloc(buddyMap, needed, p);
    if (!result.success) {
      trace.push({ type: 'err', text: `✗ ${p.id} (${p.name}, ${p.size} MB → necesita ${needed} MB buddy) → Sin espacio` });
      rejected.push(p);
      return;
    }
    buddyMap = result.buddyMap;
    const blk = buddyMap.find(b => !b.free && b.processId === p.id);
    const frag = blk ? blk.size - p.size : 0;
    trace.push({ type: 'ok', text: `✓ ${p.id} (${p.name}, ${p.size} MB → bloque ${needed} MB) → [${blk?.start ?? '?'}–${blk ? blk.start + blk.size - 1 : '?'}], frag. interna: ${frag} MB` });
    allocated.push(p);
    metrics.push({ ...p, start: blk?.start ?? 0, end: blk ? blk.start + blk.size - 1 : 0, allocSize: needed, internalFrag: frag });
  });

  // Bloques planos ordenados para el mapa visual
  const blocks = [...buddyMap].sort((a, b) => a.start - b.start).map(b => ({
    id: b.free ? `free-${b.start}` : b.processId,
    start: b.start, end: b.start + b.size - 1,
    size: b.size, free: b.free,
    processId: b.processId, color: b.color, name: b.name
  }));

  return { blocks, allocated, rejected, trace, metrics, type: 'buddy', memSize, buddyMap };
}

function buddyAlloc(buddyMap, needed, proc) {
  // Encuentra el bloque libre más pequeño que quepa
  const free = buddyMap
    .filter(b => b.free && b.size >= needed)
    .sort((a, b) => a.size - b.size);
  if (!free.length) return { success: false, buddyMap };

  let blk = { ...free[0] };
  let newMap = buddyMap.map(b => ({ ...b })); // copia profunda

  // Dividir hasta tamaño exacto
  while (blk.size > needed) {
    const half = blk.size / 2;
    const idx = newMap.findIndex(b => b.id === blk.id);
    if (idx === -1) break;
    const leftId  = `b${blk.start}`;
    const rightId = `b${blk.start + half}`;
    newMap.splice(idx, 1,
      { id: leftId,  start: blk.start,        size: half, free: true, processId: null, color: null, name: null },
      { id: rightId, start: blk.start + half,  size: half, free: true, processId: null, color: null, name: null }
    );
    blk = newMap.find(b => b.id === leftId);
    if (!blk) break;
    blk = { ...blk };
  }

  // Asignar
  const finalIdx = newMap.findIndex(b => b.id === blk.id);
  if (finalIdx === -1) return { success: false, buddyMap };
  newMap[finalIdx] = { ...blk, free: false, processId: proc.id, color: proc.color, name: proc.name };
  return { success: true, buddyMap: newMap };
}

// ═══════════════════════════════════════════════════════
//  DISPATCHER
// ═══════════════════════════════════════════════════════

function runMemAlgorithm(algo, memType, processes, totalSize, numParts) {
  if (algo === 'buddy') return buddySystem(processes, totalSize);
  if (memType === 'fixed') {
    if (algo === 'first') return firstFitFixed(processes, numParts, totalSize);
    if (algo === 'best')  return bestFitFixed(processes, numParts, totalSize);
    if (algo === 'worst') return worstFitFixed(processes, numParts, totalSize);
  }
  if (algo === 'first') return firstFitDynamic(processes, totalSize);
  if (algo === 'best')  return bestFitDynamic(processes, totalSize);
  if (algo === 'worst') return worstFitDynamic(processes, totalSize);
  return firstFitDynamic(processes, totalSize);
}

// ═══════════════════════════════════════════════════════
//  MÉTRICAS
// ═══════════════════════════════════════════════════════

function computeMemMetrics(result, totalSize) {
  const { blocks, allocated, rejected } = result;
  const usedSize  = blocks.filter(b => !b.free).reduce((s, b) => s + (b.size || 0), 0);
  const freeSize  = totalSize - usedSize;
  const holes     = blocks.filter(b => b.free);
  const holeCount = holes.length;
  const maxHole   = holes.length ? Math.max(...holes.map(b => b.size)) : 0;

  let extFrag = 0;
  if (holeCount > 1) {
    const totalFree = holes.reduce((s, b) => s + b.size, 0);
    extFrag = parseFloat(((1 - maxHole / totalFree) * 100).toFixed(1));
  }

  const totalIntFrag = result.metrics.reduce((s, m) => s + (m.internalFrag || 0), 0);
  const utilPct      = parseFloat((usedSize / totalSize * 100).toFixed(1));

  return {
    usedSize, freeSize, holeCount, maxHole,
    extFrag, totalIntFrag, utilPct,
    allocCount: allocated.length, rejectedCount: rejected.length
  };
}

// ═══════════════════════════════════════════════════════
//  LIBERAR PROCESO
// ═══════════════════════════════════════════════════════

function freeProcessFromMemory(blocks, processId, memType) {
  if (memType === 'fixed') {
    return blocks.map(b => {
      if (b.processId === processId) {
        return { ...b, free: true, processId: null, color: null, name: null, internalFrag: 0 };
      }
      return b;
    });
  }
  // Dinámica: liberar y fusionar bloques libres adyacentes
  const freed = blocks.map(b => {
    if (!b.free && b.processId === processId) {
      return { id: `free-${b.start}`, start: b.start, end: b.end, size: b.size, free: true };
    }
    return { ...b };
  });
  return mergeFreeBlocks(freed);
}

function mergeFreeBlocks(blocks) {
  const sorted = [...blocks].sort((a, b) => a.start - b.start);
  const merged = [];
  sorted.forEach(b => {
    if (merged.length && merged[merged.length - 1].free && b.free) {
      const prev = merged[merged.length - 1];
      prev.end  = b.end;
      prev.size = prev.end - prev.start + 1;
      prev.id   = `free-${prev.start}`;
    } else {
      merged.push({ ...b });
    }
  });
  return merged;
}

// ═══════════════════════════════════════════════════════
//  PARSEO DE ARCHIVO
//  Formato: N en primera línea, luego N líneas:
//    ID, llegada, duración, memoria
// ═══════════════════════════════════════════════════════

function parseInputFile(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  if (!lines.length) return { error: 'El archivo está vacío.' };

  const n = parseInt(lines[0]);
  if (isNaN(n) || n < 1) return { error: 'La primera línea debe ser el número de procesos (ej: 4).' };
  if (lines.length < n + 1) return { error: `Se esperan ${n} procesos pero hay ${lines.length - 1} líneas de datos.` };

  const procs = [];
  for (let i = 1; i <= n; i++) {
    const parts = lines[i].split(/[,;\t ]+/);
    if (parts.length < 4) return { error: `Línea ${i + 1} necesita: ID, llegada, duración, memoria. Encontrado: "${lines[i]}"` };

    const id      = parts[0].trim();
    const arrival = parseFloat(parts[1]);
    const burst   = parseFloat(parts[2]);
    const mem     = parseFloat(parts[3]);

    if (isNaN(arrival) || arrival < 0) return { error: `Línea ${i + 1}: tiempo de llegada inválido.` };
    if (isNaN(burst)   || burst <= 0)  return { error: `Línea ${i + 1}: duración debe ser > 0.` };
    if (isNaN(mem)     || mem <= 0)    return { error: `Línea ${i + 1}: memoria debe ser > 0.` };

    procs.push({ id, arrival, burst, mem });
  }
  return { procs };
}