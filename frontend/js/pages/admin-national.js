/**
 * SCHOOLAR — Espace Administrateur National
 * Validation des inscriptions d'établissements + validation finale des
 * demandes de changement d'administrateur (section 5 du cahier des charges).
 */
const AdminNationalPage = {
  state: {
    tab: 'dashboard', // dashboard | pending_establishments | all_establishments | admin_changes
    establishments: [],
    counts: {},
    changeRequests: [],
    overview: null,
    regions: [],
    departments: [],
    regionFilter: '',
    mapEstablishments: [],
    leafletMap: null,
  },

  async render(root) {
    const user = Store.getUser();
    if (!user || user.role_code !== 'admin_national') {
      window.location.hash = '#/dashboard';
      return;
    }
    this.root = root;
    this.user = user;
    await this.loadData();
    this.paint();
  },

  async loadData() {
    try {
      if (this.state.tab === 'dashboard') {
        const [overview, regions, mapData] = await Promise.all([
          API.nationalStatsOverview(), API.nationalStatsByRegion(), API.nationalStatsMap(),
        ]);
        this.state.overview = overview;
        this.state.regions = regions.regions;
        this.state.mapEstablishments = mapData.establishments;
        return;
      }
      const status = this.state.tab === 'pending_establishments' ? 'pending' : '';
      if (this.state.tab !== 'admin_changes') {
        const data = await API.listEstablishmentsAdmin(status ? `?status=${status}` : '');
        this.state.establishments = data.establishments;
        this.state.counts = Object.fromEntries((data.counts_by_status || []).map(c => [c.status, c.n]));
      } else {
        const data = await API.listAdminChangeRequests('');
        this.state.changeRequests = data.requests;
      }
    } catch (err) {
      UI.toast(err.message || 'Erreur de chargement.', 'error');
    }
  },

  paint() {
    const user = Store.getUser();
    const navItems = DashboardPage.buildNavItems(user).map(item =>
      item.href === '#/admin-national' ? { ...item, active: true } : { ...item, active: false }
    );

    const tabs = [
      { key: 'dashboard', label: t('nav_national_dashboard') },
      { key: 'pending_establishments', label: t('nav_pending_establishments') },
      { key: 'all_establishments', label: t('nav_all_establishments') },
      { key: 'admin_changes', label: t('nav_admin_changes') },
    ];

    const body = `
      <h2>${I18N.current === 'fr' ? 'Espace national SCHOOLAR' : 'SCHOOLAR national space'}</h2>
      <div class="role-tabs mt-16" id="admin-tabs">
        ${tabs.map(tb => `<button type="button" class="role-tab ${this.state.tab === tb.key ? 'active' : ''}" data-tab="${tb.key}">${tb.label}</button>`).join('')}
      </div>
      <div class="mt-24" id="admin-tab-content"></div>
    `;

    const content = UI.renderShell(this.root, { user: this.user, navItems, pageBodyHtml: body });
    this.content = content;

    content.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', async () => {
        this.state.tab = btn.dataset.tab;
        await this.loadData();
        this.paint();
      });
    });

    const contentBox = content.querySelector('#admin-tab-content');
    if (this.state.tab === 'admin_changes') {
      this.paintAdminChanges(contentBox);
    } else if (this.state.tab === 'dashboard') {
      this.paintDashboard(contentBox);
    } else {
      this.paintEstablishments(contentBox);
    }
  },

  paintEstablishments(container) {
    const list = this.state.tab === 'pending_establishments'
      ? this.state.establishments.filter(e => e.status === 'pending')
      : this.state.establishments;

    if (!list.length) {
      container.innerHTML = `<div class="card"><div class="empty-state">${UI.icon('building', 30)}<p class="mt-8">${t('empty_pending_establishments')}</p></div></div>`;
      return;
    }

    container.innerHTML = list.map(e => `
      <div class="card mt-16">
        <div class="card-title-row">
          <div>
            <h3>${e.name} <span class="text-muted text-sm">(${e.code})</span></h3>
            <div class="text-sm text-muted mt-8">${e.region} · ${e.department} · ${e.establishment_type === 'lycee' ? 'Lycée' : 'Collège'} · ${e.email} · ${e.phone}</div>
          </div>
          ${UI.statusBadge(e.status)}
        </div>
        <div class="flex gap-8 mt-16" data-actions="${e.id}">
          ${e.status === 'pending' ? `
            <button class="btn btn-primary btn-sm" data-action="approve" data-id="${e.id}">${t('btn_approve')}</button>
            <button class="btn btn-outline btn-sm" data-action="reject" data-id="${e.id}">${t('btn_reject')}</button>
          ` : ''}
          ${e.status === 'active' ? `<button class="btn btn-outline btn-sm" data-action="suspend" data-id="${e.id}">${t('btn_suspend')}</button>` : ''}
          ${e.status === 'suspended' ? `<button class="btn btn-primary btn-sm" data-action="reactivate" data-id="${e.id}">${t('btn_reactivate')}</button>` : ''}
          ${e.status === 'active' ? `<button class="btn btn-outline btn-sm" data-action="coordinates" data-id="${e.id}">${t('btn_set_coordinates')}</button>` : ''}
        </div>
        <div id="coordinates-form-${e.id}"></div>
        ${e.rejection_reason ? `<div class="text-sm mt-8" style="color:var(--color-danger)">${I18N.current === 'fr' ? 'Motif' : 'Reason'}: ${e.rejection_reason}</div>` : ''}
        ${e.suspended_reason ? `<div class="text-sm mt-8" style="color:var(--color-warning)">${I18N.current === 'fr' ? 'Motif' : 'Reason'}: ${e.suspended_reason}</div>` : ''}
      </div>
    `).join('');

    container.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => this.handleEstablishmentAction(btn.dataset.action, btn.dataset.id));
    });
  },

  paintCoordinatesForm(establishmentId) {
    const box = this.content.querySelector(`#coordinates-form-${establishmentId}`);
    if (!box) return;
    box.innerHTML = `
      <div class="flex items-center gap-8 mt-8" style="flex-wrap:wrap;">
        <input id="coord-lat-${establishmentId}" placeholder="${I18N.current === 'fr' ? 'Latitude' : 'Latitude'}" style="max-width:140px;padding:8px;border:1px solid var(--color-border);border-radius:8px;">
        <input id="coord-lng-${establishmentId}" placeholder="${I18N.current === 'fr' ? 'Longitude' : 'Longitude'}" style="max-width:140px;padding:8px;border:1px solid var(--color-border);border-radius:8px;">
        <button class="btn btn-primary btn-sm" id="coord-save-${establishmentId}">${I18N.current === 'fr' ? 'Enregistrer' : 'Save'}</button>
      </div>
      <div id="coord-error-${establishmentId}" class="mt-8"></div>
    `;
    box.querySelector(`#coord-save-${establishmentId}`).addEventListener('click', async () => {
      const latitude = box.querySelector(`#coord-lat-${establishmentId}`).value;
      const longitude = box.querySelector(`#coord-lng-${establishmentId}`).value;
      const errBox = box.querySelector(`#coord-error-${establishmentId}`);
      try {
        await API.setEstablishmentCoordinates(establishmentId, { latitude, longitude });
        UI.toast(t('coordinates_saved'), 'success');
        box.innerHTML = '';
      } catch (err) {
        errBox.innerHTML = `<div class="alert alert-error">${err.message || 'Erreur.'}</div>`;
      }
    });
  },

  paintAdminChanges(container) {
    if (!this.state.changeRequests.length) {
      container.innerHTML = `<div class="card"><div class="empty-state">${UI.icon('users', 30)}<p class="mt-8">${t('empty_admin_changes')}</p></div></div>`;
      return;
    }

    container.innerHTML = this.state.changeRequests.map(r => `
      <div class="card mt-16">
        <div class="card-title-row">
          <div>
            <h3>${r.establishment_name} <span class="text-muted text-sm">(${r.establishment_code})</span></h3>
            <div class="text-sm text-muted mt-8">
              ${t('old_admin_label')}: ${r.old_admin_first_name ? `${r.old_admin_first_name} ${r.old_admin_last_name}` : '—'}
              &nbsp;→&nbsp; ${t('new_admin_label')}: ${r.new_admin_first_name} ${r.new_admin_last_name} (${r.new_admin_email})
            </div>
          </div>
          ${UI.statusBadge(r.status)}
        </div>
        ${r.status === 'email_confirmed' ? `
          <div class="flex gap-8 mt-16">
            <button class="btn btn-primary btn-sm" data-action="validate" data-id="${r.id}">${t('btn_validate')}</button>
            <button class="btn btn-outline btn-sm" data-action="reject-change" data-id="${r.id}">${t('btn_reject')}</button>
          </div>
        ` : r.status === 'pending' ? `<div class="text-sm text-muted mt-8">${I18N.current === 'fr' ? "En attente de confirmation par email du nouveau titulaire." : "Awaiting email confirmation from the new administrator."}</div>` : ''}
        ${r.rejection_reason ? `<div class="text-sm mt-8" style="color:var(--color-danger)">${I18N.current === 'fr' ? 'Motif' : 'Reason'}: ${r.rejection_reason}</div>` : ''}
      </div>
    `).join('');

    container.querySelectorAll('[data-action="validate"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await API.validateAdminChangeRequest(btn.dataset.id);
          UI.toast(I18N.current === 'fr' ? 'Changement validé.' : 'Change validated.', 'success');
          await this.loadData(); this.paint();
        } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
      });
    });
    container.querySelectorAll('[data-action="reject-change"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const reason = prompt(t('reason_prompt')) || '';
        try {
          await API.rejectAdminChangeRequest(btn.dataset.id, reason);
          UI.toast(I18N.current === 'fr' ? 'Demande rejetée.' : 'Request rejected.', 'success');
          await this.loadData(); this.paint();
        } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
      });
    });
  },

  async handleEstablishmentAction(action, id) {
    if (action === 'coordinates') {
      this.paintCoordinatesForm(id);
      return;
    }
    try {
      if (action === 'approve') {
        await API.approveEstablishment(id);
        UI.toast(I18N.current === 'fr' ? 'Établissement approuvé.' : 'School approved.', 'success');
      } else if (action === 'reject') {
        const reason = prompt(t('reason_prompt')) || '';
        await API.rejectEstablishment(id, reason);
        UI.toast(I18N.current === 'fr' ? 'Établissement rejeté.' : 'School rejected.', 'success');
      } else if (action === 'suspend') {
        const reason = prompt(t('reason_prompt')) || '';
        await API.suspendEstablishment(id, reason);
        UI.toast(I18N.current === 'fr' ? 'Établissement suspendu.' : 'School suspended.', 'success');
      } else if (action === 'reactivate') {
        await API.reactivateEstablishment(id);
        UI.toast(I18N.current === 'fr' ? 'Établissement réactivé.' : 'School reactivated.', 'success');
      }
      await this.loadData();
      this.paint();
    } catch (err) {
      UI.toast(err.message || 'Erreur.', 'error');
    }
  },

  // -------------------------------------------------------------------
  // Tableau de bord national (section 18)
  // -------------------------------------------------------------------
  paintDashboard(container) {
    const ov = this.state.overview;
    if (!ov) {
      container.innerHTML = `<div class="card"><div class="boot-spinner" style="margin:20px auto;"></div></div>`;
      return;
    }

    const byStatus = Object.fromEntries((ov.establishments_by_status || []).map(c => [c.status, c.n]));

    container.innerHTML = `
      <div class="grid-2" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;">
        <div class="hero-card"><div class="hero-value">${ov.establishments_total}</div><p class="text-sm text-muted mt-8">${t('natstat_establishments')}</p><p class="text-xs text-muted mt-8">${byStatus.active || 0} ${t('status_active').toLowerCase()} · ${byStatus.pending || 0} ${t('status_pending').toLowerCase()}</p></div>
        <div class="hero-card"><div class="hero-value">${ov.students_total}</div><p class="text-sm text-muted mt-8">${t('natstat_students')}</p></div>
        <div class="hero-card"><div class="hero-value">${ov.teachers_total}</div><p class="text-sm text-muted mt-8">${t('natstat_teachers')}</p></div>
        <div class="hero-card"><div class="hero-value">${ov.success_rate.success_rate !== null ? ov.success_rate.success_rate + '%' : '—'}</div><p class="text-sm text-muted mt-8">${t('natstat_success_rate')}</p><p class="text-xs text-muted mt-8">${ov.success_rate.students_with_grades} ${I18N.current === 'fr' ? 'élèves évalués' : 'students assessed'}</p></div>
      </div>

      <h3 class="mt-24">${t('natstat_by_region')}</h3>
      <div class="card mt-16"><table style="width:100%;border-collapse:collapse;">
        <thead><tr style="text-align:left;font-size:12px;color:var(--color-text-muted);text-transform:uppercase;">
          <th style="padding:8px;">${t('field_region')}</th>
          <th style="padding:8px;">${t('natstat_establishments')}</th>
          <th style="padding:8px;">${t('natstat_students')}</th>
          <th style="padding:8px;">${t('natstat_teachers')}</th>
          <th style="padding:8px;">${t('natstat_success_rate')}</th>
          <th style="padding:8px;"></th>
        </tr></thead>
        <tbody>
          ${this.state.regions.map(r => `
            <tr style="border-top:1px solid var(--color-border);">
              <td style="padding:8px;">${r.region}</td>
              <td style="padding:8px;">${r.establishments}</td>
              <td style="padding:8px;">${r.students}</td>
              <td style="padding:8px;">${r.teachers}</td>
              <td style="padding:8px;">${r.success_rate !== null ? r.success_rate + '%' : '—'}</td>
              <td style="padding:8px;"><button class="btn btn-outline btn-sm" data-drill-region="${r.region}">${t('btn_view_departments')}</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table></div>
      <div id="department-drill-container" class="mt-16"></div>

      <h3 class="mt-24">${t('natstat_map')}</h3>
      <div class="card mt-16"><div id="national-map" style="height:420px;border-radius:8px;"></div></div>
    `;

    container.querySelectorAll('[data-drill-region]').forEach(btn => {
      btn.addEventListener('click', () => this.loadDepartments(container, btn.dataset.drillRegion));
    });

    this.renderMap(container);
  },

  async loadDepartments(container, region) {
    this.state.regionFilter = region;
    try {
      const data = await API.nationalStatsByDepartment(region);
      this.state.departments = data.departments;
    } catch (err) {
      UI.toast(err.message || 'Erreur.', 'error');
      return;
    }

    const box = container.querySelector('#department-drill-container');
    box.innerHTML = `
      <div class="card">
        <h4 style="font-size:14px;">${t('natstat_by_department')} — ${region}</h4>
        <table style="width:100%;border-collapse:collapse;margin-top:8px;">
          <thead><tr style="text-align:left;font-size:12px;color:var(--color-text-muted);text-transform:uppercase;">
            <th style="padding:8px;">${t('field_department')}</th>
            <th style="padding:8px;">${t('natstat_establishments')}</th>
            <th style="padding:8px;">${t('natstat_students')}</th>
            <th style="padding:8px;">${t('natstat_teachers')}</th>
            <th style="padding:8px;">${t('natstat_success_rate')}</th>
          </tr></thead>
          <tbody>
            ${this.state.departments.map(d => `
              <tr style="border-top:1px solid var(--color-border);">
                <td style="padding:8px;">${d.department}</td>
                <td style="padding:8px;">${d.establishments}</td>
                <td style="padding:8px;">${d.students}</td>
                <td style="padding:8px;">${d.teachers}</td>
                <td style="padding:8px;">${d.success_rate !== null ? d.success_rate + '%' : '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  renderMap(container) {
    const mapEl = container.querySelector('#national-map');
    if (!mapEl || typeof L === 'undefined') {
      if (mapEl) mapEl.innerHTML = `<p class="text-muted text-sm" style="padding:16px;">${t('map_unavailable')}</p>`;
      return;
    }

    // Centre approximatif du Cameroun.
    const map = L.map(mapEl).setView([5.5, 12.5], 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(map);

    if (!this.state.mapEstablishments.length) {
      mapEl.insertAdjacentHTML('afterend', `<p class="text-muted text-sm mt-8">${t('empty_map_establishments')}</p>`);
      return;
    }

    this.state.mapEstablishments.forEach(e => {
      const radius = Math.max(6, Math.min(20, 6 + Math.sqrt(e.student_count || 0)));
      L.circleMarker([parseFloat(e.latitude), parseFloat(e.longitude)], {
        radius, color: '#5B4FE5', fillColor: '#5B4FE5', fillOpacity: 0.5,
      }).bindPopup(`<strong>${e.name}</strong><br>${e.region} · ${e.department}<br>${e.student_count} ${I18N.current === 'fr' ? 'élèves' : 'students'}`)
        .addTo(map);
    });
  },
};
