// ============================================================
//  disco-algoritmos-avanzado.js
//  Extensión ADITIVA del módulo disco-algoritmos.js
//  No modifica ninguna función existente (contigua/enlazada/indexada).
//  Agrega 4 técnicas nuevas al simulador:
//    1) Mapa de Bits (Bitmap)      -> gestión de espacio libre
//    2) FAT (File Allocation Table)
//    3) Asignación basada en Extensiones (Extent-Based)
//    4) Asignación Indexada Multinivel
// ============================================================

const PUNTEROS_POR_BLOQUE = 4; // tamaño reducido a propósito, para que
                                // la tabla de 2do nivel se vea completa
                                // en pantalla con discos pequeños (64 bloques)

function rango(a, b) {
  const arr = [];
  for (let i = a; i <= b; i++) arr.push(i);
  return arr;
}

// ------------------------------------------------------------
// 1) MAPA DE BITS (BITMAP) — gestión de espacio libre
// ------------------------------------------------------------
// En vez de recorrer el arreglo "disk" preguntando b.estado === 'libre',
// se construye una cadena de bits (0 = libre, 1 = ocupado) y la búsqueda
// de huecos se hace directamente sobre esa cadena. Es la misma idea que
// usa un sistema de archivos real (ej. bitmap de bloques en ext2/ext3).

function buildBitmap(disk) {
  return disk.map(b => (b.estado === 'libre' ? '0' : '1')).join('');
}

function findFreeRunBitmap(disk, sizeBlocks) {
  const bitmap = buildBitmap(disk);
  let run = 0, inicio = -1;
  for (let i = 0; i < bitmap.length; i++) {
    if (bitmap[i] === '0') {
      if (run === 0) inicio = i;
      run++;
      if (run === sizeBlocks) return inicio;
    } else {
      run = 0;
      inicio = -1;
    }
  }
  return -1;
}

function allocateBitmap(disk, sizeBlocks) {
  const inicio = findFreeRunBitmap(disk, sizeBlocks);
  if (inicio === -1) {
    return { ok: false, error: 'No hay hueco contiguo suficiente según el mapa de bits' };
  }
  for (let i = inicio; i < inicio + sizeBlocks; i++) disk[i].estado = 'ocupado';
  return {
    ok: true,
    metodo: 'Bitmap',
    inicio,
    fin: inicio + sizeBlocks - 1,
    bloques: rango(inicio, inicio + sizeBlocks - 1),
  };
}

function freeBitmap(disk, file) {
  file.bloques.forEach(b => (disk[b].estado = 'libre'));
}

// ------------------------------------------------------------
// 2) FAT (FILE ALLOCATION TABLE)
// ------------------------------------------------------------
// Una única tabla del tamaño del disco. fat[i] guarda:
//   -2  -> bloque i libre
//   -1  -> bloque i es el último del archivo (EOF)
//   n   -> bloque i apunta al bloque n (siguiente del mismo archivo)
// El directorio del archivo solo necesita guardar el PRIMER bloque.

function initFAT(totalBlocks) {
  return new Array(totalBlocks).fill(-2);
}

function allocateFAT(disk, fat, sizeBlocks) {
  const libres = [];
  for (let i = 0; i < disk.length && libres.length < sizeBlocks; i++) {
    if (disk[i].estado === 'libre') libres.push(i);
  }
  if (libres.length < sizeBlocks) {
    return { ok: false, error: 'No hay suficientes bloques libres en el disco' };
  }
  for (let i = 0; i < libres.length; i++) {
    const bloque = libres[i];
    disk[bloque].estado = 'ocupado';
    fat[bloque] = (i === libres.length - 1) ? -1 : libres[i + 1];
  }
  return { ok: true, metodo: 'FAT', primerBloque: libres[0], bloques: libres };
}

function freeFAT(disk, fat, file) {
  let actual = file.primerBloque;
  while (actual !== -1 && actual !== undefined) {
    const siguiente = fat[actual];
    disk[actual].estado = 'libre';
    fat[actual] = -2;
    actual = siguiente;
  }
}

// Genera el texto tipo "20 -> 21 -> 22 -> FIN" para el panel de punteros,
// pero leyendo la cadena desde la FAT en lugar de desde el propio bloque.
function buildFATTrace(fat, primerBloque) {
  const pasos = [];
  let actual = primerBloque;
  while (actual !== -1 && actual !== undefined) {
    pasos.push(actual);
    actual = fat[actual];
  }
  return pasos.join(' \u2192 ') + ' \u2192 FIN';
}

// ------------------------------------------------------------
// 3) ASIGNACIÓN BASADA EN EXTENSIONES (EXTENT-BASED)
// ------------------------------------------------------------
// El archivo se guarda como una lista corta de "extensiones"
// {inicio, longitud}, cada una un tramo contiguo de disco.
// A diferencia de la contigua pura, el archivo SÍ puede quedar
// repartido en varios tramos si no hay uno solo lo bastante grande;
// a diferencia de la enlazada, no se paga un puntero por bloque,
// solo un par (inicio, longitud) por cada tramo contiguo.

function allocateExtent(disk, sizeBlocks) {
  const extents = [];
  let restantes = sizeBlocks;
  let i = 0;
  while (restantes > 0 && i < disk.length) {
    if (disk[i].estado === 'libre') {
      const inicioExtent = i;
      let largo = 0;
      while (i < disk.length && disk[i].estado === 'libre' && largo < restantes) {
        largo++;
        i++;
      }
      extents.push({ inicio: inicioExtent, longitud: largo });
      restantes -= largo;
    } else {
      i++;
    }
  }
  if (restantes > 0) {
    return { ok: false, error: 'No hay suficiente espacio libre en el disco (ni fragmentado)' };
  }
  extents.forEach(ext => {
    for (let b = ext.inicio; b < ext.inicio + ext.longitud; b++) disk[b].estado = 'ocupado';
  });
  return { ok: true, metodo: 'Extensión', extents };
}

