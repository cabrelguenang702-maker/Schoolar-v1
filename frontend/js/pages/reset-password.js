/**
 * SCHOOLAR — Réinitialisation de mot de passe (étape 2/2)
 * Accessible sans connexion via le lien reçu par email (#/reset-password/:token).
 */
const ResetPasswordPage = {
  render(root, params) {
    const token = params.token;

    root.innerHTML = `
      <div class="auth-screen">
        <div class="auth-panel-brand">
          <div>
            <div class="auth-topbar">
              <div class="logo-row">
                <div class="logo-box">${UI.logoSvg()}</div>
                <div class="logo-word" style="color:white">${t('app_name')}</div>
              </div>
            </div>
            <div class="brand-headline">${t('brand_headline')}</div>
            <div class="brand-sub">${t('brand_sub')}</div>
          </div>
        </div>

        <div class="auth-panel-form">
          <div class="auth-topbar">
            <div class="logo-row">
              <div class="logo-box">${UI.logoSvg()}</div>
              <div class="logo-word">${t('app_name')}</div>
            </div>
          </div>

          <div class="form-title">${t('reset_password_title')}</div>
          <div class="form-sub">${t('reset_password_subtitle')}</div>

          <div id="rp-error"></div>
          <div id="rp-success"></div>

          <form id="rp-form" novalidate>
            <div class="field-group">
              <label class="field-label">${t('field_new_password')}</label>
              <div class="field-input-wrap">${UI.icon('lock')}<input type="password" id="rp-password" required minlength="8"></div>
            </div>
            <div class="field-group">
              <label class="field-label">${t('field_confirm_password')}</label>
              <div class="field-input-wrap">${UI.icon('lock')}<input type="password" id="rp-password2" required minlength="8"></div>
            </div>
            <button type="submit" class="btn btn-primary btn-block mt-16" id="rp-submit">${t('reset_password_submit')}</button>
          </form>
        </div>
      </div>
    `;

    root.querySelector('#rp-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorBox = root.querySelector('#rp-error');
      const successBox = root.querySelector('#rp-success');
      errorBox.innerHTML = '';
      successBox.innerHTML = '';

      const p1 = root.querySelector('#rp-password').value;
      const p2 = root.querySelector('#rp-password2').value;
      if (p1 !== p2) {
        errorBox.innerHTML = `<div class="alert alert-error mt-12">${I18N.current === 'fr' ? 'Les mots de passe ne correspondent pas.' : 'Passwords do not match.'}</div>`;
        return;
      }

      const btn = root.querySelector('#rp-submit');
      UI.setLoading(btn, true);
      try {
        await API.resetPassword(token, p1);
        successBox.innerHTML = `<div class="alert alert-success mt-12">${t('password_reset_success')}</div>`;
        root.querySelector('#rp-form').style.display = 'none';
        setTimeout(() => { window.location.hash = '#/login'; }, 2000);
      } catch (err) {
        errorBox.innerHTML = `<div class="alert alert-error mt-12">${err.message || 'Erreur.'}</div>`;
      } finally {
        UI.setLoading(btn, false);
      }
    });
  },
};
