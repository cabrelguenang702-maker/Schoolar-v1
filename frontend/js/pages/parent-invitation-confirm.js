/**
 * SCHOOLAR — Confirmation publique d'invitation parent (section 10)
 * Accessible sans connexion via le lien reçu par email.
 */
const ParentInvitationConfirmPage = {
  async render(root, params) {
    const token = params.token;
    root.innerHTML = `<div class="auth-screen"><div class="auth-panel-form"><div class="boot-spinner" style="margin:80px auto"></div></div></div>`;

    let info;
    try {
      const data = await API.parentInvitationStatus(token);
      info = data.invitation;
    } catch (err) {
      root.innerHTML = `
        <div class="auth-screen">
          <div class="auth-panel-form">
            <div class="logo-row"><div class="logo-box">${UI.logoSvg()}</div><div class="logo-word">${t('app_name')}</div></div>
            <div class="alert alert-error mt-24">${err.message || 'Lien invalide.'}</div>
            <a href="#/login" class="btn btn-outline btn-block mt-16">${t('back_to_login')}</a>
          </div>
        </div>`;
      return;
    }

    if (info.status !== 'pending') {
      root.innerHTML = `
        <div class="auth-screen">
          <div class="auth-panel-form">
            <div class="logo-row"><div class="logo-box">${UI.logoSvg()}</div><div class="logo-word">${t('app_name')}</div></div>
            <div class="alert alert-info mt-24">${I18N.current === 'fr' ? 'Cette invitation a déjà été utilisée.' : 'This invitation has already been used.'}</div>
            <a href="#/login" class="btn btn-outline btn-block mt-16">${t('back_to_login')}</a>
          </div>
        </div>`;
      return;
    }

    root.innerHTML = `
      <div class="auth-screen">
        <div class="auth-panel-form">
          <div class="logo-row"><div class="logo-box">${UI.logoSvg()}</div><div class="logo-word">${t('app_name')}</div></div>
          <div class="form-title mt-24">${t('parent_invitation_title')}</div>
          <div class="form-sub">${t('parent_invitation_subtitle')}</div>

          <div class="card mt-24">
            <div class="text-sm text-muted">${info.establishment_name}</div>
            <div style="font-weight:600;margin-top:4px;">${info.invited_first_name} ${info.invited_last_name}</div>
            <div class="text-sm text-muted">${info.invited_email}</div>
            <div class="text-sm text-muted mt-8">${I18N.current === 'fr' ? 'Enfant' : 'Child'}: ${info.student_first_name} ${info.student_last_name}</div>
          </div>

          <form id="pi-form" class="mt-24">
            <div class="field-group">
              <label class="field-label">${t('field_password')}</label>
              <div class="field-input-wrap">${UI.icon('lock')}<input type="password" id="pi-password" minlength="8" required></div>
            </div>
            <div class="field-group mt-16">
              <label class="field-label">${t('field_confirm_password')}</label>
              <div class="field-input-wrap">${UI.icon('lock')}<input type="password" id="pi-password2" minlength="8" required></div>
            </div>
            <div id="pi-error"></div>
            <div id="pi-success"></div>
            <div class="form-submit">
              <button type="submit" class="btn btn-primary btn-block" id="pi-submit">${t('btn_create_parent_space')}</button>
            </div>
          </form>
        </div>
      </div>
    `;

    document.getElementById('pi-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorBox = document.getElementById('pi-error');
      const successBox = document.getElementById('pi-success');
      errorBox.innerHTML = ''; successBox.innerHTML = '';

      const p1 = document.getElementById('pi-password').value;
      const p2 = document.getElementById('pi-password2').value;
      if (p1 !== p2) {
        errorBox.innerHTML = `<div class="alert alert-error">${I18N.current === 'fr' ? 'Les mots de passe ne correspondent pas.' : 'Passwords do not match.'}</div>`;
        return;
      }

      const btn = document.getElementById('pi-submit');
      UI.setLoading(btn, true);
      try {
        await API.confirmParentInvitation(token, p1);
        successBox.innerHTML = `<div class="alert alert-success">${I18N.current === 'fr'
          ? "Votre espace parent a été créé. Vous pouvez maintenant vous connecter."
          : "Your parent space has been created. You can now sign in."}</div>`;
        document.getElementById('pi-form').style.display = 'none';
        setTimeout(() => { window.location.hash = '#/login'; }, 1800);
      } catch (err) {
        errorBox.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
      } finally {
        UI.setLoading(btn, false, t('btn_create_parent_space'));
      }
    });
  },
};
