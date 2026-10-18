// A mind map of any size, as a note, with text the length real maps have:
// a few words most often, sometimes a sentence, now and then a line of
// details or a link. Four branches from the root, each a quarter of the
// map, so one of them is a big branch to fold. The same map for the same
// size and seed, every time.
//   node -e "process.stdout.write(require('./tests/mapgen').mapText(2000))"

const WORDS = 'law court state power review rights duty claim reason fact case rule order trade market price risk plan build test ship draft note idea theme source quote argument evidence policy history war peace treaty empire city river field seed growth'.split(' ');

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function mapText(count, seed = 7) {
  const r = rng(seed);
  const words = (n) => Array.from({ length: n }, () => WORDS[Math.floor(r() * WORDS.length)]).join(' ');
  const text = (k) => {
    const roll = r();
    let t = roll < 0.6 ? words(1 + Math.floor(r() * 4)) : roll < 0.9 ? words(5 + Math.floor(r() * 8)) : `[[${words(2)}]]`;
    t = t.charAt(0).toUpperCase() + t.slice(1) + (r() < 0.02 ? ` ${k}` : '');
    return t;
  };
  const lines = ['---', 'mindmap: true', '---', '- Map of everything'];
  let made = 1;
  const quarter = Math.max(1, Math.floor((count - 1) / 4));
  for (let top = 0; top < 4 && made < count; top++) {
    const budget = top === 3 ? count - made : quarter;
    // Breadth first under each branch, up to eight children a node.
    let used = 0;
    const branch = { text: text(made), depth: 1, kids: [] };
    used++;
    const nodes = [branch];
    let at = 0;
    while (used < budget && at < nodes.length) {
      const parent = nodes[at++];
      const fan = 2 + Math.floor(r() * 7);
      for (let k = 0; k < fan && used < budget; k++) {
        const child = { text: text(made + used), depth: parent.depth + 1, kids: [], details: r() < 0.08 ? words(6 + Math.floor(r() * 6)) : '' };
        parent.kids.push(child);
        nodes.push(child);
        used++;
      }
    }
    const emit = (n) => {
      lines.push(`${'\t'.repeat(n.depth)}- ${n.text}`);
      if (n.details) lines.push(`${'\t'.repeat(n.depth)}  ${n.details}`);
      n.kids.forEach(emit);
    };
    emit(branch);
    made += used;
  }
  return lines.join('\n') + '\n';
}

module.exports = { mapText };
