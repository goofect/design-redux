/* ------------------------------------------------------------------ */
/* Capabilities: what features offer each other                        */
/*                                                                     */
/* A feature that others need says what it offers, by name, in its     */
/* class's `offers`; anything that needs it asks the plugin for that    */
/* name with ask(). So no feature imports another, a class can be      */
/* renamed or moved freely, and this list is the one place that says   */
/* what features may ask of each other. A test checks each name here   */
/* has one feature offering it and each one asked for is here.         */
/* ------------------------------------------------------------------ */

/** Each capability, and what its feature does for the others. */
export const CAPABILITIES = {
  albums: 'An album’s structure: its kind, trail and rollups, and the notes it gathers (AlbumStructure).',
  albumProperty: 'The property that puts a note in an album: its name, and setting it on an album’s notes (AlbumProperty).',
  clipboard: 'Properties copied and pasted between notes, and an album’s as a table (PropertyClipboard).',
  covers: 'A cover set on a note or folder, and the link an image is given (CoverImages).',
  footnotes: 'A note’s footnotes counted, and the Footnotes view shown (Footnotes).',
  library: 'The library: a screen of the browse view opened, and the sidebar redrawn or put back (Library).',
  libraryCheck: 'What the library check finds: notes in no collection (LibraryCheck).',
  look: 'The look: the appearance settings applied (Appearance).',
  propertyTools: 'The property tools: their window opened on notes, a rename or a merge (BulkEditing).',
  savedViews: 'Saved views: listed, found by id, changed, and offered on menus (SmartAlbums).',
  strip: 'The context strip, redrawn (ContextStrip).',
};

/**
 * The feature offering a capability, or null where none does (or the
 * plugin can't say, as a test's stand-in may not). Whether it's switched
 * on is the caller's to check, as it was.
 */
export function ask(plugin, name) {
  return plugin && typeof plugin.capability === 'function' ? plugin.capability(name) : null;
}
