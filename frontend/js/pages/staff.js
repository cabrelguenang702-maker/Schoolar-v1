/**
 * SCHOOLAR — Gestion du personnel de l'établissement (section 6)
 */
const StaffPage = {
  state: {
    staff: [],
    roleFilter: '',
    statusFilter: '',
    search: '',
    showForm: false,
    editingId: null,
  },

  roleOptions: [
    'censeur', 'surveillant_general', 'surveillant_secteur',
    'enseignant', 'professeur_principal', 'secretaire', 'econome', 'comptable',
  ],

  async render(root) {
    const user = Store.getUser();
    if (!user) { window.location.hash = '#/login'; return; }
    this.root = root;
    this.user = user;
    this.canManage = ['proviseur', 'principal', 'directeur'].includes(user.role_code);
    await this.loadStaff();
    this.paint();
  },

  async loadStaff() {
    const qs = new URLSearchParams();
    if (this.state.roleFilter) qs.set('role', this.state.roleFilter);
    if (this.state.statusFilter) qs.set('status', this.state.statusFilter);
    if (this.state.search) qs.set('q', this.state.search);
    try {
      const data = await API.listStaff(`?${qs.toString()}`);
      this.state.staff = data.staff;
    } catch (err) {
      UI.toast(err.message || 'Erreur de chargement.', 'error');
    }
  },

  paint() {
    const navItems = DashboardPage.buildNavItems(this.user).map(i => ({ ...i, active: i.href === '#/staff' }));

    const body = `
      <div class="flex justify-between items-center" style="flex-wrap:wrap;gap:12px;">
        <div>
          <h2>${t('staff_title')}</h2>
          <p class="text-muted text-sm mt-8">${t('staff_subtitle')}</p>
        </div>
        ${this.canManage ? `<button class="btn btn-primary" id="btn-new-staff">${t('btn_new_staff')}</button>` : ''}
      </div>

      <div class="card mt-24">
        <div class="grid-2" style="grid-template-columns: 2fr 1fr 1fr;">
          <div class="field-input-wrap">${UI.icon('search', 16)}<input id="f-search" placeholder="${t('field_search')}" value="${this.state.search}"></div>
          <div class="field-input-wrap">
            <select id="f-role-filter">
              <option value="">${t('filter_all_roles')}</option>
              ${this.roleOptions.map(r => `<option value="${r}" ${this.state.roleFilter === r ? 'selected' : ''}>${t('role_' + r)}</option>`).join('')}
            </select>
          </div>
          <div class="field-input-wrap">
            <select id="f-status-filter">
              <option value="">${t('filter_all_status')}</option>
              <option value="active" ${this.state.statusFilter === 'active' ? 'selected' : ''}>${t('status_active')}</option>
              <option value="archived" ${this.state.statusFilter === 'archived' ? 'selected' : ''}>${t('status_archived')}</option>
            </select>
          </div>
        </div>
      </div>

      <div id="staff-form-container"></div>
      <div id="staff-list-container" class="mt-24"></div>
    `;

    const content = UI.renderShell(this.root, { user: this.user, navItems, pageBodyHtml: body });
    this.content = content;

    content.querySelector('#f-search').addEventListener('input', this.debounce((e) => {
      this.state.search = e.target.value;
      this.loadStaff().then(() => this.paintList());
    }, 300));
    content.querySelector('#f-role-filter').addEventListener('change', (e) => {
      this.state.roleFilter = e.target.value;
      this.loadStaff().then(() => this.paintList());
    });
    content.querySelector('#f-status-filter').addEventListener('change', (e) => {
      this.state.statusFilter = e.target.value;
      this.loadStaff().then(() => this.paintList());
    });

    if (this.canManage) {
      content.querySelector('#btn-new-staff').addEventListener('click', () => {
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
    const container = this.content.querySelector('#staff-form-container');
    if (!this.state.showForm) { container.innerHTML = ''; return; }

    container.innerHTML = `
      <div class="card mt-24" style="max-width:640px;">
        <h3>${prefill ? t('btn_edit') : t('btn_new_staff')}</h3>
        <form id="staff-form" class="mt-16">
          <div class="grid-2">
            <div class="field-group">
              <label class="field-label">${t('field_first_name')}</label>
              <div class="field-input-wrap"><input id="s-fname" value="${prefill ? prefill.first_name : ''}" required></div>
            </div>
            <div class="field-group">
              <label class="field-label">${t('field_last_name')}</label>
              <div class="field-input-wrap"><input id="s-lname" value="${prefill ? prefill.last_name : ''}" required></div>
            </div>
          </div>
          <div class="field-group mt-16">
            <label class="field-label">${t('field_email')}</label>
            <div class="field-input-wrap">${UI.icon('mail')}<input type="email" id="s-email" value="${prefill ? prefill.email : ''}" ${prefill ? 'disabled' : ''} required></div>
          </div>
          <div class="grid-2 mt-16">
            <div class="field-group">
              <label class="field-label">${t('field_phone')}</label>
              <div class="field-input-wrap"><input id="s-phone" value="${prefill ? (prefill.phone || '') : ''}"></div>
            </div>
            <div class="field-group">
              <label class="field-label">${t('field_role')}</label>
              <div class="field-input-wrap">
                <select id="s-role">
                  ${this.roleOptions.map(r => `<option value="${r}" ${prefill && prefill.role_code === r ? 'selected' : ''}>${t('role_' + r)}</option>`).join('')}
                </select>
              </div>
            </div>
          </div>
          <div id="staff-form-error"></div>
          <div id="staff-form-success"></div>
          <div class="flex gap-8 mt-24">
            <button type="submit" class="btn btn-primary" id="staff-form-submit">${prefill ? t('btn_edit') : t('btn_new_staff')}</button>
            <button type="button" class="btn btn-outline" id="staff-form-cancel">${I18N.current === 'fr' ? 'Annuler' : 'Cancel'}</button>
          </div>
        </form>
      </div>
    `;

    container.querySelector('#staff-form-cancel').addEventListener('click', () => {
      this.state.showForm = false;
      this.paintForm();
    });

    container.querySelector('#staff-form').addEventListener('submit', (e) => this.handleFormSubmit(e, prefill));
  },

  async handleFormSubmit(e, prefill) {
    e.preventDefault();
    const errorBox = this.content.querySelector('#staff-form-error');
    const successBox = this.content.querySelector('#staff-form-success');
    errorBox.innerHTML = ''; successBox.innerHTML = '';

    const payload = {
      first_name: this.content.querySelector('#s-fname').value,
      last_name: this.content.querySelector('#s-lname').value,
      phone: this.content.querySelector('#s-phone').value,
      role_code: this.content.querySelector('#s-role').value,
    };
    if (!prefill) payload.email = this.content.querySelector('#s-email').value;

    const btn = this.content.querySelector('#staff-form-submit');
    UI.setLoading(btn, true);

    try {
      if (prefill) {
        await API.updateStaff(prefill.id, payload);
        UI.toast(I18N.current === 'fr' ? 'Compte mis à jour.' : 'Account updated.', 'success');
        this.state.showForm = false;
        this.paintForm();
      } else {
        const data = await API.createStaff(payload);
        let html = `<div class="alert alert-success"><strong>${t('staff_created_title')}</strong><br>${t('staff_created_note')}</div>`;
        if (data.dev_temp_password) {
          html += `<div class="alert alert-info mt-8">${t('dev_note_password')} <strong>${data.dev_temp_password}</strong></div>`;
        }
        successBox.innerHTML = html;
        this.content.querySelector('#staff-form').reset();
      }
      await this.loadStaff();
      this.paintList();
    } catch (err) {
      errorBox.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
    } finally {
      UI.setLoading(btn, false, prefill ? t('btn_edit') : t('btn_new_staff'));
    }
  },

  paintList() {
    const container = this.content.querySelector('#staff-list-container');

    if (!this.state.staff.length) {
      container.innerHTML = `<div class="card"><div class="empty-state">${UI.icon('users', 30)}<p class="mt-8">${t('empty_staff')}</p></div></div>`;
      return;
    }

    container.innerHTML = this.state.staff.map(s => `
      <div class="card mt-16">
        <div class="card-title-row">
          <div class="flex items-center gap-12">
            <div class="avatar">${UI.initials(s.first_name, s.last_name)}</div>
            <div>
              <h3>${s.first_name} ${s.last_name}</h3>
              <div class="text-sm text-muted mt-8">${I18N.current === 'fr' ? s.role_label_fr : s.role_label_en} · ${s.email}${s.phone ? ' · ' + s.phone : ''}</div>
            </div>
          </div>
          ${UI.statusBadge(s.status)}
        </div>
        ${this.canManage && s.status === 'active' ? `
          <div class="flex gap-8 mt-16">
            <button class="btn btn-outline btn-sm" data-action="edit" data-id="${s.id}">${t('btn_edit')}</button>
            <button class="btn btn-outline btn-sm" data-action="reset-password" data-id="${s.id}">${t('btn_reset_password')}</button>
            <button class="btn btn-outline btn-sm" data-action="archive" data-id="${s.id}">${t('btn_archive')}</button>
          </div>
        ` : ''}
        ${this.canManage && s.status === 'archived' ? `
          <div class="flex gap-8 mt-16">
            <button class="btn btn-primary btn-sm" data-action="reactivate" data-id="${s.id}">${t('btn_reactivate')}</button>
          </div>
        ` : ''}
      </div>
    `).join('');

    container.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const staff = this.state.staff.find(s => s.id === btn.dataset.id);
        this.state.showForm = true;
        this.state.editingId = staff.id;
        this.paintForm(staff);
        this.content.querySelector('#staff-form-container').scrollIntoView({ behavior: 'smooth' });
      });
    });
    container.querySelectorAll('[data-action="archive"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const reason = prompt(t('reason_prompt')) || '';
        try {
          await API.archiveStaff(btn.dataset.id, reason);
          UI.toast(I18N.current === 'fr' ? 'Compte archivé.' : 'Account archived.', 'success');
          await this.loadStaff(); this.paintList();
        } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
      });
    });
    container.querySelectorAll('[data-action="reactivate"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await API.reactivateStaff(btn.dataset.id);
          UI.toast(I18N.current === 'fr' ? 'Compte réactivé.' : 'Account reactivated.', 'success');
          await this.loadStaff(); this.paintList();
        } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
      });
    });
    container.querySelectorAll('[data-action="reset-password"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          const data = await API.resetStaffPassword(btn.dataset.id);
          UI.toast(I18N.current === 'fr' ? 'Mot de passe réinitialisé et envoyé par email.' : 'Password reset and emailed.', 'success');
          if (data.dev_temp_password) {
            UI.toast(`${t('dev_note_password')} ${data.dev_temp_password}`, 'default');
          }
        } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
      });
    });
  },
};
