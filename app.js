(function () {
  'use strict';

  const THEME_KEY = 'hana-exam-theme';
  const THEMES = new Set(['classic', 'ocean', 'sand', 'dark']);

  function themeNameFor(button) {
    return button.dataset.themeChoice || button.dataset.themeValue || button.dataset.theme || '';
  }

  function applyTheme(themeName, sourceButton) {
    const theme = THEMES.has(themeName) ? themeName : 'classic';
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (_) {
      // Theme persistence is optional when storage is unavailable.
    }

    document.querySelectorAll('[data-theme-choice], [data-theme-value], button[data-theme]').forEach((button) => {
      const active = themeNameFor(button) === theme;
      button.classList.toggle('active', active);
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    if (sourceButton) sourceButton.blur();
  }

  function savedTheme() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (THEMES.has(saved)) return saved;
    } catch (_) {
      // Fall back to the system preference.
    }
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'classic';
  }

  function initTheme() {
    applyTheme(savedTheme());
    document.querySelectorAll('[data-theme-choice], [data-theme-value], button[data-theme]').forEach((button) => {
      button.addEventListener('click', () => applyTheme(themeNameFor(button), button));
    });
  }

  function initNavigation() {
    const toggle = document.querySelector('[data-nav-toggle], .mobile-nav-toggle');
    if (!toggle) return;
    const controlledId = toggle.getAttribute('aria-controls');
    const menu = (controlledId && document.getElementById(controlledId))
      || document.querySelector('[data-nav-menu]')
      || document.getElementById('site-nav')
      || document.getElementById('primary-nav');
    if (!toggle || !menu) return;

    const close = (restoreFocus) => {
      menu.classList.remove('open');
      menu.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Mở menu');
      if (restoreFocus) toggle.focus();
    };

    toggle.addEventListener('click', () => {
      const opening = !menu.classList.contains('open');
      menu.classList.toggle('open', opening);
      menu.classList.toggle('is-open', opening);
      toggle.setAttribute('aria-expanded', String(opening));
      toggle.setAttribute('aria-label', opening ? 'Đóng menu' : 'Mở menu');
    });

    menu.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => close(false)));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && menu.classList.contains('open')) close(true);
    });

    const desktop = window.matchMedia('(min-width: 1041px)');
    if (typeof desktop.addEventListener === 'function') {
      desktop.addEventListener('change', (event) => {
        if (event.matches) close(false);
      });
    }
  }

  function timeInZone(zone) {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date());
  }

  function initClock() {
    const clock = document.getElementById('site-clock');
    if (!clock) return;

    const update = () => {
      try {
        clock.textContent = `Việt Nam ${timeInZone('Asia/Ho_Chi_Minh')} · Sydney ${timeInZone('Australia/Sydney')}`;
      } catch (_) {
        clock.textContent = new Date().toLocaleTimeString('vi-VN', {
          hour: '2-digit',
          minute: '2-digit'
        });
      }
    };

    update();
    window.setInterval(update, 30000);
  }

  function initYears() {
    document.querySelectorAll('[data-current-year]').forEach((element) => {
      element.textContent = String(new Date().getFullYear());
    });
  }

  function init() {
    initTheme();
    initNavigation();
    initClock();
    initYears();
  }

  window.setTheme = applyTheme;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
