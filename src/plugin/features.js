/* ------------------------------------------------------------------ */
/* The features, listed once, in the order they load                   */
/* ------------------------------------------------------------------ */

import { Appearance } from '../core/appearance.js';
import { AlbumProperty } from '../library/album-property.js';
import { Albums } from '../library/albums.js';
import { LibraryCheck } from '../library/check.js';
import { Covers } from '../library/covers.js';
import { Library } from '../library/library.js';
import { AlbumRefactor } from '../library/refactor.js';
import { SavedViews } from '../library/saved-views.js';
import { Footnotes } from '../note/footnotes.js';
import { ImageRouter } from '../note/image-router.js';
import { MarkedLists } from '../note/lists.js';
import { NotePage } from '../note/note-head.js';
import { NotePages } from '../note/pages.js';
import { Panel } from '../note/panel.js';
import { Scripts } from '../note/scripts.js';

export const FEATURES = [Appearance, Library, Albums, AlbumRefactor, AlbumProperty, Covers, SavedViews, LibraryCheck, NotePage, NotePages, Panel, Footnotes, Scripts, MarkedLists, ImageRouter];
