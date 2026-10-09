/**
 * SCHOOLAR — Confirmation publique de prise de fonction (section 5)
 * Accessible sans connexion via le lien reçu par email.
 */
const AdminChangeConfirmPage = {
  async render(root, params) {
    const token = params.token;
    root.innerHTML = `<div class="auth-screen"><div class="auth-panel-form"><div class="boot-spinner" style="margin:80px auto"></div></div></div>`;

    let info;
    try {
      const data = await API.adminChangeStatus(token);
      info = data.request;
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
            <div class="alert alert-info mt-24">${I18N.current === 'fr' ? 'Cette demande a déjà été traitée.' : 'This request has already been processed.'}</div>
            <a href="#/login" class="btn btn-outline btn-block mt-16">${t('back_to_login')}</a>
          </div>
        </div>`;
      return;
    }

    root.innerHTML = `
      <div class="auth-screen">
        <div class="auth-panel-form">
          <div class="logo-row"><div class="logo-box">${UI.logoSvg()}</div><div class="logo-word">${t('app_name')}</div></div>
          <div class="form-title mt-24">${t('admin_change_confirm_title')}</div>
          <div class="form-sub">${t('admin_change_confirm_subtitle')}</div>

          <div class="card mt-24">
            <div class="text-sm text-muted">${info.establishment_name}</div>
            <div style="font-weight:600;margin-top:4px;">${info.new_admin_first_name} ${info.new_admin_last_name}</div>
            <div class="text-sm text-muted">${info.new_admin_email}</div>
          </div>

          <form id="confirm-form" class="mt-24">
            <div class="field-group">
              <label class="field-label">${t('field_password')}</label>
              <div class="field-input-wrap">${UI.icon('lock')}<input type="password" id="cf-password" minlength="8" required></div>
            </div>
            <div class="field-group mt-16">
              <label class="field-label">${t('field_confirm_password')}</label>
              <div class="field-input-wrap">${UI.icon('lock')}<input type="password" id="cf-password2" minlength="8" required></div>
            </div>
            <div id="confirm-error"></div>
            <div id="confirm-success"></div>
            <div class="form-submit">
              <button type="submit" class="btn btn-primary btn-block" id="confirm-submit">${t('btn_confirm_takeover')}</button>
            </div>
          </form>
        </div>
      </div>
    `;

    document.getElementById('confirm-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorBox = document.getElementById('confirm-error');
      const successBox = document.getElementById('confirm-success');
      errorBox.innerHTML = ''; successBox.innerHTML = '';

      const p1 = document.getElementById('cf-password').value;
      const p2 = document.getElementById('cf-password2').value;
      if (p1 !== p2) {
        errorBox.innerHTML = `<div class="alert alert-error">${I18N.current === 'fr' ? 'Les mots de passe ne correspondent pas.' : 'Passwords do not match.'}</div>`;
        return;
      }

      const btn = document.getElementById('confirm-submit');
      UI.setLoading(btn, true);
      try {
        await API.confirmAdminChange(token, p1);
        successBox.innerHTML = `<div class="alert alert-success">${I18N.current === 'fr'
          ? "Confirmation reçue. Votre demande est en attente de validation par l'administration nationale SCHOOLAR."
          : "Confirmation received. Your request is pending validation by the SCHOOLAR national administration."}</div>`;
        document.getElementById('confirm-form').style.display = 'none';
      } catch (err) {
        errorBox.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
      } finally {
        UI.setLoading(btn, false, t('btn_confirm_takeover'));
      }
    });
  },
};
