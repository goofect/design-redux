/* ------------------------------------------------------------------ */
/* The features, listed once, in the order they load                   */
/* ------------------------------------------------------------------ */

import { Appearance } from '../core/appearance.js';
import { AlbumProperty } from '../library/album-property.js';
import { Albums } from '../library/albums.js';
import { Covers } from '../library/covers.js';
import { Library } from '../library/library.js';
import { AlbumRefactor } from '../library/refactor.js';
import { Footnotes } from '../note/footnotes.js';
import { ImageRouter } from '../note/image-router.js';
import { MarkedLists } from '../note/lists.js';
import { Scripts } from '../note/scripts.js';
import { RetiredViews } from './retired-views.js';
import { PropertyClipboard } from '../tools/clipboard.js';
import { ActionsMenu, Diagnostics, MenuFilter } from '../tools/extras.js';
import { Graph3D } from '../tools/graph-3d.js';
import { GraphFilter, GraphRoutes } from '../tools/graph-routes.js';
import { PropertyTools } from '../tools/property-tools.js';
import { PropertyHistory, PropertyRules } from '../tools/rules.js';
import { PropertySchemas } from '../tools/schemas.js';

export const FEATURES = [Appearance, Library, Albums, AlbumRefactor, AlbumProperty, Covers, Footnotes, Scripts, MarkedLists, ImageRouter,
  PropertyTools, PropertyClipboard, PropertySchemas, PropertyRules, PropertyHistory, GraphFilter, GraphRoutes, Graph3D, RetiredViews, MenuFilter, ActionsMenu, Diagnostics];
