/**
 * SCHOOLAR — Inscription d'un établissement
 * Section 4.1 : formulaire détaillé établissement + identifiants administrateur.
 */
const RegisterEstablishmentPage = {
  regions: [
    'Adamaoua', 'Centre', 'Est', 'Extrême-Nord', 'Littoral',
    'Nord', 'Nord-Ouest', 'Ouest', 'Sud', 'Sud-Ouest',
  ],

  state: {
    educationLevel: 'secondaire',
    sector: 'public',
  },

  render(root) {
    root.innerHTML = `
      <div class="auth-screen" style="align-items:flex-start;">
        <div class="wide-card">
          <div class="auth-topbar">
            <div class="logo-row">
              <div class="logo-box">${UI.logoSvg()}</div>
              <div class="logo-word">${t('app_name')}</div>
            </div>
            <a href="#/login" class="btn btn-outline btn-sm">${t('back_to_login')}</a>
          </div>

          <div class="form-title">${t('register_title')}</div>
          <div class="form-sub">${t('register_subtitle')}</div>

          <form id="register-form" novalidate>
            <!-- Piège anti-bot : invisible pour un humain (position hors-écran,
                 pas juste display:none, pour tromper aussi les bots un peu
                 plus sophistiqués), jamais rempli par une vraie personne. -->
            <div style="position:absolute; left:-9999px; top:-9999px;" aria-hidden="true">
              <label for="f-website">Site web (ne pas remplir)</label>
              <input type="text" id="f-website" name="website" tabindex="-1" autocomplete="off">
            </div>
            <div class="section-heading"><span class="step-num">1</span><h3>${t('section_establishment')}</h3></div>

            <div class="field-group">
              <label class="field-label">${t('field_education_level')}</label>
              <div class="role-tabs">
                <button type="button" class="role-tab ${this.state.educationLevel === 'secondaire' ? 'active' : ''}" data-elevel="secondaire">${t('education_level_secondaire')}</button>
                <button type="button" class="role-tab ${this.state.educationLevel === 'primaire' ? 'active' : ''}" data-elevel="primaire">${t('education_level_primaire')}</button>
              </div>
              <p class="text-muted text-sm mt-8">${this.state.educationLevel === 'primaire' ? t('education_level_primaire_hint') : t('education_level_secondaire_hint')}</p>
            </div>

            <div class="field-group mt-16">
              <label class="field-label">${t('field_sector')}</label>
              <div class="field-input-wrap">
                <select id="f-sector">
                  <option value="public" ${this.state.sector === 'public' ? 'selected' : ''}>${t('sector_public')}</option>
                  <option value="prive" ${this.state.sector === 'prive' ? 'selected' : ''}>${t('sector_prive')}</option>
                </select>
              </div>
            </div>

            <div class="field-group mt-16">
              <label class="field-label">${t('field_name')}</label>
              <div class="field-input-wrap">${UI.icon('building')}<input id="f-name" required></div>
            </div>
            <div class="grid-2 mt-16">
              ${this.state.educationLevel === 'secondaire' ? `
              <div class="field-group">
                <label class="field-label">${t('field_type')}</label>
                <div class="field-input-wrap">
                  <select id="f-etype">
                    <option value="college">${t('college')}</option>
                    <option value="lycee">${t('lycee')}</option>
                  </select>
                </div>
              </div>
              <div class="field-group">
                <label class="field-label">${t('field_teaching_type')}</label>
                <div class="field-input-wrap">
                  <select id="f-ttype">
                    <option value="general">${t('general')}</option>
                    <option value="technique">${t('technique')}</option>
                  </select>
                </div>
              </div>
              ` : ''}
            </div>
            <div class="field-group mt-16">
              <label class="field-label">${t('field_linguistic')}</label>
              <div class="field-input-wrap">
                <select id="f-lsys">
                  <option value="francophone">${t('francophone')}</option>
                  <option value="anglophone">${t('anglophone')}</option>
                  <option value="bilingue">${t('bilingue')}</option>
                </select>
              </div>
            </div>
            <div class="grid-2 mt-16">
              <div class="field-group">
                <label class="field-label">${t('field_region')}</label>
                <div class="field-input-wrap">
                  <select id="f-region">${this.regions.map(r => `<option value="${r}">${r}</option>`).join('')}</select>
                </div>
              </div>
              <div class="field-group">
                <label class="field-label">${t('field_department')}</label>
                <div class="field-input-wrap"><input id="f-department" required></div>
              </div>
            </div>
            <div class="grid-2 mt-16">
              <div class="field-group">
                <label class="field-label">${t('field_arrondissement')}</label>
                <div class="field-input-wrap"><input id="f-arrondissement" required></div>
              </div>
              <div class="field-group">
                <label class="field-label">${t('field_quartier')}</label>
                <div class="field-input-wrap"><input id="f-quartier"></div>
              </div>
            </div>
            <div class="field-group mt-16">
              <label class="field-label">${t('field_address')}</label>
              <div class="field-input-wrap"><input id="f-address"></div>
            </div>
            <div class="grid-2 mt-16">
              <div class="field-group">
                <label class="field-label">${t('field_phone')}</label>
                <div class="field-input-wrap"><input id="f-phone" required></div>
              </div>
              <div class="field-group">
                <label class="field-label">${t('field_email')}</label>
                <div class="field-input-wrap">${UI.icon('mail')}<input type="email" id="f-email" required></div>
              </div>
            </div>

            <div class="section-heading"><span class="step-num">2</span><h3>${t('section_admin')}</h3></div>
            <div class="field-group">
              <label class="field-label">${t('field_admin_role')}</label>
              <div class="field-input-wrap">
                <select id="f-admin-role">
                  ${this.state.educationLevel === 'primaire'
                    ? `<option value="directeur">${t('directeur')}</option>`
                    : `<option value="proviseur">Proviseur (Lycée)</option><option value="principal">Principal (Collège)</option>`
                  }
                </select>
              </div>
            </div>
            <div class="grid-2 mt-16">
              <div class="field-group">
                <label class="field-label">${t('field_first_name')}</label>
                <div class="field-input-wrap"><input id="f-admin-fname" required></div>
              </div>
              <div class="field-group">
                <label class="field-label">${t('field_last_name')}</label>
                <div class="field-input-wrap"><input id="f-admin-lname" required></div>
              </div>
            </div>
            <div class="field-group mt-16">
              <label class="field-label">${t('field_email')}</label>
              <div class="field-input-wrap">${UI.icon('mail')}<input type="email" id="f-admin-email" required></div>
            </div>
            <div class="field-group mt-16">
              <label class="field-label">${t('field_admin_phone')}</label>
              <div class="field-input-wrap">${UI.icon('phone')}<input type="tel" id="f-admin-phone" placeholder="6XX XXX XXX" required></div>
              <p class="text-muted text-sm mt-8">${t('field_admin_phone_hint')}</p>
            </div>
            <div class="grid-2 mt-16">
              <div class="field-group">
                <label class="field-label">${t('field_password')}</label>
                <div class="field-input-wrap">${UI.icon('lock')}<input type="password" id="f-admin-password" minlength="8" required></div>
              </div>
              <div class="field-group">
                <label class="field-label">${t('field_confirm_password')}</label>
                <div class="field-input-wrap">${UI.icon('lock')}<input type="password" id="f-admin-password2" minlength="8" required></div>
              </div>
            </div>

            <div id="register-error"></div>
            <div id="register-success"></div>

            <div class="form-submit">
              <button type="submit" class="btn btn-primary btn-block" id="register-submit">${t('btn_submit_registration')}</button>
            </div>
          </form>
        </div>
      </div>
    `;

    root.querySelectorAll('[data-elevel]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.state.educationLevel = btn.dataset.elevel;
        this.render(root);
      });
    });

    root.querySelector('#register-form').addEventListener('submit', (e) => this.handleSubmit(e, root));
  },

  async handleSubmit(e, root) {
    e.preventDefault();
    const errorBox = root.querySelector('#register-error');
    const successBox = root.querySelector('#register-success');
    errorBox.innerHTML = '';
    successBox.innerHTML = '';

    const password = root.querySelector('#f-admin-password').value;
    const password2 = root.querySelector('#f-admin-password2').value;
    if (password !== password2) {
      errorBox.innerHTML = `<div class="alert alert-error">${I18N.current === 'fr' ? 'Les mots de passe ne correspondent pas.' : 'Passwords do not match.'}</div>`;
      return;
    }

    const payload = {
      name: root.querySelector('#f-name').value,
      education_level: this.state.educationLevel,
      sector: root.querySelector('#f-sector').value,
      establishment_type: root.querySelector('#f-etype')?.value,
      teaching_type: root.querySelector('#f-ttype')?.value,
      linguistic_system: root.querySelector('#f-lsys').value,
      region: root.querySelector('#f-region').value,
      department: root.querySelector('#f-department').value,
      arrondissement: root.querySelector('#f-arrondissement').value,
      quartier: root.querySelector('#f-quartier').value,
      address: root.querySelector('#f-address').value,
      phone: root.querySelector('#f-phone').value,
      email: root.querySelector('#f-email').value,
      admin_role: root.querySelector('#f-admin-role').value,
      admin_first_name: root.querySelector('#f-admin-fname').value,
      admin_last_name: root.querySelector('#f-admin-lname').value,
      admin_email: root.querySelector('#f-admin-email').value,
      admin_phone: root.querySelector('#f-admin-phone').value,
      admin_password: password,
      // Piège anti-bot invisible (voir champ #f-website ci-dessous, masqué en CSS) :
      // un humain ne le remplit jamais, un robot de spam le fait souvent.
      website: root.querySelector('#f-website')?.value || '',
    };

    const submitBtn = root.querySelector('#register-submit');
    UI.setLoading(submitBtn, true);

    try {
      const data = await API.registerEstablishment(payload);
      successBox.innerHTML = `
        <div class="alert alert-success">
          <div>
            <strong>${t('registration_success_title')}</strong><br>
            ${t('registration_success_body')} <strong>${data.establishment_code}</strong>.<br>
            <span class="text-sm">${t('registration_success_note')}</span>
          </div>
        </div>`;
      root.querySelector('#register-form').reset();
      root.querySelector('#register-form').style.display = 'none';
      this.renderVerificationStep(root, data.admin_email, data.establishment_code);
    } catch (err) {
      errorBox.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
    } finally {
      UI.setLoading(submitBtn, false, t('btn_submit_registration'));
    }
  },

  renderVerificationStep(root, email, establishmentCode) {
    const container = root.querySelector('.auth-panel-form') || root.querySelector('#register-success').parentElement;
    const box = document.createElement('div');
    box.className = 'card mt-16';
    box.innerHTML = `
      <h3>${t('verify_account_title')}</h3>
      <p class="text-muted text-sm mt-8">${t('verify_account_subtitle')}</p>
      <div class="field-group mt-16" style="max-width:220px;">
        <label class="field-label">${t('field_twofa_code')}</label>
        <div class="field-input-wrap"><input type="text" id="verify-code-input" inputmode="numeric" maxlength="6" placeholder="123456"></div>
      </div>
      <div id="verify-code-error" class="mt-8"></div>
      <div id="verify-code-success" class="mt-8"></div>
      <div class="flex gap-8 mt-16">
        <button class="btn btn-primary" id="verify-code-submit">${t('btn_verify')}</button>
        <button class="btn btn-outline" id="verify-code-resend">${t('btn_resend_code')}</button>
      </div>
    `;
    container.appendChild(box);

    box.querySelector('#verify-code-submit').addEventListener('click', async () => {
      const code = box.querySelector('#verify-code-input').value.trim();
      const errBox = box.querySelector('#verify-code-error');
      const okBox = box.querySelector('#verify-code-success');
      errBox.innerHTML = ''; okBox.innerHTML = '';
      try {
        await API.verifyAccount({ email, establishment_code: establishmentCode, code });
        okBox.innerHTML = `<div class="alert alert-success">${t('verify_account_success')}</div>`;
        box.querySelector('#verify-code-submit').disabled = true;
        box.querySelector('#verify-code-resend').style.display = 'none';
        setTimeout(() => { window.location.hash = '#/login'; }, 2000);
      } catch (err) {
        errBox.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
      }
    });

    box.querySelector('#verify-code-resend').addEventListener('click', async (e) => {
      const errBox = box.querySelector('#verify-code-error');
      const okBox = box.querySelector('#verify-code-success');
      errBox.innerHTML = ''; okBox.innerHTML = '';
      UI.setLoading(e.target, true);
      try {
        await API.resendVerificationCode({ email, establishment_code: establishmentCode });
        okBox.innerHTML = `<div class="alert alert-info">${t('account_verification_code_resent')}</div>`;
      } catch (err) {
        errBox.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
      } finally {
        UI.setLoading(e.target, false, t('btn_resend_code'));
      }
    });
  },
};
