/**
 * SCHOOLAR — Routeur SPA (hash-based, conformément à l'architecture
 * technique demandée : HTML5/CSS3/JS Vanilla, section 26 du cahier des charges)
 */
const App = {
  routes: [
    { pattern: '/login', page: () => LoginPage, public: true },
    { pattern: '/forgot-password', page: () => ForgotPasswordPage, public: true },
    { pattern: '/reset-password/:token', page: () => ResetPasswordPage, public: true },
    // Route ajoutée pour le flux Supabase Auth natif : le lien de
    // réinitialisation envoyé par Supabase place son propre jeton dans le
    // fragment d'URL (#access_token=...&type=recovery), qu'il consomme et
    // transforme lui-même en session temporaire AVANT que ce routeur ne lise
    // le hash — voir API.forgotPassword()/l'écouteur PASSWORD_RECOVERY dans
    // api.js. Le token n'a donc plus besoin d'être un segment de route.
    { pattern: '/reset-password', page: () => ResetPasswordPage, public: true },
    { pattern: '/setup-national-admin', page: () => SetupNationalAdminPage, public: true },
    { pattern: '/legal/:tab', page: () => LegalPage, public: true },
    { pattern: '/legal', page: () => LegalPage, public: true },
    { pattern: '/register-establishment', page: () => RegisterEstablishmentPage, public: true },
    { pattern: '/dashboard', page: () => DashboardPage, public: false },
    { pattern: '/change-password', page: () => ChangePasswordPage, public: false },
    { pattern: '/staff', page: () => StaffPage, public: false, roles: ['proviseur', 'principal', 'directeur', 'censeur', 'secretaire'] },
    { pattern: '/classes', page: () => ClassesPage, public: false, roles: ['proviseur', 'principal', 'directeur', 'censeur', 'surveillant_general', 'enseignant', 'professeur_principal'] },
    { pattern: '/students', page: () => StudentsPage, public: false, roles: ['proviseur', 'principal', 'directeur', 'censeur', 'surveillant_general', 'secretaire', 'econome', 'comptable', 'enseignant', 'professeur_principal'] },
    { pattern: '/grades', page: () => GradesPage, public: false, roles: ['proviseur', 'principal', 'directeur', 'censeur', 'surveillant_general', 'enseignant', 'professeur_principal'] },
    { pattern: '/attendance', page: () => AttendancePage, public: false, roles: ['proviseur', 'principal', 'directeur', 'censeur', 'surveillant_general', 'surveillant_secteur', 'enseignant', 'professeur_principal'] },
    { pattern: '/discipline', page: () => DisciplinePage, public: false, roles: ['proviseur', 'principal', 'directeur', 'censeur', 'surveillant_general', 'surveillant_secteur', 'professeur_principal'] },
    { pattern: '/timetable', page: () => TimetablePage, public: false, roles: ['proviseur', 'principal', 'directeur', 'censeur', 'surveillant_general', 'surveillant_secteur', 'enseignant', 'professeur_principal'] },
    { pattern: '/progression', page: () => ProgressionPage, public: false, roles: ['proviseur', 'principal', 'directeur', 'enseignant', 'professeur_principal'] },
    { pattern: '/homework', page: () => HomeworkPage, public: false, roles: ['proviseur', 'principal', 'directeur', 'enseignant', 'professeur_principal'] },
    { pattern: '/messages', page: () => MessagesPage, public: false, roles: ['proviseur', 'principal', 'directeur', 'censeur', 'surveillant_general', 'surveillant_secteur', 'econome', 'comptable', 'secretaire', 'enseignant', 'professeur_principal', 'parent'] },
    { pattern: '/announcements', page: () => AnnouncementsPage, public: false, roles: ['proviseur', 'principal', 'directeur', 'censeur', 'surveillant_general', 'surveillant_secteur', 'econome', 'comptable', 'secretaire', 'enseignant', 'professeur_principal', 'parent'] },
    { pattern: '/payments', page: () => PaymentsPage, public: false, roles: ['proviseur', 'principal', 'directeur', 'econome', 'comptable'] },
    { pattern: '/documents', page: () => DocumentsPage, public: false, roles: ['proviseur', 'principal', 'directeur', 'secretaire'] },
    { pattern: '/library', page: () => LibraryPage, public: false, roles: ['proviseur', 'principal', 'directeur', 'censeur', 'surveillant_general', 'surveillant_secteur', 'econome', 'comptable', 'secretaire', 'enseignant', 'professeur_principal', 'parent', 'eleve'] },
    { pattern: '/my-children', page: () => MyChildrenPage, public: false, roles: ['parent'] },
    { pattern: '/exams/:id', page: () => ExamTakingPage, public: false, roles: ['proviseur', 'principal', 'directeur', 'censeur', 'secretaire', 'econome', 'comptable', 'surveillant_general', 'surveillant_secteur', 'enseignant', 'professeur_principal', 'parent'] },
    { pattern: '/security', page: () => SecurityPage, public: false },
    { pattern: '/verify/:code', page: () => VerifyBulletinPage, public: true },
    { pattern: '/parent-invitation/confirm/:token', page: () => ParentInvitationConfirmPage, public: true },
    { pattern: '/admin-national', page: () => AdminNationalPage, public: false, roles: ['admin_national'] },
    { pattern: '/admin-change/request', page: () => AdminChangeRequestPage, public: false, roles: ['proviseur', 'principal', 'directeur', 'admin_national'] },
    { pattern: '/admin-change/confirm/:token', page: () => AdminChangeConfirmPage, public: true },
  ],

  root: null,

  init() {
    this.root = document.getElementById('app');
    document.documentElement.lang = I18N.current;
    window.addEventListener('hashchange', () => this.resolve());
    this.resolve();
  },

  currentPath() {
    const hash = window.location.hash.replace(/^#/, '');
    return hash || (Store.isAuthenticated() ? '/dashboard' : '/login');
  },

  matchRoute(path) {
    for (const route of this.routes) {
      const paramNames = [];
      const regexStr = '^' + route.pattern.replace(/:([a-zA-Z_]+)/g, (_, name) => {
        paramNames.push(name);
        return '([^/]+)';
      }) + '$';
      const match = path.match(new RegExp(regexStr));
      if (match) {
        const params = {};
        paramNames.forEach((name, i) => { params[name] = match[i + 1]; });
        return { route, params };
      }
    }
    return null;
  },

  resolve() {
    const path = this.currentPath();
    const matched = this.matchRoute(path);

    if (!matched) {
      window.location.hash = Store.isAuthenticated() ? '#/dashboard' : '#/login';
      return;
    }

    const { route, params } = matched;
    const user = Store.getUser();

    if (!route.public && !Store.isAuthenticated()) {
      window.location.hash = '#/login';
      return;
    }

    if (route.public && Store.isAuthenticated() && path === '/login') {
      window.location.hash = '#/dashboard';
      return;
    }

    if (route.roles && user && !route.roles.includes(user.role_code)) {
      window.location.hash = '#/dashboard';
      return;
    }

    if (user && user.must_change_password && path !== '/change-password') {
      window.location.hash = '#/change-password';
      return;
    }
    if (path === '/change-password' && user && !user.must_change_password) {
      window.location.hash = '#/dashboard';
      return;
    }

    route.page().render(this.root, params);
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
