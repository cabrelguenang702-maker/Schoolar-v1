/**
 * SCHOOLAR — Espace parent : tous les enfants sur un seul tableau de bord (section 17)
 * + consultation du bulletin par séquence (section 11)
 */
const MyChildrenPage = {
  state: {
    children: [],
    sequences: [],
    expandedChildId: null,
    selectedSequenceByChild: {},
  },

  async render(root) {
    const user = Store.getUser();
    if (!user || user.role_code !== 'parent') { window.location.hash = '#/dashboard'; return; }
    this.root = root;
    this.user = user;

    try {
      const data = await API.myChildren();
      this.state.children = data.children;
    } catch (err) {
      UI.toast(err.message || 'Erreur.', 'error');
    }
    try {
      const seqData = await API.listSequences();
      this.state.sequences = seqData.sequences;
    } catch { /* silencieux */ }

    this.paint();
  },

  paint() {
    const user = Store.getUser();
    const navItems = DashboardPage.buildNavItems(user).map(item =>
      item.href === '#/my-children' ? { ...item, active: true } : { ...item, active: false }
    );

    const body = `
      <h2>${t('my_children_title')}</h2>
      <p class="text-muted text-sm mt-8">${t('my_children_subtitle')}</p>

      <div class="mt-24">
        ${this.state.children.length ? this.state.children.map(c => `
          <div class="card mt-16">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-12">
                <div class="avatar" style="width:52px;height:52px;font-size:16px;">${UI.initials(c.first_name, c.last_name)}</div>
                <div>
                  <h3>${c.first_name} ${c.last_name}</h3>
                  <div class="text-sm text-muted mt-8">
                    ${c.matricule}${c.level ? ' · ' + c.level + (c.series ? ' ' + c.series : '') + (c.section ? ' ' + c.section : '') : ''}
                    ${c.relationship ? ' · ' + (I18N.current === 'fr' ? 'Vous êtes' : 'You are') + ' ' + c.relationship : ''}
                  </div>
                </div>
              </div>
              <button class="btn btn-outline btn-sm" data-toggle-bulletin="${c.id}">${this.state.expandedChildId === c.id ? (I18N.current === 'fr' ? 'Fermer' : 'Close') : t('btn_view_bulletin')}</button>
            </div>
            <div id="bulletin-${c.id}"></div>
          </div>
        `).join('') : `
          <div class="card"><div class="empty-state">${UI.icon('users', 30)}<p class="mt-8">${t('no_children_yet')}</p></div></div>
        `}
      </div>
    `;

    const content = UI.renderShell(this.root, { user: this.user, navItems, pageBodyHtml: body });
    this.content = content;

    content.querySelectorAll('[data-toggle-bulletin]').forEach(btn => {
      btn.addEventListener('click', () => this.toggleBulletin(btn.dataset.toggleBulletin));
    });

    if (this.state.expandedChildId) {
      const box = content.querySelector(`#bulletin-${this.state.expandedChildId}`);
      if (box) this.paintBulletinBox(box, this.state.expandedChildId);
    }
  },

  toggleBulletin(childId) {
    if (this.state.expandedChildId === childId) {
      this.state.expandedChildId = null;
    } else {
      this.state.expandedChildId = childId;
      if (!this.state.selectedSequenceByChild[childId] && this.state.sequences.length) {
        this.state.selectedSequenceByChild[childId] = this.state.sequences[this.state.sequences.length - 1].id;
      }
    }
    this.paint();
  },

  paintBulletinBox(box, childId) {
    if (!this.state.sequences.length) {
      box.innerHTML = `<div class="mt-16" style="border-top:1px solid var(--color-border);padding-top:16px;"><p class="text-muted text-sm">${t('no_sequences_yet')}</p></div>`;
      return;
    }

    box.innerHTML = `
      <div class="mt-16" style="border-top:1px solid var(--color-border);padding-top:16px;">
        <div class="field-input-wrap" style="max-width:280px;">
          <select data-seq-select="${childId}">
            ${this.state.sequences.map(s => `<option value="${s.id}" ${this.state.selectedSequenceByChild[childId] === s.id ? 'selected' : ''}>${s.term_label ? s.term_label + ' — ' : ''}${s.label}</option>`).join('')}
          </select>
        </div>
        <div id="bulletin-content-${childId}" class="mt-16"></div>
      </div>
    `;

    box.querySelector(`[data-seq-select="${childId}"]`).addEventListener('change', (e) => {
      this.state.selectedSequenceByChild[childId] = e.target.value;
      this.loadBulletin(childId);
    });

    this.loadBulletin(childId);
  },

  async loadBulletin(childId) {
    const container = this.content.querySelector(`#bulletin-content-${childId}`);
    if (!container) return;
    container.innerHTML = `<div class="boot-spinner" style="margin:20px auto;"></div>`;

    try {
      const data = await API.studentGradesSummary(childId, this.state.selectedSequenceByChild[childId]);
      container.innerHTML = `
        <div class="hero-card" style="padding:18px;">
          <div class="hero-top">
            <div>
              <div class="text-sm" style="opacity:.85">${data.sequence.label}</div>
              <div class="hero-value mt-8">${data.average !== null ? data.average : '—'}<small>/20</small></div>
            </div>
            ${data.rank !== null ? `<span class="pill">${I18N.current === 'fr' ? 'Rang' : 'Rank'} ${data.rank}${I18N.current === 'fr' ? 'e' : ''} / ${data.class_size}</span>` : ''}
          </div>
        </div>
        <div class="mt-16">
          ${data.subjects.map(s => `
            <div class="flex items-center justify-between" style="padding:8px 0;border-bottom:1px solid var(--color-border);">
              <div>${s.subject_name} <span class="text-muted text-sm">(coeff. ${s.coefficient})</span></div>
              ${s.score !== null ? `<span class="badge badge-${s.mention === 'bien' ? 'success' : s.mention === 'passable' ? 'warning' : 'danger'}">${s.score}/20</span>` : `<span class="text-muted text-sm">—</span>`}
            </div>
          `).join('')}
        </div>

        <h4 style="font-size:14px;margin-top:20px;">${t('attendance_history_title')}</h4>
        <div id="attendance-summary-${childId}" class="mt-8"><div class="boot-spinner" style="margin:10px auto;width:20px;height:20px;"></div></div>

        <h4 style="font-size:14px;margin-top:20px;">${t('my_homework_title')}</h4>
        <div id="homework-summary-${childId}" class="mt-8"><div class="boot-spinner" style="margin:10px auto;width:20px;height:20px;"></div></div>

        <h4 style="font-size:14px;margin-top:20px;">${t('fees_title')}</h4>
        <div id="fees-summary-${childId}" class="mt-8"><div class="boot-spinner" style="margin:10px auto;width:20px;height:20px;"></div></div>

        <h4 style="font-size:14px;margin-top:20px;">${t('premium_title')}</h4>
        <div id="premium-summary-${childId}" class="mt-8"><div class="boot-spinner" style="margin:10px auto;width:20px;height:20px;"></div></div>

        <h4 style="font-size:14px;margin-top:20px;">${t('documents_section_title')}</h4>
        <div id="documents-summary-${childId}" class="mt-8"><div class="boot-spinner" style="margin:10px auto;width:20px;height:20px;"></div></div>

        <h4 style="font-size:14px;margin-top:20px;">${t('orientation_title')}</h4>
        <div id="orientation-summary-${childId}" class="mt-8"><div class="boot-spinner" style="margin:10px auto;width:20px;height:20px;"></div></div>

        <h4 style="font-size:14px;margin-top:20px;">${t('concours_title')}</h4>
        <div id="concours-summary-${childId}" class="mt-8"><div class="boot-spinner" style="margin:10px auto;width:20px;height:20px;"></div></div>

        <h4 style="font-size:14px;margin-top:20px;">${t('bulletins_title')}</h4>
        <div id="bulletins-summary-${childId}" class="mt-8"><div class="boot-spinner" style="margin:10px auto;width:20px;height:20px;"></div></div>
      `;

      this.loadAttendanceSummary(childId);
      this.loadHomeworkSummary(childId, box);
      this.loadFeesSummary(childId);
      this.loadPremiumSummary(childId);
      this.loadDocumentsSummary(childId);
      this.loadOrientationSummary(childId);
      this.loadConcoursSummary(childId);
      this.loadBulletinsSummary(childId);
    } catch (err) {
      container.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
    }
  },

  async loadAttendanceSummary(childId) {
    const container = this.content.querySelector(`#attendance-summary-${childId}`);
    if (!container) return;
    try {
      const data = await API.studentAttendanceHistory(childId);
      if (!data.history.length) {
        container.innerHTML = `<p class="text-muted text-sm">${t('no_attendance_history')}</p>`;
        return;
      }
      container.innerHTML = `
        <div class="text-sm text-muted mt-8">${t('stat_absent')}: ${data.stats.absent_count} · ${t('stat_late')}: ${data.stats.late_count}</div>
        ${data.history.slice(0, 5).map(h => `
          <div class="flex items-center justify-between text-sm" style="padding:6px 0;border-bottom:1px solid var(--color-border);">
            <div>${h.session_date} — ${h.subject_name}</div>
            <span class="badge badge-${h.status === 'absent' ? 'danger' : 'warning'}">${t('status_' + h.status)}${h.justified ? ' ✓' : ''}</span>
          </div>
        `).join('')}
      `;
    } catch {
      container.innerHTML = `<p class="text-muted text-sm">—</p>`;
    }
  },

  async loadHomeworkSummary(childId, box) {
    const container = this.content.querySelector(`#homework-summary-${childId}`);
    if (!container) return;
    try {
      const data = await API.studentHomework(childId);
      if (!data.assignments.length) {
        container.innerHTML = `<p class="text-muted text-sm">${t('empty_homework')}</p>`;
        return;
      }
      container.innerHTML = data.assignments.slice(0, 6).map(a => `
        <div class="flex items-center justify-between text-sm" style="padding:8px 0;border-bottom:1px solid var(--color-border);">
          <div>
            <div>${a.title} <span class="text-muted">(${a.subject_name})</span></div>
            <div class="text-muted text-sm">${t('field_due_date')}: ${a.due_date}</div>
          </div>
          <div class="flex items-center gap-8">
            ${a.submission_id
              ? `<span class="badge badge-${a.reviewed ? 'success' : 'info'}">${a.reviewed ? t('homework_reviewed_badge') : t('homework_submitted_badge')}</span>`
              : `<button class="btn btn-primary btn-sm" data-submit-hw="${a.id}">${t('btn_submit_homework')}</button>`}
          </div>
        </div>
        <div id="hw-upload-${a.id}"></div>
      `).join('');

      container.querySelectorAll('[data-submit-hw]').forEach(btn => {
        btn.addEventListener('click', () => this.paintUploadForm(container, btn.dataset.submitHw, childId));
      });
    } catch {
      container.innerHTML = `<p class="text-muted text-sm">—</p>`;
    }
  },

  paintUploadForm(container, assignmentId, childId) {
    const box = container.querySelector(`#hw-upload-${assignmentId}`);
    box.innerHTML = `
      <div class="flex items-center gap-8 mt-8" style="flex-wrap:wrap;">
        <input type="file" accept=".pdf,.doc,.docx" id="hw-file-${assignmentId}">
        <button class="btn btn-primary btn-sm" id="hw-confirm-${assignmentId}">${t('btn_submit_homework')}</button>
      </div>
      <div id="hw-upload-error-${assignmentId}"></div>
    `;
    box.querySelector(`#hw-confirm-${assignmentId}`).addEventListener('click', async () => {
      const fileInput = box.querySelector(`#hw-file-${assignmentId}`);
      const errorBox = box.querySelector(`#hw-upload-error-${assignmentId}`);
      errorBox.innerHTML = '';
      if (!fileInput.files.length) { errorBox.innerHTML = `<div class="alert alert-error mt-8">${t('field_file')}</div>`; return; }
      try {
        await API.submitHomework(assignmentId, childId, fileInput.files[0]);
        UI.toast(I18N.current === 'fr' ? 'Devoir soumis.' : 'Homework submitted.', 'success');
        this.loadHomeworkSummary(childId);
      } catch (err) {
        errorBox.innerHTML = `<div class="alert alert-error mt-8">${err.message || 'Erreur.'}</div>`;
      }
    });
  },

  // -------------------------------------------------------------------
  // Frais de scolarité + paiement Mobile Money (section 24)
  // -------------------------------------------------------------------
  async loadFeesSummary(childId) {
    const container = this.content.querySelector(`#fees-summary-${childId}`);
    if (!container) return;
    try {
      const data = await API.studentFees(childId);
      if (!data.invoices.length) {
        container.innerHTML = `<p class="text-muted text-sm">${t('empty_fee_structures')}</p>`;
        return;
      }
      container.innerHTML = data.invoices.map(inv => {
        const remaining = Number(inv.amount_due) - Number(inv.amount_paid);
        return `
          <div style="padding:8px 0;border-bottom:1px solid var(--color-border);">
            <div class="flex items-center justify-between text-sm">
              <div>${inv.fee_label}${inv.due_date ? ` <span class="text-muted">(${t('field_due_date')}: ${inv.due_date})</span>` : ''}</div>
              ${UI.statusBadge(inv.status)}
            </div>
            <div class="text-sm text-muted mt-8">${Number(inv.amount_paid).toLocaleString()} / ${Number(inv.amount_due).toLocaleString()} FCFA</div>
            ${remaining > 0.01 ? `<button class="btn btn-primary btn-sm mt-8" data-pay-invoice="${inv.id}">${t('btn_pay_mobile_money')}</button>` : ''}
            <div id="mm-form-${inv.id}"></div>
          </div>
        `;
      }).join('');

      container.querySelectorAll('[data-pay-invoice]').forEach(btn => {
        btn.addEventListener('click', () => this.paintMobileMoneyForm(container, btn.dataset.payInvoice, childId));
      });
    } catch {
      container.innerHTML = `<p class="text-muted text-sm">—</p>`;
    }
  },

  paintMobileMoneyForm(container, invoiceId, childId) {
    const box = container.querySelector(`#mm-form-${invoiceId}`);
    box.innerHTML = `
      <div class="flex items-center gap-8 mt-8" style="flex-wrap:wrap;">
        <select id="mm-method-${invoiceId}" style="padding:10px;border:1px solid var(--color-border);border-radius:8px;">
          <option value="orange_money">Orange Money</option>
          <option value="mtn_momo">MTN MoMo</option>
        </select>
        <input id="mm-phone-${invoiceId}" placeholder="${I18N.current === 'fr' ? 'Numéro de téléphone' : 'Phone number'}" style="padding:10px;border:1px solid var(--color-border);border-radius:8px;">
        <button class="btn btn-primary btn-sm" id="mm-confirm-${invoiceId}">${t('btn_pay_mobile_money')}</button>
      </div>
      <div id="mm-status-${invoiceId}" class="mt-8"></div>
    `;
    box.querySelector(`#mm-confirm-${invoiceId}`).addEventListener('click', async () => {
      const method = box.querySelector(`#mm-method-${invoiceId}`).value;
      const phone = box.querySelector(`#mm-phone-${invoiceId}`).value;
      const statusBox = box.querySelector(`#mm-status-${invoiceId}`);
      if (!phone) { statusBox.innerHTML = `<div class="alert alert-error">${t('field_child')}</div>`; return; }
      try {
        const data = await API.payInvoiceMobileMoney(invoiceId, { method, phone });
        statusBox.innerHTML = `<div class="alert alert-info">${t('mobile_money_initiated')}</div>`;
        // En développement (APP_DEBUG), simule la confirmation fournisseur.
        try {
          await API.confirmPayment(data.payment_id, true);
          statusBox.innerHTML = `<div class="alert alert-success">${t('payment_confirmed')}</div>
            <button class="btn btn-outline btn-sm mt-8" id="mm-receipt-${invoiceId}">${I18N.current === 'fr' ? 'Voir le reçu' : 'View receipt'}</button>`;
          statusBox.querySelector(`#mm-receipt-${invoiceId}`).addEventListener('click', () => UI.printReceipt(data.payment_id));
        } catch { /* confirmation dev indisponible en production, l'utilisateur suit le code USSD */ }
      } catch (err) {
        statusBox.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
      }
    });
  },

  // -------------------------------------------------------------------
  // Premium Parents (section 17)
  // -------------------------------------------------------------------
  async loadPremiumSummary(childId) {
    const container = this.content.querySelector(`#premium-summary-${childId}`);
    if (!container) return;
    try {
      const data = await API.premiumStatus(childId);
      if (data.is_active) {
        container.innerHTML = `
          <div class="alert alert-success">${t('premium_active_until')} ${data.subscription.period_end}</div>
          <button class="btn btn-outline btn-sm mt-8" data-cancel-premium="${childId}">${t('btn_cancel_premium')}</button>
          <div id="premium-checkouts-${childId}" class="mt-16"></div>
        `;
        container.querySelector(`[data-cancel-premium]`).addEventListener('click', async (e) => {
          UI.setLoading(e.target, true);
          try {
            await API.cancelPremium(childId);
            this.loadPremiumSummary(childId);
          } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
        });
        this.loadPremiumCheckouts(childId);
      } else {
        container.innerHTML = `
          <p class="text-muted text-sm">${t('premium_pitch')}</p>
          <div class="flex items-center gap-8 mt-8" style="flex-wrap:wrap;">
            <select id="prem-method-${childId}" style="padding:10px;border:1px solid var(--color-border);border-radius:8px;">
              <option value="orange_money">Orange Money</option>
              <option value="mtn_momo">MTN MoMo</option>
            </select>
            <input id="prem-phone-${childId}" placeholder="${I18N.current === 'fr' ? 'Numéro de téléphone' : 'Phone number'}" style="padding:10px;border:1px solid var(--color-border);border-radius:8px;">
            <button class="btn btn-primary btn-sm" id="prem-subscribe-${childId}">${t('btn_subscribe_premium')}</button>
          </div>
          <div id="prem-status-${childId}" class="mt-8"></div>
        `;
        container.querySelector(`#prem-subscribe-${childId}`).addEventListener('click', async () => {
          const method = container.querySelector(`#prem-method-${childId}`).value;
          const phone = container.querySelector(`#prem-phone-${childId}`).value;
          const statusBox = container.querySelector(`#prem-status-${childId}`);
          if (!phone) return;
          try {
            const d = await API.subscribePremium(childId, { method, phone });
            statusBox.innerHTML = `<div class="alert alert-info">${t('mobile_money_initiated')}</div>`;
            try {
              await API.confirmPayment(d.payment_id, true);
              this.loadPremiumSummary(childId);
            } catch { /* confirmation dev indisponible en production */ }
          } catch (err) {
            statusBox.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
          }
        });
      }
    } catch {
      container.innerHTML = `<p class="text-muted text-sm">—</p>`;
    }
  },

  async loadPremiumCheckouts(childId) {
    const container = this.content.querySelector(`#premium-checkouts-${childId}`);
    if (!container) return;
    try {
      const data = await API.premiumCheckoutTimes(childId);
      if (!data.checkouts.length) {
        container.innerHTML = `<p class="text-muted text-sm">${t('empty_checkouts')}</p>`;
        return;
      }
      container.innerHTML = `<h4 style="font-size:13px;">${t('checkout_times_title')}</h4>` + data.checkouts.map(c => `
        <div class="flex justify-between text-sm" style="padding:6px 0;border-bottom:1px solid var(--color-border);">
          <div>${c.session_date} — ${c.subject_name}</div>
          <div class="text-muted">${new Date(c.checkout_at).toLocaleTimeString()}</div>
        </div>
      `).join('');
    } catch {
      container.innerHTML = '';
    }
  },

  // -------------------------------------------------------------------
  // Documents administratifs de l'enfant (section 8)
  // -------------------------------------------------------------------
  async loadDocumentsSummary(childId) {
    const container = this.content.querySelector(`#documents-summary-${childId}`);
    if (!container) return;
    try {
      const data = await API.studentDocuments(childId);
      if (!data.documents.length) {
        container.innerHTML = `<p class="text-muted text-sm">${t('empty_documents')}</p>`;
        return;
      }
      container.innerHTML = data.documents.map(d => `
        <div class="flex items-center justify-between text-sm" style="padding:8px 0;border-bottom:1px solid var(--color-border);">
          <div>
            <div>${d.title}</div>
            <span class="badge badge-neutral mt-8">${t('document_cat_' + d.category)}</span>
          </div>
          <a class="btn btn-outline btn-sm" href="${API.downloadDocumentUrl(d.id)}" target="_blank" rel="noopener">${t('btn_download')}</a>
        </div>
      `).join('');
    } catch {
      container.innerHTML = `<p class="text-muted text-sm">—</p>`;
    }
  },

  // -------------------------------------------------------------------
  // Orientation scolaire (section 11 — IA Claude)
  // -------------------------------------------------------------------
  async loadOrientationSummary(childId) {
    const container = this.content.querySelector(`#orientation-summary-${childId}`);
    if (!container) return;
    try {
      const data = await API.orientationHistory(childId);
      const latest = data.assessments[0];
      container.innerHTML = `
        ${latest ? `
          <div class="card">
            <p class="text-muted text-sm">${new Date(latest.created_at).toLocaleDateString()}</p>
            <p class="mt-8">${latest.content.summary || ''}</p>
            <p class="mt-8"><strong>${I18N.current === 'fr' ? 'Estimation' : 'Estimate'}:</strong> ${latest.content.success_estimate || ''}</p>
            ${latest.content.suggested_universities && latest.content.suggested_universities.length ? `<p class="mt-8"><strong>${I18N.current === 'fr' ? 'Universités suggérées' : 'Suggested universities'}:</strong> ${latest.content.suggested_universities.join(', ')}</p>` : ''}
            ${latest.content.suggested_competitive_exams && latest.content.suggested_competitive_exams.length ? `<p class="mt-8"><strong>${I18N.current === 'fr' ? 'Concours suggérés' : 'Suggested exams'}:</strong> ${latest.content.suggested_competitive_exams.join(', ')}</p>` : ''}
            ${latest.content.revision_plan ? `<p class="mt-8 text-sm text-muted">${latest.content.revision_plan}</p>` : ''}
          </div>
        ` : `<p class="text-muted text-sm">${t('empty_orientation')}</p>`}
        <button class="btn btn-outline btn-sm mt-8" id="orientation-generate-${childId}">${t('btn_generate_orientation')}</button>
        <div id="orientation-error-${childId}" class="mt-8"></div>
      `;
      container.querySelector(`#orientation-generate-${childId}`).addEventListener('click', async (e) => {
        UI.setLoading(e.target, true);
        const errBox = container.querySelector(`#orientation-error-${childId}`);
        try {
          await API.generateOrientation(childId);
          await this.loadOrientationSummary(childId);
        } catch (err) {
          errBox.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
          UI.setLoading(e.target, false, t('btn_generate_orientation'));
        }
      });
    } catch {
      container.innerHTML = `<p class="text-muted text-sm">—</p>`;
    }
  },

  // -------------------------------------------------------------------
  // Préparation aux concours (section 12 — IA GPT)
  // -------------------------------------------------------------------
  async loadConcoursSummary(childId) {
    const container = this.content.querySelector(`#concours-summary-${childId}`);
    if (!container) return;
    try {
      const status = await API.concoursStatus(childId);
      let examsHtml = '';
      if (status.is_active) {
        const examsData = await API.listExams(childId);
        examsHtml = examsData.exams.length ? examsData.exams.map(ex => `
          <a href="#/exams/${ex.id}" class="flex justify-between items-center text-sm" style="padding:8px 0;border-bottom:1px solid var(--color-border);text-decoration:none;color:inherit;">
            <div>${ex.subject_label} — ${ex.level} <span class="badge badge-neutral">${ex.difficulty}</span></div>
            <div>${ex.attempt_status === 'graded' ? `${ex.score} / ${ex.max_score}` : (I18N.current === 'fr' ? 'À passer' : 'To take')}</div>
          </a>
        `).join('') : `<p class="text-muted text-sm">${t('empty_exams')}</p>`;
      }

      container.innerHTML = status.is_active ? `
        <div class="alert alert-success">${t('concours_active')} (${status.subscription.tier === 'unlimited' ? t('tier_unlimited') : t('tier_limited') + ` — ${status.quota_remaining} ${I18N.current === 'fr' ? 'restantes' : 'left'}`})</div>
        <div id="concours-generate-form-${childId}" class="mt-8"></div>
        <button class="btn btn-outline btn-sm mt-8" id="concours-show-generate-${childId}">${t('btn_generate_exam')}</button>
        <div class="mt-16">${examsHtml}</div>
      ` : `
        <p class="text-muted text-sm">${t('concours_pitch')}</p>
        <div class="flex items-center gap-8 mt-8" style="flex-wrap:wrap;">
          <select id="concours-tier-${childId}" style="padding:10px;border:1px solid var(--color-border);border-radius:8px;">
            <option value="limited">${t('tier_limited')} — 500 FCFA</option>
            <option value="unlimited">${t('tier_unlimited')} — 1000 FCFA</option>
          </select>
          <select id="concours-method-${childId}" style="padding:10px;border:1px solid var(--color-border);border-radius:8px;">
            <option value="orange_money">Orange Money</option>
            <option value="mtn_momo">MTN MoMo</option>
          </select>
          <input id="concours-phone-${childId}" placeholder="${I18N.current === 'fr' ? 'Numéro de téléphone' : 'Phone number'}" style="padding:10px;border:1px solid var(--color-border);border-radius:8px;">
          <button class="btn btn-primary btn-sm" id="concours-subscribe-${childId}">${t('btn_subscribe_concours')}</button>
        </div>
        <div id="concours-status-${childId}" class="mt-8"></div>
      `;

      if (status.is_active) {
        container.querySelector(`#concours-show-generate-${childId}`).addEventListener('click', () => this.paintExamGenerateForm(container, childId));
      } else {
        container.querySelector(`#concours-subscribe-${childId}`).addEventListener('click', async () => {
          const tier = container.querySelector(`#concours-tier-${childId}`).value;
          const method = container.querySelector(`#concours-method-${childId}`).value;
          const phone = container.querySelector(`#concours-phone-${childId}`).value;
          const statusBox = container.querySelector(`#concours-status-${childId}`);
          if (!phone) return;
          try {
            const d = await API.subscribeConcours(childId, { tier, method, phone });
            statusBox.innerHTML = `<div class="alert alert-info">${t('mobile_money_initiated')}</div>`;
            try {
              await API.confirmPayment(d.payment_id, true);
              this.loadConcoursSummary(childId);
            } catch { /* confirmation dev indisponible en production */ }
          } catch (err) {
            statusBox.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
          }
        });
      }
    } catch {
      container.innerHTML = `<p class="text-muted text-sm">—</p>`;
    }
  },

  paintExamGenerateForm(container, childId) {
    const box = container.querySelector(`#concours-generate-form-${childId}`);
    box.innerHTML = `
      <div class="card">
        <div class="grid-2">
          <input id="exam-subject-${childId}" placeholder="${I18N.current === 'fr' ? 'Matière (ex: Mathématiques)' : 'Subject (e.g. Mathematics)'}">
          <input id="exam-level-${childId}" placeholder="${I18N.current === 'fr' ? 'Niveau (ex: Terminale C)' : 'Level (e.g. Terminale C)'}">
        </div>
        <div class="grid-2 mt-16">
          <select id="exam-difficulty-${childId}" style="padding:10px;border:1px solid var(--color-border);border-radius:8px;">
            <option value="easy">${I18N.current === 'fr' ? 'Facile' : 'Easy'}</option>
            <option value="medium" selected>${I18N.current === 'fr' ? 'Moyen' : 'Medium'}</option>
            <option value="hard">${I18N.current === 'fr' ? 'Difficile' : 'Hard'}</option>
          </select>
          <input type="number" id="exam-count-${childId}" value="10" min="3" max="20" placeholder="${I18N.current === 'fr' ? 'Nb questions' : 'Question count'}">
        </div>
        <button class="btn btn-primary btn-sm mt-16" id="exam-generate-confirm-${childId}">${t('btn_generate_exam')}</button>
        <div id="exam-generate-error-${childId}" class="mt-8"></div>
      </div>
    `;
    box.querySelector(`#exam-generate-confirm-${childId}`).addEventListener('click', async (e) => {
      const payload = {
        subject_label: container.querySelector(`#exam-subject-${childId}`).value,
        level: container.querySelector(`#exam-level-${childId}`).value,
        difficulty: container.querySelector(`#exam-difficulty-${childId}`).value,
        question_count: container.querySelector(`#exam-count-${childId}`).value,
      };
      const errBox = box.querySelector(`#exam-generate-error-${childId}`);
      if (!payload.subject_label || !payload.level) { errBox.innerHTML = `<div class="alert alert-error">${t('validation_missing_fields') || 'Champs requis.'}</div>`; return; }
      UI.setLoading(e.target, true);
      try {
        await API.generateExam(childId, payload);
        await this.loadConcoursSummary(childId);
      } catch (err) {
        errBox.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
        UI.setLoading(e.target, false, t('btn_generate_exam'));
      }
    });
  },

  // -------------------------------------------------------------------
  // Bulletins pilotés par IA
  // -------------------------------------------------------------------
  async loadBulletinsSummary(childId) {
    const container = this.content.querySelector(`#bulletins-summary-${childId}`);
    if (!container) return;
    try {
      const status = await API.bulletinStatus(childId);
      let bulletinsHtml = '';
      if (status.is_active) {
        const data = await API.listBulletins(childId);
        bulletinsHtml = data.bulletins.length ? data.bulletins.map(b => `
          <div class="flex justify-between items-center text-sm" style="padding:8px 0;border-bottom:1px solid var(--color-border);">
            <div>${b.sequence_label}${b.term_label ? ' — ' + b.term_label : ''}</div>
            <button class="btn btn-outline btn-sm" data-view-bulletin="${b.id}">${I18N.current === 'fr' ? 'Voir / Imprimer' : 'View / Print'}</button>
          </div>
        `).join('') : `<p class="text-muted text-sm">${t('empty_bulletins')}</p>`;
      }

      container.innerHTML = status.is_active ? `
        <div class="alert alert-success">${t('bulletin_active')}</div>
        <div class="mt-16">${bulletinsHtml}</div>
      ` : `
        <p class="text-muted text-sm">${t('bulletin_pitch')}${!status.template_available ? ' ' + t('bulletin_no_template_yet') : ''}</p>
        <div class="flex items-center gap-8 mt-8" style="flex-wrap:wrap;">
          <select id="bulletin-method-${childId}" style="padding:10px;border:1px solid var(--color-border);border-radius:8px;">
            <option value="orange_money">Orange Money</option>
            <option value="mtn_momo">MTN MoMo</option>
          </select>
          <input id="bulletin-phone-${childId}" placeholder="${I18N.current === 'fr' ? 'Numéro de téléphone' : 'Phone number'}" style="padding:10px;border:1px solid var(--color-border);border-radius:8px;">
          <button class="btn btn-primary btn-sm" id="bulletin-subscribe-${childId}">${t('btn_subscribe_bulletin')} — 500 FCFA</button>
        </div>
        <div id="bulletin-status-${childId}" class="mt-8"></div>
      `;

      container.querySelectorAll('[data-view-bulletin]').forEach(btn => {
        btn.addEventListener('click', () => this.openBulletin(btn.dataset.viewBulletin));
      });

      const subscribeBtn = container.querySelector(`#bulletin-subscribe-${childId}`);
      if (subscribeBtn) subscribeBtn.addEventListener('click', async () => {
        const method = container.querySelector(`#bulletin-method-${childId}`).value;
        const phone = container.querySelector(`#bulletin-phone-${childId}`).value;
        const statusBox = container.querySelector(`#bulletin-status-${childId}`);
        if (!phone) return;
        try {
          const d = await API.subscribeBulletin(childId, { method, phone });
          statusBox.innerHTML = `<div class="alert alert-info">${t('mobile_money_initiated')}</div>`;
          try {
            await API.confirmPayment(d.payment_id, true);
            this.loadBulletinsSummary(childId);
          } catch { /* confirmation dev indisponible en production */ }
        } catch (err) {
          statusBox.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
        }
      });
    } catch {
      container.innerHTML = `<p class="text-muted text-sm">—</p>`;
    }
  },

  async openBulletin(bulletinId) {
    try {
      const data = await API.getBulletin(bulletinId);
      const b = data.bulletin;
      const overlay = document.createElement('div');
      overlay.className = 'receipt-print-area';
      overlay.style.cssText = 'position:fixed;inset:0;background:white;z-index:10000;padding:40px;max-width:640px;margin:40px auto;border:1px solid var(--color-border);border-radius:12px;overflow:auto;';
      overlay.innerHTML = `
        <h2>${b.first_name} ${b.last_name}</h2>
        <p class="text-muted text-sm">${b.matricule} — ${b.level || ''} ${b.series || ''}</p>
        <p class="text-sm mt-8">${b.sequence_label}${b.term_label ? ' — ' + b.term_label : ''}</p>
        <table style="width:100%;border-collapse:collapse;margin-top:16px;">
          <thead><tr style="text-align:left;font-size:12px;color:var(--color-text-muted);"><th style="padding:6px;">${I18N.current === 'fr' ? 'Matière' : 'Subject'}</th><th style="padding:6px;">Coef.</th><th style="padding:6px;">${I18N.current === 'fr' ? 'Note' : 'Score'}</th><th style="padding:6px;">${I18N.current === 'fr' ? 'Appréciation' : 'Remark'}</th></tr></thead>
          <tbody>
            ${(b.content.subjects || []).map(s => `<tr style="border-top:1px solid var(--color-border);"><td style="padding:6px;">${s.subject_name}</td><td style="padding:6px;">${s.coefficient}</td><td style="padding:6px;">${s.score ?? '—'}</td><td style="padding:6px;">${s.appreciation || ''}</td></tr>`).join('')}
          </tbody>
        </table>
        <div class="hero-card mt-16" style="padding:16px;">
          <div class="hero-value">${b.content.average ?? '—'} <small>/ 20</small></div>
        </div>
        <p class="mt-16">${b.content.general_appreciation || ''}</p>
        ${b.verification_code ? `
          <div class="flex items-center gap-16 mt-24" style="border-top:1px solid var(--color-border);padding-top:16px;">
            <div id="bulletin-qr" style="width:90px;height:90px;"></div>
            <div>
              <p class="text-muted text-sm">${t('bulletin_verification_hint')}</p>
              <p class="text-sm mt-8"><code>${b.verification_code}</code></p>
            </div>
          </div>
        ` : ''}
        <div class="flex gap-8 mt-24">
          <button class="btn btn-primary" id="bulletin-print-btn">${I18N.current === 'fr' ? 'Imprimer' : 'Print'}</button>
          <a class="btn btn-outline" href="${API.bulletinPdfUrl(bulletinId)}" target="_blank" rel="noopener">${t('btn_export_pdf')}</a>
          <button class="btn btn-outline" id="bulletin-close-btn">${I18N.current === 'fr' ? 'Fermer' : 'Close'}</button>
        </div>
      `;
      document.body.appendChild(overlay);
      if (b.verification_code && typeof QRCode !== 'undefined') {
        new QRCode(overlay.querySelector('#bulletin-qr'), {
          text: `${window.location.origin}${window.location.pathname}#/verify/${b.verification_code}`,
          width: 90, height: 90,
        });
      }
      overlay.querySelector('#bulletin-print-btn').addEventListener('click', () => window.print());
      overlay.querySelector('#bulletin-close-btn').addEventListener('click', () => overlay.remove());
    } catch (err) {
      UI.toast(err.message || 'Erreur.', 'error');
    }
  },
};