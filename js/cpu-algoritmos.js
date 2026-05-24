// ══════════════════════════════════════════════════════
//  cpu-algoritmos.js — Políticas de planificación de CPU
//  FCFS · SJF · SRT · RR
// ══════════════════════════════════════════════════════

function fcfs(procs) {
  const sorted = [...procs].sort((a, b) => a.arrival - b.arrival);
  let t = 0;
  const timeline = [], trace = [];
  sorted.forEach(p => {
    if (t < p.arrival) {
      trace.push({ type: 'idle', text: `CPU idle desde t=${t} hasta t=${p.arrival}` });
      timeline.push({ id: 'IDLE', start: t, end: p.arrival, color: '#2a3347' });
      t = p.arrival;
    }
    trace.push({ type: 'normal', text: `t=${t}: inicia ${p.id} → ejecuta ${p.burst} ut` });
    timeline.push({ id: p.id, start: t, end: t + p.burst, color: p.color });
    t += p.burst;
  });
  return { timeline, trace };
}

function sjf(procs) {
  let t = 0;
  const done = new Set(), timeline = [], trace = [];
  const total = procs.length;
  while (done.size < total) {
    const available = procs.filter(p => !done.has(p.id) && p.arrival <= t);
    if (!available.length) {
      const next = procs.filter(p => !done.has(p.id)).sort((a, b) => a.arrival - b.arrival)[0];
      trace.push({ type: 'idle', text: `CPU idle desde t=${t} hasta t=${next.arrival}` });
      timeline.push({ id: 'IDLE', start: t, end: next.arrival, color: '#2a3347' });
      t = next.arrival;
      continue;
    }
    available.sort((a, b) => a.burst - b.burst || a.arrival - b.arrival);
    const p = available[0];
    trace.push({ type: 'normal', text: `t=${t}: elige ${p.id} (duración ${p.burst} ut)` });
    timeline.push({ id: p.id, start: t, end: t + p.burst, color: p.color });
    t += p.burst;
    done.add(p.id);
  }
  return { timeline, trace };
}

function srt(procs) {
  const tasks = procs.map(p => ({ ...p, remaining: p.burst }));
  const timeline = [], trace = [];
  let t = 0;
  const completed = new Set();
  const total = tasks.length;
  while (completed.size < total) {
    const available = tasks.filter(p => !completed.has(p.id) && p.arrival <= t);
    if (!available.length) {
      const next = tasks.filter(p => !completed.has(p.id)).sort((a, b) => a.arrival - b.arrival)[0];
      trace.push({ type: 'idle', text: `t=${t}: CPU idle hasta t=${next.arrival}` });
      timeline.push({ id: 'IDLE', start: t, end: next.arrival, color: '#2a3347' });
      t = next.arrival;
      continue;
    }
    available.sort((a, b) => a.remaining - b.remaining || a.arrival - b.arrival);
    const current = available[0];
    const future = tasks.filter(p => !completed.has(p.id) && p.arrival > t).sort((a, b) => a.arrival - b.arrival);
    const nextArr = future.length ? future[0].arrival : Infinity;
    const dur = Math.min(current.remaining, nextArr - t);
    trace.push({ type: 'normal', text: `t=${t}: ejecuta ${current.id} (restante: ${current.remaining}) por ${dur} ut` });
    timeline.push({ id: current.id, start: t, end: t + dur, color: current.color });
    current.remaining -= dur;
    t += dur;
    if (current.remaining <= 0) {
      trace.push({ type: 'fin', text: `✓ ${current.id} termina en t=${t}` });
      completed.add(current.id);
    }
  }
  return { timeline: mergeTimeline(timeline), trace };
}

function rr(procs, quantum) {
  const tasks = procs.map(p => ({ ...p, remaining: p.burst }));
  const timeline = [], trace = [], queue = [];
  let t = 0;
  const completed = new Set();
  const total = tasks.length;
  while (completed.size < total) {
    tasks.filter(p => p.arrival <= t && !queue.find(q => q.id === p.id) && !completed.has(p.id))
         .forEach(p => queue.push(p));
    if (!queue.length) {
      const next = tasks.filter(p => !completed.has(p.id)).sort((a, b) => a.arrival - b.arrival)[0];
      trace.push({ type: 'idle', text: `t=${t}: CPU idle hasta t=${next.arrival}` });
      timeline.push({ id: 'IDLE', start: t, end: next.arrival, color: '#2a3347' });
      t = next.arrival;
      tasks.filter(p => p.arrival <= t && !queue.find(q => q.id === p.id) && !completed.has(p.id))
           .forEach(p => queue.push(p));
      continue;
    }
    const current = queue.shift();
    const dur = Math.min(current.remaining, quantum);
    trace.push({ type: 'normal', text: `t=${t}: ejecuta ${current.id} por ${dur} ut (quedan ${current.remaining - dur})` });
    timeline.push({ id: current.id, start: t, end: t + dur, color: current.color });
    current.remaining -= dur;
    t += dur;
    tasks.filter(p => p.arrival <= t && !queue.find(q => q.id === p.id) && !completed.has(p.id) && p.id !== current.id)
         .forEach(p => queue.push(p));
    if (current.remaining > 0) {
      queue.push(current);
    } else {
      trace.push({ type: 'fin', text: `✓ ${current.id} termina en t=${t}` });
      completed.add(current.id);
    }
    trace.push({ type: 'normal', text: `Cola RR: [${queue.map(p => p.id).join(', ') || 'vacía'}]` });
  }
  return { timeline: mergeTimeline(timeline), trace };
}

// ── HELPERS ──────────────────────────────────────────────

function mergeTimeline(tl) {
  if (!tl.length) return tl;
  const m = [{ ...tl[0] }];
  for (let i = 1; i < tl.length; i++) {
    const c = tl[i], l = m[m.length - 1];
    if (c.id === l.id && Math.abs(c.start - l.end) < 1e-9) l.end = c.end;
    else m.push({ ...c });
  }
  return m;
}

function computeCpuMetrics(procs, timeline) {
  return procs.map(p => {
    const slots = timeline.filter(s => s.id === p.id);
    const start = slots.length ? Math.min(...slots.map(s => s.start)) : p.arrival;
    const end   = slots.length ? Math.max(...slots.map(s => s.end))   : p.arrival;
    const tr    = parseFloat((end - p.arrival).toFixed(2));
    const te    = parseFloat((tr - p.burst).toFixed(2));
    return { ...p, cpuStart: start, cpuEnd: end, tr, te };
  });
}

function computeCpuUtil(timeline) {
  if (!timeline.length) return { util: 0, busy: 0, idle: 0, total: 0 };
  const total = Math.max(...timeline.map(s => s.end));
  const busy  = timeline.reduce((s, b) => b.id !== 'IDLE' ? s + (b.end - b.start) : s, 0);
  return {
    util:  parseFloat((busy / total * 100).toFixed(1)),
    busy:  parseFloat(busy.toFixed(2)),
    idle:  parseFloat((total - busy).toFixed(2)),
    total: parseFloat(total.toFixed(2))
  };
}

function countExpulsions(tl) {
  let n = 0;
  for (let i = 1; i < tl.length; i++) {
    if (tl[i].id !== 'IDLE' && tl[i - 1].id !== 'IDLE' && tl[i].id !== tl[i - 1].id) n++;
  }
  return n;
}