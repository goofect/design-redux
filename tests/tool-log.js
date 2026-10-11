#!/usr/bin/env node
/*
 * How a coding session spent its reading: a hook keeps a line per tool call
 * in logs/tools.jsonl (gitignored) — the tool, the file, how much came back,
 * never what — and a report sums it up.
 *
 *   node tests/tool-log.js          the latest session
 *   node tests/tool-log.js all      a line per session
 *   node tests/tool-log.js hook     (run by .claude/settings.json after each tool call)
 *
 * Re-reading a file after changing it is fine; "needless" counts reads of a
 * file not changed since it was last read. Tokens come from the session's
 * own transcript: input not served from the cache, written to it, read
 * from it, and output — the first is the one to bring down.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const log = path.join(root, 'logs', 'tools.jsonl');
const BROAD = 400;

function hook() {
  let input = '';
  process.stdin.on('data', (d) => (input += d));
  process.stdin.on('end', () => {
    try {
      const e = JSON.parse(input);
      const ti = e.tool_input || {};
      const out = e.tool_response === undefined ? '' : typeof e.tool_response === 'string' ? e.tool_response : JSON.stringify(e.tool_response);
      const rel = (f) => (f ? path.relative(e.cwd || root, path.resolve(e.cwd || root, f)) : undefined);
      const row = { t: Date.now(), s: e.session_id, tool: e.tool_name, bytes: out.length };
      if (e.transcript_path) row.tp = e.transcript_path;
      if (ti.file_path) row.file = rel(ti.file_path);
      if (e.tool_name === 'Read') {
        const file = e.tool_response && e.tool_response.file;
        row.lines = file && typeof file.numLines === 'number' ? file.numLines : (out.match(/\\n|\n/g) || []).length;
      }
      if (e.tool_name === 'Bash' && typeof ti.command === 'string') {
        // A single file shown whole or in part counts as a read of it.
        const m = ti.command.match(/^(?:cd \S+ && )?(?:cat|head|tail|sed -n '[^']*'|sed -n "[^"]*")(?: -n ?\d+)? ([\w./-]+\.\w+)\s*$/);
        if (m) {
          row.file = rel(m[1]);
          row.read = true;
        }
      }
      fs.mkdirSync(path.dirname(log), { recursive: true });
      fs.appendFileSync(log, JSON.stringify(row) + '\n');
    } catch (err) {
      /* never in the way of the session */
    }
  });
}

function sessions() {
  if (!fs.existsSync(log)) return new Map();
  const by = new Map();
  fs.readFileSync(log, 'utf8').split('\n').forEach((l) => {
    if (!l) return;
    try {
      const r = JSON.parse(l);
      if (!by.has(r.s)) by.set(r.s, []);
      by.get(r.s).push(r);
    } catch (err) {
      /* a torn line */
    }
  });
  return by;
}

function sum(rows) {
  const isRead = (r) => r.tool === 'Read' || r.read;
  const reads = rows.filter(isRead);
  const files = new Map();
  let needless = 0;
  const fresh = new Set();
  rows.forEach((r) => {
    if (!r.file) return;
    if (r.tool === 'Edit' || r.tool === 'Write' || r.tool === 'NotebookEdit') fresh.delete(r.file);
    else if (isRead(r)) {
      files.set(r.file, (files.get(r.file) || 0) + 1);
      if (fresh.has(r.file)) needless++;
      fresh.add(r.file);
    }
  });
  const bytes = {};
  rows.forEach((r) => (bytes[r.tool] = (bytes[r.tool] || 0) + (r.bytes || 0)));
  return {
    calls: rows.length,
    minutes: rows.length ? Math.round((rows[rows.length - 1].t - rows[0].t) / 60000) : 0,
    reads: reads.length,
    unique: files.size,
    repeat: reads.length ? (reads.length - files.size) / reads.length : 0,
    needless,
    broad: reads.filter((r) => (r.lines || 0) > BROAD).map((r) => `${r.file} (${r.lines})`),
    searches: rows.filter((r) => r.tool === 'Grep' || r.tool === 'Glob').length,
    bash: rows.filter((r) => r.tool === 'Bash').length,
    kb: Math.round(rows.reduce((n, r) => n + (r.bytes || 0), 0) / 1024),
    bytes,
    most: Array.from(files.entries()).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 5),
  };
}

