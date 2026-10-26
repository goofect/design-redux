/* ------------------------------------------------------------------ */
/* The plugin, as Obsidian loads it                                   */
/*                                                                    */
/* The plugin and nothing else: each module imports what it uses, so  */
/* the plugin's imports reach them all. esbuild bundles them into the */
/* one main.js Obsidian loads.                                        */
/* ------------------------------------------------------------------ */

// First, for the one cycle the order decides: the browse screens and the
// screens built on them. Smart albums' SmartScreen extends BrowseScreen as it
// loads, while the browse screens only reach for SmartAlbums when drawing.
import './library/258-smart-albums.js';
import { DesignRedux } from './plugin/350-plugin.js';

export default DesignRedux;
