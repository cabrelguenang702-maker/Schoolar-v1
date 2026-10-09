/**
 * SCHOOLAR — Utilitaires d'interface partagés
 */
const UI = {
  toast(message, type = 'default') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type === 'error' ? 'toast-error' : type === 'success' ? 'toast-success' : ''}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  },

  icon(name, size = 18) {
    const icons = {
      mail: `<path d="M4 6h16v12H4z" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M4 7l8 6 8-6" stroke="currentColor" stroke-width="1.6" fill="none"/>`,
      lock: `<rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M8 10V7a4 4 0 018 0v3" stroke="currentColor" stroke-width="1.6" fill="none"/>`,
      building: `<rect x="4" y="3" width="16" height="18" rx="1.5" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M8 8h1M12 8h1M16 8h1M8 12h1M12 12h1M16 12h1M8 16h1M12 16h1M16 16h1" stroke="currentColor" stroke-width="1.6"/>`,
      eye: `<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" stroke="currentColor" stroke-width="1.6" fill="none"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6" fill="none"/>`,
      eyeOff: `<path d="M3 3l18 18" stroke="currentColor" stroke-width="1.6"/><path d="M10.6 5.1A10.6 10.6 0 0112 5c6 0 10 7 10 7a17 17 0 01-3.2 4.1M6.5 6.6C4 8.3 2 12 2 12s4 7 10 7c1.4 0 2.7-.3 3.8-.8" stroke="currentColor" stroke-width="1.6" fill="none"/>`,
      bell: `<path d="M12 3a5 5 0 00-5 5v3.5L5 15h14l-2-3.5V8a5 5 0 00-5-5z" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M9.5 18a2.5 2.5 0 005 0" stroke="currentColor" stroke-width="1.6" fill="none"/>`,
      search: `<circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M20 20l-3.5-3.5" stroke="currentColor" stroke-width="1.6"/>`,
      chevronDown: `<path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="1.8" fill="none"/>`,
      arrowRight: `<path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="1.8" fill="none"/>`,
      users: `<circle cx="9" cy="8" r="3.2" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M2.5 19c1-3.3 3.6-5 6.5-5s5.5 1.7 6.5 5" stroke="currentColor" stroke-width="1.6" fill="none"/><circle cx="17" cy="8.5" r="2.6" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M15.5 14c2.4.3 4.3 1.9 5 4.5" stroke="currentColor" stroke-width="1.6" fill="none"/>`,
      graph: `<path d="M4 20V10M11 20V4M18 20v-7" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      info: `<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M12 8v.01M12 11v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
      phone: `<path d="M6.5 3h3l1.5 4-2 1.5a12 12 0 006 6l1.5-2 4 1.5v3a2 2 0 01-2.2 2A17 17 0 014.5 5.2 2 2 0 016.5 3z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/>`,
      menu: `<path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
    };
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24">${icons[name] || ''}</svg>`;
  },

  logoSvg() {
    return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 3L1 8l11 5 9-4.09V17h2V8L12 3z" fill="white"/><path d="M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82z" fill="white"/></svg>`;
  },

  initials(firstName, lastName) {
    return `${(firstName || '?')[0] || ''}${(lastName || '')[0] || ''}`.toUpperCase();
  },

  /**
   * Structure commune "sidebar + topbar + contenu" utilisée par toutes les
   * pages applicatives (dashboard, espace national, etc.). Retourne le
   * conteneur #page-content-inner pour que la page y injecte son contenu.
   */
  renderShell(root, { user, navItems, pageBodyHtml }) {
    root.innerHTML = `
      <div class="app-shell">
        <div class="sidebar-overlay" id="sidebar-overlay"></div>
        <aside class="sidebar" id="app-sidebar">
          <div class="logo-row">
            <div class="logo-box">${UI.logoSvg()}</div>
            <div class="logo-word">${t('app_name')}</div>
          </div>
          <div class="nav-section-label">Menu</div>
          ${navItems.map(item => `
            <a href="${item.href}" class="nav-item ${item.active ? 'active' : ''}">
              ${UI.icon(item.icon, 18)}
              <span>${I18N.current === 'fr' ? item.label_fr : item.label_en}</span>
            </a>
          `).join('')}
          <div style="margin-top:auto;">
            <button class="nav-item" id="logout-btn" style="width:100%;border:none;background:none;text-align:left;">
              ${UI.icon('arrowRight', 18)}<span>${t('logout')}</span>
            </button>
          </div>
        </aside>

        <div class="main-col">
          <div class="topbar">
            <button class="menu-toggle-btn" id="menu-toggle-btn" aria-label="Menu">${UI.icon('menu', 18)}</button>
            <div class="topbar-greeting" style="flex-shrink:0;">${t('welcome_back')}, <span>${user.first_name}</span></div>
          <div style="flex:1;max-width:360px;margin:0 16px;position:relative;" class="topbar-search-wrap">
            <input id="global-search-input" placeholder="${t('search_placeholder')}" style="width:100%;padding:10px 14px;border:1px solid var(--color-border);border-radius:8px;font-size:14px;">
            <div id="global-search-results" class="hidden" style="position:absolute;top:calc(100% + 4px);left:0;right:0;background:white;border:1px solid var(--color-border);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.1);max-height:400px;overflow-y:auto;z-index:50;"></div>
          </div>
            <div class="topbar-right">
              <div class="lang-switch">
                <button data-lang="fr" class="${I18N.current === 'fr' ? 'active' : ''}">FR</button>
                <button data-lang="en" class="${I18N.current === 'en' ? 'active' : ''}">EN</button>
              </div>
              <button class="icon-btn" id="notif-bell-btn" style="position:relative;">${UI.icon('bell', 18)}<span class="dot hidden" id="notif-dot"></span></button>
              <div class="avatar">${UI.initials(user.first_name, user.last_name)}</div>
            </div>
          </div>

          <div class="notif-dropdown hidden" id="notif-dropdown">
            <div class="flex justify-between items-center" style="padding:14px 16px;border-bottom:1px solid var(--color-border);">
              <strong style="font-size:14px;">${t('notifications_title')}</strong>
              <button class="btn btn-ghost btn-sm" id="notif-mark-all" style="padding:4px 8px;font-size:12px;">${t('btn_mark_all_read')}</button>
            </div>
            <div id="notif-list" style="max-height:360px;overflow-y:auto;"></div>
          </div>

          <div class="page-content" id="page-content-inner">
            ${pageBodyHtml}
          </div>
        </div>
      </div>
    `;

    root.querySelectorAll('[data-lang]').forEach(btn => {
      btn.addEventListener('click', () => { I18N.setLang(btn.dataset.lang); window.dispatchEvent(new Event('hashchange')); });
    });

    root.querySelector('#logout-btn').addEventListener('click', async () => {
      try { await API.logout(); } catch {}
      Store.clearSession();
      window.location.hash = '#/login';
    });

    // Menu mobile (< 900px) : bouton hamburger ouvre le tiroir, l'overlay ou
    // un clic sur un lien de navigation le referme.
    const sidebarEl = root.querySelector('#app-sidebar');
    const overlayEl = root.querySelector('#sidebar-overlay');
    const closeMobileMenu = () => { sidebarEl.classList.remove('open'); overlayEl.classList.remove('open'); };
    root.querySelector('#menu-toggle-btn').addEventListener('click', () => {
      sidebarEl.classList.toggle('open');
      overlayEl.classList.toggle('open');
    });
    overlayEl.addEventListener('click', closeMobileMenu);
    sidebarEl.querySelectorAll('.nav-item').forEach(link => link.addEventListener('click', closeMobileMenu));

    UI.initNotificationBell(root);
    UI.initGlobalSearch(root);

    return root.querySelector('#page-content-inner');
  },

  /** Barre de recherche globale (section 20) : élèves, personnel, classes, bibliothèque. */
  initGlobalSearch(root) {
    const input = root.querySelector('#global-search-input');
    const results = root.querySelector('#global-search-results');
    if (!input) return;

    let timeout;
    input.addEventListener('input', () => {
      clearTimeout(timeout);
      const q = input.value.trim();
      if (q.length < 2) { results.classList.add('hidden'); return; }
      timeout = setTimeout(async () => {
        try {
          const data = await API.globalSearch(q);
          UI.paintGlobalSearchResults(results, data);
        } catch { /* silencieux */ }
      }, 300);
    });

    document.addEventListener('click', (e) => {
      if (!results.contains(e.target) && e.target !== input) results.classList.add('hidden');
    });
  },

  paintGlobalSearchResults(container, data) {
    const sections = [
      { key: 'students', label: I18N.current === 'fr' ? 'Élèves' : 'Students', render: r => `${r.first_name} ${r.last_name} — ${r.matricule}`, href: () => '#/students' },
      { key: 'staff', label: I18N.current === 'fr' ? 'Personnel' : 'Staff', render: r => `${r.first_name} ${r.last_name} — ${r.role}`, href: () => '#/staff' },
      { key: 'classes', label: I18N.current === 'fr' ? 'Classes' : 'Classes', render: r => `${r.level} ${r.series || ''} ${r.section || ''}`, href: () => '#/classes' },
      { key: 'library', label: I18N.current === 'fr' ? 'Bibliothèque' : 'Library', render: r => r.title, href: () => '#/library' },
    ];

    const nonEmpty = sections.filter(s => (data[s.key] || []).length);
    if (!nonEmpty.length) {
      container.innerHTML = `<div style="padding:16px;" class="text-muted text-sm">${I18N.current === 'fr' ? 'Aucun résultat.' : 'No results.'}</div>`;
      container.classList.remove('hidden');
      return;
    }

    container.innerHTML = nonEmpty.map(s => `
      <div style="padding:10px 14px;font-size:11px;text-transform:uppercase;color:var(--color-text-muted);border-top:1px solid var(--color-border);">${s.label}</div>
      ${data[s.key].map(r => `<a href="${s.href()}" style="display:block;padding:8px 14px;font-size:14px;color:inherit;text-decoration:none;">${s.render(r)}</a>`).join('')}
    `).join('');
    container.classList.remove('hidden');
  },

  /** Cloche de notifications in-app (section 24) : badge, ouverture, marquage lu. */
  async initNotificationBell(root) {
    const bellBtn = root.querySelector('#notif-bell-btn');
    const dropdown = root.querySelector('#notif-dropdown');
    const dot = root.querySelector('#notif-dot');
    if (!bellBtn) return;

    try {
      const d = await API.unreadNotificationCount();
      dot.classList.toggle('hidden', !d.count);
    } catch { /* silencieux */ }

    bellBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const isOpen = !dropdown.classList.contains('hidden');
      if (isOpen) { dropdown.classList.add('hidden'); return; }
      dropdown.classList.remove('hidden');
      await UI.loadNotificationList(root);
    });

    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target) && e.target !== bellBtn) dropdown.classList.add('hidden');
    });

    const markAllBtn = root.querySelector('#notif-mark-all');
    if (markAllBtn) markAllBtn.addEventListener('click', async () => {
      try {
        await API.markAllNotificationsRead();
        dot.classList.add('hidden');
        await UI.loadNotificationList(root);
      } catch { /* silencieux */ }
    });
  },

  async loadNotificationList(root) {
    const listBox = root.querySelector('#notif-list');
    if (!listBox) return;
    try {
      const d = await API.listNotifications();
      if (!d.notifications.length) {
        listBox.innerHTML = `<div class="empty-state" style="padding:24px;">${UI.icon('bell', 24)}<p class="mt-8 text-sm">${t('empty_notifications')}</p></div>`;
        return;
      }
      listBox.innerHTML = d.notifications.map(n => `
        <div class="notif-item ${n.read_at ? '' : 'unread'}" data-notif="${n.id}" data-link="${n.link || ''}">
          <div style="font-weight:${n.read_at ? '500' : '700'};font-size:13.5px;">${n.title}</div>
          ${n.body ? `<div class="text-muted text-sm mt-8">${n.body}</div>` : ''}
          <div class="text-muted" style="font-size:11px;margin-top:4px;">${new Date(n.created_at).toLocaleString()}</div>
        </div>
      `).join('');

      listBox.querySelectorAll('[data-notif]').forEach(item => {
        item.addEventListener('click', async () => {
          try { await API.markNotificationRead(item.dataset.notif); } catch {}
          if (item.dataset.link) window.location.hash = item.dataset.link.replace(/^#/, '');
          root.querySelector('#notif-dropdown').classList.add('hidden');
        });
      });
    } catch {
      listBox.innerHTML = `<p class="text-muted text-sm" style="padding:16px;">—</p>`;
    }
  },

  statusBadge(status) {
    const map = {
      pending: 'warning', active: 'success', suspended: 'danger', rejected: 'danger',
      archived: 'neutral', email_confirmed: 'info', completed: 'success',
    };
    const cls = map[status] || 'neutral';
    return `<span class="badge badge-${cls}">${t('status_' + status) || status}</span>`;
  },

  /** Étape 11 — ouvre un reçu de paiement imprimable (section 24). */
  async printReceipt(paymentId) {
    let data;
    try {
      data = await API.getReceipt(paymentId);
    } catch (err) {
      UI.toast(err.message || 'Erreur.', 'error');
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'receipt-print-area';
    overlay.style.cssText = 'position:fixed;inset:0;background:white;z-index:10000;padding:40px;max-width:520px;margin:40px auto;border:1px solid var(--color-border);border-radius:12px;overflow:auto;';
    overlay.innerHTML = `
      <h2>${data.establishment ? data.establishment.name : 'SCHOOLAR'}</h2>
      <p class="text-muted text-sm">${data.establishment && data.establishment.address ? data.establishment.address : ''}</p>
      <hr style="margin:16px 0;border-color:var(--color-border);">
      <h3>${I18N.current === 'fr' ? 'Reçu de paiement' : 'Payment receipt'}</h3>
      <p class="text-sm mt-8">${I18N.current === 'fr' ? 'N° de reçu' : 'Receipt no.'}: <strong>${data.payment.receipt_number}</strong></p>
      <p class="text-sm">${I18N.current === 'fr' ? 'Date' : 'Date'}: ${new Date(data.payment.paid_at).toLocaleString()}</p>
      ${data.student ? `<p class="text-sm">${I18N.current === 'fr' ? 'Élève' : 'Student'}: ${data.student.first_name} ${data.student.last_name} (${data.student.matricule})</p>` : ''}
      <p class="text-sm">${data.label || ''}</p>
      <p class="text-sm">${I18N.current === 'fr' ? 'Méthode' : 'Method'}: ${data.payment.method}</p>
      <div class="hero-card mt-16" style="padding:16px;">
        <div class="hero-value">${Number(data.payment.amount).toLocaleString()}<small> FCFA</small></div>
      </div>
      <div class="flex gap-8 mt-24">
        <button class="btn btn-primary" id="receipt-print-btn">${I18N.current === 'fr' ? 'Imprimer' : 'Print'}</button>
        <a class="btn btn-outline" href="${API.receiptPdfUrl(paymentId)}" target="_blank" rel="noopener">${t('btn_export_pdf')}</a>
        <button class="btn btn-outline" id="receipt-close-btn">${I18N.current === 'fr' ? 'Fermer' : 'Close'}</button>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#receipt-print-btn').addEventListener('click', () => window.print());
    overlay.querySelector('#receipt-close-btn').addEventListener('click', () => overlay.remove());
  },

  setLoading(button, loading, label) {
    if (loading) {
      button.dataset.originalText = button.innerHTML;
      button.innerHTML = t('loading');
      button.disabled = true;
    } else {
      button.innerHTML = label || button.dataset.originalText || button.innerHTML;
      button.disabled = false;
    }
  },
};
