/**
 * SCHOOLAR — Annonces (annexe section 7)
 */
const AnnouncementsPage = {
  state: {
    announcements: [],
    classes: [],
    showForm: false,
  },

  CAN_CREATE_ROLES: ['proviseur', 'principal', 'directeur', 'censeur', 'surveillant_general', 'secretaire', 'enseignant', 'professeur_principal'],
  ADMIN_ROLES: ['proviseur', 'principal', 'directeur', 'censeur', 'surveillant_general', 'secretaire'],

  async render(root) {
    const user = Store.getUser();
    if (!user) { window.location.hash = '#/login'; return; }
    this.root = root;
    this.user = user;
    this.canCreate = this.CAN_CREATE_ROLES.includes(user.role_code);
    this.isAdmin = this.ADMIN_ROLES.includes(user.role_code);

    if (this.canCreate && !this.isAdmin) {
      try { const d = await API.listClasses(); this.state.classes = d.classes; } catch {}
    }
    await this.loadAnnouncements();
    this.paint();
  },

  async loadAnnouncements() {
    try {
      const d = await API.listAnnouncements();
      this.state.announcements = d.announcements;
    } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
  },

  paint() {
    const navItems = DashboardPage.buildNavItems(this.user).map(i => ({ ...i, active: i.href === '#/announcements' }));

    const body = `
      <div class="flex justify-between items-center">
        <div>
          <h2>${t('announcements_title')}</h2>
          <p class="text-muted text-sm mt-8">${t('announcements_subtitle')}</p>
        </div>
        ${this.canCreate ? `<button class="btn btn-primary btn-sm" id="btn-new-announcement">${t('btn_new_announcement')}</button>` : ''}
      </div>

      <div id="announcement-form-container" class="mt-16"></div>
      <div id="announcement-list-container" class="mt-24"></div>
    `;

    const content = UI.renderShell(this.root, { user: this.user, navItems, pageBodyHtml: body });
    this.content = content;

    if (this.canCreate) {
      content.querySelector('#btn-new-announcement').addEventListener('click', () => {
        this.state.showForm = true;
        this.paintForm();
      });
    }

    this.paintList();
  },

  paintForm() {
    const container = this.content.querySelector('#announcement-form-container');
    if (!this.state.showForm) { container.innerHTML = ''; return; }

    container.innerHTML = `
      <div class="card" style="max-width:640px;">
        <div class="field-group">
          <label class="field-label">${t('field_title')}</label>
          <div class="field-input-wrap"><input id="an-title"></div>
        </div>
        <div class="field-group mt-16">
          <label class="field-label">${t('field_body')}</label>
          <div class="field-input-wrap"><input id="an-body"></div>
        </div>
        <div class="field-group mt-16">
          <label class="field-label">${t('field_audience')}</label>
          <div class="field-input-wrap">
            <select id="an-audience">
              ${this.isAdmin ? `
                <option value="all_establishment">${t('audience_all_establishment')}</option>
                <option value="all_staff">${t('audience_all_staff')}</option>
                <option value="all_parents">${t('audience_all_parents')}</option>
              ` : ''}
              <option value="class">${t('audience_class')}</option>
            </select>
          </div>
        </div>
        <div class="field-group mt-16" id="an-class-wrap" style="${this.isAdmin ? 'display:none;' : ''}">
          <label class="field-label">${t('field_class')}</label>
          <div class="field-input-wrap">
            <select id="an-class">
              ${this.state.classes.map(c => `<option value="${c.id}">${c.level}${c.series ? ' ' + c.series : ''}${c.section ? ' ' + c.section : ''}</option>`).join('')}
            </select>
          </div>
        </div>
        <div id="an-form-error"></div>
        <div class="flex gap-8 mt-24">
          <button class="btn btn-primary btn-sm" id="an-form-submit">${t('btn_new_announcement')}</button>
          <button class="btn btn-outline btn-sm" id="an-form-cancel">${I18N.current === 'fr' ? 'Annuler' : 'Cancel'}</button>
        </div>
      </div>
    `;

    const audienceSelect = container.querySelector('#an-audience');
    const classWrap = container.querySelector('#an-class-wrap');
    audienceSelect.addEventListener('change', () => {
      classWrap.style.display = audienceSelect.value === 'class' ? 'block' : 'none';
    });

    container.querySelector('#an-form-cancel').addEventListener('click', () => { this.state.showForm = false; this.paintForm(); });
    container.querySelector('#an-form-submit').addEventListener('click', async () => {
      const errorBox = container.querySelector('#an-form-error');
      errorBox.innerHTML = '';
      const audience = audienceSelect.value;
      const payload = {
        title: container.querySelector('#an-title').value,
        body: container.querySelector('#an-body').value,
        audience,
      };
      if (audience === 'class') payload.class_id = container.querySelector('#an-class').value;

      try {
        const data = await API.createAnnouncement(payload);
        UI.toast(I18N.current === 'fr' ? `Annonce diffusée à ${data.notified_count} personne(s).` : `Announcement sent to ${data.notified_count} people.`, 'success');
        this.state.showForm = false;
        await this.loadAnnouncements();
        this.paint();
      } catch (err) {
        errorBox.innerHTML = `<div class="alert alert-error mt-8">${err.message || 'Erreur.'}</div>`;
      }
    });
  },

  paintList() {
    const container = this.content.querySelector('#announcement-list-container');
    if (!this.state.announcements.length) {
      container.innerHTML = `<div class="card"><div class="empty-state">${UI.icon('bell', 30)}<p class="mt-8">${t('empty_announcements')}</p></div></div>`;
      return;
    }

    container.innerHTML = this.state.announcements.map(a => `
      <div class="card mt-16">
        <div class="card-title-row">
          <div>
            <h3>${a.title}</h3>
            <div class="text-sm text-muted mt-8">
              ${a.author_first_name} ${a.author_last_name} · ${new Date(a.created_at).toLocaleDateString()}
              ${a.level ? ' · ' + a.level + (a.series ? ' ' + a.series : '') + (a.section ? ' ' + a.section : '') : ''}
            </div>
          </div>
          <span class="badge badge-neutral">${t('audience_' + a.audience)}</span>
        </div>
        <p class="text-sm mt-8">${a.body}</p>
        ${(this.isAdmin || a.author_id === this.user.id) ? `<button class="btn btn-outline btn-sm mt-16" data-delete="${a.id}">${t('btn_delete')}</button>` : ''}
      </div>
    `).join('');

    container.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await API.deleteAnnouncement(btn.dataset.delete);
          await this.loadAnnouncements();
          this.paintList();
        } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
      });
    });
  },
};
