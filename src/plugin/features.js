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

export const FEATURES = [Appearance, Library, Albums, AlbumRefactor, AlbumProperty, Covers, SavedViews, LibraryCheck];
