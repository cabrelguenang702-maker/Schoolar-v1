/**
 * SCHOOLAR — Bibliothèque numérique (section 9 du cahier des charges).
 * Consultation ouverte à tout membre authentifié de l'établissement ; dépôt
 * réservé au personnel titulaire de library.manage (proviseur, principal,
 * enseignants).
 */
const LibraryPage = {
  state: {
    resources: [],
    subjects: [],
    categoryFilter: '',
    subjectFilter: '',
    showTrash: false,
    showForm: false,
  },

  categories: [
    { key: 'book', label_key: 'library_cat_book' },
    { key: 'pdf', label_key: 'library_cat_pdf' },
    { key: 'exercise', label_key: 'library_cat_exercise' },
    { key: 'past_exam', label_key: 'library_cat_past_exam' },
    { key: 'answer_key', label_key: 'library_cat_answer_key' },
    { key: 'video', label_key: 'library_cat_video' },
    { key: 'podcast', label_key: 'library_cat_podcast' },
    { key: 'interactive_course', label_key: 'library_cat_interactive_course' },
  ],

  async render(root) {
    const user = Store.getUser();
    if (!user) { window.location.hash = '#/login'; return; }
    this.root = root;
    this.user = user;
    this.canManage = ['proviseur', 'principal', 'directeur', 'enseignant', 'professeur_principal'].includes(user.role_code);

    if (this.canManage) {
      try {
        const subjData = await API.listSubjects();
        this.state.subjects = subjData.subjects;
      } catch { /* silencieux */ }
    }

    await this.loadResources();
    this.paint();
  },

  async loadResources() {
    try {
      const qs = new URLSearchParams();
      if (this.state.categoryFilter) qs.set('category', this.state.categoryFilter);
      if (this.state.subjectFilter) qs.set('subject_id', this.state.subjectFilter);
      if (this.state.showTrash) qs.set('trashed', 'true');
      const data = await API.listLibrary(`?${qs.toString()}`);
      this.state.resources = data.resources;
    } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
  },

  paint() {
    const navItems = DashboardPage.buildNavItems(this.user).map(i => ({ ...i, active: i.href === '#/library' }));

    const body = `
      <div class="flex justify-between items-center" style="flex-wrap:wrap;gap:10px;">
        <div>
          <h2>${t('library_title')}</h2>
          <p class="text-muted text-sm mt-8">${t('library_subtitle')}</p>
        </div>
        ${this.canManage ? `<button class="btn btn-primary" id="btn-new-resource">${t('btn_new_resource')}</button>` : ''}
      </div>

      <div class="flex gap-8 mt-16" style="flex-wrap:wrap;">
        <div class="field-input-wrap" style="max-width:220px;">
          <select id="lib-category-filter">
            <option value="">${I18N.current === 'fr' ? 'Toutes les catégories' : 'All categories'}</option>
            ${this.categories.map(c => `<option value="${c.key}" ${this.state.categoryFilter === c.key ? 'selected' : ''}>${t(c.label_key)}</option>`).join('')}
          </select>
        </div>
        ${this.canManage && this.state.subjects.length ? `
          <div class="field-input-wrap" style="max-width:220px;">
            <select id="lib-subject-filter">
              <option value="">${I18N.current === 'fr' ? 'Toutes les matières' : 'All subjects'}</option>
              ${this.state.subjects.map(s => `<option value="${s.id}" ${this.state.subjectFilter === s.id ? 'selected' : ''}>${s.name}</option>`).join('')}
            </select>
          </div>
        ` : ''}
        ${this.canManage ? `<button class="btn btn-outline btn-sm" id="lib-toggle-trash">${this.state.showTrash ? (I18N.current === 'fr' ? 'Voir la bibliothèque' : 'Back to library') : t('btn_trash')}</button>` : ''}
      </div>

      <div id="resource-form-container"></div>
      <div id="resource-list-container" class="mt-16"></div>
    `;

    const content = UI.renderShell(this.root, { user: this.user, navItems, pageBodyHtml: body });
    this.content = content;

    content.querySelector('#lib-category-filter').addEventListener('change', async (e) => {
      this.state.categoryFilter = e.target.value;
      await this.loadResources();
      this.paintList();
    });
    const subjFilter = content.querySelector('#lib-subject-filter');
    if (subjFilter) subjFilter.addEventListener('change', async (e) => {
      this.state.subjectFilter = e.target.value;
      await this.loadResources();
      this.paintList();
    });
    const trashBtn = content.querySelector('#lib-toggle-trash');
    if (trashBtn) trashBtn.addEventListener('click', async () => {
      this.state.showTrash = !this.state.showTrash;
      await this.loadResources();
      this.paint();
    });
    const newBtn = content.querySelector('#btn-new-resource');
    if (newBtn) newBtn.addEventListener('click', () => { this.state.showForm = true; this.paintForm(); });

    this.paintList();
  },

  paintForm() {
    const container = this.content.querySelector('#resource-form-container');
    if (!this.state.showForm) { container.innerHTML = ''; return; }

    container.innerHTML = `
      <div class="card mt-16" style="max-width:640px;">
        <h3>${t('btn_new_resource')}</h3>
        <form id="resource-form" class="mt-16">
          <div class="field-group">
            <label class="field-label">${t('field_title')}</label>
            <div class="field-input-wrap"><input id="res-title" required></div>
          </div>
          <div class="field-group">
            <label class="field-label">${t('field_body')}</label>
            <div class="field-input-wrap"><input id="res-description"></div>
          </div>
          <div class="grid-2 mt-16">
            <div class="field-group">
              <label class="field-label">${I18N.current === 'fr' ? 'Catégorie' : 'Category'}</label>
              <div class="field-input-wrap">
                <select id="res-category">
                  ${this.categories.map(c => `<option value="${c.key}">${t(c.label_key)}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="field-group">
              <label class="field-label">${t('field_level')}</label>
              <div class="field-input-wrap"><input id="res-level" placeholder="Ex: 6e, Terminale"></div>
            </div>
          </div>
          <div class="field-group mt-16">
            <label class="field-label">${t('field_subject')}</label>
            <div class="field-input-wrap">
              <select id="res-subject">
                <option value="">${t('none_option')}</option>
                ${this.state.subjects.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="field-group mt-16">
            <label class="field-label">${t('field_file')}</label>
            <div class="field-input-wrap"><input type="file" id="res-file" required></div>
          </div>
          <div id="resource-form-error"></div>
          <div id="resource-form-success"></div>
          <div class="flex gap-8 mt-24">
            <button type="submit" class="btn btn-primary" id="resource-form-submit">${t('btn_new_resource')}</button>
            <button type="button" class="btn btn-outline" id="resource-form-cancel">${I18N.current === 'fr' ? 'Annuler' : 'Cancel'}</button>
          </div>
        </form>
      </div>
    `;

    container.querySelector('#resource-form-cancel').addEventListener('click', () => { this.state.showForm = false; this.paintForm(); });
    container.querySelector('#resource-form').addEventListener('submit', (e) => this.handleCreate(e));
  },

  async handleCreate(e) {
    e.preventDefault();
    const errorBox = this.content.querySelector('#resource-form-error');
    const successBox = this.content.querySelector('#resource-form-success');
    errorBox.innerHTML = ''; successBox.innerHTML = '';

    const fileInput = this.content.querySelector('#res-file');
    if (!fileInput.files.length) { errorBox.innerHTML = `<div class="alert alert-error">${t('field_file')}</div>`; return; }

    const payload = {
      title: this.content.querySelector('#res-title').value,
      description: this.content.querySelector('#res-description').value,
      category: this.content.querySelector('#res-category').value,
      level: this.content.querySelector('#res-level').value,
      subject_id: this.content.querySelector('#res-subject').value,
      file: fileInput.files[0],
    };

    const btn = this.content.querySelector('#resource-form-submit');
    UI.setLoading(btn, true);
    try {
      await API.createLibraryResource(payload);
      successBox.innerHTML = `<div class="alert alert-success">${I18N.current === 'fr' ? 'Ressource ajoutée.' : 'Resource added.'}</div>`;
      this.content.querySelector('#resource-form').reset();
      this.state.showForm = false;
      await this.loadResources();
      this.paintForm();
      this.paintList();
    } catch (err) {
      errorBox.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
    } finally {
      UI.setLoading(btn, false, t('btn_new_resource'));
    }
  },

  paintList() {
    const container = this.content.querySelector('#resource-list-container');
    if (!this.state.resources.length) {
      container.innerHTML = `<div class="card"><div class="empty-state">${UI.icon('graph', 30)}<p class="mt-8">${t('empty_library')}</p></div></div>`;
      return;
    }

    container.innerHTML = `<div class="grid-2">
      ${this.state.resources.map(r => `
        <div class="card">
          <div class="flex justify-between items-center">
            <span class="badge badge-info">${t('library_cat_' + r.category)}</span>
            ${r.level ? `<span class="text-muted text-sm">${r.level}</span>` : ''}
          </div>
          <h3 class="mt-8">${r.title}</h3>
          ${r.description ? `<p class="text-muted text-sm mt-8">${r.description}</p>` : ''}
          ${r.subject_name ? `<p class="text-sm mt-8">${r.subject_name}</p>` : ''}
          <div class="flex gap-8 mt-16" style="flex-wrap:wrap;">
            <a class="btn btn-primary btn-sm" href="${API.downloadLibraryResourceUrl(r.id)}" target="_blank" rel="noopener">${t('btn_download')}</a>
            ${this.canManage && !this.state.showTrash ? `<button class="btn btn-outline btn-sm" data-trash="${r.id}">${t('btn_trash')}</button>` : ''}
            ${this.canManage && this.state.showTrash ? `
              <button class="btn btn-outline btn-sm" data-restore="${r.id}">${I18N.current === 'fr' ? 'Restaurer' : 'Restore'}</button>
              <button class="btn btn-outline btn-sm" data-delete-forever="${r.id}">${I18N.current === 'fr' ? 'Supprimer définitivement' : 'Delete forever'}</button>
            ` : ''}
          </div>
        </div>
      `).join('')}
    </div>`;

    container.querySelectorAll('[data-trash]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try { await API.trashLibraryResource(btn.dataset.trash); await this.loadResources(); this.paintList(); }
        catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
      });
    });
    container.querySelectorAll('[data-restore]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try { await API.restoreLibraryResource(btn.dataset.restore); await this.loadResources(); this.paintList(); }
        catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
      });
    });
    container.querySelectorAll('[data-delete-forever]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try { await API.deleteLibraryResource(btn.dataset.deleteForever); await this.loadResources(); this.paintList(); }
        catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
      });
    });
  },
};
