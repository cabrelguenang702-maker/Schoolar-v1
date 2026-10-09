/**
 * SCHOOLAR — Sécurité (section 13, 16, 20).
 * Onglet "Double authentification" : accessible à tous.
 * Onglets "Journal & alertes" et "Clés API" : réservés aux responsables
 * d'établissement (proviseur/principal/censeur) et à l'admin national.
 */
const SecurityPage = {
  state: {
    tab: '2fa',
    setupData: null,
    backupCodes: null,
    auditEntries: [],
    onlyLogins: false,
    alerts: [],
    showAcknowledged: false,
    apiKeys: [],
    newKeyPlain: null,
  },

  async render(root) {
    const user = Store.getUser();
    if (!user) { window.location.hash = '#/login'; return; }
    this.root = root;
    this.user = user;
    this.canViewAudit = ['proviseur', 'principal', 'directeur', 'censeur', 'admin_national'].includes(user.role_code);
    this.canManageKeys = ['proviseur', 'principal', 'directeur'].includes(user.role_code);

    this.paint();
  },

  paint() {
    const navItems = DashboardPage.buildNavItems(this.user).map(i => ({ ...i, active: i.href === '#/security' }));

    const tabs = [{ key: '2fa', label: t('tab_2fa') }];
    if (this.canViewAudit) tabs.push({ key: 'audit', label: t('tab_audit') });
    if (this.canManageKeys) tabs.push({ key: 'api_keys', label: t('tab_api_keys') });

    const body = `
      <h2>${t('security_title')}</h2>
      <div class="role-tabs mt-16">
        ${tabs.map(tb => `<button type="button" class="role-tab ${this.state.tab === tb.key ? 'active' : ''}" data-tab="${tb.key}">${tb.label}</button>`).join('')}
      </div>
      <div class="mt-24" id="tab-content"></div>
    `;

    const content = UI.renderShell(this.root, { user: this.user, navItems, pageBodyHtml: body });
    this.content = content;

    content.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => { this.state.tab = btn.dataset.tab; this.paint(); });
    });

    this.paintTab();
  },

  paintTab() {
    const box = this.content.querySelector('#tab-content');
    if (this.state.tab === '2fa') return this.paint2fa(box);
    if (this.state.tab === 'audit') return this.paintAudit(box);
    if (this.state.tab === 'api_keys') return this.paintApiKeys(box);
  },

  // -------------------------------------------------------------------
  // Double authentification (section 13)
  // -------------------------------------------------------------------
  paint2fa(box) {
    const enabled = this.user.totp_enabled;

    box.innerHTML = enabled ? `
      <div class="card">
        <div class="alert alert-success">${t('twofa_status_enabled')}</div>
        <p class="text-muted text-sm mt-16">${t('twofa_disable_hint')}</p>
        <div class="field-group mt-16" style="max-width:320px;">
          <label class="field-label">${t('field_password')}</label>
          <div class="field-input-wrap"><input type="password" id="twofa-disable-password"></div>
        </div>
        <button class="btn btn-outline mt-8" id="twofa-disable-btn">${t('btn_disable_2fa')}</button>
        <div id="twofa-disable-error" class="mt-8"></div>
      </div>
    ` : `
      <div class="card">
        <p class="text-muted text-sm">${t('twofa_pitch')}</p>
        <div id="twofa-setup-area" class="mt-16">
          <button class="btn btn-primary" id="twofa-start-btn">${t('btn_enable_2fa')}</button>
        </div>
      </div>
    `;

    if (enabled) {
      box.querySelector('#twofa-disable-btn').addEventListener('click', async () => {
        const password = box.querySelector('#twofa-disable-password').value;
        const errBox = box.querySelector('#twofa-disable-error');
        try {
          await API.disable2fa(password);
          this.user.totp_enabled = false;
          UI.toast(t('twofa_disabled'), 'success');
          this.paint2fa(box);
        } catch (err) {
          errBox.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
        }
      });
    } else {
      box.querySelector('#twofa-start-btn').addEventListener('click', () => this.startTwoFactorSetup(box));
    }
  },

  async startTwoFactorSetup(box) {
    const area = box.querySelector('#twofa-setup-area');
    try {
      const data = await API.setup2fa();
      this.state.setupData = data;
      area.innerHTML = `
        <p class="text-sm">${t('twofa_scan_hint')}</p>
        <div id="twofa-qr" class="mt-16" style="width:200px;height:200px;"></div>
        <p class="text-muted text-sm mt-8">${I18N.current === 'fr' ? 'Ou saisissez ce code manuellement' : 'Or enter this code manually'} : <code>${data.secret}</code></p>
        <div class="field-group mt-16" style="max-width:200px;">
          <label class="field-label">${t('field_twofa_code')}</label>
          <div class="field-input-wrap"><input type="text" id="twofa-confirm-code" inputmode="numeric" maxlength="6" placeholder="123456"></div>
        </div>
        <button class="btn btn-primary mt-8" id="twofa-confirm-btn">${t('btn_verify')}</button>
        <div id="twofa-confirm-error" class="mt-8"></div>
      `;

      if (typeof QRCode !== 'undefined') {
        new QRCode(area.querySelector('#twofa-qr'), { text: data.provisioning_uri, width: 200, height: 200 });
      } else {
        area.querySelector('#twofa-qr').outerHTML = `<p class="text-muted text-sm">${t('qr_unavailable')}</p>`;
      }

      area.querySelector('#twofa-confirm-btn').addEventListener('click', async () => {
        const code = area.querySelector('#twofa-confirm-code').value.trim();
        const errBox = area.querySelector('#twofa-confirm-error');
        try {
          const confirmData = await API.confirm2fa(code);
          this.state.backupCodes = confirmData.backup_codes;
          this.user.totp_enabled = true;
          Store.setSession(Store.getToken(), this.user);
          this.paintBackupCodes(box);
        } catch (err) {
          errBox.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
        }
      });
    } catch (err) {
      area.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
    }
  },

  paintBackupCodes(box) {
    box.innerHTML = `
      <div class="card">
        <div class="alert alert-success">${t('twofa_enabled')}</div>
        <h4 class="mt-16" style="font-size:14px;">${t('backup_codes_title')}</h4>
        <p class="text-muted text-sm mt-8">${t('backup_codes_hint')}</p>
        <div class="mt-16" style="font-family:monospace;font-size:15px;line-height:2;">
          ${this.state.backupCodes.map(c => `<div>${c}</div>`).join('')}
        </div>
      </div>
    `;
  },

  // -------------------------------------------------------------------
  // Journal des connexions/actions & alertes (section 13, 16)
  // -------------------------------------------------------------------
  async paintAudit(box) {
    box.innerHTML = `<div class="boot-spinner" style="margin:20px auto;"></div>`;
    await this.loadAlerts();
    await this.loadAuditEntries();

    box.innerHTML = `
      <h3>${t('security_alerts_title')}</h3>
      <div class="flex items-center gap-8 mt-8">
        <label class="flex items-center gap-8 text-sm"><input type="checkbox" id="show-acknowledged" ${this.state.showAcknowledged ? 'checked' : ''}> ${t('show_acknowledged')}</label>
      </div>
      <div id="alerts-list" class="mt-8"></div>

      <h3 class="mt-24">${t('audit_log_title')}</h3>
      <div class="flex items-center gap-8 mt-8">
        <label class="flex items-center gap-8 text-sm"><input type="checkbox" id="only-logins" ${this.state.onlyLogins ? 'checked' : ''}> ${t('only_logins')}</label>
      </div>
      <div id="audit-list" class="mt-8"></div>
    `;

    this.paintAlertsList(box.querySelector('#alerts-list'));
    this.paintAuditList(box.querySelector('#audit-list'));

    box.querySelector('#show-acknowledged').addEventListener('change', async (e) => {
      this.state.showAcknowledged = e.target.checked;
      await this.loadAlerts();
      this.paintAlertsList(box.querySelector('#alerts-list'));
    });
    box.querySelector('#only-logins').addEventListener('change', async (e) => {
      this.state.onlyLogins = e.target.checked;
      await this.loadAuditEntries();
      this.paintAuditList(box.querySelector('#audit-list'));
    });
  },

  async loadAlerts() {
    try {
      const data = await API.securityAlerts(this.state.showAcknowledged ? '?acknowledged=true' : '?acknowledged=false');
      this.state.alerts = data.alerts;
    } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
  },

  async loadAuditEntries() {
    try {
      const data = await API.auditLog(this.state.onlyLogins ? '?only_logins=true' : '');
      this.state.auditEntries = data.entries;
    } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
  },

  paintAlertsList(container) {
    if (!this.state.alerts.length) {
      container.innerHTML = `<p class="text-muted text-sm">${t('empty_alerts')}</p>`;
      return;
    }
    container.innerHTML = this.state.alerts.map(a => `
      <div class="card mt-8">
        <div class="flex justify-between items-start">
          <div>
            <span class="badge badge-${a.severity === 'critical' ? 'danger' : a.severity === 'warning' ? 'warning' : 'info'}">${a.severity}</span>
            <p class="mt-8 text-sm">${a.message}</p>
            <p class="text-muted text-sm mt-8">${new Date(a.created_at).toLocaleString()}</p>
          </div>
          ${!a.acknowledged_at ? `<button class="btn btn-outline btn-sm" data-ack="${a.id}">${t('btn_acknowledge')}</button>` : `<span class="badge badge-success">${I18N.current === 'fr' ? 'Traitée' : 'Handled'}</span>`}
        </div>
      </div>
    `).join('');

    container.querySelectorAll('[data-ack]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await API.acknowledgeAlert(btn.dataset.ack);
          await this.loadAlerts();
          this.paintAlertsList(container);
        } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
      });
    });
  },

  paintAuditList(container) {
    if (!this.state.auditEntries.length) {
      container.innerHTML = `<p class="text-muted text-sm">${t('empty_audit_log')}</p>`;
      return;
    }
    container.innerHTML = `<div class="card"><table style="width:100%;border-collapse:collapse;">
      <thead><tr style="text-align:left;font-size:12px;color:var(--color-text-muted);text-transform:uppercase;">
        <th style="padding:8px;">${I18N.current === 'fr' ? 'Date' : 'Date'}</th>
        <th style="padding:8px;">${I18N.current === 'fr' ? 'Utilisateur' : 'User'}</th>
        <th style="padding:8px;">${I18N.current === 'fr' ? 'Action' : 'Action'}</th>
      </tr></thead>
      <tbody>
        ${this.state.auditEntries.map(e => `
          <tr style="border-top:1px solid var(--color-border);">
            <td style="padding:8px;font-size:13px;">${new Date(e.created_at).toLocaleString()}</td>
            <td style="padding:8px;font-size:13px;">${e.first_name ? e.first_name + ' ' + e.last_name : '—'}</td>
            <td style="padding:8px;font-size:13px;">${e.action}</td>
          </tr>
        `).join('')}
      </tbody>
    </table></div>`;
  },

  // -------------------------------------------------------------------
  // Clés d'API (section 20)
  // -------------------------------------------------------------------
  async paintApiKeys(box) {
    box.innerHTML = `<div class="boot-spinner" style="margin:20px auto;"></div>`;
    try {
      const data = await API.listApiKeys();
      this.state.apiKeys = data.keys;
    } catch (err) {
      box.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
      return;
    }

    box.innerHTML = `
      <p class="text-muted text-sm">${t('api_keys_pitch')}</p>
      <div class="card mt-16">
        <div class="grid-2">
          <input id="new-key-label" placeholder="${I18N.current === 'fr' ? 'Libellé (ex: Intégration ministère)' : 'Label (e.g. Ministry integration)'}">
        </div>
        <div class="flex gap-16 mt-8" style="flex-wrap:wrap;">
          <label class="flex items-center gap-8 text-sm"><input type="checkbox" class="key-scope" value="students.read" checked> students.read</label>
          <label class="flex items-center gap-8 text-sm"><input type="checkbox" class="key-scope" value="grades.read"> grades.read</label>
          <label class="flex items-center gap-8 text-sm"><input type="checkbox" class="key-scope" value="establishment.read"> establishment.read</label>
        </div>
        <button class="btn btn-primary btn-sm mt-16" id="create-key-btn">${t('btn_create_api_key')}</button>
        <div id="new-key-result" class="mt-8"></div>
      </div>
      <div id="api-keys-list" class="mt-16"></div>
    `;

    this.paintApiKeysList(box.querySelector('#api-keys-list'));

    box.querySelector('#create-key-btn').addEventListener('click', async (e) => {
      const label = box.querySelector('#new-key-label').value.trim();
      const scopes = Array.from(box.querySelectorAll('.key-scope:checked')).map(el => el.value);
      const resultBox = box.querySelector('#new-key-result');
      if (!label) return;
      UI.setLoading(e.target, true);
      try {
        const data = await API.createApiKey({ label, scopes });
        resultBox.innerHTML = `
          <div class="alert alert-success">${t('api_key_created')}</div>
          <div class="mt-8" style="font-family:monospace;background:var(--color-bg);padding:12px;border-radius:8px;word-break:break-all;">${data.key}</div>
        `;
        box.querySelector('#new-key-label').value = '';
        const listData = await API.listApiKeys();
        this.state.apiKeys = listData.keys;
        this.paintApiKeysList(box.querySelector('#api-keys-list'));
      } catch (err) {
        resultBox.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
      } finally {
        UI.setLoading(e.target, false, t('btn_create_api_key'));
      }
    });
  },

  paintApiKeysList(container) {
    if (!this.state.apiKeys.length) {
      container.innerHTML = `<p class="text-muted text-sm">${t('empty_api_keys')}</p>`;
      return;
    }
    container.innerHTML = this.state.apiKeys.map(k => `
      <div class="card mt-8">
        <div class="flex justify-between items-center">
          <div>
            <strong>${k.label}</strong>
            <p class="text-muted text-sm mt-8">${k.key_prefix}••••••••••••••••••••</p>
            <p class="text-muted text-sm mt-8">${(JSON.parse(k.scopes) || []).join(', ')}</p>
          </div>
          ${!k.revoked_at ? `<button class="btn btn-outline btn-sm" data-revoke="${k.id}">${I18N.current === 'fr' ? 'Révoquer' : 'Revoke'}</button>` : `<span class="badge badge-neutral">${I18N.current === 'fr' ? 'Révoquée' : 'Revoked'}</span>`}
        </div>
      </div>
    `).join('');

    container.querySelectorAll('[data-revoke]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await API.revokeApiKey(btn.dataset.revoke);
          const listData = await API.listApiKeys();
          this.state.apiKeys = listData.keys;
          this.paintApiKeysList(container);
        } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
      });
    });
  },
};
