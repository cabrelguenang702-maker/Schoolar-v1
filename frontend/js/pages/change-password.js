/**
 * SCHOOLAR — Changement de mot de passe obligatoire
 * Affiché automatiquement après connexion si must_change_password = true
 * (comptes créés par un administrateur avec un mot de passe temporaire — section 6).
 */
const ChangePasswordPage = {
  render(root) {
    const user = Store.getUser();
    if (!user) { window.location.hash = '#/login'; return; }

    root.innerHTML = `
      <div class="auth-screen">
        <div class="auth-panel-form">
          <div class="logo-row"><div class="logo-box">${UI.logoSvg()}</div><div class="logo-word">${t('app_name')}</div></div>
          <div class="alert alert-info mt-24">${t('must_change_password_banner')}</div>

          <form id="pwd-form" class="mt-16">
            <div class="field-group">
              <label class="field-label">${t('field_current_password')}</label>
              <div class="field-input-wrap">${UI.icon('lock')}<input type="password" id="pwd-current" required></div>
            </div>
            <div class="field-group mt-16">
              <label class="field-label">${t('field_new_password')}</label>
              <div class="field-input-wrap">${UI.icon('lock')}<input type="password" id="pwd-new" minlength="8" required></div>
            </div>
            <div class="field-group mt-16">
              <label class="field-label">${t('field_confirm_password')}</label>
              <div class="field-input-wrap">${UI.icon('lock')}<input type="password" id="pwd-new2" minlength="8" required></div>
            </div>
            <div id="pwd-error"></div>
            <div class="form-submit">
              <button type="submit" class="btn btn-primary btn-block" id="pwd-submit">${t('btn_update_password')}</button>
            </div>
          </form>
        </div>
      </div>
    `;

    root.querySelector('#pwd-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorBox = root.querySelector('#pwd-error');
      errorBox.innerHTML = '';

      const current = root.querySelector('#pwd-current').value;
      const p1 = root.querySelector('#pwd-new').value;
      const p2 = root.querySelector('#pwd-new2').value;

      if (p1 !== p2) {
        errorBox.innerHTML = `<div class="alert alert-error">${I18N.current === 'fr' ? 'Les mots de passe ne correspondent pas.' : 'Passwords do not match.'}</div>`;
        return;
      }

      const btn = root.querySelector('#pwd-submit');
      UI.setLoading(btn, true);
      try {
        await API.changePassword(current, p1);
        const updatedUser = { ...user, must_change_password: false };
        Store.setSession(Store.getToken(), updatedUser);
        UI.toast(I18N.current === 'fr' ? 'Mot de passe mis à jour.' : 'Password updated.', 'success');
        window.location.hash = '#/dashboard';
      } catch (err) {
        errorBox.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
      } finally {
        UI.setLoading(btn, false, t('btn_update_password'));
      }
    });
  },
};
