// A sample vault for the specimen: a student's, plausible, and nobody's in particular.
export const folders = [
  ['Inbox', 7], ['Essays', 9], ['Logic', 24], ['Reading', 48], ['Lectures', 36], ['Seminar', 14],
  ['Field notes', 31], ['People', 18], ['Projects', 6], ['Recipes', 22], ['Journal', 212], ['Archive', 140],
].map(([name, count]) => ({ name, count, path: name }));

/** The notes of the folder the specimen opens: [title, words]. */
export const logic = [
  ['Why study logic', 420], ['Arguments and their parts', 980], ['Validity and soundness', 1340], ['Propositional connectives', 1720],
  ['Truth tables', 2210], ['Translating from English', 1460], ['Tautologies and contradictions', 760], ['Logical equivalence', 890],
  ['Natural deduction: conjunction', 640], ['Natural deduction: the conditional', 1510], ['Proof by contradiction', 2680], ['Disjunction and cases', 1120],
  ['Problem set 1', 310], ['Problem set 2', 280], ['Quantifiers', 2340], ['Scope and binding', 1180],
  ['Identity', 720], ['Definite descriptions', 1630], ['Problem set 3', 350], ['Soundness of the system', 1940],
  ['Completeness, in outline', 2460], ['What logic leaves out', 870], ['Revision: the rules on one page', 540], ['Mock exam', 1260],
].map(([title, words], i) => ({ title, words, number: i + 1 }));

export const OPEN = 'Truth tables';
export const headings = ['What a table shows', 'Building one', 'Reading validity off it', 'Shortcuts'];
export const subfolders = [['Problem sets', 3], ['Past papers', 8], ['Diagrams', 5]].map(([name, count]) => ({ name, count, path: `Logic/${name}` }));

/** A note's length as a bar's height in units: 1 for a stub, 5 for a long piece. */
export const size = (words) => Math.max(1, Math.min(5, Math.ceil(Math.log2(words / 150))));

/** Bars for a folder the specimen doesn't open: lengths that look written, the same on every run. */
export function lengths(name, count) {
  let seed = Array.from(name).reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
  return Array.from({ length: count }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return 1 + Math.floor(((seed >>> 8) % 1000) / 1000 * 5 * (0.45 + ((seed >>> 20) % 100) / 180));
  }).map((n) => Math.max(1, Math.min(5, n)));
}

export const properties = [['Status', 'Draft'], ['Course', 'Logic'], ['Week', '6'], ['Updated', '12 November'], ['Sources', '']];
