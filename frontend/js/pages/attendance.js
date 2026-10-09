/**
 * SCHOOLAR — Appel numérique (section 18)
 */
const AttendancePage = {
  state: {
    classes: [],
    selectedClassId: '',
    classDetail: null,
    selectedClassSubjectId: '',
    date: new Date().toISOString().slice(0, 10),
    period: '',
    session: null,
  },

  FULL_ACCESS_ROLES: ['proviseur', 'principal', 'directeur', 'censeur', 'surveillant_general', 'surveillant_secteur'],

  async render(root) {
    const user = Store.getUser();
    if (!user) { window.location.hash = '#/login'; return; }
    this.root = root;
    this.user = user;
    this.hasFullAccess = this.FULL_ACCESS_ROLES.includes(user.role_code);

    try {
      const d = await API.listClasses();
      this.state.classes = d.classes;
    } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }

    this.paint();
  },

  paint() {
    const navItems = DashboardPage.buildNavItems(this.user).map(i => ({ ...i, active: i.href === '#/attendance' }));

    const body = `
      <h2>${t('attendance_title')}</h2>
      <p class="text-muted text-sm mt-8">${t('attendance_subtitle')}</p>

      <div class="card mt-24">
        <div class="grid-2" style="grid-template-columns: 1fr 1fr;">
          <div class="field-group">
            <label class="field-label">${t('field_class')}</label>
            <div class="field-input-wrap">
              <select id="att-class-select">
                <option value="">${t('none_option')}</option>
                ${this.state.classes.map(c => `<option value="${c.id}" ${this.state.selectedClassId === c.id ? 'selected' : ''}>${c.level}${c.series ? ' ' + c.series : ''}${c.section ? ' ' + c.section : ''}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label">${t('field_subject')}</label>
            <div class="field-input-wrap">
              <select id="att-subject-select" ${!this.state.classDetail ? 'disabled' : ''}>
                <option value="">${t('none_option')}</option>
                ${this.availableSubjects().map(s => `<option value="${s.id}" ${this.state.selectedClassSubjectId === s.id ? 'selected' : ''}>${s.subject_name}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>
        <div class="grid-2 mt-16">
          <div class="field-group">
            <label class="field-label">${t('field_date')}</label>
            <div class="field-input-wrap"><input type="date" id="att-date" value="${this.state.date}"></div>
          </div>
          <div class="field-group">
            <label class="field-label">${I18N.current === 'fr' ? 'Créneau (facultatif)' : 'Period (optional)'}</label>
            <div class="field-input-wrap"><input id="att-period" value="${this.state.period}" placeholder="Ex: 8h-9h"></div>
          </div>
        </div>
      </div>

      <div id="attendance-sheet-container" class="mt-24"></div>
    `;

    const content = UI.renderShell(this.root, { user: this.user, navItems, pageBodyHtml: body });
    this.content = content;

    content.querySelector('#att-class-select').addEventListener('change', async (e) => {
      this.state.selectedClassId = e.target.value;
      this.state.selectedClassSubjectId = '';
      this.state.session = null;
      this.state.classDetail = null;
      if (this.state.selectedClassId) {
        try { this.state.classDetail = (await API.getClass(this.state.selectedClassId)).class; } catch {}
      }
      this.paint();
    });

    content.querySelector('#att-subject-select').addEventListener('change', (e) => {
      this.state.selectedClassSubjectId = e.target.value;
      this.state.session = null;
      this.loadSession();
    });
    content.querySelector('#att-date').addEventListener('change', (e) => {
      this.state.date = e.target.value;
      this.loadSession();
    });
    content.querySelector('#att-period').addEventListener('change', (e) => {
      this.state.period = e.target.value;
      this.loadSession();
    });

    if (this.state.selectedClassSubjectId) this.loadSession();
  },

  availableSubjects() {
    if (!this.state.classDetail) return [];
    if (this.hasFullAccess) return this.state.classDetail.subjects;
    return this.state.classDetail.subjects.filter(s => s.teacher_id === this.user.id);
  },

  async loadSession() {
    const container = this.content.querySelector('#attendance-sheet-container');
    if (!this.state.selectedClassSubjectId) { container.innerHTML = ''; return; }
    container.innerHTML = `<div class="boot-spinner" style="margin:30px auto;"></div>`;
    try {
      const data = await API.getAttendanceSession(this.state.selectedClassSubjectId, this.state.date, this.state.period);
      this.state.session = data;
      this.paintSheet(container);
    } catch (err) {
      container.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
    }
  },

  paintSheet(container) {
    const s = this.state.session;
    if (!s) return;

    container.innerHTML = `
      <div class="card">
        <div class="card-title-row">
          <h3>${s.subject_name}</h3>
          <button class="btn btn-outline btn-sm" id="btn-mark-all-present">${t('btn_mark_all_present')}</button>
        </div>
        <div class="stat-grid mt-16" style="grid-template-columns:repeat(3,1fr);">
          <div class="stat-card" style="padding:12px;"><div class="stat-label">${t('stat_present')}</div><div class="stat-value" style="font-size:20px;" id="count-present">${s.stats.present}</div></div>
          <div class="stat-card" style="padding:12px;"><div class="stat-label">${t('stat_absent')}</div><div class="stat-value" style="font-size:20px;" id="count-absent">${s.stats.absent}</div></div>
          <div class="stat-card" style="padding:12px;"><div class="stat-label">${t('stat_late')}</div><div class="stat-value" style="font-size:20px;" id="count-late">${s.stats.late}</div></div>
        </div>

        <div class="mt-16">
          ${s.students.map(st => `
            <div class="flex items-center justify-between gap-8" style="padding:10px 0;border-bottom:1px solid var(--color-border);flex-wrap:wrap;">
              <div style="min-width:160px;">${st.last_name} ${st.first_name} <span class="text-muted text-sm">${st.matricule}</span></div>
              <div class="flex items-center gap-8">
                <select data-status="${st.student_id}" data-record="${st.record_id}">
                  <option value="present" ${st.status === 'present' ? 'selected' : ''}>${t('status_present')}</option>
                  <option value="absent" ${st.status === 'absent' ? 'selected' : ''}>${t('status_absent')}</option>
                  <option value="late" ${st.status === 'late' ? 'selected' : ''}>${t('status_late')}</option>
                </select>
                ${st.status !== 'present' ? `
                  <label class="text-sm flex items-center gap-8"><input type="checkbox" data-justified="${st.student_id}" ${st.justified ? 'checked' : ''}> ${t('field_justified')}</label>
                  <button class="btn btn-outline btn-sm" data-alert="${st.record_id}" ${st.alerted_at ? 'disabled' : ''}>${st.alerted_at ? '✓ ' + t('parent_alerted_at') : t('btn_alert_parent')}</button>
                ` : ''}
              </div>
            </div>
          `).join('')}
        </div>

        <div id="attendance-error"></div>
        <div class="form-submit">
          <button class="btn btn-primary" id="btn-save-attendance">${t('btn_save_attendance')}</button>
        </div>
      </div>
    `;

    container.querySelector('#btn-mark-all-present').addEventListener('click', () => {
      container.querySelectorAll('[data-status]').forEach(sel => { sel.value = 'present'; });
      this.paintSheetAfterBulkChange(container);
    });

    container.querySelectorAll('[data-status]').forEach(sel => {
      sel.addEventListener('change', () => this.paintSheetAfterBulkChange(container));
    });

    container.querySelectorAll('[data-alert]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          const data = await API.alertParent(btn.dataset.alert);
          UI.toast(I18N.current === 'fr' ? `${data.notified_parents} parent(s) notifié(s).` : `${data.notified_parents} parent(s) notified.`, 'success');
          this.loadSession();
        } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
      });
    });

    container.querySelector('#btn-save-attendance').addEventListener('click', () => this.handleSave(container));
  },

  paintSheetAfterBulkChange(container) {
    // Recalcule les compteurs en direct et affiche/masque justification+alerte selon le statut choisi
    let present = 0, absent = 0, late = 0;
    container.querySelectorAll('[data-status]').forEach(sel => {
      if (sel.value === 'present') present++;
      else if (sel.value === 'absent') absent++;
      else if (sel.value === 'late') late++;
    });
    container.querySelector('#count-present').textContent = present;
    container.querySelector('#count-absent').textContent = absent;
    container.querySelector('#count-late').textContent = late;
  },

  async handleSave(container) {
    const errorBox = container.querySelector('#attendance-error');
    errorBox.innerHTML = '';

    const records = [];
    container.querySelectorAll('[data-status]').forEach(sel => {
      const studentId = sel.dataset.status;
      const justifiedInput = container.querySelector(`[data-justified="${studentId}"]`);
      records.push({
        student_id: studentId,
        status: sel.value,
        justified: justifiedInput ? justifiedInput.checked : false,
      });
    });

    const btn = container.querySelector('#btn-save-attendance');
    UI.setLoading(btn, true);
    try {
      const data = await API.saveAttendanceSession(this.state.selectedClassSubjectId, this.state.date, records, this.state.period);
      UI.toast(t('attendance_saved_toast'), 'success');
      if (data.auto_alerts_sent > 0) {
        UI.toast(t('auto_alerts_notice').replace('{count}', data.auto_alerts_sent), 'default');
      }
      this.loadSession();
    } catch (err) {
      errorBox.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
    } finally {
      UI.setLoading(btn, false, t('btn_save_attendance'));
    }
  },
};
