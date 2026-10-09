/**
 * SCHOOLAR — Emploi du temps (section 16)
 */
const TimetablePage = {
  state: {
    classes: [],
    selectedClassId: '',
    classDetail: null,
    entries: [],
    showForm: false,
    myEntries: null,
    showHistory: false,
    history: [],
  },

  MANAGE_ROLES: ['proviseur', 'principal', 'directeur', 'censeur'],
  TEACHER_ROLES: ['enseignant', 'professeur_principal'],
  DAYS: [1, 2, 3, 4, 5, 6],

  async render(root) {
    const user = Store.getUser();
    if (!user) { window.location.hash = '#/login'; return; }
    this.root = root;
    this.user = user;
    this.canManage = this.MANAGE_ROLES.includes(user.role_code);
    this.isTeacherOnly = this.TEACHER_ROLES.includes(user.role_code);

    if (this.isTeacherOnly) {
      try { const d = await API.myTimetable(); this.state.myEntries = d.entries; } catch { this.state.myEntries = []; }
    } else {
      try { const d = await API.listClasses(); this.state.classes = d.classes; } catch {}
    }

    this.paint();
  },

  paint() {
    const navItems = DashboardPage.buildNavItems(this.user).map(i => ({ ...i, active: i.href === '#/timetable' }));

    const body = this.isTeacherOnly ? `
      <h2>${t('my_timetable_title')}</h2>
      <div id="timetable-grid-container" class="mt-24"></div>
    ` : `
      <h2>${t('timetable_title')}</h2>
      <p class="text-muted text-sm mt-8">${t('timetable_subtitle')}</p>

      <div class="card mt-24">
        <div class="field-group">
          <label class="field-label">${t('field_class')}</label>
          <div class="field-input-wrap">
            <select id="tt-class-select">
              <option value="">${t('none_option')}</option>
              ${this.state.classes.map(c => `<option value="${c.id}" ${this.state.selectedClassId === c.id ? 'selected' : ''}>${c.level}${c.series ? ' ' + c.series : ''}${c.section ? ' ' + c.section : ''}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <div id="timetable-toolbar" class="flex gap-8 mt-16"></div>
      <div id="timetable-form-container" class="mt-16"></div>
      <div id="timetable-grid-container" class="mt-24"></div>
      <div id="timetable-history-container" class="mt-24"></div>
    `;

    const content = UI.renderShell(this.root, { user: this.user, navItems, pageBodyHtml: body });
    this.content = content;

    if (this.isTeacherOnly) {
      this.paintGrid(content.querySelector('#timetable-grid-container'), this.state.myEntries, false);
      return;
    }

    content.querySelector('#tt-class-select').addEventListener('change', async (e) => {
      this.state.selectedClassId = e.target.value;
      this.state.showForm = false;
      this.state.showHistory = false;
      await this.loadClassTimetable();
      this.paint();
    });

    if (this.state.selectedClassId) this.loadClassTimetable().then(() => this.paintAfterLoad());
  },

  async loadClassTimetable() {
    if (!this.state.selectedClassId) { this.state.entries = []; this.state.classDetail = null; return; }
    try {
      this.state.classDetail = (await API.getClass(this.state.selectedClassId)).class;
      const d = await API.getClassTimetable(this.state.selectedClassId);
      this.state.entries = d.entries;
    } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
  },

  paintAfterLoad() {
    const toolbar = this.content.querySelector('#timetable-toolbar');
    toolbar.innerHTML = `
      ${this.canManage ? `<button class="btn btn-primary btn-sm" id="btn-new-entry">${t('btn_new_entry')}</button>` : ''}
      <button class="btn btn-outline btn-sm" id="btn-view-history">${t('btn_view_history')}</button>
      <a class="btn btn-outline btn-sm" href="${API.icsExportUrl(this.state.selectedClassId)}">${t('btn_add_to_calendar')}</a>
    `;
    if (this.canManage) {
      toolbar.querySelector('#btn-new-entry').addEventListener('click', () => { this.state.showForm = true; this.paintForm(); });
    }
    toolbar.querySelector('#btn-view-history').addEventListener('click', () => this.toggleHistory());

    this.paintGrid(this.content.querySelector('#timetable-grid-container'), this.state.entries, true);
  },

  paintForm() {
    const container = this.content.querySelector('#timetable-form-container');
    if (!this.state.showForm || !this.state.classDetail) { container.innerHTML = ''; return; }

    container.innerHTML = `
      <div class="card" style="max-width:640px;">
        <form id="tt-form">
          <div class="field-group">
            <label class="field-label">${t('field_subject')}</label>
            <div class="field-input-wrap">
              <select id="tt-subject">
                ${this.state.classDetail.subjects.map(s => `<option value="${s.id}">${s.subject_name}${s.teacher_first_name ? ' — ' + s.teacher_first_name + ' ' + s.teacher_last_name : ''}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="grid-2 mt-16">
            <div class="field-group">
              <label class="field-label">${t('field_day')}</label>
              <div class="field-input-wrap">
                <select id="tt-day">
                  ${this.DAYS.map(d => `<option value="${d}">${t('day_' + d)}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="field-group">
              <label class="field-label">${t('field_room_optional')}</label>
              <div class="field-input-wrap"><input id="tt-room"></div>
            </div>
          </div>
          <div class="grid-2 mt-16">
            <div class="field-group">
              <label class="field-label">${t('field_start_time')}</label>
              <div class="field-input-wrap"><input type="time" id="tt-start" value="08:00"></div>
            </div>
            <div class="field-group">
              <label class="field-label">${t('field_end_time')}</label>
              <div class="field-input-wrap"><input type="time" id="tt-end" value="09:00"></div>
            </div>
          </div>
          <div id="tt-form-error"></div>
          <div class="flex gap-8 mt-24">
            <button type="submit" class="btn btn-primary btn-sm">${t('btn_new_entry')}</button>
            <button type="button" class="btn btn-outline btn-sm" id="tt-form-cancel">${I18N.current === 'fr' ? 'Annuler' : 'Cancel'}</button>
          </div>
        </form>
      </div>
    `;

    container.querySelector('#tt-form-cancel').addEventListener('click', () => { this.state.showForm = false; this.paintForm(); });
    container.querySelector('#tt-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorBox = container.querySelector('#tt-form-error');
      errorBox.innerHTML = '';
      const payload = {
        class_subject_id: container.querySelector('#tt-subject').value,
        day_of_week: container.querySelector('#tt-day').value,
        start_time: container.querySelector('#tt-start').value,
        end_time: container.querySelector('#tt-end').value,
        room: container.querySelector('#tt-room').value,
      };
      try {
        await API.createTimetableEntry(this.state.selectedClassId, payload);
        UI.toast(I18N.current === 'fr' ? 'Cours ajouté.' : 'Course added.', 'success');
        this.state.showForm = false;
        await this.loadClassTimetable();
        this.paint();
      } catch (err) {
        let html = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
        if (Array.isArray(err.errors)) {
          html += err.errors.map(c => `<div class="alert alert-info mt-8">${t('conflict_type_' + c.type)} — ${c.subject_name} (${c.start_time}–${c.end_time})</div>`).join('');
        }
        errorBox.innerHTML = html;
      }
    });
  },

  paintGrid(container, entries, canDelete) {
    if (!container) return;
    if (!entries || !entries.length) {
      container.innerHTML = `<div class="card"><div class="empty-state">${UI.icon('graph', 28)}<p class="mt-8">${t('empty_timetable')}</p></div></div>`;
      return;
    }

    const byDay = {};
    entries.forEach(e => { (byDay[e.day_of_week] = byDay[e.day_of_week] || []).push(e); });

    container.innerHTML = Object.keys(byDay).sort((a, b) => a - b).map(day => `
      <div class="card mt-16">
        <h3 style="font-size:15px;">${t('day_' + day)}</h3>
        ${byDay[day].sort((a, b) => a.start_time.localeCompare(b.start_time)).map(e => `
          <div class="flex items-center justify-between" style="padding:8px 0;border-bottom:1px solid var(--color-border);">
            <div>
              <strong>${e.start_time.slice(0, 5)}–${e.end_time.slice(0, 5)}</strong> — ${e.subject_name}
              ${e.room ? ' · ' + e.room : ''}
              ${e.teacher_first_name ? ' · ' + e.teacher_first_name + ' ' + e.teacher_last_name : ''}
              ${e.level ? ' · ' + e.level + (e.series ? ' ' + e.series : '') + (e.section ? ' ' + e.section : '') : ''}
            </div>
            ${canDelete && this.canManage ? `<button class="btn btn-outline btn-sm" data-delete="${e.id}">✕</button>` : ''}
          </div>
        `).join('')}
      </div>
    `).join('');

    if (canDelete && this.canManage) {
      container.querySelectorAll('[data-delete]').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            await API.deleteTimetableEntry(this.state.selectedClassId, btn.dataset.delete);
            await this.loadClassTimetable();
            this.paint();
          } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
        });
      });
    }
  },

  async toggleHistory() {
    this.state.showHistory = !this.state.showHistory;
    const container = this.content.querySelector('#timetable-history-container');
    if (!this.state.showHistory) { container.innerHTML = ''; return; }
    try {
      const d = await API.getTimetableHistory(this.state.selectedClassId);
      this.state.history = d.history;
      container.innerHTML = `
        <div class="card">
          <h3 style="font-size:15px;">${I18N.current === 'fr' ? 'Historique des modifications' : 'Modification history'}</h3>
          ${this.state.history.length ? this.state.history.map(h => `
            <div class="text-sm" style="padding:8px 0;border-bottom:1px solid var(--color-border);">
              <strong>${h.first_name || ''} ${h.last_name || ''}</strong> — ${h.action.replace('timetable.', '')} —
              ${h.details.subject_name || ''} ${h.details.day_of_week ? t('day_' + h.details.day_of_week) : ''}
              ${h.details.start_time ? h.details.start_time + '–' + h.details.end_time : ''}
              <span class="text-muted"> · ${new Date(h.created_at).toLocaleString()}</span>
            </div>
          `).join('') : `<p class="text-muted text-sm mt-8">—</p>`}
        </div>
      `;
    } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
  },
};