function freeExtent(disk, file) {
  file.extents.forEach(ext => {
    for (let b = ext.inicio; b < ext.inicio + ext.longitud; b++) disk[b].estado = 'libre';
  });
}

// ------------------------------------------------------------
// 4) ASIGNACIÓN INDEXADA MULTINIVEL
// ------------------------------------------------------------
// Un bloque índice de primer nivel (IDX1) no apunta a datos, sino a
// varios bloques índice de segundo nivel (IDX2). Cada IDX2 sí apunta
// directamente a bloques de datos (máx. PUNTEROS_POR_BLOQUE cada uno).
// Permite indexar archivos mucho más grandes que los que caben en
// un solo bloque índice, pagando un nivel extra de indirección.

function allocateMultilevel(disk, sizeBlocks) {
  const numL2 = Math.ceil(sizeBlocks / PUNTEROS_POR_BLOQUE);
  const bloquesNecesarios = 1 + numL2 + sizeBlocks; // IDX1 + bloques IDX2 + datos

  const libres = [];
  for (let i = 0; i < disk.length && libres.length < bloquesNecesarios; i++) {
    if (disk[i].estado === 'libre') libres.push(i);
  }
  if (libres.length < bloquesNecesarios) {
    return { ok: false, error: 'No hay suficientes bloques libres para el esquema multinivel' };
  }

  const idx1 = libres[0];
  const idx2Blocks = libres.slice(1, 1 + numL2);
  const dataBlocks = libres.slice(1 + numL2);

  disk[idx1].estado = 'indice1';
  idx2Blocks.forEach(b => (disk[b].estado = 'indice2'));
  dataBlocks.forEach(b => (disk[b].estado = 'ocupado'));

  const tablaL2 = idx2Blocks.map((idx2Block, k) => ({
    bloqueIndice: idx2Block,
    datos: dataBlocks.slice(k * PUNTEROS_POR_BLOQUE, (k + 1) * PUNTEROS_POR_BLOQUE),
  }));

  return { ok: true, metodo: 'Multinivel', idx1, tablaL2, totalBloques: bloquesNecesarios };
}

function freeMultilevel(disk, file) {
  disk[file.idx1].estado = 'libre';
  file.tablaL2.forEach(nivel => {
    disk[nivel.bloqueIndice].estado = 'libre';
    nivel.datos.forEach(b => (disk[b].estado = 'libre'));
  });
}

// ============================================================
//  INTEGRACIÓN CON app.js (createFile / deleteFile / render)
//  Copiar estos fragmentos dentro de los switch ya existentes,
//  sin borrar los casos 'contigua' | 'enlazada' | 'indexada'.
// ============================================================

/*
  ---- dentro de createFile(nombre, sizeBlocks, metodo) ----
  switch (metodo) {
    // ...casos existentes (contigua, enlazada, indexada)...

    case 'bitmap': {
      const res = allocateBitmap(diskBlocks, sizeBlocks);
      if (!res.ok) return mostrarError(res.error);
      filesOnDisk.push({ id: nuevoId(), nombre, metodo: 'Bitmap', bloques: res.bloques });
      break;
    }

    case 'fat': {
      const res = allocateFAT(diskBlocks, fatTable, sizeBlocks);
      if (!res.ok) return mostrarError(res.error);
      filesOnDisk.push({
        id: nuevoId(), nombre, metodo: 'FAT',
        primerBloque: res.primerBloque, bloques: res.bloques,
      });
      break;
    }

    case 'extension': {
      const res = allocateExtent(diskBlocks, sizeBlocks);
      if (!res.ok) return mostrarError(res.error);
      filesOnDisk.push({ id: nuevoId(), nombre, metodo: 'Extensión', extents: res.extents });
      break;
    }

    case 'multinivel': {
      const res = allocateMultilevel(diskBlocks, sizeBlocks);
      if (!res.ok) return mostrarError(res.error);
      filesOnDisk.push({
        id: nuevoId(), nombre, metodo: 'Multinivel',
        idx1: res.idx1, tablaL2: res.tablaL2,
      });
      break;
    }
  }

  ---- dentro de deleteFile(fileId) ----
  switch (file.metodo) {
    // ...casos existentes...
    case 'Bitmap':     freeBitmap(diskBlocks, file);       break;
    case 'FAT':        freeFAT(diskBlocks, fatTable, file); break;
    case 'Extensión':  freeExtent(diskBlocks, file);        break;
    case 'Multinivel': freeMultilevel(diskBlocks, file);    break;
  }

  ---- dentro de renderDiskMap(disk) ----
  // agregar reconocimiento visual de los nuevos estados de bloque:
  //   'indice1' -> etiqueta "L1", borde doble
  //   'indice2' -> etiqueta "L2", borde simple
  // (mismo tratamiento visual que ya usas para 'indice' en la indexada simple)

  ---- panel nuevo: "Mapa de Bits del Disco" ----
  // debajo del mapa de bloques, mostrar buildBitmap(diskBlocks) como
  // una franja monoespaciada de 0s y 1s, agrupada de 8 en 8, ej:
  //   00000000 00000000 11111111 00000000 ...
*/