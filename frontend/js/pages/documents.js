/**
 * SCHOOLAR — Gestion documentaire (section 8 du cahier des charges).
 * Réservé au personnel titulaire de documents.manage (proviseur, principal,
 * secrétaire). Archive bulletins, actes de naissance, certificats médicaux,
 * photos, diplômes (liés à un élève), emplois du temps, circulaires et
 * notes administratives (documents généraux de l'établissement).
 */
const DocumentsPage = {
  state: {
    documents: [],
    categoryFilter: '',
    showTrash: false,
    showForm: false,
    studentResults: [],
    selectedStudent: null,
  },

  studentCategories: ['bulletin', 'birth_certificate', 'medical_certificate', 'photo', 'diploma'],
  establishmentCategories: ['timetable', 'circular', 'administrative_note'],

  async render(root) {
    const user = Store.getUser();
    if (!user) { window.location.hash = '#/login'; return; }
    this.root = root;
    this.user = user;

    await this.loadDocuments();
    this.paint();
  },

  async loadDocuments() {
    try {
      const qs = new URLSearchParams();
      if (this.state.categoryFilter) qs.set('category', this.state.categoryFilter);
      if (this.state.showTrash) qs.set('trashed', 'true');
      const data = await API.listDocuments(`?${qs.toString()}`);
      this.state.documents = data.documents;
    } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
  },

  paint() {
    const navItems = DashboardPage.buildNavItems(this.user).map(i => ({ ...i, active: i.href === '#/documents' }));
    const allCategories = [...this.studentCategories, ...this.establishmentCategories];

    const body = `
      <div class="flex justify-between items-center" style="flex-wrap:wrap;gap:10px;">
        <div>
          <h2>${t('documents_title')}</h2>
          <p class="text-muted text-sm mt-8">${t('documents_subtitle')}</p>
        </div>
        <button class="btn btn-primary" id="btn-new-document">${t('btn_new_document')}</button>
      </div>

      <div class="flex gap-8 mt-16" style="flex-wrap:wrap;">
        <div class="field-input-wrap" style="max-width:240px;">
          <select id="doc-category-filter">
            <option value="">${I18N.current === 'fr' ? 'Toutes les catégories' : 'All categories'}</option>
            ${allCategories.map(c => `<option value="${c}" ${this.state.categoryFilter === c ? 'selected' : ''}>${t('document_cat_' + c)}</option>`).join('')}
          </select>
        </div>
        <button class="btn btn-outline btn-sm" id="doc-toggle-trash">${this.state.showTrash ? (I18N.current === 'fr' ? 'Voir les documents' : 'Back to documents') : t('btn_trash')}</button>
      </div>

      <div id="document-form-container"></div>
      <div id="document-list-container" class="mt-16"></div>
    `;

    const content = UI.renderShell(this.root, { user: this.user, navItems, pageBodyHtml: body });
    this.content = content;

    content.querySelector('#doc-category-filter').addEventListener('change', async (e) => {
      this.state.categoryFilter = e.target.value;
      await this.loadDocuments();
      this.paintList();
    });
    content.querySelector('#doc-toggle-trash').addEventListener('click', async () => {
      this.state.showTrash = !this.state.showTrash;
      await this.loadDocuments();
      this.paint();
    });
    content.querySelector('#btn-new-document').addEventListener('click', () => { this.state.showForm = true; this.paintForm(); });

    this.paintList();
  },

  paintForm() {
    const container = this.content.querySelector('#document-form-container');
    if (!this.state.showForm) { container.innerHTML = ''; return; }

    const allCategories = [...this.studentCategories, ...this.establishmentCategories];

    container.innerHTML = `
      <div class="card mt-16" style="max-width:640px;">
        <h3>${t('btn_new_document')}</h3>
        <form id="document-form" class="mt-16">
          <div class="field-group">
            <label class="field-label">${t('field_title')}</label>
            <div class="field-input-wrap"><input id="doc-title" required></div>
          </div>
          <div class="field-group mt-16">
            <label class="field-label">${I18N.current === 'fr' ? 'Catégorie' : 'Category'}</label>
            <div class="field-input-wrap">
              <select id="doc-category">
                ${allCategories.map(c => `<option value="${c}">${t('document_cat_' + c)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div id="doc-student-picker" class="field-group mt-16">
            <label class="field-label">${t('field_child')}</label>
            <div class="field-input-wrap"><input id="doc-student-search" placeholder="${I18N.current === 'fr' ? 'Nom ou matricule...' : 'Name or ID...'}"></div>
            <div id="doc-student-results" class="mt-8"></div>
            <div id="doc-student-selected" class="mt-8"></div>
          </div>
          <div class="field-group mt-16">
            <label class="field-label">${t('field_file')}</label>
            <div class="field-input-wrap"><input type="file" id="doc-file" required></div>
          </div>
          <div id="document-form-error"></div>
          <div id="document-form-success"></div>
          <div class="flex gap-8 mt-24">
            <button type="submit" class="btn btn-primary" id="document-form-submit">${t('btn_new_document')}</button>
            <button type="button" class="btn btn-outline" id="document-form-cancel">${I18N.current === 'fr' ? 'Annuler' : 'Cancel'}</button>
          </div>
        </form>
      </div>
    `;

    const toggleStudentPicker = () => {
      const category = container.querySelector('#doc-category').value;
      container.querySelector('#doc-student-picker').style.display = this.studentCategories.includes(category) ? '' : 'none';
    };
    toggleStudentPicker();
    container.querySelector('#doc-category').addEventListener('change', toggleStudentPicker);

    const searchInput = container.querySelector('#doc-student-search');
    let searchTimeout;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => this.searchStudents(container, searchInput.value), 300);
    });

    container.querySelector('#document-form-cancel').addEventListener('click', () => { this.state.showForm = false; this.state.selectedStudent = null; this.paintForm(); });
    container.querySelector('#document-form').addEventListener('submit', (e) => this.handleCreate(e));
  },

  async searchStudents(container, q) {
    const resultsBox = container.querySelector('#doc-student-results');
    if (!q || q.length < 2) { resultsBox.innerHTML = ''; return; }
    try {
      const data = await API.listStudents(`?q=${encodeURIComponent(q)}`);
      resultsBox.innerHTML = data.students.slice(0, 6).map(s => `
        <div class="flex justify-between items-center text-sm" style="padding:6px 0;border-bottom:1px solid var(--color-border);cursor:pointer;" data-pick-student="${s.id}" data-pick-name="${s.first_name} ${s.last_name} (${s.matricule})">
          <span>${s.first_name} ${s.last_name} — ${s.matricule}</span>
        </div>
      `).join('');
      resultsBox.querySelectorAll('[data-pick-student]').forEach(row => {
        row.addEventListener('click', () => {
          this.state.selectedStudent = { id: row.dataset.pickStudent, name: row.dataset.pickName };
          resultsBox.innerHTML = '';
          container.querySelector('#doc-student-search').value = '';
          container.querySelector('#doc-student-selected').innerHTML = `<span class="badge badge-info">${this.state.selectedStudent.name}</span>`;
        });
      });
    } catch { /* silencieux */ }
  },

  async handleCreate(e) {
    e.preventDefault();
    const errorBox = this.content.querySelector('#document-form-error');
    const successBox = this.content.querySelector('#document-form-success');
    errorBox.innerHTML = ''; successBox.innerHTML = '';

    const category = this.content.querySelector('#doc-category').value;
    const fileInput = this.content.querySelector('#doc-file');
    if (!fileInput.files.length) { errorBox.innerHTML = `<div class="alert alert-error">${t('field_file')}</div>`; return; }
    if (this.studentCategories.includes(category) && !this.state.selectedStudent) {
      errorBox.innerHTML = `<div class="alert alert-error">${t('field_child')}</div>`;
      return;
    }

    const payload = {
      title: this.content.querySelector('#doc-title').value,
      category,
      student_id: this.state.selectedStudent ? this.state.selectedStudent.id : '',
      file: fileInput.files[0],
    };

    const btn = this.content.querySelector('#document-form-submit');
    UI.setLoading(btn, true);
    try {
      await API.createDocument(payload);
      successBox.innerHTML = `<div class="alert alert-success">${I18N.current === 'fr' ? 'Document ajouté.' : 'Document added.'}</div>`;
      this.content.querySelector('#document-form').reset();
      this.state.showForm = false;
      this.state.selectedStudent = null;
      await this.loadDocuments();
      this.paintForm();
      this.paintList();
    } catch (err) {
      errorBox.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
    } finally {
      UI.setLoading(btn, false, t('btn_new_document'));
    }
  },

  paintList() {
    const container = this.content.querySelector('#document-list-container');
    if (!this.state.documents.length) {
      container.innerHTML = `<div class="card"><div class="empty-state">${UI.icon('building', 30)}<p class="mt-8">${t('empty_documents')}</p></div></div>`;
      return;
    }

    container.innerHTML = `<div class="card"><table style="width:100%;border-collapse:collapse;">
      <thead><tr style="text-align:left;font-size:12px;color:var(--color-text-muted);text-transform:uppercase;">
        <th style="padding:8px;">${t('field_title')}</th>
        <th style="padding:8px;">${I18N.current === 'fr' ? 'Catégorie' : 'Category'}</th>
        <th style="padding:8px;">${t('field_child')}</th>
        <th style="padding:8px;"></th>
      </tr></thead>
      <tbody>
        ${this.state.documents.map(d => `
          <tr style="border-top:1px solid var(--color-border);">
            <td style="padding:8px;">${d.title}</td>
            <td style="padding:8px;"><span class="badge badge-neutral">${t('document_cat_' + d.category)}</span></td>
            <td style="padding:8px;">${d.student_first_name ? d.student_first_name + ' ' + d.student_last_name + ' (' + d.matricule + ')' : (I18N.current === 'fr' ? 'Établissement' : 'School-wide')}</td>
            <td style="padding:8px;text-align:right;">
              <div class="flex gap-8" style="flex-wrap:wrap;justify-content:flex-end;">
                <a class="btn btn-outline btn-sm" href="${API.downloadDocumentUrl(d.id)}" target="_blank" rel="noopener">${t('btn_download')}</a>
                ${!this.state.showTrash ? `<button class="btn btn-outline btn-sm" data-trash="${d.id}">${t('btn_trash')}</button>` : `
                  <button class="btn btn-outline btn-sm" data-restore="${d.id}">${I18N.current === 'fr' ? 'Restaurer' : 'Restore'}</button>
                  <button class="btn btn-outline btn-sm" data-delete-forever="${d.id}">${I18N.current === 'fr' ? 'Supprimer définitivement' : 'Delete forever'}</button>
                `}
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table></div>`;

    container.querySelectorAll('[data-trash]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try { await API.trashDocument(btn.dataset.trash); await this.loadDocuments(); this.paintList(); }
        catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
      });
    });
    container.querySelectorAll('[data-restore]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try { await API.restoreDocument(btn.dataset.restore); await this.loadDocuments(); this.paintList(); }
        catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
      });
    });
    container.querySelectorAll('[data-delete-forever]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try { await API.deleteDocument(btn.dataset.deleteForever); await this.loadDocuments(); this.paintList(); }
        catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
      });
    });
  },
};
