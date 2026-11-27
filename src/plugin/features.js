/* ------------------------------------------------------------------ */
/* The features, listed once, in the order they load                   */
/* ------------------------------------------------------------------ */

import { Appearance } from '../core/appearance.js';
import { Backup } from '../backup/backup.js';
import { AlbumProperty } from '../library/album-property.js';
import { LibraryCheck } from '../library/check.js';
import { Library } from '../library/library.js';
import { AlbumRefactor } from '../library/refactor.js';
import { SavedViews } from '../library/saved-views.js';
import { Footnotes } from '../note/footnotes.js';
import { MarkedLists } from '../note/lists.js';
import { NotePage } from '../note/note-head.js';
import { NoteOut } from '../note/note-out.js';
import { NotePages } from '../note/pages.js';
import { NoteHtml } from '../note/note-html.js';
import { Maps } from '../maps/map-view.js';
import { PropertyClipboard } from '../tools/clipboard.js';
import { ActionsMenu, Diagnostics, FullPane, MenuFilter } from '../tools/extras.js';
import { Graph3D } from '../tools/graph-3d.js';
import { GuideCheck } from '../tools/guide-check.js';
import { GraphFilter, GraphRoutes } from '../tools/graph-routes.js';
import { PropertyTools } from '../tools/property-tools.js';
import { PropertyRules } from '../tools/rules.js';
import { PropertySchemas } from '../tools/schemas.js';

export const FEATURES = [Appearance, Library, AlbumRefactor, AlbumProperty, SavedViews, LibraryCheck, NotePage, NotePages, Footnotes, NoteHtml, MarkedLists, NoteOut,
  PropertyTools, PropertyClipboard, PropertySchemas, PropertyRules, GraphFilter, GraphRoutes, Graph3D, Maps, MenuFilter, ActionsMenu, FullPane, Diagnostics, GuideCheck, Backup];
