const { Plugin } = require('obsidian');
module.exports = class ProbeB extends Plugin {
  onload() {
    const P = (window.__probe ??= { t0: performance.now(), log: [] });
    P.log.push([Math.round(performance.now() - P.t0), 'b:onload-start', { aEnded: P.log.some((e) => e[1] === 'a:onload-end') }]);
  }
};
