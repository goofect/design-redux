/* ------------------------------------------------------------------ */
/* Home's shelves                                                      */
/*                                                                     */
/* Which shelves home has, and the order they are shown in. Pure, so   */
/* the library's filters can read it without loading the screen.       */
/* ------------------------------------------------------------------ */

/* Home's shelves, in the order they first come; which show, and in what order, is the homeShelves setting. */
export const HOME_SHELVES = [
  { id: 'picks', label: 'Highlights' },
  { id: 'revisit', label: 'To revisit' },
  { id: 'continue', label: 'Continue reading' },
  { id: 'fromReading', label: 'From what you read' },
  { id: 'recents', label: 'Recently opened' },
  { id: 'added', label: 'Recently added' },
  { id: 'collections', label: 'Your views' },
  { id: 'pinned', label: 'Pinned' },
  { id: 'rediscover', label: 'Rediscover' },
  { id: 'folders', label: 'Folders' },
];

/** Home's shelves as set: each once, in the order chosen, on or off; any new since, on at the end. */
export function homeShelves(settings) {
  const known = new Map(HOME_SHELVES.map((s) => [s.id, s]));
  const out = [];
  (Array.isArray(settings.homeShelves) ? settings.homeShelves : []).forEach((s) => {
    if (s && known.has(s.id) && !out.some((o) => o.id === s.id)) out.push(Object.assign({}, known.get(s.id), { on: s.on !== false }));
  });
  HOME_SHELVES.forEach((s) => {
    if (!out.some((o) => o.id === s.id)) out.push(Object.assign({}, s, { on: true }));
  });
  return out;
}
