/**
 * SCHOOLAR — Inscription de l'administrateur national (bootstrap, une seule fois)
 * Accessible via #/setup-national-admin. Se désactive elle-même dès qu'un
 * compte admin_national existe déjà (voir AuthController::registerNationalAdmin).
 */
const SetupNationalAdminPage = {
  state: {
    checking: true,
    available: null,
  },

  async render(root) {
    root.innerHTML = `<div class="auth-screen"><div class="auth-panel-form"><div class="boot-spinner" style="margin:60px auto;"></div></div></div>`;

    try {
      const data = await API.nationalAdminBootstrapStatus();
      this.state.available = !!data.available;
    } catch (err) {
      this.state.available = false;
    }
    this.state.checking = false;
    this.paint(root);
  },

  paint(root) {
    if (!this.state.available) {
      root.innerHTML = `
        <div class="auth-screen">
          <div class="auth-panel-form" style="margin:0 auto;">
            <div class="logo-row"><div class="logo-box">${UI.logoSvg()}</div><div class="logo-word">${t('app_name')}</div></div>
            <div class="form-title mt-24">${I18N.current === 'fr' ? 'Inscription déjà effectuée' : 'Registration already done'}</div>
            <div class="alert alert-info mt-16">${I18N.current === 'fr'
              ? "Un administrateur national existe déjà sur cette installation. Cette page d'inscription ne peut être utilisée qu'une seule fois, pour des raisons de sécurité."
              : 'A national admin already exists on this installation. This registration page can only be used once, for security reasons.'}</div>
            <a href="#/login" class="btn btn-primary btn-block mt-16">${t('back_to_login')}</a>
          </div>
        </div>
      `;
      return;
    }

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
            <div class="brand-headline">${I18N.current === 'fr' ? 'Configuration initiale' : 'Initial setup'}</div>
            <div class="brand-sub">${I18N.current === 'fr'
              ? "Créez le tout premier compte administrateur national de cette installation SCHOOLAR. Cet écran ne sera plus jamais accessible une fois ce compte créé."
              : 'Create the very first national admin account for this SCHOOLAR installation. This screen will never be reachable again once this account is created.'}</div>
          </div>
        </div>

        <div class="auth-panel-form">
          <div class="auth-topbar">
            <div class="logo-row">
              <div class="logo-box">${UI.logoSvg()}</div>
              <div class="logo-word">${t('app_name')}</div>
            </div>
          </div>

          <div class="form-title">${I18N.current === 'fr' ? 'Créer le compte administrateur national' : 'Create the national admin account'}</div>
          <div class="alert alert-info mt-8">${I18N.current === 'fr'
            ? '⚠️ Inscription à usage unique — notez précieusement ces identifiants, cet écran ne sera plus accessible ensuite.'
            : '⚠️ One-time registration — keep these credentials safe, this screen will not be reachable again.'}</div>

          <div id="sna-error"></div>
          <div id="sna-success"></div>

          <form id="sna-form" novalidate>
            <div class="grid-2 mt-16">
              <div class="field-group">
                <label class="field-label">${t('field_first_name')}</label>
                <div class="field-input-wrap"><input id="sna-fname" required></div>
              </div>
              <div class="field-group">
                <label class="field-label">${t('field_last_name')}</label>
                <div class="field-input-wrap"><input id="sna-lname" required></div>
              </div>
            </div>
            <div class="field-group mt-16">
              <label class="field-label">${t('field_email')}</label>
              <div class="field-input-wrap">${UI.icon('mail')}<input type="email" id="sna-email" required></div>
            </div>
            <div class="field-group mt-16">
              <label class="field-label">${t('field_phone')}</label>
              <div class="field-input-wrap">${UI.icon('phone')}<input id="sna-phone"></div>
            </div>
            <div class="field-group mt-16">
              <label class="field-label">${t('field_password')}</label>
              <div class="field-input-wrap">${UI.icon('lock')}<input type="password" id="sna-password" required minlength="8"></div>
            </div>
            <div class="field-group mt-16">
              <label class="field-label">${t('field_confirm_password')}</label>
              <div class="field-input-wrap">${UI.icon('lock')}<input type="password" id="sna-password2" required minlength="8"></div>
            </div>
            <button type="submit" class="btn btn-primary btn-block mt-16" id="sna-submit">${I18N.current === 'fr' ? "Créer l'administrateur national" : 'Create national admin'}</button>
          </form>

          <p class="mt-16" style="text-align:center;"><a href="#/login">${t('back_to_login')}</a></p>
        </div>
      </div>
    `;

    root.querySelector('#sna-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorBox = root.querySelector('#sna-error');
      const successBox = root.querySelector('#sna-success');
      errorBox.innerHTML = '';
      successBox.innerHTML = '';

      const p1 = root.querySelector('#sna-password').value;
      const p2 = root.querySelector('#sna-password2').value;
      if (p1 !== p2) {
        errorBox.innerHTML = `<div class="alert alert-error mt-12">${I18N.current === 'fr' ? 'Les mots de passe ne correspondent pas.' : 'Passwords do not match.'}</div>`;
        return;
      }

      const payload = {
        first_name: root.querySelector('#sna-fname').value,
        last_name: root.querySelector('#sna-lname').value,
        email: root.querySelector('#sna-email').value,
        phone: root.querySelector('#sna-phone').value,
        password: p1,
      };

      const btn = root.querySelector('#sna-submit');
      UI.setLoading(btn, true);
      try {
        await API.registerNationalAdmin(payload);
        successBox.innerHTML = `<div class="alert alert-success mt-12">${I18N.current === 'fr' ? 'Compte créé avec succès. Redirection vers la connexion...' : 'Account created successfully. Redirecting to login...'}</div>`;
        root.querySelector('#sna-form').style.display = 'none';
        setTimeout(() => { window.location.hash = '#/login'; }, 2000);
      } catch (err) {
        errorBox.innerHTML = `<div class="alert alert-error mt-12">${err.message || 'Erreur.'}</div>`;
      } finally {
        UI.setLoading(btn, false);
      }
    });
  },
};
