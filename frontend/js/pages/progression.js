/**
 * SCHOOLAR — Cahier de progression pédagogique (section 13)
 */
const ProgressionPage = {
  state: {
    myEntries: [],
    selectedEntry: null,
    items: [],
    completionRate: null,
  },

  async render(root) {
    const user = Store.getUser();
    if (!user) { window.location.hash = '#/login'; return; }
    this.root = root;
    this.user = user;

    await this.loadMyEntries();
    this.paint();
  },

  async loadMyEntries() {
    try {
      const d = await API.listClasses();
      const entries = [];
      for (const cls of d.classes) {
        const detail = await API.getClass(cls.id);
        for (const cs of detail.class.subjects) {
          if (cs.teacher_id === this.user.id || ['proviseur', 'principal', 'directeur'].includes(this.user.role_code)) {
            entries.push({ class: cls, classSubject: cs });
          }
        }
      }
      this.state.myEntries = entries;
    } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
  },

  paint() {
    const navItems = DashboardPage.buildNavItems(this.user).map(i => ({ ...i, active: i.href === '#/progression' }));

    const body = `
      <h2>${t('progression_title')}</h2>
      <p class="text-muted text-sm mt-8">${t('progression_subtitle')}</p>

      <div class="card mt-24">
        <div class="field-group">
          <label class="field-label">${t('field_class')} / ${t('field_subject')}</label>
          <div class="field-input-wrap">
            <select id="pg-entry-select">
              <option value="">${t('none_option')}</option>
              ${this.state.myEntries.map((e, i) => `<option value="${i}">${e.classSubject.subject_name} — ${e.class.level}${e.class.series ? ' ' + e.class.series : ''}${e.class.section ? ' ' + e.class.section : ''}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <div id="progression-content" class="mt-24"></div>
    `;

    const content = UI.renderShell(this.root, { user: this.user, navItems, pageBodyHtml: body });
    this.content = content;

    content.querySelector('#pg-entry-select').addEventListener('change', async (e) => {
      if (e.target.value === '') { this.state.selectedEntry = null; this.paintContent(); return; }
      this.state.selectedEntry = this.state.myEntries[e.target.value];
      await this.loadItems();
      this.paintContent();
    });

    this.paintContent();
  },

  async loadItems() {
    try {
      const d = await API.listProgression(this.state.selectedEntry.classSubject.id);
      this.state.items = d.items;
      this.state.completionRate = d.completion_rate;
    } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
  },

  paintContent() {
    const container = this.content.querySelector('#progression-content');
    if (!this.state.selectedEntry) {
      container.innerHTML = `<div class="card"><p class="text-muted text-sm">${t('select_subject_class')}</p></div>`;
      return;
    }

    container.innerHTML = `
      <div class="card">
        <div class="flex justify-between items-center">
          <h3>${t('progression_completion')}</h3>
          <span class="badge badge-${this.state.completionRate >= 70 ? 'success' : this.state.completionRate >= 30 ? 'warning' : 'danger'}">${this.state.completionRate !== null ? this.state.completionRate + '%' : '—'}</span>
        </div>
        <div class="progress-track mt-16" style="background:var(--color-border);">
          <div class="progress-fill" style="background:var(--color-primary);width:${this.state.completionRate || 0}%;"></div>
        </div>

        <div class="mt-24">
          ${this.state.items.length ? this.state.items.map(item => `
            <div class="flex items-center justify-between" style="padding:10px 0;border-bottom:1px solid var(--color-border);">
              <div class="flex items-center gap-8">
                <span style="opacity:.6;">${item.order_index}.</span>
                <span style="${item.completed ? 'text-decoration:line-through;color:var(--color-text-muted);' : ''}">${item.title}</span>
              </div>
              <div class="flex items-center gap-8">
                ${item.completed
                  ? `<span class="badge badge-success">✓</span><button class="btn btn-outline btn-sm" data-reopen="${item.id}">${t('btn_reopen')}</button>`
                  : `<button class="btn btn-primary btn-sm" data-complete="${item.id}">${t('btn_mark_done')}</button>`}
                <button class="btn btn-outline btn-sm" data-delete="${item.id}">✕</button>
              </div>
            </div>
          `).join('') : `<p class="text-muted text-sm">${t('empty_progression')}</p>`}
        </div>

        <div class="flex gap-8 items-center mt-16" style="flex-wrap:wrap;">
          <input id="pg-new-title" placeholder="${t('field_chapter_title')}" style="flex:1;min-width:200px;padding:10px;border:1px solid var(--color-border);border-radius:8px;">
          <button class="btn btn-primary btn-sm" id="pg-add-btn">${t('btn_add_chapter')}</button>
        </div>
      </div>
    `;

    container.querySelector('#pg-add-btn').addEventListener('click', async () => {
      const input = container.querySelector('#pg-new-title');
      if (!input.value.trim()) return;
      try {
        await API.addProgressionItem(this.state.selectedEntry.classSubject.id, { title: input.value, order_index: this.state.items.length + 1 });
        await this.loadItems();
        this.paintContent();
      } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
    });

    container.querySelectorAll('[data-complete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await API.completeProgressionItem(this.state.selectedEntry.classSubject.id, btn.dataset.complete);
          UI.toast(I18N.current === 'fr' ? 'Chapitre marqué comme terminé.' : 'Chapter marked as done.', 'success');
          await this.loadItems();
          this.paintContent();
        } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
      });
    });
    container.querySelectorAll('[data-reopen]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await API.reopenProgressionItem(this.state.selectedEntry.classSubject.id, btn.dataset.reopen);
          await this.loadItems();
          this.paintContent();
        } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
      });
    });
    container.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await API.deleteProgressionItem(this.state.selectedEntry.classSubject.id, btn.dataset.delete);
          await this.loadItems();
          this.paintContent();
        } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
      });
    });
  },
};
