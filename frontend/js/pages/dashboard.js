/**
 * SCHOOLAR — Squelette du tableau de bord
 * Étape 1 : structure de base. Étape 2 : navigation vers l'espace national
 * et le changement d'administrateur, selon le rôle connecté.
 * Les modules pédagogiques (classes, notes, présences...) arrivent aux étapes suivantes.
 */
const DashboardPage = {
  buildNavItems(user) {
    const items = [
      { icon: 'graph', label_fr: 'Tableau de bord', label_en: 'Dashboard', href: '#/dashboard', active: true },
    ];

    if (['proviseur', 'principal', 'directeur', 'censeur', 'surveillant_general', 'enseignant', 'professeur_principal'].includes(user.role_code)) {
      items.push({ icon: 'graph', label_fr: t('nav_classes'), label_en: t('nav_classes'), href: '#/classes' });
    }
    if (['proviseur', 'principal', 'directeur', 'censeur', 'surveillant_general', 'secretaire', 'econome', 'comptable', 'enseignant', 'professeur_principal'].includes(user.role_code)) {
      items.push({ icon: 'users', label_fr: t('nav_students'), label_en: t('nav_students'), href: '#/students' });
    }
    if (['proviseur', 'principal', 'directeur', 'censeur', 'surveillant_general', 'enseignant', 'professeur_principal'].includes(user.role_code)) {
      items.push({ icon: 'graph', label_fr: t('nav_grades'), label_en: t('nav_grades'), href: '#/grades' });
    }
    if (['proviseur', 'principal', 'directeur', 'censeur', 'surveillant_general', 'surveillant_secteur', 'enseignant', 'professeur_principal'].includes(user.role_code)) {
      items.push({ icon: 'users', label_fr: t('nav_attendance'), label_en: t('nav_attendance'), href: '#/attendance' });
    }
    if (['proviseur', 'principal', 'directeur', 'censeur', 'surveillant_general', 'surveillant_secteur', 'professeur_principal'].includes(user.role_code)) {
      items.push({ icon: 'info', label_fr: t('nav_discipline'), label_en: t('nav_discipline'), href: '#/discipline' });
    }
    if (['proviseur', 'principal', 'directeur', 'censeur', 'surveillant_general', 'surveillant_secteur', 'enseignant', 'professeur_principal'].includes(user.role_code)) {
      items.push({ icon: 'graph', label_fr: t('nav_timetable'), label_en: t('nav_timetable'), href: '#/timetable' });
    }
    if (['proviseur', 'principal', 'directeur', 'enseignant', 'professeur_principal'].includes(user.role_code)) {
      items.push({ icon: 'graph', label_fr: t('nav_progression'), label_en: t('nav_progression'), href: '#/progression' });
      items.push({ icon: 'users', label_fr: t('nav_homework'), label_en: t('nav_homework'), href: '#/homework' });
    }
    if (user.role_scope === 'family') {
      items.push({ icon: 'users', label_fr: t('nav_my_children'), label_en: t('nav_my_children'), href: '#/my-children' });
    }
    if (user.role_code !== 'admin_national') {
      items.push({ icon: 'bell', label_fr: t('nav_announcements'), label_en: t('nav_announcements'), href: '#/announcements' });
      items.push({ icon: 'mail', label_fr: t('nav_messages'), label_en: t('nav_messages'), href: '#/messages' });
    }
    if (['proviseur', 'principal', 'directeur', 'econome', 'comptable'].includes(user.role_code)) {
      items.push({ icon: 'graph', label_fr: t('nav_payments'), label_en: t('nav_payments'), href: '#/payments' });
    }
    if (['proviseur', 'principal', 'directeur', 'secretaire'].includes(user.role_code)) {
      items.push({ icon: 'building', label_fr: t('nav_documents'), label_en: t('nav_documents'), href: '#/documents' });
    }
    if (user.role_code !== 'admin_national') {
      items.push({ icon: 'graph', label_fr: t('nav_library'), label_en: t('nav_library'), href: '#/library' });
    }
    if (['proviseur', 'principal', 'directeur', 'censeur', 'secretaire'].includes(user.role_code)) {
      items.push({ icon: 'users', label_fr: t('nav_staff'), label_en: t('nav_staff'), href: '#/staff' });
    }
    if (['proviseur', 'principal', 'directeur'].includes(user.role_code)) {
      items.push({ icon: 'arrowRight', label_fr: t('nav_change_admin'), label_en: t('nav_change_admin'), href: '#/admin-change/request' });
    }
    if (user.role_code === 'admin_national') {
      items.push({ icon: 'building', label_fr: 'Établissements', label_en: 'Schools', href: '#/admin-national' });
    }
    items.push({ icon: 'lock', label_fr: t('nav_security'), label_en: t('nav_security'), href: '#/security' });
    return items;
  },

  render(root) {
    const user = Store.getUser();
    if (!user) {
      window.location.hash = '#/login';
      return;
    }

    const body = `
      <div class="hero-card">
        <div class="hero-top">
          <div>
            <div class="text-sm" style="opacity:.85">${I18N.current === 'fr' ? user.role_label_fr : user.role_label_en}</div>
            <div class="hero-value mt-8">${user.establishment_name || 'SCHOOLAR'}</div>
          </div>
          <span class="pill">${user.establishment_id ? (I18N.current === 'fr' ? 'Espace établissement' : 'School space') : (I18N.current === 'fr' ? 'Espace national' : 'National space')}</span>
        </div>
        <p style="opacity:.9">${I18N.current === 'fr'
          ? "Bienvenue sur SCHOOLAR. Les modules Classes, Notes, Présences, Discipline et Communication seront activés au fil des prochaines livraisons du projet."
          : "Welcome to SCHOOLAR. The Classes, Grades, Attendance, Discipline and Communication modules will be enabled in upcoming project deliveries."}</p>
      </div>

      <div class="stat-grid mt-24">
        <div class="stat-card">
          <div class="stat-icon">${UI.icon('users', 18)}</div>
          <div class="stat-label">${I18N.current === 'fr' ? 'Compte' : 'Account'}</div>
          <div class="stat-value" style="font-size:16px">${user.email}</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">${UI.icon('building', 18)}</div>
          <div class="stat-label">${I18N.current === 'fr' ? 'Rôle' : 'Role'}</div>
          <div class="stat-value" style="font-size:16px">${I18N.current === 'fr' ? user.role_label_fr : user.role_label_en}</div>
        </div>
      </div>
    `;

    UI.renderShell(root, { user, navItems: this.buildNavItems(user), pageBodyHtml: body });
  },
};
