/**
 * SCHOOLAR — Paiements (section 24 : frais de scolarité, section 27 : modèle
 * économique). Réservé au personnel avec la permission payments.manage
 * (proviseur, principal, économe, comptable).
 */
const PaymentsPage = {
  state: {
    tab: 'fees',
    schoolYears: [],
    feeStructures: [],
    invoices: [],
    invoiceStatusFilter: '',
    showFeeForm: false,
    expandedInvoiceId: null,
    expandedInvoiceDetail: null,
  },

  async render(root) {
    const user = Store.getUser();
    if (!user) { window.location.hash = '#/login'; return; }
    this.root = root;
    this.user = user;

    await this.loadSchoolYears();
    await this.loadFeeStructures();
    this.paint();
  },

  async loadSchoolYears() {
    try {
      const data = await API.listSchoolYears();
      this.state.schoolYears = data.school_years;
    } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
  },

  async loadFeeStructures() {
    try {
      const data = await API.listFeeStructures();
      this.state.feeStructures = data.fee_structures;
    } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
  },

  async loadInvoices() {
    try {
      const qs = this.state.invoiceStatusFilter ? `?status=${this.state.invoiceStatusFilter}` : '';
      const data = await API.listInvoices(qs);
      this.state.invoices = data.invoices;
    } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
  },

  paint() {
    const navItems = DashboardPage.buildNavItems(this.user).map(i => ({ ...i, active: i.href === '#/payments' }));

    const tabs = [
      { key: 'fees', label: t('tab_fee_structures') },
      { key: 'invoices', label: t('tab_invoices') },
    ];

    const body = `
      <div class="flex justify-between items-center" style="flex-wrap:wrap;gap:12px;">
        <div>
          <h2>${t('payments_title')}</h2>
          <p class="text-muted text-sm mt-8">${t('payments_subtitle')}</p>
        </div>
        <div class="flex gap-8">
          <a class="btn btn-outline" href="${API.exportUrl('/export/payments', 'csv')}">${t('btn_export_csv')}</a>
          <a class="btn btn-outline" href="${API.exportUrl('/export/payments', 'xlsx')}">${t('btn_export_xlsx')}</a>
          <a class="btn btn-outline" href="${API.exportUrl('/export/payments', 'pdf')}">${t('btn_export_pdf')}</a>
        </div>
      </div>

      <div class="role-tabs mt-16">
        ${tabs.map(tb => `<button type="button" class="role-tab ${this.state.tab === tb.key ? 'active' : ''}" data-tab="${tb.key}">${tb.label}</button>`).join('')}
      </div>
      <div class="mt-24" id="tab-content"></div>
    `;

    const content = UI.renderShell(this.root, { user: this.user, navItems, pageBodyHtml: body });
    this.content = content;

    content.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', async () => {
        this.state.tab = btn.dataset.tab;
        if (this.state.tab === 'invoices') await this.loadInvoices();
        this.paintTab();
      });
    });

    this.paintTab();
  },

  paintTab() {
    const box = this.content.querySelector('#tab-content');
    if (this.state.tab === 'fees') return this.paintFeesTab(box);
    if (this.state.tab === 'invoices') return this.paintInvoicesTab(box);
  },

  // -------------------------------------------------------------------
  // Onglet : frais de scolarité (modèles)
  // -------------------------------------------------------------------
  paintFeesTab(box) {
    box.innerHTML = `
      <div class="flex justify-between items-center">
        <div></div>
        <button class="btn btn-primary" id="btn-new-fee">${t('btn_new_fee')}</button>
      </div>
      <div id="fee-form-container"></div>
      <div id="fee-list-container" class="mt-16"></div>
    `;

    box.querySelector('#btn-new-fee').addEventListener('click', () => {
      this.state.showFeeForm = true;
      this.paintFeeForm();
    });

    this.paintFeeList(box.querySelector('#fee-list-container'));
  },

  paintFeeForm() {
    const container = this.content.querySelector('#fee-form-container');
    if (!this.state.showFeeForm) { container.innerHTML = ''; return; }

    const currentYear = this.state.schoolYears.find(y => y.is_current) || this.state.schoolYears[0];

    container.innerHTML = `
      <div class="card mt-16" style="max-width:640px;">
        <h3>${t('btn_new_fee')}</h3>
        <form id="fee-form" class="mt-16">
          <div class="field-group">
            <label class="field-label">${t('field_school_year')}</label>
            <div class="field-input-wrap">
              <select id="fee-year">
                ${this.state.schoolYears.map(y => `<option value="${y.id}" ${currentYear && y.id === currentYear.id ? 'selected' : ''}>${y.label}${y.is_current ? ' ★' : ''}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="field-group">
            <label class="field-label">${t('field_title')}</label>
            <div class="field-input-wrap"><input id="fee-label" placeholder="${I18N.current === 'fr' ? "Ex: Frais d'inscription" : 'Ex: Registration fee'}" required></div>
          </div>
          <div class="grid-2 mt-16">
            <div class="field-group">
              <label class="field-label">${t('field_level')} (${t('none_option').toLowerCase()} = ${I18N.current === 'fr' ? "tout l'établissement" : 'whole school'})</label>
              <div class="field-input-wrap"><input id="fee-level" placeholder="Ex: 6e, Terminale"></div>
            </div>
            <div class="field-group">
              <label class="field-label">${t('field_series')}</label>
              <div class="field-input-wrap"><input id="fee-series" placeholder="Ex: C, D"></div>
            </div>
          </div>
          <div class="grid-2 mt-16">
            <div class="field-group">
              <label class="field-label">${t('field_amount')} (FCFA)</label>
              <div class="field-input-wrap"><input type="number" min="1" id="fee-amount" required></div>
            </div>
            <div class="field-group">
              <label class="field-label">${t('field_due_date')}</label>
              <div class="field-input-wrap"><input type="date" id="fee-due"></div>
            </div>
          </div>
          <div id="fee-form-error"></div>
          <div id="fee-form-success"></div>
          <div class="flex gap-8 mt-24">
            <button type="submit" class="btn btn-primary" id="fee-form-submit">${t('btn_new_fee')}</button>
            <button type="button" class="btn btn-outline" id="fee-form-cancel">${I18N.current === 'fr' ? 'Annuler' : 'Cancel'}</button>
          </div>
        </form>
      </div>
    `;

    container.querySelector('#fee-form-cancel').addEventListener('click', () => { this.state.showFeeForm = false; this.paintFeeForm(); });
    container.querySelector('#fee-form').addEventListener('submit', (e) => this.handleFeeCreate(e));
  },

  async handleFeeCreate(e) {
    e.preventDefault();
    const errorBox = this.content.querySelector('#fee-form-error');
    const successBox = this.content.querySelector('#fee-form-success');
    errorBox.innerHTML = ''; successBox.innerHTML = '';

    const payload = {
      school_year_id: this.content.querySelector('#fee-year').value,
      label: this.content.querySelector('#fee-label').value,
      level: this.content.querySelector('#fee-level').value,
      series: this.content.querySelector('#fee-series').value,
      amount: this.content.querySelector('#fee-amount').value,
      due_date: this.content.querySelector('#fee-due').value,
    };

    const btn = this.content.querySelector('#fee-form-submit');
    UI.setLoading(btn, true);
    try {
      await API.createFeeStructure(payload);
      successBox.innerHTML = `<div class="alert alert-success">${I18N.current === 'fr' ? 'Frais créé.' : 'Fee created.'}</div>`;
      this.content.querySelector('#fee-form').reset();
      this.state.showFeeForm = false;
      await this.loadFeeStructures();
      this.paintFeeForm();
      this.paintFeeList(this.content.querySelector('#fee-list-container'));
    } catch (err) {
      errorBox.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
    } finally {
      UI.setLoading(btn, false, t('btn_new_fee'));
    }
  },

  paintFeeList(container) {
    if (!this.state.feeStructures.length) {
      container.innerHTML = `<div class="card"><div class="empty-state">${UI.icon('graph', 30)}<p class="mt-8">${t('empty_fee_structures')}</p></div></div>`;
      return;
    }

    container.innerHTML = this.state.feeStructures.map(f => `
      <div class="card mt-16">
        <div class="flex justify-between items-center" style="flex-wrap:wrap;gap:10px;">
          <div>
            <h3>${f.label}</h3>
            <div class="text-sm text-muted mt-8">
              ${f.level ? f.level + (f.series ? ' ' + f.series : '') : (I18N.current === 'fr' ? 'Tout établissement' : 'Whole school')}
              · ${Number(f.amount).toLocaleString()} FCFA
              ${f.due_date ? ' · ' + t('field_due_date') + ': ' + f.due_date : ''}
            </div>
            <div class="text-sm text-muted mt-8">
              ${f.invoice_count} ${I18N.current === 'fr' ? 'facture(s)' : 'invoice(s)'}
              · ${I18N.current === 'fr' ? 'collecté' : 'collected'}: ${Number(f.total_collected).toLocaleString()} / ${Number(f.total_due).toLocaleString()} FCFA
            </div>
          </div>
          <div class="flex gap-8" style="flex-wrap:wrap;">
            <button class="btn btn-outline btn-sm" data-generate="${f.id}">${t('btn_generate_invoices')}</button>
          </div>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('[data-generate]').forEach(btn => {
      btn.addEventListener('click', async () => {
        UI.setLoading(btn, true);
        try {
          const data = await API.generateInvoices(btn.dataset.generate);
          UI.toast(`${data.created} ${I18N.current === 'fr' ? 'facture(s) générée(s) sur' : 'invoice(s) generated out of'} ${data.candidates}.`, 'success');
          await this.loadFeeStructures();
          this.paintFeeList(container);
        } catch (err) {
          UI.toast(err.message || 'Erreur.', 'error');
        } finally {
          UI.setLoading(btn, false, t('btn_generate_invoices'));
        }
      });
    });
  },

  // -------------------------------------------------------------------
  // Onglet : factures (vue établissement + encaissement manuel)
  // -------------------------------------------------------------------
  async paintInvoicesTab(box) {
    box.innerHTML = `
      <div class="field-input-wrap" style="max-width:260px;">
        <select id="invoice-status-filter">
          <option value="">${I18N.current === 'fr' ? 'Tous les statuts' : 'All statuses'}</option>
          <option value="unpaid">${t('status_unpaid')}</option>
          <option value="partial">${t('status_partial')}</option>
          <option value="paid">${t('status_paid')}</option>
        </select>
      </div>
      <div id="invoice-list-container" class="mt-16"><div class="boot-spinner" style="margin:20px auto;"></div></div>
    `;

    box.querySelector('#invoice-status-filter').addEventListener('change', async (e) => {
      this.state.invoiceStatusFilter = e.target.value;
      await this.loadInvoices();
      this.paintInvoiceList(box.querySelector('#invoice-list-container'));
    });

    await this.loadInvoices();
    this.paintInvoiceList(box.querySelector('#invoice-list-container'));
  },

  paintInvoiceList(container) {
    if (!this.state.invoices.length) {
      container.innerHTML = `<div class="card"><div class="empty-state">${UI.icon('graph', 30)}<p class="mt-8">${t('empty_invoices')}</p></div></div>`;
      return;
    }

    container.innerHTML = `<div class="card"><table style="width:100%;border-collapse:collapse;">
      <thead><tr style="text-align:left;font-size:12px;color:var(--color-text-muted);text-transform:uppercase;">
        <th style="padding:8px;">${t('field_child')}</th>
        <th style="padding:8px;">${t('field_title')}</th>
        <th style="padding:8px;">${I18N.current === 'fr' ? 'Solde' : 'Balance'}</th>
        <th style="padding:8px;"></th>
      </tr></thead>
      <tbody>
        ${this.state.invoices.map(inv => `
          <tr style="border-top:1px solid var(--color-border);">
            <td style="padding:8px;">${inv.first_name} ${inv.last_name}<div class="text-muted text-sm">${inv.matricule}${inv.level ? ' · ' + inv.level : ''}</div></td>
            <td style="padding:8px;">${inv.fee_label}</td>
            <td style="padding:8px;">
              ${Number(inv.amount_paid).toLocaleString()} / ${Number(inv.amount_due).toLocaleString()} FCFA
              <div class="mt-8">${UI.statusBadge(inv.status)}</div>
            </td>
            <td style="padding:8px;text-align:right;">
              <button class="btn btn-outline btn-sm" data-toggle-invoice="${inv.id}">${this.state.expandedInvoiceId === inv.id ? (I18N.current === 'fr' ? 'Fermer' : 'Close') : (I18N.current === 'fr' ? 'Détail' : 'Details')}</button>
            </td>
          </tr>
          <tr id="invoice-detail-row-${inv.id}"><td colspan="4"></td></tr>
        `).join('')}
      </tbody>
    </table></div>`;

    container.querySelectorAll('[data-toggle-invoice]').forEach(btn => {
      btn.addEventListener('click', () => this.toggleInvoice(btn.dataset.toggleInvoice, container));
    });

    if (this.state.expandedInvoiceId) {
      this.paintInvoiceDetail(container, this.state.expandedInvoiceId);
    }
  },

  async toggleInvoice(id, container) {
    if (this.state.expandedInvoiceId === id) {
      this.state.expandedInvoiceId = null;
      this.paintInvoiceList(container);
      return;
    }
    this.state.expandedInvoiceId = id;
    this.paintInvoiceList(container);
  },

  async paintInvoiceDetail(container, invoiceId) {
    const cell = container.querySelector(`#invoice-detail-row-${invoiceId} td`);
    if (!cell) return;
    cell.innerHTML = `<div class="boot-spinner" style="margin:16px auto;width:20px;height:20px;"></div>`;

    try {
      const data = await API.getInvoice(invoiceId);
      const remaining = Number(data.invoice.amount_due) - Number(data.invoice.amount_paid);
      cell.innerHTML = `
        <div class="card" style="background:var(--color-bg);">
          <h4 style="font-size:14px;">${I18N.current === 'fr' ? 'Historique des paiements' : 'Payment history'}</h4>
          ${data.payments.length ? data.payments.map(p => `
            <div class="flex justify-between text-sm" style="padding:6px 0;border-bottom:1px solid var(--color-border);">
              <div>${Number(p.amount).toLocaleString()} FCFA — ${p.method} ${p.receipt_number ? '· ' + p.receipt_number : ''}</div>
              <span class="badge badge-${p.status === 'completed' ? 'success' : p.status === 'pending' ? 'warning' : 'danger'}">${p.status}</span>
            </div>
          `).join('') : `<p class="text-muted text-sm">${I18N.current === 'fr' ? 'Aucun paiement.' : 'No payments yet.'}</p>`}

          ${remaining > 0.01 ? `
            <div class="flex gap-8 items-center mt-16" style="flex-wrap:wrap;">
              <input type="number" min="1" max="${remaining}" id="pay-amount-${invoiceId}" placeholder="${I18N.current === 'fr' ? 'Montant' : 'Amount'}" style="max-width:140px;padding:10px;border:1px solid var(--color-border);border-radius:8px;">
              <select id="pay-method-${invoiceId}" style="padding:10px;border:1px solid var(--color-border);border-radius:8px;">
                <option value="cash">${I18N.current === 'fr' ? 'Espèces' : 'Cash'}</option>
                <option value="bank_card">${I18N.current === 'fr' ? 'Carte bancaire' : 'Bank card'}</option>
              </select>
              <button class="btn btn-primary btn-sm" id="pay-confirm-${invoiceId}">${t('btn_record_payment')}</button>
            </div>
          ` : ''}
        </div>
      `;

      const confirmBtn = cell.querySelector(`#pay-confirm-${invoiceId}`);
      if (confirmBtn) confirmBtn.addEventListener('click', async () => {
        const amount = cell.querySelector(`#pay-amount-${invoiceId}`).value;
        const method = cell.querySelector(`#pay-method-${invoiceId}`).value;
        if (!amount || Number(amount) <= 0) { UI.toast(t('payment_amount_invalid') || 'Montant invalide.', 'error'); return; }
        UI.setLoading(confirmBtn, true);
        try {
          const data = await API.recordManualPayment(invoiceId, { amount, method });
          UI.toast(I18N.current === 'fr' ? 'Paiement enregistré.' : 'Payment recorded.', 'success');
          if (data.payment_id) UI.printReceipt(data.payment_id);
          await this.loadInvoices();
          this.paintInvoiceList(container);
        } catch (err) {
          UI.toast(err.message || 'Erreur.', 'error');
        } finally {
          UI.setLoading(confirmBtn, false, t('btn_record_payment'));
        }
      });
    } catch (err) {
      cell.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
    }
  },
};