/** A session's tokens from its transcript, each reply counted once: { fresh, written, cached, out, replies }, or null. */
function tokens(rows) {
  const tp = rows.map((r) => r.tp).filter(Boolean).pop();
  if (!tp || !fs.existsSync(tp)) return null;
  const seen = new Map();
  fs.readFileSync(tp, 'utf8').split('\n').forEach((l) => {
    if (!l.includes('"usage"')) return;
    try {
      const e = JSON.parse(l);
      const m = e.message;
      if (m && m.usage) seen.set(m.id || e.uuid, m.usage);
    } catch (err) {
      /* a line being written */
    }
  });
  const sum = { fresh: 0, written: 0, cached: 0, out: 0, replies: seen.size, peak: 0, last: 0 };
  seen.forEach((u) => {
    sum.fresh += u.input_tokens || 0;
    sum.written += u.cache_creation_input_tokens || 0;
    sum.cached += u.cache_read_input_tokens || 0;
    sum.out += u.output_tokens || 0;
    // How full the context was for this reply: everything it was given.
    const held = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    sum.peak = Math.max(sum.peak, held);
    sum.last = held;
  });
  return sum;
}

const thousands = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : String(n));

function report(which) {
  const by = sessions();
  if (!by.size) {
    console.log('No tool calls logged yet (logs/tools.jsonl).');
    return;
  }
  const pct = (x) => `${Math.round(x * 100)}%`;
  if (which === 'all') {
    by.forEach((rows, s) => {
      const r = sum(rows);
      const k = tokens(rows);
      const t = k ? `, ${thousands(k.fresh + k.written)} uncached in, ${thousands(k.out)} out` : '';
      console.log(`${String(s).slice(0, 8)}  ${new Date(rows[0].t).toISOString().slice(0, 16)}  ${r.calls} calls, ${r.reads} reads of ${r.unique} files (${pct(r.repeat)} repeat, ${r.needless} needless), ${r.searches} searches, ${r.kb} KB back${t}`);
    });
    return;
  }
  const [s, rows] = Array.from(by.entries()).pop();
  const r = sum(rows);
  console.log(`session ${s}: ${r.calls} tool calls over ${r.minutes} min`);
  console.log(`reads: ${r.reads} of ${r.unique} files — ${pct(r.repeat)} repeat, ${r.needless} of a file unchanged since last read`);
  if (r.most.length) console.log(`read most: ${r.most.map(([f, n]) => `${f} ×${n}`).join(', ')}`);
  if (r.broad.length) console.log(`broad reads (over ${BROAD} lines): ${r.broad.join(', ')}`);
  console.log(`searches: ${r.searches}, shell commands: ${r.bash}`);
  console.log(`came back: ${r.kb} KB — ${Object.entries(r.bytes).sort((a, b) => b[1] - a[1]).map(([t, b]) => `${t} ${Math.round(b / 1024)}`).join(', ')}`);
  const k = tokens(rows);
  if (k) {
    const input = k.fresh + k.written + k.cached;
    console.log(`tokens: ${thousands(k.fresh)} input not cached, ${thousands(k.written)} written to the cache, ${thousands(k.cached)} read from it (${pct(input ? k.cached / input : 0)} of input), ${thousands(k.out)} output, over ${k.replies} replies`);
    console.log(`uncached input per tool call: ${thousands(Math.round((k.fresh + k.written) / Math.max(1, r.calls)))}; context at its fullest ${thousands(k.peak)}, now ${thousands(k.last)}`);
  }
}

if (process.argv[2] === 'hook') hook();
else report(process.argv[2]);
