/* ------------------------------------------------------------------ */
/* Feature base                                                        */
/*                                                                     */
/* Deliberately thin. Some features own DOM and need setting up and    */
/* tearing down; others are only commands. Everything here is optional */
/* so a feature implements what it actually has, rather than carrying  */
/* empty methods to satisfy a shape.                                   */
/*                                                                     */
/* Commands are declared, not registered: Obsidian has no public way   */
/* to remove a command, so registering them per feature on enable      */
/* would leave entries in the palette for features later switched off. */
/* The plugin registers every declared command once, at load.          */
/* ------------------------------------------------------------------ */

class Feature {
  constructor(plugin) {
    this.plugin = plugin;
  }

  get app() {
    return this.plugin.app;
  }

  get settings() {
    return this.plugin.settings;
  }

  /**
   * Features with no settingKey are always on. A desktopOnly feature
   * rearranges chrome the mobile app doesn't have, so it's off there
   * whatever the setting says — the setting is shared through the vault.
   */
  get enabled() {
    if (this.constructor.desktopOnly && Platform.isMobile) return false;
    const key = this.constructor.settingKey;
    return !key || !!this.settings[key];
  }

  /**
   * What it does, each written once (see 253-actions.js): as commands
   * here, and on the menus of what they act on where the feature puts
   * them there.
   */
  actions() {
    return [];
  }

  /** [{ id, name, check?, run }] — check gates palette visibility. Its actions, by default. */
  commands() {
    return actionCommands(this.actions(), (a) => actionContext(this.app, a));
  }

  /** Rows for the settings tab, in order. */
  settingsSchema() {
    return [];
  }

  /**
   * Registrations that must happen at load: view types and anything
   * else Obsidian needs before it restores the workspace. Kept apart
   * from register(), which runs once the vault is ready.
   */
  registerTypes() {}

  /** Called once after layout is ready, whether enabled or not. */
  register() {}

  enable() {}
  disable() {}
  sync() {}
}

/**
 * A class written in parts: the methods of `part` put on `target`, so a
 * large view can be split by what it does across pieces. A name already
 * there is refused, as the build refuses a name declared twice. A part
 * has no super of its own to call: what needs one stays in the class.
 */
function mixInto(target, part) {
  Object.getOwnPropertyNames(part.prototype).forEach((name) => {
    if (name === 'constructor') return;
    if (Object.prototype.hasOwnProperty.call(target.prototype, name)) throw new Error(`${target.name}.${name} is written twice`);
    Object.defineProperty(target.prototype, name, Object.getOwnPropertyDescriptor(part.prototype, name));
  });
}
