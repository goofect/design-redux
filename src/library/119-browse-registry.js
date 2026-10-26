/* ------------------------------------------------------------------ */
/* Browse screens: which screen a mode draws                          */
/*                                                                    */
/* The table the browse view reads: every screen, features' too.        */
/* ------------------------------------------------------------------ */

import { CollectionScreen, CollectionsScreen, FolderScreen, FoldersScreen, NotesScreen, SubjectsScreen } from './110-browse-screens.js';
import { PropertiesScreen } from './111-browse-properties.js';
import { SearchScreen } from './112-browse-search.js';
import { HomeScreen } from './113-browse-home.js';
import { HighlightsScreen } from './147-study.js';
import { ConceptScreen } from './254-knowledge.js';
import { SmartScreen } from './258-smart-albums.js';
import { InboxScreen, ReportScreen } from './259-library-check.js';
import { IntegrityScreen } from './261-knowledge-check.js';

/* Screens you start from, rather than arrive at. */
export const ROOT_MODES = ['home', 'search'];

/* Which screen a mode draws. */
export const BROWSE_SCREENS = {
  home: HomeScreen,
  search: SearchScreen,
  folder: FolderScreen,
  folders: FoldersScreen,
  notes: NotesScreen,
  properties: PropertiesScreen,
  property: PropertiesScreen,
  recents: CollectionScreen,
  pinned: CollectionScreen,
  added: CollectionScreen,
  read: CollectionScreen,
  subjects: SubjectsScreen,
  collections: CollectionsScreen,
  smart: SmartScreen,
  concept: ConceptScreen,
  highlights: HighlightsScreen,
  'library-check': ReportScreen,
  inbox: InboxScreen,
  'knowledge-check': IntegrityScreen,
};
