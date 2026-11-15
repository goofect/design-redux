/* ------------------------------------------------------------------ */
/* The plugin, as Obsidian loads it                                   */
/*                                                                    */
/* The plugin and nothing else: each module imports what it uses, so  */
/* the plugin's imports reach them all. esbuild bundles them into the */
/* one main.js Obsidian loads.                                        */
/* ------------------------------------------------------------------ */

import { DesignRedux } from './plugin/350-plugin.js';

export default DesignRedux;
