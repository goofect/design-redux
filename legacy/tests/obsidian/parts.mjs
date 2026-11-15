// Where each spec leaves its timings and errors, and how wdio.conf.mjs joins
// them once every spec has run: kept apart from helpers.mjs, so the launcher
// loads nothing of a test's.
import fs from 'fs';
import path from 'path';

export const OUT = path.resolve('ci-output');
export const PARTS = path.join(OUT, 'parts');

/** Run by wdio.conf.mjs once every spec is done: each version's parts joined into the files ci.sh reads. */
export function joinParts() {
  if (!fs.existsSync(PARTS)) return;
  for (const v of fs.readdirSync(PARTS)) {
    const dir = path.join(PARTS, v);
    const perfs = [];
    const times = [];
    const errors = [];
    for (const f of fs.readdirSync(dir).sort()) {
      const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (f.endsWith('.timings.json')) {
        perfs.push(...data.perf);
        times.push(...data.timings);
      } else if (f.endsWith('.errors.json')) errors.push(...data);
    }
    const lines = perfs.concat(times.sort((x, y) => y[0] - x[0]).map(([ms, title]) => `${(ms / 1000).toFixed(1).padStart(5)}s  ${title}`));
    fs.writeFileSync(path.join(OUT, `${v}-timings.txt`), lines.join('\n') + '\n');
    fs.writeFileSync(path.join(OUT, `${v}-errors.txt`), errors.join('\n\n') || 'none');
  }
  fs.rmSync(PARTS, { recursive: true, force: true });
}
