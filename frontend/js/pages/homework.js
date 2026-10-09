/**
 * SCHOOLAR — Devoirs à domicile (section 14) — vue enseignant/administration
 */
const HomeworkPage = {
  state: {
    myEntries: [],
    selectedEntry: null,
    assignments: [],
    selectedAssignment: null,
    assignmentDetail: null,
    showForm: false,
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
    const navItems = DashboardPage.buildNavItems(this.user).map(i => ({ ...i, active: i.href === '#/homework' }));

    const body = `
      <div class="flex justify-between items-center" style="flex-wrap:wrap;gap:12px;">
        <div>
          <h2>${t('homework_title')}</h2>
          <p class="text-muted text-sm mt-8">${t('homework_subtitle')}</p>
        </div>
      </div>

      <div class="card mt-24">
        <div class="field-group">
          <label class="field-label">${t('field_class')} / ${t('field_subject')}</label>
          <div class="field-input-wrap">
            <select id="hw-entry-select">
              <option value="">${t('none_option')}</option>
              ${this.state.myEntries.map((e, i) => `<option value="${i}">${e.classSubject.subject_name} — ${e.class.level}${e.class.series ? ' ' + e.class.series : ''}${e.class.section ? ' ' + e.class.section : ''}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <div id="homework-list-container" class="mt-24"></div>
      <div id="homework-detail-container" class="mt-24"></div>
    `;

    const content = UI.renderShell(this.root, { user: this.user, navItems, pageBodyHtml: body });
    this.content = content;

    content.querySelector('#hw-entry-select').addEventListener('change', async (e) => {
      this.state.selectedAssignment = null;
      this.state.assignmentDetail = null;
      if (e.target.value === '') { this.state.selectedEntry = null; this.paintList(); this.paintDetail(); return; }
      this.state.selectedEntry = this.state.myEntries[e.target.value];
      await this.loadAssignments();
      this.paint();
    });

    this.paintList();
    this.paintDetail();
  },

  async loadAssignments() {
    try {
      const d = await API.listHomework(this.state.selectedEntry.classSubject.id);
      this.state.assignments = d.assignments;
    } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
  },

  paintList() {
    const container = this.content.querySelector('#homework-list-container');
    if (!this.state.selectedEntry) { container.innerHTML = `<div class="card"><p class="text-muted text-sm">${t('select_subject_class')}</p></div>`; return; }

    container.innerHTML = `
      <div class="flex justify-between items-center">
        <div></div>
        <button class="btn btn-primary btn-sm" id="btn-new-homework">${t('btn_new_homework')}</button>
      </div>
      <div id="homework-form-container"></div>
      <div class="mt-16">
        ${this.state.assignments.length ? this.state.assignments.map(a => `
          <div class="card mt-8">
            <div class="flex justify-between items-center">
              <div>
                <strong>${a.title}</strong>
                <div class="text-sm text-muted mt-8">${t('field_due_date')}: ${a.due_date} · ${a.submission_count} ${I18N.current === 'fr' ? 'soumission(s)' : 'submission(s)'}</div>
              </div>
              <button class="btn btn-outline btn-sm" data-view="${a.id}">${t('btn_view_details')}</button>
            </div>
          </div>
        `).join('') : `<div class="card"><p class="text-muted text-sm">${t('empty_homework')}</p></div>`}
      </div>
    `;

    container.querySelector('#btn-new-homework').addEventListener('click', () => { this.state.showForm = true; this.paintForm(); });
    container.querySelectorAll('[data-view]').forEach(btn => {
      btn.addEventListener('click', async () => {
        this.state.selectedAssignment = btn.dataset.view;
        await this.loadDetail();
        this.paintDetail();
      });
    });
  },

  paintForm() {
    const container = this.content.querySelector('#homework-form-container');
    if (!this.state.showForm) { container.innerHTML = ''; return; }

    container.innerHTML = `
      <div class="card mt-16">
        <div class="field-group">
          <label class="field-label">${t('btn_new_homework')}</label>
          <div class="field-input-wrap"><input id="hw-title" placeholder="${I18N.current === 'fr' ? 'Titre' : 'Title'}"></div>
        </div>
        <div class="field-group mt-16">
          <label class="field-label">${t('field_instructions')}</label>
          <div class="field-input-wrap"><input id="hw-instructions"></div>
        </div>
        <div class="field-group mt-16">
          <label class="field-label">${t('field_due_date')}</label>
          <div class="field-input-wrap"><input type="date" id="hw-due"></div>
        </div>
        <div id="hw-form-error"></div>
        <div class="flex gap-8 mt-16">
          <button class="btn btn-primary btn-sm" id="hw-form-submit">${t('btn_new_homework')}</button>
          <button class="btn btn-outline btn-sm" id="hw-form-cancel">${I18N.current === 'fr' ? 'Annuler' : 'Cancel'}</button>
        </div>
      </div>
    `;

    container.querySelector('#hw-form-cancel').addEventListener('click', () => { this.state.showForm = false; this.paintForm(); });
    container.querySelector('#hw-form-submit').addEventListener('click', async () => {
      const errorBox = container.querySelector('#hw-form-error');
      errorBox.innerHTML = '';
      try {
        await API.createHomework(this.state.selectedEntry.classSubject.id, {
          title: container.querySelector('#hw-title').value,
          description: container.querySelector('#hw-instructions').value,
          due_date: container.querySelector('#hw-due').value,
        });
        this.state.showForm = false;
        await this.loadAssignments();
        this.paint();
      } catch (err) {
        errorBox.innerHTML = `<div class="alert alert-error mt-8">${err.message || 'Erreur.'}</div>`;
      }
    });
  },

  async loadDetail() {
    try {
      this.state.assignmentDetail = await API.getHomework(this.state.selectedAssignment);
    } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
  },

  paintDetail() {
    const container = this.content.querySelector('#homework-detail-container');
    if (!this.state.assignmentDetail) { container.innerHTML = ''; return; }
    const d = this.state.assignmentDetail;

    container.innerHTML = `
      <div class="card">
        <h3>${t('homework_tracking_title')} — ${d.assignment.title}</h3>
        <div class="mt-16">
          ${d.submissions.map(s => `
            <div class="flex items-center justify-between" style="padding:8px 0;border-bottom:1px solid var(--color-border);">
              <div>${s.last_name} ${s.first_name} <span class="text-muted text-sm">${new Date(s.submitted_at).toLocaleString()}</span></div>
              <div class="flex items-center gap-8">
                <span class="badge badge-${s.reviewed ? 'success' : 'info'}">${s.reviewed ? t('homework_reviewed_badge') : t('homework_submitted_badge')}</span>
                <a class="btn btn-outline btn-sm" href="${API.downloadHomeworkSubmissionUrl(s.id)}" target="_blank">${t('btn_download')}</a>
                ${!s.reviewed ? `<button class="btn btn-primary btn-sm" data-review="${s.id}">${t('btn_mark_reviewed')}</button>` : ''}
              </div>
            </div>
          `).join('')}
          ${d.not_submitted.map(s => `
            <div class="flex items-center justify-between" style="padding:8px 0;border-bottom:1px solid var(--color-border);">
              <div>${s.last_name} ${s.first_name}</div>
              <span class="badge badge-warning">${t('homework_not_submitted_badge')}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    container.querySelectorAll('[data-review]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await API.reviewHomeworkSubmission(btn.dataset.review, '');
          await this.loadDetail();
          this.paintDetail();
        } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
      });
    });
  },
};
