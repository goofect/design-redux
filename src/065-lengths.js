/* ------------------------------------------------------------------ */
/* Lengths                                                             */
/*                                                                     */
/* How long a note is, standing where a track's length does in a list. */
/* Nothing Obsidian caches holds a word count, so each note is read    */
/* once and its count kept against its modified time: it's counted     */
/* again only after it changes. A list is drawn first and its lengths  */
/* arrive a moment later.                                              */
/* ------------------------------------------------------------------ */

const WORDS_PER_MINUTE = 230;

/* Scripts written without spaces between words: each character is a word, as in Obsidian's own count. */
const UNSPACED = /[぀-ヿ㐀-䶿一-鿿가-힯]/g;

/** Words in a note's text, its properties left out. */
function countWords(text) {
  const body = String(text || '').replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, '');
  const unspaced = (body.match(UNSPACED) || []).length;
  // Markdown's own marks (#, -, >, |) aren't words: a word has a letter or digit in it.
  const spaced = body
    .replace(UNSPACED, ' ')
    .split(/\s+/)
    .filter((w) => /[0-9A-Za-zÀ-ɏͰ-ϿЀ-ӿ֐-ۿ]/.test(w)).length;
  return unspaced + spaced;
}

/** "<1 min", "4 min", "1 hr 5 min". */
function readingTime(words) {
  const minutes = Math.round(words / WORDS_PER_MINUTE);
  if (minutes < 1) return '<1 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

function wordLabel(words) {
  return words === 1 ? '1 word' : `${words.toLocaleString()} words`;
}

/* How a length is written, by the setting's value. */
const LENGTH_STYLES = {
  time: 'Reading time',
  words: 'Word count',
  none: 'None',
};

class Lengths {
  constructor(plugin) {
    this.plugin = plugin;
    // path -> { mtime, words }
    this.known = new Map();
    // path + mtime -> the read under way
    this.reading = new Map();
  }

  get app() {
    return this.plugin.app;
  }

  /** Words in a note, or null until it has been counted as it is now. */
  words(file) {
    if (!(file instanceof TFile) || file.extension !== 'md') return null;
    const kept = this.known.get(file.path);
    return kept && kept.mtime === file.stat.mtime ? kept.words : null;
  }

  /** Whether a length can be known for this file at all: notes only. */
  measurable(file) {
    return file instanceof TFile && file.extension === 'md';
  }

  /**
   * Count the notes not yet counted, a few at a time so a long list
   * doesn't open every file at once. Resolves true if any count is new.
   */
  async measure(files) {
    const vault = this.app.vault;
    if (!vault || typeof vault.cachedRead !== 'function') return false;
    const todo = files.filter((f) => this.measurable(f) && this.words(f) === null);
    if (!todo.length) return false;
    let next = 0;
    const worker = async () => {
      while (next < todo.length) await this.count(todo[next++]);
    };
    await Promise.all([1, 2, 3, 4, 5, 6].map(worker));
    return true;
  }

  count(file) {
    const mtime = file.stat.mtime;
    const key = `${file.path}\n${mtime}`;
    if (this.reading.has(key)) return this.reading.get(key);
    const job = this.app.vault
      .cachedRead(file)
      .then(countWords, () => 0)
      .then((words) => {
        this.known.set(file.path, { mtime: mtime, words: words });
        this.reading.delete(key);
      });
    this.reading.set(key, job);
    return job;
  }

  /** A note's length as the setting writes it, or '' while it's unknown. */
  label(file, style) {
    const words = this.words(file);
    if (words === null || !words) return '';
    return style === 'words' ? wordLabel(words) : readingTime(words);
  }

  /**
   * The length of many notes together, for an album's header — or null
   * while any of them is still to be counted.
   */
  total(files, style) {
    let sum = 0;
    for (const f of files) {
      if (!this.measurable(f)) continue;
      const words = this.words(f);
      if (words === null) return null;
      sum += words;
    }
    if (!sum) return '';
    return style === 'words' ? wordLabel(sum) : `${readingTime(sum)} read`;
  }
}
