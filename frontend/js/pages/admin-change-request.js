/**
 * SCHOOLAR — Demande de changement d'administrateur (section 5)
 */
const AdminChangeRequestPage = {
  render(root) {
    const user = Store.getUser();
    if (!user) { window.location.hash = '#/login'; return; }

    const navItems = DashboardPage.buildNavItems(user).map(i => ({ ...i, active: i.href === '#/admin-change/request' }));

    const body = `
      <div class="card" style="max-width:620px;">
        <h2>${t('admin_change_request_title')}</h2>
        <p class="text-muted mt-8">${t('admin_change_request_subtitle')}</p>

        <form id="change-form" class="mt-24">
          ${user.role_code === 'admin_national' ? `
            <div class="field-group">
              <label class="field-label">${t('field_establishment')} (code)</label>
              <div class="field-input-wrap">${UI.icon('building')}<input id="c-est-code" placeholder="Ex: LYCOU2560" required></div>
            </div>
          ` : ''}
          <div class="grid-2 mt-16">
            <div class="field-group">
              <label class="field-label">${t('field_first_name')}</label>
              <div class="field-input-wrap"><input id="c-fname" required></div>
            </div>
            <div class="field-group">
              <label class="field-label">${t('field_last_name')}</label>
              <div class="field-input-wrap"><input id="c-lname" required></div>
            </div>
          </div>
          <div class="field-group mt-16">
            <label class="field-label">${t('field_email')}</label>
            <div class="field-input-wrap">${UI.icon('mail')}<input type="email" id="c-email" required></div>
          </div>
          <div class="field-group mt-16">
            <label class="field-label">${t('field_phone')}</label>
            <div class="field-input-wrap"><input id="c-phone"></div>
          </div>
          <div class="field-group mt-16">
            <label class="field-label">${t('field_justification')}</label>
            <div class="field-input-wrap"><input id="c-doc" placeholder="https://..."></div>
          </div>

          <div id="change-error"></div>
          <div id="change-success"></div>

          <div class="form-submit">
            <button type="submit" class="btn btn-primary btn-block" id="change-submit">${t('btn_submit_change_request')}</button>
          </div>
        </form>
      </div>
    `;

    const content = UI.renderShell(root, { user, navItems, pageBodyHtml: body });
    content.querySelector('#change-form').addEventListener('submit', (e) => this.handleSubmit(e, content, user));
  },

  async handleSubmit(e, content, user) {
    e.preventDefault();
    const errorBox = content.querySelector('#change-error');
    const successBox = content.querySelector('#change-success');
    errorBox.innerHTML = ''; successBox.innerHTML = '';

    const payload = {
      new_admin_first_name: content.querySelector('#c-fname').value,
      new_admin_last_name: content.querySelector('#c-lname').value,
      new_admin_email: content.querySelector('#c-email').value,
      new_admin_phone: content.querySelector('#c-phone').value,
      justification_doc_url: content.querySelector('#c-doc').value,
    };

    if (user.role_code === 'admin_national') {
      // NOTE: en Étape 2, l'admin national fournit le code établissement ; une future étape
      // pourra remplacer ce champ par un sélecteur avec recherche.
      const code = content.querySelector('#c-est-code').value;
      try {
        const data = await API.searchEstablishments(code);
        const match = (data.establishments || []).find(e => e.code === code);
        if (!match) { errorBox.innerHTML = `<div class="alert alert-error">${I18N.current === 'fr' ? 'Code établissement introuvable.' : 'School code not found.'}</div>`; return; }
        payload.establishment_id = match.id;
      } catch { errorBox.innerHTML = `<div class="alert alert-error">Erreur.</div>`; return; }
    }

    const submitBtn = content.querySelector('#change-submit');
    UI.setLoading(submitBtn, true);

    try {
      const data = await API.requestAdminChange(payload);
      let html = `<div class="alert alert-success">${I18N.current === 'fr' ? 'Demande envoyée avec succès.' : 'Request sent successfully.'}</div>`;
      if (data.dev_confirmation_token) {
        const link = `#/admin-change/confirm/${data.dev_confirmation_token}`;
        html += `<div class="alert alert-info mt-8">${t('dev_note_email')}<br><a href="${link}">${window.location.origin}${window.location.pathname}${link}</a></div>`;
      }
      successBox.innerHTML = html;
      content.querySelector('#change-form').reset();
    } catch (err) {
      errorBox.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
    } finally {
      UI.setLoading(submitBtn, false, t('btn_submit_change_request'));
    }
  },
};
