/**
 * SCHOOLAR — Gestion des élèves (section 9) + invitation de parents (section 10)
 */
const StudentsPage = {
  state: {
    students: [],
    classes: [],
    search: '',
    classFilter: '',
    showForm: false,
    editingId: null,
    expandedStudentId: null,
    expandedStudentDetail: null,
  },

  async render(root) {
    const user = Store.getUser();
    if (!user) { window.location.hash = '#/login'; return; }
    this.root = root;
    this.user = user;
    this.canManage = ['proviseur', 'principal', 'directeur', 'secretaire', 'professeur_principal'].includes(user.role_code);

    await this.loadClasses();
    await this.loadStudents();
    this.paint();
  },

  async loadClasses() {
    try {
      const data = await API.listClasses();
      this.state.classes = data.classes;
    } catch (err) { /* silencieux */ }
  },

  async loadStudents() {
    const qs = new URLSearchParams();
    if (this.state.classFilter) qs.set('class_id', this.state.classFilter);
    if (this.state.search) qs.set('q', this.state.search);
    try {
      const data = await API.listStudents(`?${qs.toString()}`);
      this.state.students = data.students;
    } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
  },

  paint() {
    const navItems = DashboardPage.buildNavItems(this.user).map(i => ({ ...i, active: i.href === '#/students' }));

    const body = `
      <div class="flex justify-between items-center" style="flex-wrap:wrap;gap:12px;">
        <div>
          <h2>${t('students_title')}</h2>
          <p class="text-muted text-sm mt-8">${t('students_subtitle')}</p>
        </div>
        <div class="flex gap-8">
          <a class="btn btn-outline" href="${API.exportUrl('/export/students', 'csv')}">${t('btn_export_csv')}</a>
          <a class="btn btn-outline" href="${API.exportUrl('/export/students', 'xlsx')}">${t('btn_export_xlsx')}</a>
          <a class="btn btn-outline" href="${API.exportUrl('/export/students', 'pdf')}">${t('btn_export_pdf')}</a>
          ${this.canManage ? `<button class="btn btn-primary" id="btn-new-student">${t('btn_new_student')}</button>` : ''}
        </div>
      </div>

      <div class="card mt-24">
        <div class="grid-2" style="grid-template-columns: 2fr 1fr;">
          <div class="field-input-wrap">${UI.icon('search', 16)}<input id="f-search" placeholder="${t('field_search')}" value="${this.state.search}"></div>
          <div class="field-input-wrap">
            <select id="f-class-filter">
              <option value="">${I18N.current === 'fr' ? 'Toutes les classes' : 'All classes'}</option>
              ${this.state.classes.map(c => `<option value="${c.id}" ${this.state.classFilter === c.id ? 'selected' : ''}>${c.level}${c.series ? ' ' + c.series : ''}${c.section ? ' ' + c.section : ''}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <div id="student-form-container"></div>
      <div id="student-list-container" class="mt-24"></div>
    `;

    const content = UI.renderShell(this.root, { user: this.user, navItems, pageBodyHtml: body });
    this.content = content;

    content.querySelector('#f-search').addEventListener('input', this.debounce((e) => {
      this.state.search = e.target.value;
      this.loadStudents().then(() => this.paintList());
    }, 300));
    content.querySelector('#f-class-filter').addEventListener('change', (e) => {
      this.state.classFilter = e.target.value;
      this.loadStudents().then(() => this.paintList());
    });

    if (this.canManage) {
      content.querySelector('#btn-new-student').addEventListener('click', () => {
        this.state.showForm = true;
        this.state.editingId = null;
        this.paintForm();
      });
    }

    this.paintList();
  },

  debounce(fn, delay) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
  },

  paintForm(prefill = null) {
    const container = this.content.querySelector('#student-form-container');
    if (!this.state.showForm) { container.innerHTML = ''; return; }

    container.innerHTML = `
      <div class="card mt-24" style="max-width:720px;">
        <h3>${prefill ? t('btn_edit') : t('btn_new_student')}</h3>
        <form id="student-form" class="mt-16">
          <div class="grid-2">
            <div class="field-group">
              <label class="field-label">${t('field_first_name')}</label>
              <div class="field-input-wrap"><input id="st-fname" value="${prefill ? prefill.first_name : ''}" required></div>
            </div>
            <div class="field-group">
              <label class="field-label">${t('field_last_name')}</label>
              <div class="field-input-wrap"><input id="st-lname" value="${prefill ? prefill.last_name : ''}" required></div>
            </div>
          </div>
          <div class="grid-2 mt-16">
            <div class="field-group">
              <label class="field-label">${t('field_sex')}</label>
              <div class="field-input-wrap">
                <select id="st-sex">
                  <option value="">—</option>
                  <option value="M" ${prefill && prefill.sex === 'M' ? 'selected' : ''}>${t('sex_m')}</option>
                  <option value="F" ${prefill && prefill.sex === 'F' ? 'selected' : ''}>${t('sex_f')}</option>
                </select>
              </div>
            </div>
            <div class="field-group">
              <label class="field-label">${t('field_birth_date')}</label>
              <div class="field-input-wrap"><input type="date" id="st-bdate" value="${prefill ? (prefill.birth_date || '') : ''}"></div>
            </div>
          </div>
          <div class="grid-2 mt-16">
            <div class="field-group">
              <label class="field-label">${t('field_birth_place')}</label>
              <div class="field-input-wrap"><input id="st-bplace" value="${prefill ? (prefill.birth_place || '') : ''}"></div>
            </div>
            <div class="field-group">
              <label class="field-label">${t('field_class')}</label>
              <div class="field-input-wrap">
                <select id="st-class">
                  <option value="">${t('none_option')}</option>
                  ${this.state.classes.map(c => `<option value="${c.id}" ${prefill && prefill.class_id === c.id ? 'selected' : ''}>${c.level}${c.series ? ' ' + c.series : ''}${c.section ? ' ' + c.section : ''}</option>`).join('')}
                </select>
              </div>
            </div>
          </div>
          <div class="field-group mt-16">
            <label class="field-label">${t('field_matricule')}</label>
            <div class="field-input-wrap"><input id="st-matricule" value="${prefill ? prefill.matricule : ''}" ${prefill ? 'disabled' : ''}></div>
          </div>
          <div class="grid-2 mt-16">
            <div class="field-group">
              <label class="field-label">${t('field_father_name')}</label>
              <div class="field-input-wrap"><input id="st-father" value="${prefill ? (prefill.father_name || '') : ''}"></div>
            </div>
            <div class="field-group">
              <label class="field-label">${t('field_mother_name')}</label>
              <div class="field-input-wrap"><input id="st-mother" value="${prefill ? (prefill.mother_name || '') : ''}"></div>
            </div>
          </div>
          <div class="grid-2 mt-16">
            <div class="field-group">
              <label class="field-label">${t('field_parent_phone_1')}</label>
              <div class="field-input-wrap"><input id="st-phone1" value="${prefill ? (prefill.parent_phone_1 || '') : ''}"></div>
            </div>
            <div class="field-group">
              <label class="field-label">${t('field_parent_phone_2')}</label>
              <div class="field-input-wrap"><input id="st-phone2" value="${prefill ? (prefill.parent_phone_2 || '') : ''}"></div>
            </div>
          </div>
          <div class="grid-2 mt-16">
            <div class="field-group">
              <label class="field-label">${t('field_student_phone')}</label>
              <div class="field-input-wrap"><input id="st-sphone" value="${prefill ? (prefill.student_phone || '') : ''}"></div>
            </div>
            <div class="field-group">
              <label class="field-label">${t('field_address')}</label>
              <div class="field-input-wrap"><input id="st-address" value="${prefill ? (prefill.address || '') : ''}"></div>
            </div>
          </div>
          <div id="student-form-warnings"></div>
          <div id="student-form-error"></div>
          <div id="student-form-success"></div>
          <div class="flex gap-8 mt-24">
            <button type="submit" class="btn btn-primary" id="student-form-submit">${prefill ? t('btn_edit') : t('btn_new_student')}</button>
            <button type="button" class="btn btn-outline" id="student-form-cancel">${I18N.current === 'fr' ? 'Annuler' : 'Cancel'}</button>
          </div>
        </form>
      </div>
    `;

    container.querySelector('#student-form-cancel').addEventListener('click', () => { this.state.showForm = false; this.paintForm(); });
    container.querySelector('#student-form').addEventListener('submit', (e) => this.handleFormSubmit(e, prefill));
  },

  async handleFormSubmit(e, prefill) {
    e.preventDefault();
    const errorBox = this.content.querySelector('#student-form-error');
    const successBox = this.content.querySelector('#student-form-success');
    const warningsBox = this.content.querySelector('#student-form-warnings');
    errorBox.innerHTML = ''; successBox.innerHTML = ''; warningsBox.innerHTML = '';

    const payload = {
      first_name: this.content.querySelector('#st-fname').value,
      last_name: this.content.querySelector('#st-lname').value,
      sex: this.content.querySelector('#st-sex').value,
      birth_date: this.content.querySelector('#st-bdate').value,
      birth_place: this.content.querySelector('#st-bplace').value,
      class_id: this.content.querySelector('#st-class').value,
      father_name: this.content.querySelector('#st-father').value,
      mother_name: this.content.querySelector('#st-mother').value,
      parent_phone_1: this.content.querySelector('#st-phone1').value,
      parent_phone_2: this.content.querySelector('#st-phone2').value,
      student_phone: this.content.querySelector('#st-sphone').value,
      address: this.content.querySelector('#st-address').value,
    };
    if (!prefill) payload.matricule = this.content.querySelector('#st-matricule').value;

    const btn = this.content.querySelector('#student-form-submit');
    UI.setLoading(btn, true);

    try {
      let warnings = [];
      if (prefill) {
        const data = await API.updateStudent(prefill.id, payload);
        warnings = data.warnings || [];
        UI.toast(I18N.current === 'fr' ? 'Fiche mise à jour.' : 'Record updated.', 'success');
        this.state.showForm = false;
        this.paintForm();
      } else {
        const data = await API.createStudent(payload);
        warnings = data.warnings || [];
        successBox.innerHTML = `<div class="alert alert-success"><strong>${t('student_created_title')}</strong> — ${I18N.current === 'fr' ? 'Matricule' : 'Student ID'}: ${data.matricule}</div>`;
        this.content.querySelector('#student-form').reset();
      }
      if (warnings.length) {
        warningsBox.innerHTML = warnings.map(w => `<div class="alert alert-info mt-8">${w}</div>`).join('');
      }
      await this.loadStudents();
      this.paintList();
    } catch (err) {
      errorBox.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
    } finally {
      UI.setLoading(btn, false, prefill ? t('btn_edit') : t('btn_new_student'));
    }
  },

  paintList() {
    const container = this.content.querySelector('#student-list-container');

    if (!this.state.students.length) {
      container.innerHTML = `<div class="card"><div class="empty-state">${UI.icon('users', 30)}<p class="mt-8">${t('empty_students')}</p></div></div>`;
      return;
    }

    container.innerHTML = this.state.students.map(s => `
      <div class="card mt-16">
        <div class="card-title-row">
          <div class="flex items-center gap-12">
            <div class="avatar">${UI.initials(s.first_name, s.last_name)}</div>
            <div>
              <h3>${s.last_name} ${s.first_name}</h3>
              <div class="text-sm text-muted mt-8">${s.matricule} ${s.level ? '· ' + s.level + (s.series ? ' ' + s.series : '') + (s.section ? ' ' + s.section : '') : ''}</div>
            </div>
          </div>
          <button class="btn btn-outline btn-sm" data-action="toggle" data-id="${s.id}">${this.state.expandedStudentId === s.id ? (I18N.current === 'fr' ? 'Fermer' : 'Close') : t('btn_view_details')}</button>
        </div>
        <div id="student-detail-${s.id}"></div>
      </div>
    `).join('');

    container.querySelectorAll('[data-action="toggle"]').forEach(btn => {
      btn.addEventListener('click', () => this.toggleDetail(btn.dataset.id, container));
    });

    if (this.state.expandedStudentId) {
      const box = container.querySelector(`#student-detail-${this.state.expandedStudentId}`);
      if (box && this.state.expandedStudentDetail) this.paintDetail(box, this.state.expandedStudentDetail);
    }
  },

  async toggleDetail(studentId, container) {
    if (this.state.expandedStudentId === studentId) {
      this.state.expandedStudentId = null;
      this.state.expandedStudentDetail = null;
      this.paintList();
      return;
    }
    try {
      const data = await API.getStudent(studentId);
      this.state.expandedStudentId = studentId;
      this.state.expandedStudentDetail = data.student;
      this.paintList();
    } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
  },

  paintDetail(box, student) {
    box.innerHTML = `
      <div class="mt-16" style="border-top:1px solid var(--color-border);padding-top:16px;">
        <div class="flex justify-between items-center">
          <h4 style="font-size:14px;">${t('parents_title')}</h4>
          ${this.canManage ? `<button class="btn btn-outline btn-sm" data-action="edit-student">${t('btn_edit')}</button>` : ''}
        </div>
        ${student.parents.length ? student.parents.map(p => `
          <div class="flex items-center justify-between" style="padding:8px 0;border-bottom:1px solid var(--color-border);">
            <div><strong>${p.first_name} ${p.last_name}</strong> <span class="text-muted text-sm">${p.relationship ? '(' + t('relationship_' + normalizeRel(p.relationship)) + ')' : ''}</span></div>
            <div class="text-sm text-muted">${p.email}</div>
          </div>
        `).join('') : `<p class="text-muted text-sm mt-8">${t('no_parents_yet')}</p>`}

        ${student.pending_invitations && student.pending_invitations.length ? `
          <h4 style="font-size:14px;margin-top:16px;">${t('pending_invitations_title')}</h4>
          ${student.pending_invitations.map(inv => `
            <div class="text-sm text-muted" style="padding:6px 0;">${inv.invited_first_name} ${inv.invited_last_name} — ${inv.invited_email} <span class="badge badge-warning">${t('status_pending')}</span></div>
          `).join('')}
        ` : ''}

        ${this.canManage ? `
          <div id="invite-form-${student.id}" class="mt-16"></div>
          <button class="btn btn-outline btn-sm mt-8" data-action="show-invite">${t('btn_invite_parent')}</button>
        ` : ''}

        <h4 style="font-size:14px;margin-top:20px;">${I18N.current === 'fr' ? 'Compte de connexion élève' : 'Student login account'}</h4>
        <div id="student-account-box-${student.id}" class="mt-8">
          ${Store.getUser()?.establishment_education_level === 'primaire'
            ? `<p class="text-sm text-muted">${I18N.current === 'fr' ? "La connexion élève n'est pas disponible pour les établissements du primaire." : 'Student login is not available for primary schools.'}</p>`
            : (student.user_id
                ? `<p class="text-sm text-muted">${I18N.current === 'fr' ? 'Cet élève dispose déjà d\'un compte de connexion (matricule : ' + student.matricule + ').' : 'This student already has a login account (matricule: ' + student.matricule + ').'}</p>`
                : (this.canManage ? `<button class="btn btn-outline btn-sm" data-action="create-student-account">${I18N.current === 'fr' ? 'Créer un compte de connexion' : 'Create login account'}</button>` : `<p class="text-sm text-muted">${I18N.current === 'fr' ? 'Aucun compte de connexion pour cet élève.' : 'No login account for this student.'}</p>`))
          }
        </div>

        <h4 style="font-size:14px;margin-top:20px;">${t('attendance_history_title')}</h4>
        <div id="attendance-history-${student.id}" class="mt-8"><div class="boot-spinner" style="margin:10px auto;width:20px;height:20px;"></div></div>

        <h4 style="font-size:14px;margin-top:20px;">${I18N.current === 'fr' ? 'Notes et classement' : 'Grades and ranking'}</h4>
        <div id="grades-box-${student.id}" class="mt-8"><div class="boot-spinner" style="margin:10px auto;width:20px;height:20px;"></div></div>

        <h4 style="font-size:14px;margin-top:20px;">${t('discipline_history_title')}</h4>
        <div id="discipline-history-${student.id}" class="mt-8"><div class="boot-spinner" style="margin:10px auto;width:20px;height:20px;"></div></div>

        <h4 style="font-size:14px;margin-top:20px;">${t('orientation_title')}</h4>
        <div id="orientation-box-${student.id}" class="mt-8"><div class="boot-spinner" style="margin:10px auto;width:20px;height:20px;"></div></div>

        <h4 style="font-size:14px;margin-top:20px;">${t('exams_title')}</h4>
        <div id="exams-box-${student.id}" class="mt-8"><div class="boot-spinner" style="margin:10px auto;width:20px;height:20px;"></div></div>

        <h4 style="font-size:14px;margin-top:20px;">${t('bulletins_title')}</h4>
        <div id="bulletins-box-${student.id}" class="mt-8"><div class="boot-spinner" style="margin:10px auto;width:20px;height:20px;"></div></div>
      </div>
    `;

    function normalizeRel(r) {
      const map = { 'père': 'pere', 'mère': 'mere', 'tuteur': 'tuteur' };
      return map[r.toLowerCase()] || 'tuteur';
    }

    this.loadAttendanceHistory(box, student.id);
    this.loadGradesBox(box, student.id);
    this.loadDisciplineHistory(box, student.id);
    this.loadOrientationBox(box, student.id);
    this.loadExamsBox(box, student.id);
    this.loadBulletinsBox(box, student.id);

    if (this.canManage) {
      const editBtn = box.querySelector('[data-action="edit-student"]');
      if (editBtn) editBtn.addEventListener('click', () => {
        this.state.showForm = true;
        this.paintForm(student);
        this.content.querySelector('#student-form-container').scrollIntoView({ behavior: 'smooth' });
      });

      const inviteBtn = box.querySelector('[data-action="show-invite"]');
      if (inviteBtn) inviteBtn.addEventListener('click', () => this.paintInviteForm(box, student));

      const createAccountBtn = box.querySelector('[data-action="create-student-account"]');
      if (createAccountBtn) createAccountBtn.addEventListener('click', () => this.createStudentAccount(box, student));
    }
  },

  async loadAttendanceHistory(box, studentId) {
    const container = box.querySelector(`#attendance-history-${studentId}`);
    if (!container) return;
    try {
      const data = await API.studentAttendanceHistory(studentId);
      if (!data.history.length) {
        container.innerHTML = `<p class="text-muted text-sm">${t('no_attendance_history')}</p>`;
        return;
      }
      container.innerHTML = `
        <div class="text-sm text-muted mt-8">${t('stat_absent')}: ${data.stats.absent_count} · ${t('stat_late')}: ${data.stats.late_count} · ${I18N.current === 'fr' ? 'Non justifiées' : 'Unjustified'}: ${data.stats.unjustified_count}</div>
        ${data.history.slice(0, 8).map(h => `
          <div class="flex items-center justify-between text-sm" style="padding:6px 0;border-bottom:1px solid var(--color-border);">
            <div>${h.session_date} — ${h.subject_name}</div>
            <span class="badge badge-${h.status === 'absent' ? 'danger' : 'warning'}">${t('status_' + h.status)}${h.justified ? ' ✓' : ''}</span>
          </div>
        `).join('')}
      `;
    } catch (err) {
      container.innerHTML = `<p class="text-muted text-sm">—</p>`;
    }
  },

  async loadGradesBox(box, studentId) {
    const container = box.querySelector(`#grades-box-${studentId}`);
    if (!container) return;
    try {
      const seqData = await API.listSequences();
      const sequences = seqData.sequences || [];
      if (!sequences.length) {
        container.innerHTML = `<p class="text-muted text-sm">${I18N.current === 'fr' ? 'Aucune séquence créée pour l\'instant.' : 'No sequence created yet.'}</p>`;
        return;
      }
      const terms = [...new Set(sequences.map(s => s.term_label))];
      const defaultSeq = sequences[sequences.length - 1];
      container.innerHTML = `
        <div class="flex items-center" style="gap:6px;flex-wrap:wrap;">
          ${sequences.map(s => `
            <button type="button" class="btn btn-sm grade-pill" data-mode="sequence" data-seq="${s.id}"
              style="${s.id === defaultSeq.id ? 'background:var(--color-primary);color:#fff;border-color:var(--color-primary);' : 'background:#fff;'}">
              ${s.label}
            </button>
          `).join('')}
          ${terms.map(term => `
            <button type="button" class="btn btn-sm btn-outline grade-pill" data-mode="term" data-term="${term}" data-year="${defaultSeq.school_year_id}"
              style="border-style:dashed;">
              ${I18N.current === 'fr' ? 'Vue' : 'View'} ${term}
            </button>
          `).join('')}
        </div>
        <div class="text-muted text-sm mt-8" id="grades-mode-label-${studentId}"></div>
        <div id="grades-seq-content-${studentId}" class="mt-8"></div>
      `;
      const setActivePill = (btn) => {
        container.querySelectorAll('.grade-pill').forEach(b => { b.style.background = '#fff'; b.style.color = ''; b.style.borderColor = ''; });
        btn.style.background = 'var(--color-primary)'; btn.style.color = '#fff'; btn.style.borderColor = 'var(--color-primary)';
      };
      container.querySelectorAll('[data-mode="sequence"]').forEach(btn => {
        btn.addEventListener('click', () => {
          setActivePill(btn);
          container.querySelector(`#grades-mode-label-${studentId}`).textContent = '';
          this.renderStudentGradesForSequence(container, studentId, btn.dataset.seq);
        });
      });
      container.querySelectorAll('[data-mode="term"]').forEach(btn => {
        btn.addEventListener('click', () => {
          setActivePill(btn);
          container.querySelector(`#grades-mode-label-${studentId}`).textContent = I18N.current === 'fr'
            ? `Moyenne agrégée sur toutes les séquences de ce trimestre.`
            : `Aggregated average across all sequences of this term.`;
          this.renderStudentGradesForTerm(container, studentId, btn.dataset.term, btn.dataset.year);
        });
      });
      await this.renderStudentGradesForSequence(container, studentId, defaultSeq.id);
    } catch (err) {
      container.innerHTML = `<p class="text-muted text-sm">—</p>`;
    }
  },

  async renderStudentGradesForTerm(container, studentId, termLabel, schoolYearId) {
    const target = container.querySelector(`#grades-seq-content-${studentId}`);
    target.innerHTML = `<div class="boot-spinner" style="margin:10px auto;width:20px;height:20px;"></div>`;
    try {
      const d = await API.studentTermSummary(studentId, termLabel, schoolYearId);
      const mentionBadge = (mention) => {
        if (!mention) return '';
        const cls = { 'insuffisant': 'danger', 'passable': 'warning', 'bien': 'success' }[mention] || 'warning';
        return `<span class="badge badge-${cls}">${t('mention_' + mention)}</span>`;
      };
      if (!d.sequences.length) {
        target.innerHTML = `<p class="text-muted text-sm">${I18N.current === 'fr' ? 'Aucune séquence dans ce trimestre.' : 'No sequence in this term.'}</p>`;
        return;
      }
      target.innerHTML = `
        <div class="flex items-center" style="gap:24px;flex-wrap:wrap;padding:12px 0;">
          <div>
            <div class="text-muted text-sm">${I18N.current === 'fr' ? 'Moyenne du trimestre' : 'Term average'}</div>
            <div style="font-size:22px;font-weight:700;">${d.average !== null ? Number(d.average).toFixed(2) + '/20' : '—'}</div>
          </div>
          <div>
            <div class="text-muted text-sm">${I18N.current === 'fr' ? 'Rang trimestriel' : 'Term rank'}</div>
            <div style="font-size:22px;font-weight:700;">${d.rank !== null ? `${d.rank}${I18N.current === 'fr' ? 'e' : 'th'} / ${d.class_size}` : '—'}</div>
          </div>
          <div>
            <div class="text-muted text-sm">${I18N.current === 'fr' ? 'Moyenne de classe' : 'Class average'}</div>
            <div style="font-size:22px;font-weight:700;">${d.class_average !== null ? Number(d.class_average).toFixed(2) + '/20' : '—'}</div>
          </div>
          <div>${mentionBadge(d.mention)}</div>
        </div>
        <div class="text-muted text-sm" style="font-weight:600;margin-top:4px;">${I18N.current === 'fr' ? 'Détail par séquence' : 'Breakdown by sequence'}</div>
        ${d.sequences.map(s => `
          <div class="flex items-center justify-between text-sm" style="padding:8px 0;border-bottom:1px solid var(--color-border);">
            <div>${s.label}</div>
            <div class="flex items-center" style="gap:8px;">
              <strong>${s.average !== null ? Number(s.average).toFixed(2) + '/20' : (I18N.current === 'fr' ? 'Pas de notes' : 'No grades')}</strong>
              ${s.rank !== null ? `<span class="text-muted">(${I18N.current === 'fr' ? 'rang' : 'rank'} ${s.rank})</span>` : ''}
            </div>
          </div>
        `).join('')}
      `;
    } catch (err) {
      target.innerHTML = `<p class="text-muted text-sm">${err.message || '—'}</p>`;
    }
  },

  async renderStudentGradesForSequence(container, studentId, sequenceId) {
    const target = container.querySelector(`#grades-seq-content-${studentId}`);
    target.innerHTML = `<div class="boot-spinner" style="margin:10px auto;width:20px;height:20px;"></div>`;
    try {
      const d = await API.studentGradesSummary(studentId, sequenceId);
      const mentionBadge = (mention) => {
        if (!mention) return '';
        const cls = { 'insuffisant': 'danger', 'passable': 'warning', 'bien': 'success', 'tres_bien': 'success', 'excellent': 'success' }[mention] || 'warning';
        return `<span class="badge badge-${cls}">${t('mention_' + mention)}</span>`;
      };
      target.innerHTML = `
        <div class="flex items-center" style="gap:24px;flex-wrap:wrap;padding:12px 0;">
          <div>
            <div class="text-muted text-sm">${I18N.current === 'fr' ? 'Moyenne' : 'Average'}</div>
            <div style="font-size:22px;font-weight:700;">${d.average !== null ? Number(d.average).toFixed(2) + '/20' : '—'}</div>
          </div>
          <div>
            <div class="text-muted text-sm">${I18N.current === 'fr' ? 'Rang' : 'Rank'}</div>
            <div style="font-size:22px;font-weight:700;">${d.rank !== null ? `${d.rank}${I18N.current === 'fr' ? 'e' : 'th'} / ${d.class_size}` : '—'}</div>
          </div>
          <div>
            <div class="text-muted text-sm">${I18N.current === 'fr' ? 'Moyenne de classe' : 'Class average'}</div>
            <div style="font-size:22px;font-weight:700;">${d.class_average !== null ? Number(d.class_average).toFixed(2) + '/20' : '—'}</div>
          </div>
          <div>${mentionBadge(d.mention)}</div>
        </div>
        ${d.subjects.map(s => `
          <div class="flex items-center justify-between text-sm" style="padding:8px 0;border-bottom:1px solid var(--color-border);">
            <div>${s.subject_name} <span class="text-muted">(Coeff. ${s.coefficient})</span></div>
            <div class="flex items-center" style="gap:8px;">
              <strong>${s.score !== null ? Number(s.score).toFixed(1) + '/20' : '—'}</strong>
              ${mentionBadge(s.mention)}
            </div>
          </div>
        `).join('')}
      `;
    } catch (err) {
      target.innerHTML = `<p class="text-muted text-sm">${err.message || '—'}</p>`;
    }
  },


  async loadDisciplineHistory(box, studentId) {
    const container = box.querySelector(`#discipline-history-${studentId}`);
    if (!container) return;
    try {
      const data = await API.studentDisciplineHistory(studentId);
      if (!data.history.length) {
        container.innerHTML = `<p class="text-muted text-sm">${t('no_discipline_history')}</p>`;
        return;
      }
      container.innerHTML = data.history.slice(0, 6).map(h => `
        <div class="flex items-center justify-between text-sm" style="padding:6px 0;border-bottom:1px solid var(--color-border);">
          <div>${h.incident_date} — ${t('discipline_category_' + h.category)}</div>
          <span class="badge badge-${h.status === 'resolved' ? 'success' : 'warning'}">${t('status_' + h.status)}</span>
        </div>
      `).join('');
    } catch (err) {
      container.innerHTML = `<p class="text-muted text-sm">—</p>`;
    }
  },

  paintInviteForm(box, student) {
    const container = box.querySelector(`#invite-form-${student.id}`);
    container.innerHTML = `
      <div class="card">
        <div class="grid-2">
          <div class="field-group">
            <label class="field-label">${t('field_first_name')}</label>
            <div class="field-input-wrap"><input id="inv-fname-${student.id}"></div>
          </div>
          <div class="field-group">
            <label class="field-label">${t('field_last_name')}</label>
            <div class="field-input-wrap"><input id="inv-lname-${student.id}"></div>
          </div>
        </div>
        <div class="field-group mt-16">
          <label class="field-label">${t('field_email')}</label>
          <div class="field-input-wrap">${UI.icon('mail')}<input type="email" id="inv-email-${student.id}"></div>
        </div>
        <div class="grid-2 mt-16">
          <div class="field-group">
            <label class="field-label">${t('field_phone')}</label>
            <div class="field-input-wrap"><input id="inv-phone-${student.id}"></div>
          </div>
          <div class="field-group">
            <label class="field-label">${t('field_relationship')}</label>
            <div class="field-input-wrap">
              <select id="inv-rel-${student.id}">
                <option value="père">${t('relationship_pere')}</option>
                <option value="mère">${t('relationship_mere')}</option>
                <option value="tuteur">${t('relationship_tuteur')}</option>
              </select>
            </div>
          </div>
        </div>
        <div id="invite-result-${student.id}"></div>
        <button class="btn btn-primary btn-sm mt-16" id="confirm-invite-${student.id}">${t('btn_invite_parent')}</button>
      </div>
    `;

    container.querySelector(`#confirm-invite-${student.id}`).addEventListener('click', async () => {
      const resultBox = container.querySelector(`#invite-result-${student.id}`);
      resultBox.innerHTML = '';
      const payload = {
        first_name: container.querySelector(`#inv-fname-${student.id}`).value,
        last_name: container.querySelector(`#inv-lname-${student.id}`).value,
        email: container.querySelector(`#inv-email-${student.id}`).value,
        phone: container.querySelector(`#inv-phone-${student.id}`).value,
        relationship: container.querySelector(`#inv-rel-${student.id}`).value,
      };
      try {
        const data = await API.inviteParent(student.id, payload);
        let html = `<div class="alert alert-success mt-16">${data.linked_existing ? t('invite_linked_existing') : t('invite_sent')}</div>`;
        if (data.dev_confirmation_token) {
          const link = `#/parent-invitation/confirm/${data.dev_confirmation_token}`;
          html += `<div class="alert alert-info mt-8">${t('dev_note_invite_link')}<br><a href="${link}">${window.location.origin}${window.location.pathname}${link}</a></div>`;
        }
        resultBox.innerHTML = html;
        await this.toggleDetail(student.id, this.content.querySelector('#student-list-container'));
        await this.toggleDetail(student.id, this.content.querySelector('#student-list-container'));
      } catch (err) {
        resultBox.innerHTML = `<div class="alert alert-error mt-16">${err.message || 'Erreur.'}</div>`;
      }
    });
  },

  // -------------------------------------------------------------------
  // Orientation scolaire (section 11 — IA Claude)
  // -------------------------------------------------------------------
  async createStudentAccount(box, student) {
    const container = box.querySelector(`#student-account-box-${student.id}`);
    try {
      const data = await API.createStudentAccount(student.id);
      container.innerHTML = `
        <div class="alert alert-success">
          <p>${I18N.current === 'fr' ? 'Compte créé. Notez ces identifiants — ils ne seront plus affichés ensuite :' : 'Account created. Note these credentials — they will not be shown again:'}</p>
          <p class="mt-8"><strong>${I18N.current === 'fr' ? 'Matricule' : 'Matricule'} :</strong> ${data.matricule}</p>
          <p><strong>${I18N.current === 'fr' ? 'Mot de passe temporaire' : 'Temporary password'} :</strong> ${data.temp_password}</p>
          <p><strong>${I18N.current === 'fr' ? 'Code établissement' : 'Establishment code'} :</strong> ${data.establishment_code}</p>
        </div>
      `;
      UI.toast(I18N.current === 'fr' ? 'Compte de connexion créé.' : 'Login account created.');
    } catch (err) {
      UI.toast(err.message || 'Erreur.', 'error');
    }
  },

  async loadOrientationBox(box, studentId) {
    const container = box.querySelector(`#orientation-box-${studentId}`);
    if (!container) return;
    try {
      const data = await API.orientationHistory(studentId);
      const latest = data.assessments[0];
      container.innerHTML = `
        ${latest ? `
          <p class="text-sm">${latest.content.summary || ''}</p>
          <p class="text-sm mt-8"><strong>${I18N.current === 'fr' ? 'Estimation' : 'Estimate'}:</strong> ${latest.content.success_estimate || ''}</p>
        ` : `<p class="text-muted text-sm">${t('empty_orientation')}</p>`}
        <button class="btn btn-outline btn-sm mt-8" id="orientation-gen-${studentId}">${t('btn_generate_orientation')}</button>
        <div id="orientation-err-${studentId}" class="mt-8"></div>
      `;
      container.querySelector(`#orientation-gen-${studentId}`).addEventListener('click', async (e) => {
        UI.setLoading(e.target, true);
        try {
          await API.generateOrientation(studentId);
          await this.loadOrientationBox(box, studentId);
        } catch (err) {
          container.querySelector(`#orientation-err-${studentId}`).innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
          UI.setLoading(e.target, false, t('btn_generate_orientation'));
        }
      });
    } catch {
      container.innerHTML = `<p class="text-muted text-sm">—</p>`;
    }
  },

  // -------------------------------------------------------------------
  // Préparation aux concours (section 12 — IA GPT) — vue personnel
  // -------------------------------------------------------------------
  async loadExamsBox(box, studentId) {
    const container = box.querySelector(`#exams-box-${studentId}`);
    if (!container) return;
    try {
      const status = await API.concoursStatus(studentId);
      if (!status.is_active) {
        container.innerHTML = `<p class="text-muted text-sm">${t('concours_not_subscribed_staff')}</p>`;
        return;
      }
      const data = await API.listExams(studentId);
      container.innerHTML = data.exams.length ? data.exams.map(ex => `
        <a href="#/exams/${ex.id}" class="flex justify-between items-center text-sm" style="padding:6px 0;border-bottom:1px solid var(--color-border);text-decoration:none;color:inherit;">
          <div>${ex.subject_label} — ${ex.level}</div>
          <div>${ex.attempt_status === 'graded' ? `${ex.score} / ${ex.max_score}` : (I18N.current === 'fr' ? 'À passer' : 'To take')}</div>
        </a>
      `).join('') : `<p class="text-muted text-sm">${t('empty_exams')}</p>`;
    } catch {
      container.innerHTML = `<p class="text-muted text-sm">—</p>`;
    }
  },

  // -------------------------------------------------------------------
  // Bulletins pilotés par IA — vue personnel
  // -------------------------------------------------------------------
  async loadBulletinsBox(box, studentId) {
    const container = box.querySelector(`#bulletins-box-${studentId}`);
    if (!container) return;
    try {
      const status = await API.bulletinStatus(studentId);
      if (!status.is_active) {
        container.innerHTML = `<p class="text-muted text-sm">${t('bulletin_not_subscribed_staff')}${!status.template_available ? ' ' + t('bulletin_no_template_yet') : ''}</p>`;
        return;
      }

      let sequences = [];
      try { sequences = (await API.listSequences()).sequences; } catch { /* silencieux */ }

      const data = await API.listBulletins(studentId);
      const listHtml = data.bulletins.length ? data.bulletins.map(b => `
        <div class="flex justify-between items-center text-sm" style="padding:6px 0;border-bottom:1px solid var(--color-border);">
          <div>${b.sequence_label}${b.term_label ? ' — ' + b.term_label : ''}</div>
          <button class="btn btn-outline btn-sm" data-view-bulletin="${b.id}">${I18N.current === 'fr' ? 'Voir' : 'View'}</button>
        </div>
      `).join('') : `<p class="text-muted text-sm">${t('empty_bulletins')}</p>`;

      container.innerHTML = `
        ${sequences.length ? `
          <div class="flex items-center gap-8" style="flex-wrap:wrap;">
            <select id="bulletin-seq-${studentId}" style="padding:8px;border:1px solid var(--color-border);border-radius:8px;">
              ${sequences.map(s => `<option value="${s.id}">${s.label}</option>`).join('')}
            </select>
            <button class="btn btn-primary btn-sm" id="bulletin-gen-${studentId}">${t('btn_generate_bulletin')}</button>
          </div>
          <div id="bulletin-gen-err-${studentId}" class="mt-8"></div>
        ` : ''}
        <div class="mt-16">${listHtml}</div>
      `;

      const genBtn = container.querySelector(`#bulletin-gen-${studentId}`);
      if (genBtn) genBtn.addEventListener('click', async () => {
        const seqId = container.querySelector(`#bulletin-seq-${studentId}`).value;
        UI.setLoading(genBtn, true);
        try {
          await API.generateBulletin(studentId, seqId);
          await this.loadBulletinsBox(box, studentId);
        } catch (err) {
          container.querySelector(`#bulletin-gen-err-${studentId}`).innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
          UI.setLoading(genBtn, false, t('btn_generate_bulletin'));
        }
      });

      container.querySelectorAll('[data-view-bulletin]').forEach(btn => {
        btn.addEventListener('click', () => MyChildrenPage.openBulletin(btn.dataset.viewBulletin));
      });
    } catch {
      container.innerHTML = `<p class="text-muted text-sm">—</p>`;
    }
  },
};
