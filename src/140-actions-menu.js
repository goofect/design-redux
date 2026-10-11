/* ------------------------------------------------------------------ */
/* Actions menu: file explorer buttons, and optionally the ribbon's    */
/*                                                                     */
/* Nothing is relocated. The real buttons stay where Obsidian put      */
/* them, hidden by CSS, and each entry proxies a click to the live     */
/* button — re-queried every time, so rebuilds are irrelevant.         */
/* ------------------------------------------------------------------ */

class ActionsMenu extends Feature {
  constructor(plugin) {
    super(plugin);
    this.triggerEl = null;
  }

  settingsSchema() {
    return [
      {
        key: 'navDropdown',
        name: 'Actions menu',
        desc: 'Replace the file explorer’s buttons with a menu in the sidebar header.',
      },
      {
        key: 'ribbonInMenu',
        showIf: 'navDropdown',
        name: 'Ribbon in menu',
        desc: 'Move the left ribbon’s buttons into that menu.',
      },
    ];
  }

  actions() {
    return [
      {
        id: 'open-actions',
        name: 'Open actions menu',
        when: () => this.enabled,
        run: () => {
          // The trigger lives in the left sidebar's tab header, so there
          // isn't one while that sidebar is collapsed.
          const trigger = document.querySelector('.dr-trigger');
          if (trigger) trigger.click();
          else new Notice('Open the left sidebar to reach the actions menu.');
        },
      },
    ];
  }

  enable() {
    document.body.addClass('dr-nav-active');
    document.body.toggleClass('dr-ribbon-active', !!this.settings.ribbonInMenu);
    this.sync();
  }

  disable() {
    document.body.removeClass('dr-nav-active');
    document.body.removeClass('dr-ribbon-active');
    unpark();
    if (this.triggerEl) {
      this.triggerEl.remove();
      this.triggerEl = null;
    }
  }

  sync() {
    const header = document.querySelector(TAB_HEADER);
    if (!header) return;
    if (this.triggerEl && this.triggerEl.isConnected) return;

    const trigger = makeTrigger('dr-trigger', 'Actions', 'ellipsis', (el) =>
      this.showMenu(el)
    );

    placeInHeader(header, trigger, this.settings.headerOrder.actions, () => {
      const newTab = header.querySelector('.workspace-tab-header-new-tab');
      if (newTab) newTab.insertAdjacentElement('afterend', trigger);
      else header.appendChild(trigger);
    });
    makeHeaderDraggable(trigger, 'actions', this.plugin);

    this.triggerEl = trigger;
    // The gear may have been saved as following this; it was placed
    // before this existed, so it goes back where it belongs.
    settleHeader(header, this.settings.headerOrder);
  }

  showMenu(trigger) {
    const rect = trigger.getBoundingClientRect();
    parkAt(rect);

    const menu = new Menu();
    let added = 0;

    const addFrom = (selector, buttonSelector) => {
      const root = document.querySelector(selector);
      if (!root) return 0;
      let n = 0;
      root.querySelectorAll(buttonSelector).forEach((btn) => {
        if (btn.style.display === 'none') return; // Obsidian hides some itself
        const label = btn.getAttribute('aria-label');
        if (!label) return;
        menu.addItem((item) => {
          item.setTitle(label);
          const icon = iconNameOf(btn);
          if (icon) item.setIcon(icon);
          item.onClick(() => btn.click());
        });
        n++;
      });
      return n;
    };

    added += addFrom(NAV_BUTTONS, '.nav-action-button');

    if (this.settings.ribbonInMenu) {
      // Counted first: a separator has to be added before the items it
      // precedes, and only when both sides actually contribute.
      const ribbon = document.querySelector(RIBBON_ACTIONS);
      const usable = ribbon
        ? Array.from(ribbon.querySelectorAll('.side-dock-ribbon-action')).filter(
            (b) => b.style.display !== 'none' && b.getAttribute('aria-label')
          ).length
        : 0;

      if (usable && added) menu.addSeparator();
      if (usable) added += addFrom(RIBBON_ACTIONS, '.side-dock-ribbon-action');
    }

    if (!added) {
      new Notice('No actions available.');
      return;
    }

    trigger.setAttribute('aria-expanded', 'true');
    menu.onHide(() => {
      trigger.setAttribute('aria-expanded', 'false');
      trigger.focus();
    });
    menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
  }
}

ActionsMenu.settingKey = 'navDropdown';
ActionsMenu.desktopOnly = true;

