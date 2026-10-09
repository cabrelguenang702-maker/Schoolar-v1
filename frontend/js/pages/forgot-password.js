/**
 * SCHOOLAR — Mot de passe oublié (étape 1/2 : demande du lien par email)
 */
const ForgotPasswordPage = {
  render(root) {
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
            <div class="lang-switch">
              <button data-lang="fr" class="${I18N.current === 'fr' ? 'active' : ''}">FR</button>
              <button data-lang="en" class="${I18N.current === 'en' ? 'active' : ''}">EN</button>
            </div>
          </div>

          <div class="form-title">${t('forgot_password_title')}</div>
          <div class="form-sub">${t('forgot_password_subtitle')}</div>

          <div id="fp-error"></div>
          <div id="fp-success"></div>

          <form id="fp-form" novalidate>
            <div class="field-group">
              <label class="field-label">${t('field_email')}</label>
              <div class="field-input-wrap">${UI.icon('mail')}<input type="email" id="fp-email" required></div>
            </div>
            <button type="submit" class="btn btn-primary btn-block mt-16" id="fp-submit">${t('forgot_password_submit')}</button>
          </form>

          <p class="mt-16" style="text-align:center;"><a href="#/login">${t('back_to_login')}</a></p>
        </div>
      </div>
    `;

    root.querySelectorAll('.lang-switch button').forEach(btn => {
      btn.addEventListener('click', () => { I18N.setLocale(btn.dataset.lang); this.render(root); });
    });

    root.querySelector('#fp-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorBox = root.querySelector('#fp-error');
      const successBox = root.querySelector('#fp-success');
      errorBox.innerHTML = '';
      successBox.innerHTML = '';
      const email = root.querySelector('#fp-email').value.trim();
      if (!email) return;

      const btn = root.querySelector('#fp-submit');
      UI.setLoading(btn, true);
      try {
        await API.forgotPassword(email);
        successBox.innerHTML = `<div class="alert alert-success mt-12">${t('password_reset_email_sent')}</div>`;
        root.querySelector('#fp-form').style.display = 'none';
      } catch (err) {
        errorBox.innerHTML = `<div class="alert alert-error mt-12">${err.message || 'Erreur.'}</div>`;
      } finally {
        UI.setLoading(btn, false);
      }
    });
  },
};
