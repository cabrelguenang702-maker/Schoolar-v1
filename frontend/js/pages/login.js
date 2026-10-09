/**
 * SCHOOLAR — Écran de connexion
 * Reproduit fidèlement la maquette : logo, onglets de rôle, champs avec
 * icônes, sélecteur d'établissement, bouton principal, comptes de démo.
 */
const LoginPage = {
  state: {
    role: 'eleve',
    showPassword: false,
    establishments: [],
    loadingEstablishments: false,
  },

  roles: [
    { code: 'eleve', key: 'role_student', roleScope: 'establishment' },
    { code: 'parent', key: 'role_parent', roleScope: 'family' },
    { code: 'enseignant', key: 'role_teacher', roleScope: 'establishment' },
    { code: 'admin', key: 'role_admin', roleScope: 'establishment' }, // regroupe staff/direction d'établissement
    { code: 'admin_national', key: 'role_admin_national', roleScope: 'national' }, // super-admin plateforme SCHOOLAR
  ],

  demoAccounts: [
    { role_key: 'role_admin_national', email: 'admin@schoolar.cm', password: 'ChangeMoi#2026' },
  ],

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
          <div class="brand-stats">
            <div class="brand-stat"><b>4 000+</b><span>${t('stat_establishments')}</span></div>
            <div class="brand-stat"><b>1M+</b><span>${t('stat_students')}</span></div>
            <div class="brand-stat"><b>24/7</b><span>${t('stat_notifications')}</span></div>
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

          <div class="form-title">${t('login_title')}</div>
          <div class="form-sub">${t('login_subtitle')}</div>

          <div class="role-tabs" id="role-tabs">
            ${this.roles.map(r => `
              <button type="button" class="role-tab ${this.state.role === r.code ? 'active' : ''}" data-role="${r.code}">
                ${this.state.role === r.code ? '✓ ' : ''}${t(r.key)}
              </button>
            `).join('')}
          </div>

          <form id="login-form" novalidate>
            <div class="field-group">
              <label class="field-label">${this.state.role === 'eleve' ? (I18N.current === 'fr' ? 'Matricule' : 'Matricule') : t('field_email')}</label>
              <div class="field-input-wrap">
                ${UI.icon('mail')}
                <input type="${this.state.role === 'eleve' ? 'text' : 'email'}" id="login-email" placeholder="${this.emailPlaceholder()}" autocomplete="username" required>
              </div>
            </div>

            <div class="field-group">
              <label class="field-label">${t('field_password')}</label>
              <div class="field-input-wrap">
                ${UI.icon('lock')}
                <input type="password" id="login-password" placeholder="••••••••••••" autocomplete="current-password" required>
                <button type="button" class="field-toggle-visibility" id="toggle-password">${UI.icon('eye')}</button>
              </div>
              <div style="text-align:right;margin-top:6px;">
                <a href="#/forgot-password" style="font-size:13px;">${t('forgot_password_link')}</a>
              </div>
            </div>

            <div class="field-group" id="establishment-field-wrap" ${this.state.role === 'admin_national' ? 'style="display:none"' : ''}>
              <label class="field-label">${t('field_establishment')}</label>
              <div class="field-input-wrap">
                ${UI.icon('building')}
                <select id="login-establishment">
                  <option value="">${t('field_establishment_placeholder')}</option>
                </select>
                ${UI.icon('chevronDown', 16)}
              </div>
            </div>

            <div id="login-error"></div>

            <div class="form-submit">
              <button type="submit" class="btn btn-primary btn-block" id="login-submit">${t('btn_login')}</button>
            </div>
          </form>

          <div class="form-footnote">
            ${this.state.role === 'admin_national'
              ? `<a href="#/setup-national-admin">${I18N.current === 'fr' ? "Première utilisation ? Configurer l'administrateur national" : 'First time? Set up the national admin'}</a>`
              : `${t('no_account')} <a href="#/register-establishment">${t('register_link')}</a>`
            }
          </div>

          <div class="demo-box">
            <div class="demo-box-title">${UI.icon('info', 15)} ${t('demo_accounts')}</div>
            ${this.demoAccounts.map(d => `
              <div class="demo-row">
                <span class="demo-role">${t(d.role_key)}</span>
                <span class="demo-email">${d.email}</span>
                <button type="button" class="btn btn-secondary btn-sm demo-use-btn" data-role="admin_national" data-email="${d.email}" data-password="${d.password}">${t('demo_use')}</button>
              </div>
            `).join('')}
          </div>

          <p class="mt-16 text-muted text-sm" style="text-align:center;">
            <a href="#/legal/mentions">${I18N.current === 'fr' ? 'Mentions légales' : 'Legal notice'}</a>
            ·
            <a href="#/legal/cgu">${I18N.current === 'fr' ? "CGU" : 'Terms'}</a>
            ·
            <a href="#/legal/confidentialite">${I18N.current === 'fr' ? 'Confidentialité' : 'Privacy'}</a>
          </p>
        </div>
      </div>
    `;

    this.attachEvents(root);
    this.loadEstablishments();
  },

  emailPlaceholder() {
    const map = { eleve: 'EL260123', parent: 'parent@schoolar.cm', enseignant: 'prof@schoolar.cm', admin: 'admin@cobiebaf.cm', admin_national: 'admin@schoolar.cm' };
    return map[this.state.role] || 'email@schoolar.cm';
  },

  attachEvents(root) {
    root.querySelectorAll('[data-lang]').forEach(btn => {
      btn.addEventListener('click', () => { I18N.setLang(btn.dataset.lang); this.render(root); });
    });

    root.querySelectorAll('[data-role]').forEach(btn => {
      btn.addEventListener('click', () => { this.state.role = btn.dataset.role; this.render(root); });
    });

    const togglePwd = root.querySelector('#toggle-password');
    togglePwd.addEventListener('click', () => {
      const input = root.querySelector('#login-password');
      this.state.showPassword = !this.state.showPassword;
      input.type = this.state.showPassword ? 'text' : 'password';
      togglePwd.innerHTML = UI.icon(this.state.showPassword ? 'eyeOff' : 'eye');
    });

    root.querySelectorAll('.demo-use-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.role && btn.dataset.role !== this.state.role) {
          this.state.role = btn.dataset.role;
          this.render(root);
        }
        root.querySelector('#login-email').value = btn.dataset.email;
        root.querySelector('#login-password').value = btn.dataset.password;
        UI.toast(I18N.current === 'fr'
          ? 'Identifiants de démonstration insérés. Connectez-vous directement (aucun établissement à sélectionner pour ce compte).'
          : 'Demo credentials filled in. Sign in directly (no establishment to select for this account).');
      });
    });

    root.querySelector('#login-form').addEventListener('submit', (e) => this.handleSubmit(e, root));
  },

  async loadEstablishments() {
    const select = document.getElementById('login-establishment');
    if (!select) return;
    try {
      // Un élève ne peut se connecter qu'à un établissement du secondaire
      // (voir field_education_level) — on filtre la liste en conséquence
      // pour éviter qu'il ne sélectionne par erreur une école primaire, où
      // aucun compte élève ne peut de toute façon exister.
      const filter = this.state.role === 'eleve' ? 'secondaire' : null;
      const data = await API.searchEstablishments('', filter);
      this.state.establishments = data.establishments || [];
      select.innerHTML = `<option value="">${t('field_establishment_placeholder')}</option>` +
        this.state.establishments.map(e => `<option value="${e.code}">${e.name} — ${e.region}</option>`).join('');
    } catch (err) {
      // Silencieux : la liste peut être vide en tout début de projet (aucun établissement validé encore)
    }
  },

  async handleSubmit(e, root) {
    e.preventDefault();
    const errorBox = root.querySelector('#login-error');
    errorBox.innerHTML = '';

    const email = root.querySelector('#login-email').value.trim();
    const password = root.querySelector('#login-password').value;
    const establishmentCode = root.querySelector('#login-establishment') ? root.querySelector('#login-establishment').value : null;

    if (!email || !password) {
      errorBox.innerHTML = `<div class="alert alert-error">${I18N.current === 'fr' ? 'Veuillez renseigner votre email et votre mot de passe.' : 'Please enter your email and password.'}</div>`;
      return;
    }

    const submitBtn = root.querySelector('#login-submit');
    UI.setLoading(submitBtn, true);

    try {
      const data = await API.login({ email, password, establishment_code: establishmentCode || undefined });
      if (data.needs_verification) {
        this.renderAccountVerificationStep(root, data.email, data.establishment_code);
        return;
      }
      if (data.requires_2fa) {
        this.render2faStep(root, data.challenge_token);
        return;
      }
      Store.setSession(data.token, data.user);
      UI.toast(I18N.current === 'fr' ? 'Connexion réussie.' : 'Signed in successfully.', 'success');
      window.location.hash = '#/dashboard';
    } catch (err) {
      errorBox.innerHTML = `<div class="alert alert-error">${err.message || (I18N.current === 'fr' ? 'Erreur de connexion.' : 'Sign-in error.')}</div>`;
    } finally {
      UI.setLoading(submitBtn, false, t('btn_login'));
    }
  },

  renderAccountVerificationStep(root, email, establishmentCode) {
    const panel = root.querySelector('.auth-panel-form');
    panel.innerHTML = `
      <div class="form-title">${t('verify_account_title')}</div>
      <div class="form-sub">${t('verify_account_login_subtitle')}</div>
      <form id="verify-account-form" class="mt-16">
        <div class="field-group">
          <label class="field-label">${t('field_twofa_code')}</label>
          <div class="field-input-wrap"><input type="text" id="verify-account-code" inputmode="numeric" maxlength="6" placeholder="123456" autofocus></div>
        </div>
        <div id="verify-account-error"></div>
        <div id="verify-account-success"></div>
        <div class="form-submit">
          <button type="submit" class="btn btn-primary btn-block" id="verify-account-submit">${t('btn_verify')}</button>
        </div>
        <button type="button" class="btn btn-outline btn-block mt-8" id="verify-account-resend">${t('btn_resend_code')}</button>
      </form>
    `;

    panel.querySelector('#verify-account-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorBox = panel.querySelector('#verify-account-error');
      errorBox.innerHTML = '';
      const code = panel.querySelector('#verify-account-code').value.trim();
      const btn = panel.querySelector('#verify-account-submit');
      UI.setLoading(btn, true);
      try {
        await API.verifyAccount({ email, establishment_code: establishmentCode, code });
        panel.querySelector('#verify-account-success').innerHTML = `<div class="alert alert-success">${t('verify_account_success')}</div>`;
        setTimeout(() => { window.location.hash = '#/login'; window.location.reload(); }, 1500);
      } catch (err) {
        errorBox.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
        UI.setLoading(btn, false, t('btn_verify'));
      }
    });

    panel.querySelector('#verify-account-resend').addEventListener('click', async (e) => {
      const errorBox = panel.querySelector('#verify-account-error');
      errorBox.innerHTML = '';
      UI.setLoading(e.target, true);
      try {
        await API.resendVerificationCode({ email, establishment_code: establishmentCode });
        panel.querySelector('#verify-account-success').innerHTML = `<div class="alert alert-info">${t('account_verification_code_resent')}</div>`;
      } catch (err) {
        errorBox.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
      } finally {
        UI.setLoading(e.target, false, t('btn_resend_code'));
      }
    });
  },

  render2faStep(root, challengeToken) {
    const panel = root.querySelector('.auth-panel-form');
    panel.innerHTML = `
      <div class="form-title">${t('twofa_title')}</div>
      <div class="form-sub">${t('twofa_subtitle')}</div>
      <form id="twofa-form" class="mt-16">
        <div class="field-group">
          <label class="field-label">${t('field_twofa_code')}</label>
          <div class="field-input-wrap"><input type="text" id="twofa-code" inputmode="numeric" maxlength="8" placeholder="123456" autofocus></div>
        </div>
        <div id="twofa-error"></div>
        <div class="form-submit">
          <button type="submit" class="btn btn-primary btn-block" id="twofa-submit">${t('btn_verify')}</button>
        </div>
      </form>
    `;

    panel.querySelector('#twofa-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorBox = panel.querySelector('#twofa-error');
      errorBox.innerHTML = '';
      const code = panel.querySelector('#twofa-code').value.trim();
      const btn = panel.querySelector('#twofa-submit');
      UI.setLoading(btn, true);
      try {
        const data = await API.login2fa(challengeToken, code);
        Store.setSession(data.token, data.user);
        UI.toast(I18N.current === 'fr' ? 'Connexion réussie.' : 'Signed in successfully.', 'success');
        window.location.hash = '#/dashboard';
      } catch (err) {
        errorBox.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
        UI.setLoading(btn, false, t('btn_verify'));
      }
    });
  },
};
