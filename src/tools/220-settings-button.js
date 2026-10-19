/* ------------------------------------------------------------------ */
/* Settings gear relocated to the sidebar tab header                   */
/*                                                                     */
/* The real button is moved, not recreated, so its click handler and   */
/* tooltip come along untouched.                                       */
/* ------------------------------------------------------------------ */

import { TAB_HEADER } from '../core/020-constants.js';
import { makeHeaderDraggable, placeInHeader, settleHeader } from '../core/050-helpers-dom.js';
import { Feature } from '../core/080-feature.js';

export class SettingsButton extends Feature {
  constructor(plugin) {
    super(plugin);
    this.el = null;
    this.home = null;
    this.nextSibling = null;
  }

  settingsSchema() {
    return [
      {
        key: 'settingsInHeader',
        name: 'Settings button',
        desc: 'Move the settings gear into the sidebar header.',
      },
    ];
  }

  enable() {
    document.body.addClass('dr-settings-active');
    this.sync();
  }

  disable() {
    document.body.removeClass('dr-settings-active');
    this.restore();
  }

  /**
   * Obsidian's gear. Each place it's kept is looked in in turn — the
   * vault's actions first — so a plugin's own gear-shaped button in the
   * ribbon is never taken for it.
   */
  find() {
    return this.gears()[0] || null;
  }

  /** Every gear of Obsidian's where it keeps them, in that order. */
  gears() {
    const out = [];
    ['.workspace-drawer-vault-actions', '.side-dock-settings', '.workspace-ribbon'].forEach((selector) =>
      document.querySelectorAll(selector).forEach((holder) =>
        holder.querySelectorAll('.clickable-icon').forEach((icon) => {
          if (icon !== this.el && out.indexOf(icon) === -1 && icon.querySelector('svg.lucide-settings, svg.settings')) out.push(icon);
        })
      )
    );
    return out;
  }

  /** Any other gear of Obsidian's — one it draws again where the moved one was — out of sight while the moved one stands in. */
  hideSpares() {
    if (this.el) this.gears().forEach((icon) => icon.addClass('dr-settings-spare'));
  }

  sync() {
    const header = document.querySelector(TAB_HEADER);
    if (!header) return;
    if (this.el && this.el.isConnected && header.contains(this.el)) return this.hideSpares();

    // Moved already, and the header rebuilt since: the gear was taken
    // down with the old one, and is put back rather than searched for.
    const moved = this.el && !this.el.isConnected;
    const gear = moved ? this.el : this.find();
    if (!gear) return;

    if (!moved) {
      this.home = gear.parentElement;
      this.nextSibling = gear.nextSibling;
      this.el = gear;
      this.hadLabel = gear.hasAttribute('aria-label');
      this.tooltip = gear.getAttribute('data-tooltip-position');
    }

    gear.addClass('dr-settings-moved');
    if (!gear.getAttribute('aria-label')) gear.setAttribute('aria-label', 'Settings');
    gear.setAttribute('data-tooltip-position', 'bottom');

    placeInHeader(header, gear, this.settings.headerOrder.settings, () => {
      const trigger = header.querySelector('.dr-trigger');
      const newTab = header.querySelector('.workspace-tab-header-new-tab');
      if (trigger) trigger.insertAdjacentElement('afterend', gear);
      else if (newTab) newTab.insertAdjacentElement('afterend', gear);
      else header.appendChild(gear);
    });
    makeHeaderDraggable(gear, 'settings', this.plugin);
    settleHeader(header, this.settings.headerOrder);
    this.hideSpares();
  }

  /** The gear back where it was, as it was. */
  restore() {
    document.querySelectorAll('.dr-settings-spare').forEach((icon) => icon.removeClass('dr-settings-spare'));
    const gear = this.el;
    if (gear) {
      gear.removeClass('dr-settings-moved');
      if (gear.drDragOff) gear.drDragOff();
      if (this.tooltip === null || this.tooltip === undefined) gear.removeAttribute('data-tooltip-position');
      else gear.setAttribute('data-tooltip-position', this.tooltip);
      if (!this.hadLabel) gear.removeAttribute('aria-label');
      if (this.home && this.home.isConnected) {
        // Its neighbour may have gone since; then it goes at the end.
        const next = this.nextSibling && this.nextSibling.parentNode === this.home ? this.nextSibling : null;
        this.home.insertBefore(gear, next);
      }
    }
    this.el = null;
    this.home = null;
    this.nextSibling = null;
  }
}

SettingsButton.settingKey = 'settingsInHeader';
SettingsButton.desktopOnly = true;

