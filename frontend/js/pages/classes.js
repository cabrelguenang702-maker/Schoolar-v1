/**
 * SCHOOLAR — Classes & Matières (sections 7 et 8 du cahier des charges)
 */
const ClassesPage = {
  state: {
    tab: 'classes',
    classes: [],
    schoolYears: [],
    subjects: [],
    templates: [],
    templateLevel: '',
    templateSeries: '',
    teachingStaff: [],
    showClassForm: false,
    showSubjectForm: false,
    showYearForm: false,
    showTemplateForm: false,
    expandedClassId: null,
    expandedClassDetail: null,
  },

  async render(root) {
    const user = Store.getUser();
    if (!user) { window.location.hash = '#/login'; return; }
    this.root = root;
    this.user = user;
    this.canManage = ['proviseur', 'principal', 'directeur'].includes(user.role_code);

    await this.loadSchoolYears();
    await this.loadClasses();
    this.paint();
  },

  async loadSchoolYears() {
    try {
      const data = await API.listSchoolYears();
      this.state.schoolYears = data.school_years;
    } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
  },

  async loadClasses() {
    try {
      const data = await API.listClasses();
      this.state.classes = data.classes;
    } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
  },

  async loadSubjects() {
    try {
      const data = await API.listSubjects();
      this.state.subjects = data.subjects;
    } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
  },

  async loadTemplates() {
    try {
      const data = await API.listLevelTemplates(this.state.templateLevel, this.state.templateSeries);
      this.state.templates = data.templates;
    } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
  },

  async loadTeachingStaff() {
    try {
      const data = await API.listStaff('?status=active');
      this.state.teachingStaff = data.staff.filter(s => ['enseignant', 'professeur_principal'].includes(s.role_code));
    } catch (err) { /* silencieux */ }
  },

  paint() {
    const navItems = DashboardPage.buildNavItems(this.user).map(i => ({ ...i, active: i.href === '#/classes' }));

    const tabs = [
      { key: 'classes', label: t('tab_classes') },
      ...(this.canManage ? [
        { key: 'subjects', label: t('tab_subjects') },
        { key: 'templates', label: t('tab_templates') },
        { key: 'school_years', label: t('tab_school_years') },
      ] : []),
    ];

    const body = `
      <h2>${t('classes_title')}</h2>
      <p class="text-muted text-sm mt-8">${t('classes_subtitle')}</p>
      <div class="role-tabs mt-16">
        ${tabs.map(tb => `<button type="button" class="role-tab ${this.state.tab === tb.key ? 'active' : ''}" data-tab="${tb.key}">${tb.label}</button>`).join('')}
      </div>
      <div class="mt-24" id="tab-content"></div>
    `;

    const content = UI.renderShell(this.root, { user: this.user, navItems, pageBodyHtml: body });
    this.content = content;

    content.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', async () => {
        this.state.tab = btn.dataset.tab;
        await this.loadTabData();
        this.paint();
      });
    });

    this.paintTab();
  },

  async loadTabData() {
    if (this.state.tab === 'subjects') await this.loadSubjects();
    if (this.state.tab === 'templates') { await this.loadSubjects(); await this.loadTemplates(); }
    if (this.state.tab === 'classes') { await this.loadTeachingStaff(); await this.loadClasses(); }
  },

  paintTab() {
    const box = this.content.querySelector('#tab-content');
    if (this.state.tab === 'classes') return this.paintClassesTab(box);
    if (this.state.tab === 'subjects') return this.paintSubjectsTab(box);
    if (this.state.tab === 'templates') return this.paintTemplatesTab(box);
    if (this.state.tab === 'school_years') return this.paintSchoolYearsTab(box);
  },

  // -------------------------------------------------------------------
  // CLASSES
  // -------------------------------------------------------------------
  paintClassesTab(box) {
    const hasCurrentYear = this.state.schoolYears.some(y => y.is_current);

    box.innerHTML = `
      ${this.canManage ? `<div class="flex justify-between items-center"><div></div><button class="btn btn-primary" id="btn-new-class">${t('btn_new_class')}</button></div>` : ''}
      ${!hasCurrentYear && this.canManage ? `
        <div class="card mt-16">
          <div class="empty-state">
            ${UI.icon('building', 28)}
            <h3 class="mt-8">${t('no_school_year_title')}</h3>
            <p class="text-muted mt-8">${t('no_school_year_body')}</p>
            <button class="btn btn-primary mt-16" data-tab="school_years">${t('btn_new_school_year')}</button>
          </div>
        </div>` : ''}
      <div id="class-form-container"></div>
      <div id="class-list-container" class="mt-16"></div>
    `;

    box.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', async () => { this.state.tab = btn.dataset.tab; await this.loadTabData(); this.paint(); });
    });

    if (this.canManage) {
      const btnNew = box.querySelector('#btn-new-class');
      if (btnNew) btnNew.addEventListener('click', async () => {
        if (!hasCurrentYear) { UI.toast(t('no_school_year_body'), 'error'); return; }
        this.state.showClassForm = true;
        await this.loadTeachingStaff();
        this.paintClassForm();
      });
    }

    this.paintClassList(box.querySelector('#class-list-container'));
  },

  paintClassForm() {
    const container = this.content.querySelector('#class-form-container');
    if (!this.state.showClassForm) { container.innerHTML = ''; return; }

    const currentYear = this.state.schoolYears.find(y => y.is_current) || this.state.schoolYears[0];

    container.innerHTML = `
      <div class="card mt-16" style="max-width:640px;">
        <h3>${t('btn_new_class')}</h3>
        <form id="class-form" class="mt-16">
          <div class="field-group">
            <label class="field-label">${t('field_school_year')}</label>
            <div class="field-input-wrap">
              <select id="cl-year">
                ${this.state.schoolYears.map(y => `<option value="${y.id}" ${currentYear && y.id === currentYear.id ? 'selected' : ''}>${y.label}${y.is_current ? ' ★' : ''}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="grid-2 mt-16">
            <div class="field-group">
              <label class="field-label">${t('field_level')}</label>
              <div class="field-input-wrap"><input id="cl-level" placeholder="Ex: 6e, Terminale, Form 3" required></div>
            </div>
            <div class="field-group">
              <label class="field-label">${t('field_series')}</label>
              <div class="field-input-wrap"><input id="cl-series" placeholder="Ex: C, D, TI"></div>
            </div>
          </div>
          <div class="grid-2 mt-16">
            <div class="field-group">
              <label class="field-label">${t('field_section')}</label>
              <div class="field-input-wrap"><input id="cl-section" placeholder="Ex: A, B"></div>
            </div>
            <div class="field-group">
              <label class="field-label">${t('field_room')}</label>
              <div class="field-input-wrap"><input id="cl-room"></div>
            </div>
          </div>
          <div class="grid-2 mt-16">
            <div class="field-group">
              <label class="field-label">${t('field_capacity')}</label>
              <div class="field-input-wrap"><input type="number" min="1" id="cl-capacity"></div>
            </div>
            <div class="field-group">
              <label class="field-label">${t('field_homeroom_teacher')}</label>
              <div class="field-input-wrap">
                <select id="cl-homeroom">
                  <option value="">${t('none_option')}</option>
                  ${this.state.teachingStaff.map(s => `<option value="${s.id}">${s.first_name} ${s.last_name} (${t('role_' + s.role_code)})</option>`).join('')}
                </select>
              </div>
            </div>
          </div>
          <div id="class-form-error"></div>
          <div id="class-form-success"></div>
          <div class="flex gap-8 mt-24">
            <button type="submit" class="btn btn-primary" id="class-form-submit">${t('btn_new_class')}</button>
            <button type="button" class="btn btn-outline" id="class-form-cancel">${I18N.current === 'fr' ? 'Annuler' : 'Cancel'}</button>
          </div>
        </form>
      </div>
    `;

    container.querySelector('#class-form-cancel').addEventListener('click', () => { this.state.showClassForm = false; this.paintClassForm(); });
    container.querySelector('#class-form').addEventListener('submit', (e) => this.handleClassCreate(e));
  },

  async handleClassCreate(e) {
    e.preventDefault();
    const errorBox = this.content.querySelector('#class-form-error');
    const successBox = this.content.querySelector('#class-form-success');
    errorBox.innerHTML = ''; successBox.innerHTML = '';

    const payload = {
      school_year_id: this.content.querySelector('#cl-year').value,
      level: this.content.querySelector('#cl-level').value,
      series: this.content.querySelector('#cl-series').value,
      section: this.content.querySelector('#cl-section').value,
      room: this.content.querySelector('#cl-room').value,
      capacity: this.content.querySelector('#cl-capacity').value || null,
      homeroom_teacher_id: this.content.querySelector('#cl-homeroom').value || null,
    };

    const btn = this.content.querySelector('#class-form-submit');
    UI.setLoading(btn, true);
    try {
      const data = await API.createClass(payload);
      successBox.innerHTML = `<div class="alert alert-success">${I18N.current === 'fr' ? 'Classe créée.' : 'Class created.'} ${data.subjects_auto_added ? data.subjects_auto_added + ' ' + t('class_created_note') : ''}</div>`;
      this.content.querySelector('#class-form').reset();
      await this.loadClasses();
      this.paintClassList(this.content.querySelector('#class-list-container'));
    } catch (err) {
      errorBox.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
    } finally {
      UI.setLoading(btn, false, t('btn_new_class'));
    }
  },

  paintClassList(container) {
    if (!this.state.classes.length) {
      container.innerHTML = `<div class="card"><div class="empty-state">${UI.icon('graph', 30)}<p class="mt-8">${t('empty_classes')}</p></div></div>`;
      return;
    }

    container.innerHTML = this.state.classes.map(c => `
      <div class="card mt-16">
        <div class="card-title-row">
          <div>
            <h3>${c.level}${c.series ? ' ' + c.series : ''}${c.section ? ' ' + c.section : ''}</h3>
            <div class="text-sm text-muted mt-8">
              ${c.room ? c.room + ' · ' : ''}${c.homeroom_first_name ? (I18N.current === 'fr' ? 'PP: ' : 'Homeroom: ') + c.homeroom_first_name + ' ' + c.homeroom_last_name : ''}
            </div>
          </div>
          <button class="btn btn-outline btn-sm" data-action="toggle" data-id="${c.id}">${this.state.expandedClassId === c.id ? (I18N.current === 'fr' ? 'Fermer' : 'Close') : (I18N.current === 'fr' ? 'Détails' : 'Details')}</button>
        </div>
        <div class="stat-grid mt-16" style="grid-template-columns:repeat(5,1fr);">
          <div class="stat-card" style="padding:12px;"><div class="stat-label">${t('badge_students')}</div><div class="stat-value" style="font-size:20px;">${c.student_count}</div></div>
          <div class="stat-card" style="padding:12px;"><div class="stat-label">${t('badge_subjects')}</div><div class="stat-value" style="font-size:20px;">${c.subject_count}</div></div>
          <div class="stat-card" style="padding:12px;"><div class="stat-label">${t('badge_teachers')}</div><div class="stat-value" style="font-size:20px;">${c.teacher_count}</div></div>
          <div class="stat-card" style="padding:12px;"><div class="stat-label">${t('badge_absent_today')}</div><div class="stat-value" style="font-size:20px;">${c.absent_today_count}</div></div>
          <div class="stat-card" style="padding:12px;"><div class="stat-label">${t('badge_grades_entered')}</div><div class="stat-value" style="font-size:20px;">${c.grades_entered_count}</div></div>
        </div>
        <div id="class-detail-${c.id}"></div>
      </div>
    `).join('');

    container.querySelectorAll('[data-action="toggle"]').forEach(btn => {
      btn.addEventListener('click', () => this.toggleClassDetail(btn.dataset.id, container));
    });

    if (this.state.expandedClassId) {
      const detailBox = container.querySelector(`#class-detail-${this.state.expandedClassId}`);
      if (detailBox && this.state.expandedClassDetail) this.paintClassDetail(detailBox, this.state.expandedClassDetail);
    }
  },

  async toggleClassDetail(classId, container) {
    if (this.state.expandedClassId === classId) {
      this.state.expandedClassId = null;
      this.state.expandedClassDetail = null;
      this.paintClassList(container);
      return;
    }
    try {
      const data = await API.getClass(classId);
      this.state.expandedClassId = classId;
      this.state.expandedClassDetail = data.class;
      await this.loadSubjects();
      await this.loadTeachingStaff();
      this.paintClassList(container);
    } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
  },

  paintClassDetail(box, cls) {
    const canManageThisClass = this.canManage || (this.user.role_code === 'professeur_principal' && cls.homeroom_teacher_id === this.user.id);

    box.innerHTML = `
      <div class="mt-16" style="border-top:1px solid var(--color-border);padding-top:16px;">
        <div class="flex justify-between items-center">
          <h4 style="font-size:14px;">${t('class_detail_subjects')}</h4>
          ${canManageThisClass ? `<button class="btn btn-outline btn-sm" data-action="add-subject">${t('btn_add_subject')}</button>` : ''}
        </div>
        <div id="add-subject-form-${cls.id}"></div>
        <div class="mt-8">
          ${cls.subjects.map(s => `
            <div class="flex items-center justify-between gap-8 mt-8" style="padding:8px 0;border-bottom:1px solid var(--color-border);">
              <div style="flex:1;">
                <strong>${s.subject_name}</strong>
                <span class="text-muted text-sm"> · ${t('field_coefficient')}: ${parseFloat(s.coefficient)}</span>
              </div>
              ${canManageThisClass ? `
                <select data-teacher-select="${s.id}" style="max-width:220px;">
                  <option value="">${t('none_option')}</option>
                  ${this.state.teachingStaff.map(st => `<option value="${st.id}" ${s.teacher_id === st.id ? 'selected' : ''}>${st.first_name} ${st.last_name}</option>`).join('')}
                </select>
                <button class="btn btn-outline btn-sm" data-action="remove-subject" data-row="${s.id}">✕</button>
              ` : `<span class="text-sm text-muted">${s.teacher_first_name ? s.teacher_first_name + ' ' + s.teacher_last_name : '—'}</span>`}
            </div>
          `).join('') || `<p class="text-muted text-sm mt-8">—</p>`}
        </div>

        ${['proviseur', 'principal', 'directeur', 'censeur', 'secretaire'].includes(this.user.role_code) ? `
          <h4 style="font-size:14px;margin-top:20px;">${t('bulletin_template_title')}</h4>
          <p class="text-muted text-sm mt-8">${t('bulletin_template_hint')}</p>
          <div class="flex items-center gap-8 mt-8" style="flex-wrap:wrap;">
            <input type="file" id="bulletin-template-file-${cls.id}" accept="image/jpeg,image/png">
            <button class="btn btn-outline btn-sm" id="bulletin-template-upload-${cls.id}">${t('btn_upload_template')}</button>
          </div>
          <div id="bulletin-template-status-${cls.id}" class="mt-8"></div>
        ` : ''}
      </div>
    `;

    if (canManageThisClass) {
      const addBtn = box.querySelector('[data-action="add-subject"]');
      if (addBtn) addBtn.addEventListener('click', () => this.paintAddSubjectForm(box, cls));

      box.querySelectorAll('[data-teacher-select]').forEach(sel => {
        sel.addEventListener('change', async () => {
          try {
            await API.updateClassSubject(cls.id, sel.dataset.teacherSelect, { teacher_id: sel.value || null });
            UI.toast(I18N.current === 'fr' ? 'Enseignant assigné.' : 'Teacher assigned.', 'success');
            await this.toggleClassDetail(cls.id, this.content.querySelector('#class-list-container'));
            await this.toggleClassDetail(cls.id, this.content.querySelector('#class-list-container'));
          } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
        });
      });

      box.querySelectorAll('[data-action="remove-subject"]').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            await API.removeClassSubject(cls.id, btn.dataset.row);
            const data = await API.getClass(cls.id);
            this.state.expandedClassDetail = data.class;
            await this.loadClasses();
            this.paintClassList(this.content.querySelector('#class-list-container'));
          } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
        });
      });
    }

    const templateBtn = box.querySelector(`#bulletin-template-upload-${cls.id}`);
    if (templateBtn) {
      templateBtn.addEventListener('click', async () => {
        const fileInput = box.querySelector(`#bulletin-template-file-${cls.id}`);
        const statusBox = box.querySelector(`#bulletin-template-status-${cls.id}`);
        if (!fileInput.files.length) { statusBox.innerHTML = `<div class="alert alert-error">${t('field_file')}</div>`; return; }
        UI.setLoading(templateBtn, true);
        try {
          await API.uploadBulletinTemplate(cls.id, fileInput.files[0]);
          statusBox.innerHTML = `<div class="alert alert-success">${t('bulletin_template_saved')}</div>`;
        } catch (err) {
          statusBox.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
        } finally {
          UI.setLoading(templateBtn, false, t('btn_upload_template'));
        }
      });
    }
  },

  paintAddSubjectForm(box, cls) {
    const container = box.querySelector(`#add-subject-form-${cls.id}`);
    const availableSubjects = this.state.subjects.filter(s => !cls.subjects.some(cs => cs.subject_id === s.id));

    container.innerHTML = `
      <div class="flex gap-8 items-center mt-8" style="flex-wrap:wrap;">
        <select id="new-subj-${cls.id}">
          ${availableSubjects.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
        </select>
        <input type="number" step="0.5" min="0" id="new-coef-${cls.id}" placeholder="${t('field_coefficient')}" style="width:100px;" value="1">
        <button class="btn btn-primary btn-sm" id="confirm-add-subj-${cls.id}">${t('btn_add_subject')}</button>
      </div>
    `;

    const confirmBtn = container.querySelector(`#confirm-add-subj-${cls.id}`);
    if (confirmBtn) confirmBtn.addEventListener('click', async () => {
      const subjectId = container.querySelector(`#new-subj-${cls.id}`).value;
      const coef = container.querySelector(`#new-coef-${cls.id}`).value || 1;
      if (!subjectId) return;
      try {
        await API.addClassSubject(cls.id, { subject_id: subjectId, coefficient: coef });
        const data = await API.getClass(cls.id);
        this.state.expandedClassDetail = data.class;
        await this.loadClasses();
        this.paintClassList(this.content.querySelector('#class-list-container'));
      } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
    });
  },

  // -------------------------------------------------------------------
  // CATALOGUE DE MATIÈRES
  // -------------------------------------------------------------------
  paintSubjectsTab(box) {
    box.innerHTML = `
      <div class="flex justify-between items-center">
        <p class="text-muted text-sm">${t('subjects_catalog_subtitle')}</p>
        <button class="btn btn-primary" id="btn-new-subject">${t('btn_new_subject')}</button>
      </div>
      <div id="subject-form-container"></div>
      <div id="subject-list-container" class="mt-16"></div>
    `;

    box.querySelector('#btn-new-subject').addEventListener('click', () => {
      this.state.showSubjectForm = true;
      this.paintSubjectForm();
    });

    this.paintSubjectList(box.querySelector('#subject-list-container'));
  },

  paintSubjectForm() {
    const container = this.content.querySelector('#subject-form-container');
    if (!this.state.showSubjectForm) { container.innerHTML = ''; return; }

    container.innerHTML = `
      <div class="card mt-16" style="max-width:480px;">
        <form id="subject-form">
          <div class="field-group">
            <label class="field-label">${t('field_subject_name')}</label>
            <div class="field-input-wrap"><input id="sub-name" required></div>
          </div>
          <div class="field-group mt-16">
            <label class="field-label">${t('field_subject_code')}</label>
            <div class="field-input-wrap"><input id="sub-code"></div>
          </div>
          <div id="subject-form-error"></div>
          <div class="flex gap-8 mt-16">
            <button type="submit" class="btn btn-primary btn-sm">${t('btn_new_subject')}</button>
            <button type="button" class="btn btn-outline btn-sm" id="subject-form-cancel">${I18N.current === 'fr' ? 'Annuler' : 'Cancel'}</button>
          </div>
        </form>
      </div>
    `;

    container.querySelector('#subject-form-cancel').addEventListener('click', () => { this.state.showSubjectForm = false; this.paintSubjectForm(); });
    container.querySelector('#subject-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorBox = container.querySelector('#subject-form-error');
      errorBox.innerHTML = '';
      try {
        await API.createSubject({ name: container.querySelector('#sub-name').value, code: container.querySelector('#sub-code').value });
        this.state.showSubjectForm = false;
        await this.loadSubjects();
        this.paintSubjectsTab(this.content.querySelector('#tab-content'));
      } catch (err) {
        errorBox.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
      }
    });
  },

  paintSubjectList(container) {
    if (!this.state.subjects.length) {
      container.innerHTML = `<div class="card"><div class="empty-state">${UI.icon('graph', 30)}<p class="mt-8">${t('no_subjects_yet')}</p></div></div>`;
      return;
    }
    container.innerHTML = `<div class="card"><table style="width:100%;border-collapse:collapse;">
      ${this.state.subjects.map(s => `
        <tr style="border-bottom:1px solid var(--color-border);">
          <td style="padding:10px 4px;font-weight:600;">${s.name}</td>
          <td style="padding:10px 4px;color:var(--color-text-muted);">${s.code || ''}</td>
          <td style="padding:10px 4px;text-align:right;"><button class="btn btn-outline btn-sm" data-action="archive-subject" data-id="${s.id}">${t('btn_archive')}</button></td>
        </tr>
      `).join('')}
    </table></div>`;

    container.querySelectorAll('[data-action="archive-subject"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await API.archiveSubject(btn.dataset.id);
          await this.loadSubjects();
          this.paintSubjectList(container);
        } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
      });
    });
  },

  // -------------------------------------------------------------------
  // MODÈLES PAR NIVEAU
  // -------------------------------------------------------------------
  paintTemplatesTab(box) {
    box.innerHTML = `
      <p class="text-muted text-sm">${t('level_templates_subtitle')}</p>
      <div class="card mt-16">
        <div class="grid-2">
          <div class="field-group">
            <label class="field-label">${t('field_level')}</label>
            <div class="field-input-wrap"><input id="tpl-level" value="${this.state.templateLevel}" placeholder="Ex: Terminale"></div>
          </div>
          <div class="field-group">
            <label class="field-label">${t('field_series')}</label>
            <div class="field-input-wrap"><input id="tpl-series" value="${this.state.templateSeries}" placeholder="Ex: C"></div>
          </div>
        </div>
        <button class="btn btn-primary btn-sm mt-16" id="tpl-search">${I18N.current === 'fr' ? 'Afficher le modèle' : 'Show template'}</button>
      </div>
      <div id="template-list-container" class="mt-16"></div>
    `;

    box.querySelector('#tpl-search').addEventListener('click', async () => {
      this.state.templateLevel = box.querySelector('#tpl-level').value;
      this.state.templateSeries = box.querySelector('#tpl-series').value;
      await this.loadTemplates();
      this.paintTemplateList(box.querySelector('#template-list-container'));
    });

    this.paintTemplateList(box.querySelector('#template-list-container'));
  },

  paintTemplateList(container) {
    if (!this.state.templateLevel) {
      container.innerHTML = `<div class="card"><p class="text-muted text-sm">${I18N.current === 'fr' ? 'Renseignez un niveau pour afficher ou créer son modèle.' : 'Enter a level to view or create its template.'}</p></div>`;
      return;
    }

    const availableSubjects = this.state.subjects.filter(s => !this.state.templates.some(tp => tp.subject_id === s.id));

    container.innerHTML = `
      <div class="card">
        ${this.state.templates.length ? this.state.templates.map(tp => `
          <div class="flex items-center justify-between gap-8" style="padding:8px 0;border-bottom:1px solid var(--color-border);">
            <div><strong>${tp.subject_name}</strong></div>
            <div class="flex items-center gap-8">
              <input type="number" step="0.5" min="0" value="${parseFloat(tp.coefficient)}" data-coef="${tp.id}" style="width:80px;padding:6px;border:1px solid var(--color-border);border-radius:8px;">
              <button class="btn btn-outline btn-sm" data-remove-tpl="${tp.id}">✕</button>
            </div>
          </div>
        `).join('') : `<p class="text-muted text-sm">${t('no_template_yet')}</p>`}

        ${availableSubjects.length ? `
          <div class="flex gap-8 items-center mt-16" style="flex-wrap:wrap;">
            <select id="tpl-add-subject">${availableSubjects.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}</select>
            <input type="number" step="0.5" min="0" id="tpl-add-coef" value="1" style="width:90px;">
            <button class="btn btn-primary btn-sm" id="tpl-add-btn">${I18N.current === 'fr' ? 'Ajouter au modèle' : 'Add to template'}</button>
          </div>
        ` : ''}
      </div>
    `;

    container.querySelectorAll('[data-coef]').forEach(input => {
      input.addEventListener('change', async () => {
        try {
          await API.updateLevelTemplateSubject(input.dataset.coef, input.value);
          UI.toast(I18N.current === 'fr' ? 'Coefficient mis à jour.' : 'Coefficient updated.', 'success');
        } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
      });
    });
    container.querySelectorAll('[data-remove-tpl]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await API.removeLevelTemplateSubject(btn.dataset.removeTpl);
          await this.loadTemplates();
          this.paintTemplateList(container);
        } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
      });
    });
    const addBtn = container.querySelector('#tpl-add-btn');
    if (addBtn) addBtn.addEventListener('click', async () => {
      const subjectId = container.querySelector('#tpl-add-subject').value;
      const coef = container.querySelector('#tpl-add-coef').value || 1;
      try {
        await API.addLevelTemplateSubject({ level: this.state.templateLevel, series: this.state.templateSeries || null, subject_id: subjectId, coefficient: coef });
        await this.loadTemplates();
        this.paintTemplateList(container);
      } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
    });
  },

  // -------------------------------------------------------------------
  // ANNÉES SCOLAIRES
  // -------------------------------------------------------------------
  paintSchoolYearsTab(box) {
    box.innerHTML = `
      <div class="flex justify-between items-center">
        <div></div>
        <button class="btn btn-primary" id="btn-new-year">${t('btn_new_school_year')}</button>
      </div>
      <div id="year-form-container"></div>
      <div id="year-list-container" class="mt-16"></div>
    `;

    box.querySelector('#btn-new-year').addEventListener('click', () => { this.state.showYearForm = true; this.paintYearForm(); });
    this.paintYearList(box.querySelector('#year-list-container'));
  },

  paintYearForm() {
    const container = this.content.querySelector('#year-form-container');
    if (!this.state.showYearForm) { container.innerHTML = ''; return; }

    container.innerHTML = `
      <div class="card mt-16" style="max-width:520px;">
        <form id="year-form">
          <div class="field-group">
            <label class="field-label">${t('field_year_label')}</label>
            <div class="field-input-wrap"><input id="yr-label" placeholder="2026-2027" required></div>
          </div>
          <div class="grid-2 mt-16">
            <div class="field-group">
              <label class="field-label">${t('field_start_date')}</label>
              <div class="field-input-wrap"><input type="date" id="yr-start" required></div>
            </div>
            <div class="field-group">
              <label class="field-label">${t('field_end_date')}</label>
              <div class="field-input-wrap"><input type="date" id="yr-end" required></div>
            </div>
          </div>
          <label class="flex items-center gap-8 mt-16 text-sm"><input type="checkbox" id="yr-current" checked> ${t('set_as_current')}</label>
          <div id="year-form-error"></div>
          <div class="flex gap-8 mt-16">
            <button type="submit" class="btn btn-primary btn-sm">${t('btn_new_school_year')}</button>
            <button type="button" class="btn btn-outline btn-sm" id="year-form-cancel">${I18N.current === 'fr' ? 'Annuler' : 'Cancel'}</button>
          </div>
        </form>
      </div>
    `;

    container.querySelector('#year-form-cancel').addEventListener('click', () => { this.state.showYearForm = false; this.paintYearForm(); });
    container.querySelector('#year-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorBox = container.querySelector('#year-form-error');
      errorBox.innerHTML = '';
      try {
        await API.createSchoolYear({
          label: container.querySelector('#yr-label').value,
          start_date: container.querySelector('#yr-start').value,
          end_date: container.querySelector('#yr-end').value,
          is_current: container.querySelector('#yr-current').checked,
        });
        this.state.showYearForm = false;
        await this.loadSchoolYears();
        this.paintSchoolYearsTab(this.content.querySelector('#tab-content'));
      } catch (err) {
        errorBox.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
      }
    });
  },

  paintYearList(container) {
    if (!this.state.schoolYears.length) {
      container.innerHTML = `<div class="card"><p class="text-muted text-sm">${I18N.current === 'fr' ? 'Aucune année scolaire.' : 'No school years.'}</p></div>`;
      return;
    }
    container.innerHTML = this.state.schoolYears.map(y => `
      <div class="card mt-8">
        <div class="flex justify-between items-center">
          <div>
            <strong>${y.label}</strong>
            <div class="text-sm text-muted">${y.start_date} → ${y.end_date}</div>
          </div>
          ${y.is_current ? `<span class="badge badge-success">★ ${I18N.current === 'fr' ? 'Courante' : 'Current'}</span>` : `<button class="btn btn-outline btn-sm" data-set-current="${y.id}">${set_as_current_label()}</button>`}
        </div>
      </div>
    `).join('');

    function set_as_current_label() { return t('set_as_current'); }

    container.querySelectorAll('[data-set-current]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await API.setCurrentSchoolYear(btn.dataset.setCurrent);
          await this.loadSchoolYears();
          this.paintYearList(container);
        } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
      });
    });
  },
};
