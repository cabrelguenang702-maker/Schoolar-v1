/**
 * SCHOOLAR — Gestion disciplinaire (section 15)
 */
const DisciplinePage = {
  state: {
    reports: [],
    classes: [],
    students: [],
    classFilter: '',
    statusFilter: '',
    showForm: false,
    selectedStudentId: '',
  },

  CATEGORIES: ['convocation', 'exclusion', 'retard', 'indiscipline', 'violence', 'fraude', 'avertissement'],
  MANAGE_ROLES: ['proviseur', 'principal', 'directeur', 'censeur', 'surveillant_general', 'professeur_principal'],

  async render(root) {
    const user = Store.getUser();
    if (!user) { window.location.hash = '#/login'; return; }
    this.root = root;
    this.user = user;
    this.canManage = this.MANAGE_ROLES.includes(user.role_code);

    try { const d = await API.listClasses(); this.state.classes = d.classes; } catch {}
    await this.loadReports();
    this.paint();
  },

  async loadReports() {
    const qs = new URLSearchParams();
    if (this.state.classFilter) qs.set('class_id', this.state.classFilter);
    if (this.state.statusFilter) qs.set('status', this.state.statusFilter);
    try {
      const d = await API.listDisciplineReports(`?${qs.toString()}`);
      this.state.reports = d.reports;
    } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
  },

  paint() {
    const navItems = DashboardPage.buildNavItems(this.user).map(i => ({ ...i, active: i.href === '#/discipline' }));

    const body = `
      <div class="flex justify-between items-center" style="flex-wrap:wrap;gap:12px;">
        <div>
          <h2>${t('discipline_title')}</h2>
          <p class="text-muted text-sm mt-8">${t('discipline_subtitle')}</p>
        </div>
        ${this.canManage ? `<button class="btn btn-primary" id="btn-new-report">${t('btn_new_report')}</button>` : ''}
      </div>

      <div class="card mt-24">
        <div class="grid-2">
          <div class="field-input-wrap">
            <select id="f-class-filter">
              <option value="">${I18N.current === 'fr' ? 'Toutes les classes' : 'All classes'}</option>
              ${this.state.classes.map(c => `<option value="${c.id}" ${this.state.classFilter === c.id ? 'selected' : ''}>${c.level}${c.series ? ' ' + c.series : ''}${c.section ? ' ' + c.section : ''}</option>`).join('')}
            </select>
          </div>
          <div class="field-input-wrap">
            <select id="f-status-filter">
              <option value="">${t('filter_all_status')}</option>
              <option value="open" ${this.state.statusFilter === 'open' ? 'selected' : ''}>${t('status_open')}</option>
              <option value="resolved" ${this.state.statusFilter === 'resolved' ? 'selected' : ''}>${t('status_resolved')}</option>
            </select>
          </div>
        </div>
      </div>

      <div id="report-form-container"></div>
      <div id="report-list-container" class="mt-24"></div>
    `;

    const content = UI.renderShell(this.root, { user: this.user, navItems, pageBodyHtml: body });
    this.content = content;

    content.querySelector('#f-class-filter').addEventListener('change', async (e) => {
      this.state.classFilter = e.target.value;
      await this.loadReports(); this.paintList();
    });
    content.querySelector('#f-status-filter').addEventListener('change', async (e) => {
      this.state.statusFilter = e.target.value;
      await this.loadReports(); this.paintList();
    });

    if (this.canManage) {
      content.querySelector('#btn-new-report').addEventListener('click', () => {
        this.state.showForm = true;
        this.paintForm();
      });
    }

    this.paintList();
  },

  async paintForm() {
    const container = this.content.querySelector('#report-form-container');
    if (!this.state.showForm) { container.innerHTML = ''; return; }

    container.innerHTML = `
      <div class="card mt-16" style="max-width:640px;">
        <h3>${t('btn_new_report')}</h3>
        <form id="report-form" class="mt-16">
          <div class="field-group">
            <label class="field-label">${t('field_class')}</label>
            <div class="field-input-wrap">
              <select id="rp-class">
                <option value="">${t('none_option')}</option>
                ${this.state.classes.map(c => `<option value="${c.id}">${c.level}${c.series ? ' ' + c.series : ''}${c.section ? ' ' + c.section : ''}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="field-group mt-16">
            <label class="field-label">${t('field_class')} — ${I18N.current === 'fr' ? 'Élève' : 'Student'}</label>
            <div class="field-input-wrap"><select id="rp-student" disabled><option value="">${t('none_option')}</option></select></div>
          </div>
          <div class="grid-2 mt-16">
            <div class="field-group">
              <label class="field-label">${t('field_category')}</label>
              <div class="field-input-wrap">
                <select id="rp-category">
                  ${this.CATEGORIES.map(c => `<option value="${c}">${t('discipline_category_' + c) || c}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="field-group">
              <label class="field-label">${t('field_incident_date')}</label>
              <div class="field-input-wrap"><input type="date" id="rp-date" value="${new Date().toISOString().slice(0, 10)}"></div>
            </div>
          </div>
          <div class="field-group mt-16">
            <label class="field-label">${t('field_description')}</label>
            <div class="field-input-wrap"><input id="rp-description"></div>
          </div>
          <div id="report-form-error"></div>
          <div class="flex gap-8 mt-24">
            <button type="submit" class="btn btn-primary" id="report-form-submit">${t('btn_new_report')}</button>
            <button type="button" class="btn btn-outline" id="report-form-cancel">${I18N.current === 'fr' ? 'Annuler' : 'Cancel'}</button>
          </div>
        </form>
      </div>
    `;

    container.querySelector('#report-form-cancel').addEventListener('click', () => { this.state.showForm = false; this.paintForm(); });

    container.querySelector('#rp-class').addEventListener('change', async (e) => {
      const studentSelect = container.querySelector('#rp-student');
      if (!e.target.value) { studentSelect.innerHTML = `<option value="">${t('none_option')}</option>`; studentSelect.disabled = true; return; }
      try {
        const d = await API.listStudents(`?class_id=${e.target.value}`);
        studentSelect.innerHTML = d.students.map(s => `<option value="${s.id}">${s.last_name} ${s.first_name}</option>`).join('');
        studentSelect.disabled = false;
      } catch { studentSelect.disabled = true; }
    });

    container.querySelector('#report-form').addEventListener('submit', (e) => this.handleSubmit(e));
  },

  async handleSubmit(e) {
    e.preventDefault();
    const errorBox = this.content.querySelector('#report-form-error');
    errorBox.innerHTML = '';

    const studentId = this.content.querySelector('#rp-student').value;
    if (!studentId) { errorBox.innerHTML = `<div class="alert alert-error">${I18N.current === 'fr' ? 'Sélectionnez un élève.' : 'Select a student.'}</div>`; return; }

    const payload = {
      student_id: studentId,
      category: this.content.querySelector('#rp-category').value,
      incident_date: this.content.querySelector('#rp-date').value,
      description: this.content.querySelector('#rp-description').value,
    };

    const btn = this.content.querySelector('#report-form-submit');
    UI.setLoading(btn, true);
    try {
      await API.createDisciplineReport(payload);
      UI.toast(I18N.current === 'fr' ? 'Signalement enregistré.' : 'Report recorded.', 'success');
      this.state.showForm = false;
      this.paintForm();
      await this.loadReports();
      this.paintList();
    } catch (err) {
      errorBox.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
    } finally {
      UI.setLoading(btn, false, t('btn_new_report'));
    }
  },

  paintList() {
    const container = this.content.querySelector('#report-list-container');
    if (!this.state.reports.length) {
      container.innerHTML = `<div class="card"><div class="empty-state">${UI.icon('info', 30)}<p class="mt-8">${t('empty_discipline_reports')}</p></div></div>`;
      return;
    }

    container.innerHTML = this.state.reports.map(r => `
      <div class="card mt-16">
        <div class="card-title-row">
          <div>
            <h3>${r.student_first_name} ${r.student_last_name} <span class="text-muted text-sm">${r.level ? '· ' + r.level + (r.series ? ' ' + r.series : '') + (r.section ? ' ' + r.section : '') : ''}</span></h3>
            <div class="text-sm text-muted mt-8">${t('discipline_category_' + r.category)} · ${r.incident_date} · ${t('reported_by')}: ${r.reported_by_first_name} ${r.reported_by_last_name}</div>
          </div>
          <span class="badge badge-${r.status === 'resolved' ? 'success' : 'warning'}">${t('status_' + r.status)}</span>
        </div>
        ${r.description ? `<p class="text-sm mt-8">${r.description}</p>` : ''}
        ${r.resolution_note ? `<div class="alert alert-success mt-8">${r.resolution_note}</div>` : ''}
        ${this.canManage && r.status === 'open' ? `<button class="btn btn-outline btn-sm mt-16" data-resolve="${r.id}">${t('btn_resolve')}</button>` : ''}
      </div>
    `).join('');

    container.querySelectorAll('[data-resolve]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const note = prompt(t('field_resolution_note')) || '';
        try {
          await API.resolveDisciplineReport(btn.dataset.resolve, note);
          UI.toast(I18N.current === 'fr' ? 'Signalement résolu.' : 'Report resolved.', 'success');
          await this.loadReports(); this.paintList();
        } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
      });
    });
  },
};
