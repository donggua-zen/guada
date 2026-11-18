'use strict';
const fs = require('node:fs');
const path = require('node:path');
const dir = path.resolve(__dirname, '..', 'tmp');
for (const name of fs.readdirSync(dir).filter(n => /^perf-window-resize-.*\.json$/.test(n) && !n.includes('.trace.'))) {
  const r = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  console.log(JSON.stringify({ file: name, allTurns: r.allTurns, prearm: r.prearm, noCv: r.noCv, noTrace: r.noTrace,
    dom: r.finalDom, rounds: r.rounds.map(x => ({ maxFrame: x.max, p95: x.p95, tasks: x.tasks })),
    layout: r.trace?.buckets.Layout, timer: r.trace?.buckets.TimerFire }));
}
