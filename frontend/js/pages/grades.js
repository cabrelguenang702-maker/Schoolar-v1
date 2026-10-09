/**
 * SCHOOLAR — Gestion des notes (section 11)
 * Deux volets selon le rôle :
 *  - Saisie (enseignant / professeur principal / admin) : feuille de notes par matière+séquence
 *  - Validation & vue d'ensemble (proviseur/principal/censeur/surveillant général)
 */
const GradesPage = {
  state: {
    schoolYears: [],
    sequences: [],
    sequenceId: '',
    classes: [],
    myEntries: [],       // { class, classSubject } que l'utilisateur peut noter
    selectedEntry: null, // entrée actuellement ouverte pour saisie
    sheet: null,
    selectedClassId: '', // pour la vue d'ensemble admin
    summary: null,
    showSequenceForm: false,
  },

  VALIDATOR_ROLES: ['proviseur', 'principal', 'directeur', 'censeur'],
  FULL_ACCESS_ROLES: ['proviseur', 'principal', 'directeur', 'censeur', 'surveillant_general'],

  async render(root) {
    const user = Store.getUser();
    if (!user) { window.location.hash = '#/login'; return; }
    this.root = root;
    this.user = user;
    this.canEnter = ['enseignant', 'professeur_principal', 'proviseur', 'principal', 'directeur'].includes(user.role_code);
    this.canValidate = this.VALIDATOR_ROLES.includes(user.role_code);
    this.hasFullAccess = this.FULL_ACCESS_ROLES.includes(user.role_code);

    await this.loadSchoolYears();
    await this.loadSequences();
    if (this.canEnter) await this.loadMyEntries();
    if (this.hasFullAccess) await this.loadClasses();

    this.paint();
  },

  async loadSchoolYears() {
    try { const d = await API.listSchoolYears(); this.state.schoolYears = d.school_years; } catch {}
  },

  async loadSequences() {
    const current = this.state.schoolYears.find(y => y.is_current);
    try {
      const d = await API.listSequences(current ? current.id : null);
      this.state.sequences = d.sequences;
      if (!this.state.sequenceId && this.state.sequences.length) {
        this.state.sequenceId = this.state.sequences[this.state.sequences.length - 1].id;
      }
    } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
  },

  async loadClasses() {
    try { const d = await API.listClasses(); this.state.classes = d.classes; } catch {}
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
    } catch (err) { /* silencieux */ }
  },

  paint() {
    const navItems = DashboardPage.buildNavItems(this.user).map(i => ({ ...i, active: i.href === '#/grades' }));

    const body = `
      <h2>${t('grades_title')}</h2>
      <p class="text-muted text-sm mt-8">${t('grades_subtitle')}</p>

      <div class="card mt-24">
        <div class="grid-2" style="grid-template-columns: 2fr 1fr; align-items:end;">
          <div class="field-group">
            <label class="field-label">${t('field_sequence')}</label>
            <div class="field-input-wrap">
              <select id="seq-select">
                ${this.state.sequences.map(s => `<option value="${s.id}" ${this.state.sequenceId === s.id ? 'selected' : ''}>${s.term_label ? s.term_label + ' — ' : ''}${s.label}</option>`).join('')}
              </select>
            </div>
          </div>
          ${['proviseur', 'principal', 'directeur'].includes(this.user.role_code) ? `<button class="btn btn-outline btn-sm" id="btn-new-sequence">${t('btn_new_sequence')}</button>` : ''}
        </div>
        <div id="sequence-form-container"></div>
      </div>

      ${this.canEnter ? `<div class="mt-24"><h3 style="font-size:16px;">${t('my_grading_title')}</h3><div id="my-entries-container" class="mt-16"></div></div>` : ''}
      ${this.hasFullAccess ? `<div class="mt-24"><h3 style="font-size:16px;">${t('class_overview_title')}</h3><div id="class-overview-container" class="mt-16"></div></div>` : ''}
      <div id="grade-sheet-container" class="mt-24"></div>
    `;

    const content = UI.renderShell(this.root, { user: this.user, navItems, pageBodyHtml: body });
    this.content = content;

    content.querySelector('#seq-select').addEventListener('change', async (e) => {
      this.state.sequenceId = e.target.value;
      this.state.selectedEntry = null;
      this.state.sheet = null;
      this.state.summary = null;
      if (this.canEnter) this.paintMyEntries();
      if (this.hasFullAccess) this.paintClassOverview();
      content.querySelector('#grade-sheet-container').innerHTML = '';
    });

    const newSeqBtn = content.querySelector('#btn-new-sequence');
    if (newSeqBtn) newSeqBtn.addEventListener('click', () => { this.state.showSequenceForm = true; this.paintSequenceForm(); });

    if (this.canEnter) this.paintMyEntries();
    if (this.hasFullAccess) this.paintClassOverview();
  },

  paintSequenceForm() {
    const container = this.content.querySelector('#sequence-form-container');
    if (!this.state.showSequenceForm) { container.innerHTML = ''; return; }
    const current = this.state.schoolYears.find(y => y.is_current) || this.state.schoolYears[0];

    container.innerHTML = `
      <div class="mt-16" style="border-top:1px solid var(--color-border);padding-top:16px;">
        <div class="grid-2">
          <div class="field-group">
            <label class="field-label">${t('field_term_label')}</label>
            <div class="field-input-wrap"><input id="sq-term" placeholder="Trimestre 1"></div>
          </div>
          <div class="field-group">
            <label class="field-label">${t('field_sequence_label')}</label>
            <div class="field-input-wrap"><input id="sq-label" placeholder="Séquence 1" required></div>
          </div>
        </div>
        <div class="field-group mt-16">
          <label class="field-label">${t('field_order')}</label>
          <div class="field-input-wrap"><input type="number" min="1" id="sq-order" value="${this.state.sequences.length + 1}"></div>
        </div>
        <div id="sequence-form-error"></div>
        <div class="flex gap-8 mt-16">
          <button class="btn btn-primary btn-sm" id="sequence-form-submit">${t('btn_new_sequence')}</button>
          <button class="btn btn-outline btn-sm" id="sequence-form-cancel">${I18N.current === 'fr' ? 'Annuler' : 'Cancel'}</button>
        </div>
      </div>
    `;

    container.querySelector('#sequence-form-cancel').addEventListener('click', () => { this.state.showSequenceForm = false; this.paintSequenceForm(); });
    container.querySelector('#sequence-form-submit').addEventListener('click', async () => {
      const errorBox = container.querySelector('#sequence-form-error');
      errorBox.innerHTML = '';
      if (!current) { errorBox.innerHTML = `<div class="alert alert-error mt-8">${t('no_school_year_body')}</div>`; return; }
      try {
        await API.createSequence({
          school_year_id: current.id,
          term_label: container.querySelector('#sq-term').value,
          label: container.querySelector('#sq-label').value,
          order_index: container.querySelector('#sq-order').value,
        });
        this.state.showSequenceForm = false;
        await this.loadSequences();
        this.paint();
      } catch (err) {
        errorBox.innerHTML = `<div class="alert alert-error mt-8">${err.message || 'Erreur.'}</div>`;
      }
    });
  },

  // -------------------------------------------------------------------
  // SAISIE (enseignant / professeur principal / admin)
  // -------------------------------------------------------------------
  paintMyEntries() {
    const container = this.content.querySelector('#my-entries-container');
    if (!container) return;

    if (!this.state.sequenceId) {
      container.innerHTML = `<div class="card"><p class="text-muted text-sm">${I18N.current === 'fr' ? 'Sélectionnez une séquence.' : 'Select a sequence.'}</p></div>`;
      return;
    }
    if (!this.state.myEntries.length) {
      container.innerHTML = `<div class="card"><p class="text-muted text-sm">${t('no_grading_entries')}</p></div>`;
      return;
    }

    container.innerHTML = this.state.myEntries.map((e, idx) => `
      <div class="card mt-8">
        <div class="flex justify-between items-center">
          <div>
            <strong>${e.classSubject.subject_name}</strong>
            <span class="text-muted text-sm"> — ${e.class.level}${e.class.series ? ' ' + e.class.series : ''}${e.class.section ? ' ' + e.class.section : ''}</span>
          </div>
          <button class="btn btn-primary btn-sm" data-open-entry="${idx}">${t('btn_grade_entry')}</button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('[data-open-entry]').forEach(btn => {
      btn.addEventListener('click', () => this.openGradeSheet(this.state.myEntries[btn.dataset.openEntry]));
    });
  },

  async openGradeSheet(entry) {
    this.state.selectedEntry = entry;
    try {
      const data = await API.getGradeSheet(entry.classSubject.id, this.state.sequenceId);
      this.state.sheet = data;
      this.paintGradeSheet();
      this.content.querySelector('#grade-sheet-container').scrollIntoView({ behavior: 'smooth' });
    } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
  },

  paintGradeSheet() {
    const container = this.content.querySelector('#grade-sheet-container');
    const sheet = this.state.sheet;
    const entry = this.state.selectedEntry;
    if (!sheet || !entry) { container.innerHTML = ''; return; }

    container.innerHTML = `
      <div class="card">
        <div class="card-title-row">
          <div>
            <h3>${sheet.subject_name} <span class="text-muted text-sm">(coeff. ${sheet.coefficient})</span></h3>
            <div class="text-sm text-muted mt-8">${entry.class.level}${entry.class.series ? ' ' + entry.class.series : ''}${entry.class.section ? ' ' + entry.class.section : ''} — ${sheet.sequence.label}</div>
          </div>
          ${sheet.locked ? `<span class="badge badge-warning">${t('status_locked')}</span>` : `<span class="badge badge-info">${t('status_draft')}</span>`}
        </div>
        <div class="flex gap-8 mt-8">
          <a class="btn btn-outline btn-sm" href="${API.exportUrl(`/export/grades/${entry.class.id}/${sheet.sequence.id}`, 'csv')}">${t('btn_export_csv')}</a>
          <a class="btn btn-outline btn-sm" href="${API.exportUrl(`/export/grades/${entry.class.id}/${sheet.sequence.id}`, 'xlsx')}">${t('btn_export_xlsx')}</a>
          <a class="btn btn-outline btn-sm" href="${API.exportUrl(`/export/grades/${entry.class.id}/${sheet.sequence.id}`, 'pdf')}">${t('btn_export_pdf')}</a>
        </div>

        <div class="stat-grid mt-16" style="grid-template-columns:repeat(4,1fr);">
          <div class="stat-card" style="padding:12px;"><div class="stat-label">${t('stat_highest')}</div><div class="stat-value" style="font-size:18px;">${sheet.stats.highest ?? '—'}</div></div>
          <div class="stat-card" style="padding:12px;"><div class="stat-label">${t('stat_lowest')}</div><div class="stat-value" style="font-size:18px;">${sheet.stats.lowest ?? '—'}</div></div>
          <div class="stat-card" style="padding:12px;"><div class="stat-label">${t('stat_class_average')}</div><div class="stat-value" style="font-size:18px;">${sheet.stats.class_average ?? '—'}</div></div>
          <div class="stat-card" style="padding:12px;"><div class="stat-label">${t('stat_success_rate')}</div><div class="stat-value" style="font-size:18px;">${sheet.stats.success_rate !== null ? sheet.stats.success_rate + '%' : '—'}</div></div>
        </div>
        ${sheet.stats.missing_count > 0 ? `<div class="alert alert-info mt-16">${t('stat_missing_count').replace('{count}', sheet.stats.missing_count)}</div>` : ''}

        <div class="mt-16">
          ${sheet.students.map(s => `
            <div class="flex items-center justify-between gap-8" style="padding:8px 0;border-bottom:1px solid var(--color-border);">
              <div>${s.last_name} ${s.first_name} <span class="text-muted text-sm">${s.matricule}</span></div>
              <input type="number" min="0" max="20" step="0.25" data-score="${s.student_id}" value="${s.score !== null ? s.score : ''}" ${sheet.locked ? 'disabled' : ''} style="width:90px;padding:8px;border:1px solid var(--color-border);border-radius:8px;text-align:center;">
            </div>
          `).join('')}
        </div>

        <div id="grade-sheet-error"></div>
        <div id="grade-sheet-status" class="text-sm text-muted mt-8"></div>
      </div>
    `;

    if (!sheet.locked) {
      const inputs = container.querySelectorAll('[data-score]');
      inputs.forEach(input => {
        input.addEventListener('input', this.debounce(() => this.autosaveScore(input), 700));
      });
    }
  },

  debounce(fn, delay) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
  },

  async autosaveScore(input) {
    const errorBox = this.content.querySelector('#grade-sheet-error');
    const statusBox = this.content.querySelector('#grade-sheet-status');
    errorBox.innerHTML = '';
    const value = input.value === '' ? null : parseFloat(input.value);
    try {
      await API.saveGradeSheet(this.state.selectedEntry.classSubject.id, this.state.sequenceId, [{ student_id: input.dataset.score, score: value }]);
      statusBox.textContent = t('autosaved') + ' ' + new Date().toLocaleTimeString();
    } catch (err) {
      errorBox.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
    }
  },

  // -------------------------------------------------------------------
  // VUE D'ENSEMBLE CLASSE + VALIDATION (admin / censeur / surveillant général)
  // -------------------------------------------------------------------
  paintClassOverview() {
    const container = this.content.querySelector('#class-overview-container');
    if (!container) return;

    container.innerHTML = `
      <div class="card">
        <div class="field-group">
          <label class="field-label">${t('field_class')}</label>
          <div class="field-input-wrap">
            <select id="overview-class-select">
              <option value="">${t('none_option')}</option>
              ${this.state.classes.map(c => `<option value="${c.id}" ${this.state.selectedClassId === c.id ? 'selected' : ''}>${c.level}${c.series ? ' ' + c.series : ''}${c.section ? ' ' + c.section : ''}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>
      <div id="class-summary-container" class="mt-16"></div>
    `;

    container.querySelector('#overview-class-select').addEventListener('change', async (e) => {
      this.state.selectedClassId = e.target.value;
      await this.loadClassSummary();
    });

    if (this.state.selectedClassId) this.loadClassSummary();
  },

  async loadClassSummary() {
    const container = this.content.querySelector('#class-summary-container');
    if (!this.state.selectedClassId || !this.state.sequenceId) { container.innerHTML = ''; return; }
    try {
      const data = await API.getClassSequenceSummary(this.state.selectedClassId, this.state.sequenceId);
      this.state.summary = data;
      this.paintClassSummary(container);
    } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
  },

  paintClassSummary(container) {
    const summary = this.state.summary;
    if (!summary) return;

    const students = Object.values(summary.students).sort((a, b) => (a.rank || 999) - (b.rank || 999));

    container.innerHTML = `
      <div class="card">
        <div class="card-title-row">
          <div>
            <div class="text-sm text-muted">${I18N.current === 'fr' ? 'Moyenne de classe' : 'Class average'}: <strong>${summary.class_average ?? '—'}</strong> · ${I18N.current === 'fr' ? 'Effectif' : 'Size'}: ${summary.class_size}</div>
          </div>
          ${summary.locked ? `
            ${this.canValidate ? `<button class="btn btn-outline btn-sm" id="btn-unvalidate">${t('btn_unvalidate')}</button>` : `<span class="badge badge-success">${t('status_validated')}</span>`}
          ` : (this.canValidate ? `<button class="btn btn-primary btn-sm" id="btn-validate">${t('btn_validate_sequence')}</button>` : '')}
        </div>
        ${summary.missing_grades_count > 0 ? `<div class="alert alert-info mt-16">${t('stat_missing_count').replace('{count}', summary.missing_grades_count)}</div>` : ''}
        <div id="validate-error"></div>

        <div class="mt-16">
          ${students.map(s => `
            <div class="flex items-center justify-between" style="padding:8px 0;border-bottom:1px solid var(--color-border);">
              <div>
                <strong>${s.rank ? s.rank + '.' : '—'}</strong> ${s.last_name} ${s.first_name}
                ${s.missing_subjects > 0 ? `<span class="text-sm" style="color:var(--color-warning);"> (${s.missing_subjects} ${I18N.current === 'fr' ? 'matière(s) manquante(s)' : 'missing subject(s)'})</span>` : ''}
              </div>
              <div class="flex items-center gap-8">
                ${s.average !== null ? `<span class="badge badge-${s.mention === 'bien' ? 'success' : s.mention === 'passable' ? 'warning' : 'danger'}">${s.average}/20</span>` : `<span class="text-muted text-sm">—</span>`}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    const validateBtn = container.querySelector('#btn-validate');
    if (validateBtn) validateBtn.addEventListener('click', () => this.handleValidate(false));
    const unvalidateBtn = container.querySelector('#btn-unvalidate');
    if (unvalidateBtn) unvalidateBtn.addEventListener('click', async () => {
      try {
        await API.unvalidateSequence(this.state.selectedClassId, this.state.sequenceId);
        UI.toast(I18N.current === 'fr' ? 'Validation annulée.' : 'Validation cancelled.', 'success');
        await this.loadClassSummary();
      } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
    });
  },

  async handleValidate(force) {
    const errorBox = this.content.querySelector('#validate-error');
    errorBox.innerHTML = '';
    try {
      const data = await API.validateSequence(this.state.selectedClassId, this.state.sequenceId, force);
      UI.toast(I18N.current === 'fr' ? `Séquence validée. ${data.notified_parents} parent(s) notifié(s).` : `Sequence validated. ${data.notified_parents} parent(s) notified.`, 'success');
      await this.loadClassSummary();
    } catch (err) {
      if (err.errors && err.errors.missing_grades_count) {
        errorBox.innerHTML = `<div class="alert alert-info mt-16">${err.message} <button class="btn btn-outline btn-sm mt-8" id="btn-force-validate">${t('btn_force_validate')}</button></div>`;
        const forceBtn = errorBox.querySelector('#btn-force-validate');
        if (forceBtn) forceBtn.addEventListener('click', () => this.handleValidate(true));
      } else {
        errorBox.innerHTML = `<div class="alert alert-error mt-16">${err.message || 'Erreur.'}</div>`;
      }
    }
  },
};
