/**
 * SCHOOLAR — Vie scolaire : réunions et événements de l'établissement
 * Lecture : tous les rôles (selon l'audience). Création : direction, secrétariat ;
 * enseignants pour leurs classes uniquement (règles appliquées par la base, migration 0023).
 */
const EventsPage = {
  state: { events: [], classes: [], showForm: false },

  ADMIN_ROLES: ['proviseur', 'principal', 'directeur', 'censeur', 'surveillant_general', 'secretaire'],
  TEACHER_ROLES: ['enseignant', 'professeur_principal'],

  async render(root) {
    const user = Store.getUser();
    if (!user) { window.location.hash = '#/login'; return; }
    this.root = root;
    this.user = user;
    this.isAdmin = this.ADMIN_ROLES.includes(user.role_code);
    this.isTeacher = this.TEACHER_ROLES.includes(user.role_code);
    this.canCreate = this.isAdmin || this.isTeacher;

    if (this.canCreate) {
      try { const d = await API.listClasses(); this.state.classes = d.classes; } catch { /* silencieux */ }
    }
    await this.loadEvents();
    this.paint();
  },

  async loadEvents() {
    try {
      const d = await API.listEvents();
      this.state.events = d.events;
    } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
  },

  paint() {
    const navItems = DashboardPage.buildNavItems(this.user).map(i => ({ ...i, active: i.href === '#/events' }));
    const body = `
      <div class="flex justify-between items-center">
        <div>
          <h2>${t('events_title')}</h2>
          <p class="text-muted text-sm mt-8">${t('events_subtitle')}</p>
        </div>
        ${this.canCreate ? `<button class="btn btn-primary btn-sm" id="btn-new-event">${t('btn_new_event')}</button>` : ''}
      </div>
      <div id="event-form-container" class="mt-16"></div>
      <div id="event-list-container" class="mt-24"></div>
    `;
    this.content = UI.renderShell(this.root, { user: this.user, navItems, pageBodyHtml: body });

    if (this.canCreate) {
      this.content.querySelector('#btn-new-event').addEventListener('click', () => {
        this.state.showForm = true;
        this.paintForm();
      });
    }
    this.paintList();
  },

  classLabel(c) {
    return `${c.level}${c.series ? ' ' + c.series : ''}${c.section ? ' ' + c.section : ''}`;
  },

  paintForm() {
    const container = this.content.querySelector('#event-form-container');
    if (!this.state.showForm) { container.innerHTML = ''; return; }

    container.innerHTML = `
      <div class="card" style="max-width:640px;">
        <div class="field-group">
          <label class="field-label">${t('field_title')}</label>
          <div class="field-input-wrap"><input id="ev-title" maxlength="200"></div>
        </div>
        <div class="field-group mt-16">
          <label class="field-label">${t('field_event_type')}</label>
          <div class="field-input-wrap">
            <select id="ev-type">
              ${['reunion', 'evenement', 'examen', 'conge'].map(k => `<option value="${k}">${t('event_type_' + k)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field-group mt-16">
          <label class="field-label">${t('field_event_start')}</label>
          <div class="field-input-wrap"><input id="ev-start" type="datetime-local"></div>
        </div>
        <div class="field-group mt-16">
          <label class="field-label">${t('field_event_end')}</label>
          <div class="field-input-wrap"><input id="ev-end" type="datetime-local"></div>
        </div>
        <div class="field-group mt-16">
          <label class="field-label">${t('field_location')}</label>
          <div class="field-input-wrap"><input id="ev-location" maxlength="200"></div>
        </div>
        <div class="field-group mt-16">
          <label class="field-label">${t('field_description')}</label>
          <div class="field-input-wrap"><input id="ev-description" maxlength="2000"></div>
        </div>
        <div class="field-group mt-16">
          <label class="field-label">${t('field_audience')}</label>
          <div class="field-input-wrap">
            <select id="ev-audience">
              ${this.isAdmin ? `
                <option value="all">${t('audience_all_establishment')}</option>
                <option value="parents">${t('audience_all_parents')}</option>
                <option value="staff">${t('audience_all_staff')}</option>
              ` : ''}
              <option value="class">${t('audience_class')}</option>
            </select>
          </div>
        </div>
        <div class="field-group mt-16" id="ev-class-wrap" style="${this.isAdmin ? 'display:none;' : ''}">
          <label class="field-label">${t('field_class')}</label>
          <div class="field-input-wrap">
            <select id="ev-class">
              ${this.state.classes.map(c => `<option value="${c.id}">${UI.esc(this.classLabel(c))}</option>`).join('')}
            </select>
          </div>
        </div>
        <div id="ev-form-error"></div>
        <div class="flex gap-8 mt-24">
          <button class="btn btn-primary btn-sm" id="ev-form-submit">${t('btn_new_event')}</button>
          <button class="btn btn-outline btn-sm" id="ev-form-cancel">${t('btn_cancel')}</button>
        </div>
      </div>
    `;

    const audienceSelect = container.querySelector('#ev-audience');
    const classWrap = container.querySelector('#ev-class-wrap');
    audienceSelect.addEventListener('change', () => {
      classWrap.style.display = audienceSelect.value === 'class' ? 'block' : 'none';
    });
    container.querySelector('#ev-form-cancel').addEventListener('click', () => { this.state.showForm = false; this.paintForm(); });
    container.querySelector('#ev-form-submit').addEventListener('click', async () => {
      const errorBox = container.querySelector('#ev-form-error');
      errorBox.innerHTML = '';
      const start = container.querySelector('#ev-start').value;
      const end = container.querySelector('#ev-end').value;
      const title = container.querySelector('#ev-title').value.trim();
      if (!title || !start) {
        errorBox.innerHTML = `<div class="alert alert-error mt-8">${t('validation_missing_fields')}</div>`;
        return;
      }
      const audience = audienceSelect.value;
      const payload = {
        title,
        event_type: container.querySelector('#ev-type').value,
        starts_at: new Date(start).toISOString(),
        ends_at: end ? new Date(end).toISOString() : null,
        location: container.querySelector('#ev-location').value.trim() || null,
        description: container.querySelector('#ev-description').value.trim() || null,
        audience,
        class_id: audience === 'class' ? container.querySelector('#ev-class').value : null,
      };
      try {
        await API.createEvent(payload);
        UI.toast(t('event_created'), 'success');
        this.state.showForm = false;
        await this.loadEvents();
        this.paint();
      } catch (err) {
        errorBox.innerHTML = `<div class="alert alert-error mt-8">${UI.esc(err.message || 'Erreur.')}</div>`;
      }
    });
  },

  audienceLabel(e) {
    if (e.audience === 'class') return e.classes ? this.classLabel(e.classes) : t('audience_class');
    return { all: t('audience_all_establishment'), parents: t('audience_all_parents'), staff: t('audience_all_staff') }[e.audience] || '';
  },

  canDelete(e) {
    return e.created_by_profile_id === this.user.id || ['proviseur', 'principal', 'directeur', 'censeur'].includes(this.user.role_code);
  },

  card(e, past) {
    const locale = I18N.current === 'fr' ? 'fr-FR' : 'en-GB';
    const when = new Date(e.starts_at).toLocaleString(locale, { dateStyle: 'full', timeStyle: 'short' });
    return `
      <div class="card mt-16" style="${past ? 'opacity:.6;' : ''}">
        <div class="card-title-row">
          <div>
            <strong>${UI.esc(e.title)}</strong>
            <span class="badge" style="margin-left:8px;">${t('event_type_' + e.event_type)}</span>
            <div class="text-sm text-muted mt-8">${UI.esc(when)}${e.location ? ' · ' + UI.esc(e.location) : ''}</div>
            <div class="text-sm text-muted">${t('field_audience')} : ${UI.esc(this.audienceLabel(e))}</div>
          </div>
          ${this.canDelete(e) ? `<button class="btn btn-outline btn-sm" data-delete-event="${e.id}">${t('btn_delete')}</button>` : ''}
        </div>
        ${e.description ? `<p class="text-sm mt-8">${UI.esc(e.description)}</p>` : ''}
      </div>`;
  },

  paintList() {
    const container = this.content.querySelector('#event-list-container');
    if (!this.state.events.length) {
      container.innerHTML = `<div class="card"><div class="empty-state">${UI.icon('bell', 30)}<p class="mt-8">${t('empty_events')}</p></div></div>`;
      return;
    }
    const limit = Date.now() - 24 * 3600 * 1000;
    const upcoming = this.state.events.filter(e => new Date(e.starts_at).getTime() >= limit);
    const past = this.state.events.filter(e => new Date(e.starts_at).getTime() < limit).reverse();

    container.innerHTML = `
      <h3 class="text-sm" style="text-transform:uppercase;letter-spacing:.04em;">${t('events_upcoming')}</h3>
      ${upcoming.length ? upcoming.map(e => this.card(e, false)).join('') : `<p class="text-muted text-sm mt-8">${t('empty_events')}</p>`}
      ${past.length ? `<h3 class="text-sm mt-24" style="text-transform:uppercase;letter-spacing:.04em;">${t('events_past')}</h3>${past.map(e => this.card(e, true)).join('')}` : ''}
    `;

    container.querySelectorAll('[data-delete-event]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(t('event_delete_confirm'))) return;
        try {
          await API.deleteEvent(btn.dataset.deleteEvent);
          await this.loadEvents();
          this.paintList();
        } catch (err) { UI.toast(err.message || 'Erreur.', 'error'); }
      });
    });
  },
};
