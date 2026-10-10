/**
 * SCHOOLAR — Client API (Supabase)
 * ------------------------------------------------------------------
 * Toutes les requêtes transitaient auparavant par le backend PHP ; elles
 * passent maintenant par Supabase : requêtes directes aux tables protégées
 * par Row Level Security (via supabase-js), fonctions SQL (RPC), et Edge
 * Functions pour tout ce qui nécessite une action privilégiée (créer un
 * compte, envoyer un email, uploader un fichier...).
 *
 * IMPORTANT — CE FICHIER EST LE SEUL QUI A CHANGÉ CÔTÉ TRANSPORT : chaque
 * méthode ci-dessous garde exactement le même nom et la même signature que
 * l'ancien client PHP, pour qu'aucune page (js/pages/*.js) n'ait besoin
 * d'être modifiée. C'est le principe même de cette conversion.
 *
 * Prérequis chargés AVANT ce fichier (voir index.html) :
 *   - env-config.js définissant window.SCHOOLAR_SUPABASE_URL / SCHOOLAR_SUPABASE_ANON_KEY
 *   - le script CDN @supabase/supabase-js (expose window.supabase.createClient)
 */

const _sb = window.supabase.createClient(
  window.SCHOOLAR_SUPABASE_URL,
  window.SCHOOLAR_SUPABASE_ANON_KEY,
);

// Cache synchrone du jeton courant : mis à jour à chaque connexion,
// déconnexion, ET rafraîchissement automatique de session par supabase-js.
// C'est ce cache (pas le localStorage) qui garantit qu'un jeton expiré n'est
// jamais utilisé pour appeler une Edge Function.
let _cachedToken = null;
let _cachedSupabaseUser = null;
_sb.auth.onAuthStateChange((_event, session) => {
  _cachedToken = session?.access_token ?? null;
  _cachedSupabaseUser = session?.user ?? null;
  if (!session && typeof Store !== 'undefined') Store.clearSession();

  // Le lien "mot de passe oublié" de Supabase Auth établit une session de
  // récupération temporaire et place ses propres paramètres dans le hash de
  // l'URL (#access_token=...&type=recovery) — incompatible avec un jeton
  // dans le CHEMIN comme le faisait le PHP d'origine (#/reset-password/:token).
  // Une fois ces paramètres consommés par supabase-js, on redirige vers la
  // page de réinitialisation (route sans jeton, voir js/app.js) ; le
  // formulaire utilise ensuite directement cette session de récupération.
  if (_event === 'PASSWORD_RECOVERY') {
    window.location.hash = '#/reset-password';
  }
});

// ----------------------------------------------------------------------
// Dictionnaire des messages d'erreur (les codes ci-dessous sont ceux
// renvoyés par les Edge Functions / fonctions SQL — voir le projet
// schoolar-supabase). Repli sur un message générique si un code n'est pas
// listé : aucune page n'affichera jamais un code brut à l'utilisateur.
// ----------------------------------------------------------------------
const _ERR_FR = {
  validation_missing_fields: "Merci de renseigner tous les champs requis.",
  unauthorized: "Vous devez être connecté(e) pour effectuer cette action.",
  forbidden: "Action non autorisée.",
  method_not_allowed: "Action non autorisée.",
  route_not_found: "Fonctionnalité non disponible.",
  resource_not_found: "Ressource introuvable.",
  server_error: "Une erreur est survenue. Veuillez réessayer.",
  too_many_requests: "Trop de tentatives. Merci de patienter avant de réessayer.",
  unknown_action: "Action inconnue.",
  network: "Impossible de contacter le serveur. Vérifiez votre connexion.",

  login_credentials_required: "Email/matricule et mot de passe requis.",
  login_invalid_credentials: "Identifiants incorrects.",
  account_locked: "Compte temporairement verrouillé suite à plusieurs échecs. Réessayez dans 15 minutes.",
  account_status_blocked: "Ce compte n'est plus actif.",
  establishment_not_active: "Cet établissement n'est pas (ou plus) actif.",
  national_admin_already_exists: "Un administrateur national existe déjà.",
  admin_password_min_length: "Le mot de passe doit contenir au moins 8 caractères.",
  password_min_length: "Le mot de passe doit contenir au moins 8 caractères.",
  admin_role_invalid: "Rôle administrateur invalide pour ce type d'établissement.",
  education_level_invalid: "Niveau d'enseignement invalide.",
  sector_invalid: "Secteur invalide.",
  establishment_type_invalid: "Type d'établissement invalide.",
  establishment_email_conflict: "Cet email est déjà utilisé.",
  establishment_creation_error: "Erreur lors de la création de l'établissement.",
  establishment_not_found: "Établissement introuvable.",
  establishment_invalid_transition: "Cette action n'est plus possible pour ce statut d'établissement.",
  account_verification_not_found: "Aucune vérification en attente pour ce compte.",
  account_verification_invalid_code: "Code de vérification incorrect ou expiré.",
  account_verification_too_soon: "Merci de patienter avant de redemander un code.",

  staff_email_conflict: "Cet email est déjà utilisé.",
  staff_creation_error: "Erreur lors de la création du compte.",
  staff_not_found: "Membre du personnel introuvable.",
  staff_role_invalid: "Rôle invalide pour cette action.",

  student_not_found: "Élève introuvable.",
  student_manage_denied: "Vous n'avez pas les droits nécessaires pour cette action.",
  student_no_class: "Cet élève n'est rattaché à aucune classe.",
  student_account_already_exists: "Un compte de connexion existe déjà pour cet élève.",
  student_login_not_available_primary: "Compte de connexion élève non disponible pour le primaire.",
  subject_not_found: "Matière introuvable.",
  class_not_found: "Classe introuvable.",
  class_subject_not_found: "Matière de classe introuvable.",
  class_access_denied: "Vous n'avez pas accès à cette classe.",
  invitation_already_pending: "Une invitation est déjà en attente pour ce parent.",
  invitation_link_invalid: "Lien d'invitation invalide.",
  invitation_already_used: "Cette invitation a déjà été utilisée.",
  parent_email_conflict: "Cet email est déjà utilisé.",
  parent_space_creation_error: "Erreur lors de la création de l'espace parent.",

  grade_out_of_range: "La note doit être comprise entre 0 et le barème.",
  grade_change_reason_required: "Un motif est requis pour un écart de note important.",
  grades_locked: "Cette séquence a déjà été validée : les notes ne sont plus modifiables.",
  grades_entry_denied: "Vous n'avez pas le droit de saisir des notes pour cette matière.",
  grades_missing_warning: "Des notes sont manquantes pour cette séquence.",
  grades_validation_denied: "Vous n'avez pas le droit de valider cette séquence.",
  sequence_not_found: "Séquence introuvable.",

  attendance_mark_denied: "Vous n'avez pas le droit de faire l'appel pour cette matière.",
  attendance_not_absent: "Cet élève n'est pas marqué absent ou en retard.",
  attendance_record_not_found: "Enregistrement de présence introuvable.",

  discipline_category_invalid: "Catégorie de signalement invalide.",
  discipline_access_denied: "Vous n'avez pas accès à cette information.",
  discipline_already_resolved: "Ce dossier a déjà été résolu.",

  timetable_conflict: "Ce créneau entre en conflit avec un autre déjà existant.",
  timetable_invalid_range: "L'heure de fin doit être après l'heure de début.",
  timetable_entry_not_found: "Créneau introuvable.",
  timetable_manage_denied: "Vous n'avez pas le droit de modifier l'emploi du temps.",

  progression_item_not_found: "Leçon introuvable.",
  progression_already_completed: "Cette leçon est déjà marquée comme terminée.",

  homework_assignment_not_found: "Devoir introuvable.",
  homework_file_required: "Un fichier est requis.",
  homework_student_wrong_class: "Cet élève n'appartient pas à cette classe.",
  homework_submission_error: "Erreur lors du dépôt du devoir.",
  homework_submission_not_found: "Soumission introuvable.",
  homework_upload_file_too_large: "Le fichier est trop volumineux.",
  homework_upload_invalid_type: "Type de fichier non autorisé (PDF ou Word uniquement).",

  messaging_cannot_message_self: "Vous ne pouvez pas vous envoyer un message à vous-même.",
  messaging_recipient_not_found: "Destinataire introuvable.",
  messaging_access_denied: "Vous n'avez pas accès à cette conversation.",
  messaging_body_required: "Le message ne peut pas être vide.",

  announcement_audience_invalid: "Audience invalide.",
  announcement_class_required: "Une classe doit être sélectionnée pour cette audience.",
  announcement_audience_denied: "Vous n'avez pas le droit de publier pour cette audience.",

  document_category_invalid: "Catégorie de document invalide.",
  document_file_required: "Un fichier est requis.",
  document_student_required: "Un élève doit être sélectionné pour cette catégorie.",
  document_upload_error: "Erreur lors de l'envoi du document.",
  document_upload_file_too_large: "Le fichier est trop volumineux.",
  document_manage_denied: "Vous n'avez pas le droit de gérer les documents.",
  document_must_be_trashed_first: "Le document doit d'abord être mis à la corbeille.",
  document_not_found: "Document introuvable.",

  library_category_invalid: "Catégorie invalide.",
  library_file_required: "Un fichier est requis.",
  library_upload_error: "Erreur lors de l'envoi de la ressource.",
  library_upload_file_too_large: "Le fichier est trop volumineux.",
  library_manage_denied: "Vous n'avez pas le droit de gérer la bibliothèque.",
  library_must_be_trashed_first: "La ressource doit d'abord être mise à la corbeille.",
  library_resource_not_found: "Ressource introuvable.",

  orientation_no_grades: "Aucune note disponible pour générer une analyse d'orientation.",
  concours_subscription_required: "Un abonnement Préparation aux concours actif est requis.",
  concours_quota_exceeded: "Quota d'épreuves atteint pour cet abonnement.",
  concours_tier_invalid: "Formule d'abonnement invalide.",
  concours_already_active: "Un abonnement est déjà actif pour cette année scolaire.",
  bulletin_no_grades: "Aucune note disponible pour générer ce bulletin.",
  bulletin_subscription_required: "Un abonnement Bulletins IA actif est requis.",
  bulletin_subscription_already_active: "Un abonnement est déjà actif pour cette année scolaire.",
  exam_not_found: "Épreuve introuvable.",
  exam_not_started: "Cette épreuve n'a pas encore été démarrée.",
  exam_already_submitted: "Cette épreuve a déjà été soumise.",
  ai_not_configured: "Le service d'intelligence artificielle n'est pas configuré sur ce serveur.",
  ai_provider_error: "Le service d'intelligence artificielle est momentanément indisponible.",
  ai_invalid_json: "Réponse inattendue du service d'intelligence artificielle. Réessayez.",

  premium_parent_only: "Réservé aux parents.",
  premium_required: "Un abonnement Premium Parents actif est requis.",
  premium_already_active: "Un abonnement est déjà actif.",
  payment_method_invalid: "Méthode de paiement invalide.",
  payment_amount_invalid: "Montant invalide.",
  payment_exceeds_balance: "Le montant dépasse le solde restant dû.",
  payment_not_found: "Paiement introuvable.",
  payment_not_pending: "Ce paiement n'est plus en attente.",
  payment_confirmation_error: "Erreur lors de la confirmation du paiement.",
  invoice_not_found: "Facture introuvable.",
  fee_structure_not_found: "Frais introuvable.",
  no_current_school_year: "Aucune année scolaire en cours n'est définie.",
  receipt_not_available: "Le reçu n'est pas encore disponible.",

  admin_change_establishment_not_found: "Établissement introuvable.",
  admin_change_already_pending: "Une demande est déjà en cours pour cet établissement.",
  admin_change_request_not_found: "Demande introuvable.",
  admin_change_needs_email_confirmation: "Le nouveau titulaire doit d'abord confirmer par email.",
  admin_change_already_processed: "Cette demande a déjà été traitée.",
  admin_change_cannot_reject: "Cette demande ne peut plus être rejetée.",
  admin_change_validation_error: "Erreur lors de la validation du changement d'administrateur.",
  invalid_confirmation_link: "Lien de confirmation invalide.",

  api_key_invalid: "Clé d'API invalide ou révoquée.",
};

function _errMessage(code) {
  if (!code) return "Une erreur est survenue. Veuillez réessayer.";
  const base = String(code).split(':')[0];
  return _ERR_FR[base] || _ERR_FR[code] || "Une erreur est survenue. Veuillez réessayer.";
}

function _throwNormalized(code, details) {
  throw { success: false, message: _errMessage(code), code, details };
}

// ----------------------------------------------------------------------
// Helpers de transport bas niveau
// ----------------------------------------------------------------------
const FUNCTIONS_URL = (window.SCHOOLAR_SUPABASE_URL || '').replace(/\/$/, '') + '/functions/v1';

async function _edge(path, body, { method = 'POST', auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Lang': (typeof I18N !== 'undefined' ? I18N.current : 'fr') };
  if (auth && _cachedToken) headers['Authorization'] = `Bearer ${_cachedToken}`;

  let response;
  try {
    response = await fetch(`${FUNCTIONS_URL}/${path}`, { method, headers, body: body ? JSON.stringify(body) : (method === 'GET' ? undefined : '{}') });
  } catch {
    throw { success: false, message: _ERR_FR.network, network: true };
  }

  let json;
  try { json = await response.json(); } catch { throw { success: false, message: "Réponse inattendue du serveur." }; }

  if (!response.ok || json.success === false || json.error) {
    if (response.status === 401 && typeof Store !== 'undefined') Store.clearSession();
    _throwNormalized(json.error, json.details);
  }
  return json.data;
}

async function _edgeForm(path, formData) {
  const headers = { 'X-Lang': (typeof I18N !== 'undefined' ? I18N.current : 'fr') };
  if (_cachedToken) headers['Authorization'] = `Bearer ${_cachedToken}`;

  let response;
  try {
    response = await fetch(`${FUNCTIONS_URL}/${path}`, { method: 'POST', headers, body: formData });
  } catch {
    throw { success: false, message: _ERR_FR.network, network: true };
  }
  let json;
  try { json = await response.json(); } catch { throw { success: false, message: "Réponse inattendue du serveur." }; }
  if (!response.ok || json.success === false || json.error) {
    if (response.status === 401 && typeof Store !== 'undefined') Store.clearSession();
    _throwNormalized(json.error, json.details);
  }
  return json.data;
}

async function _rpc(name, args = {}) {
  const { data, error } = await _sb.rpc(name, args);
  if (error) {
    // Un message levé par une fonction SQL ("raise exception 'code'") arrive
    // ici sous forme de texte brut (parfois suivi de détails après ':' ou '%').
    const code = (error.message || '').trim().split(/[\s:%]/)[0];
    _throwNormalized(code || 'server_error');
  }
  return data;
}

async function _query(promise) {
  const { data, error } = await promise;
  if (error) {
    if (error.code === '23505') _throwNormalized('duplicate_entry');
    _throwNormalized(error.message || 'server_error');
  }
  return data;
}

function _signedDownloadUrl(fnName, idParam, id) {
  const token = encodeURIComponent(_cachedToken || '');
  return `${FUNCTIONS_URL}/${fnName}?${idParam}=${encodeURIComponent(id)}&token=${token}`;
}

// Aplati une relation imbriquée renvoyée par PostgREST (ex: { roles: { code }})
// vers le champ plat que les pages attendent (role_code), comme le faisait
// la jointure SQL PHP d'origine.
function _flattenRole(row) {
  if (!row) return row;
  const { roles, ...rest } = row;
  return { ...rest, role_code: roles?.code, role_label_fr: roles?.label_fr, role_label_en: roles?.label_en };
}

const API = {
  // Conservé pour compatibilité : plus utilisé en interne (voir _edge), mais
  // certaines pages peuvent encore le lire.
  baseUrl: FUNCTIONS_URL,
  supabaseClient: _sb,
  getCachedToken() { return _cachedToken; },
  getCachedSupabaseUser() { return _cachedSupabaseUser; },

  // ==================== Auth ====================
  async login(payload) {
    const data = await _edge('auth-login', payload, { auth: false });
    if (data.token && data.refresh_token) {
      await _sb.auth.setSession({ access_token: data.token, refresh_token: data.refresh_token });
    }
    return data;
  },

  async login2fa(_challengeToken, code) {
    const { data: factorsData, error: factorsError } = await _sb.auth.mfa.listFactors();
    if (factorsError) _throwNormalized('server_error');
    const factor = (factorsData?.totp || [])[0];
    if (!factor) _throwNormalized('server_error');

    const { data: challenge, error: challengeError } = await _sb.auth.mfa.challenge({ factorId: factor.id });
    if (challengeError) _throwNormalized('server_error');

    const { data: verify, error: verifyError } = await _sb.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.id, code });
    if (verifyError) _throwNormalized('login_invalid_credentials');

    const profile = _flattenRole(await _query(_sb.from('profiles').select('id, email, first_name, last_name, establishment_id, must_change_password, roles(code), establishments!profiles_establishment_id_fkey(education_level)').eq('id', verify.user.id).single()));
    return { token: verify.access_token, user: { id: profile.id, email: profile.email, role_code: profile.role_code, establishment_id: profile.establishment_id, establishment_education_level: profile.establishments?.education_level ?? null, totp_enabled: true, must_change_password: profile.must_change_password } };
  },

  registerEstablishment(payload) { return _edge('auth-register-establishment', payload, { auth: false }); },

  async forgotPassword(email) {
    // Pas de fragment de route dans redirectTo : Supabase y ajoute ses
    // propres paramètres de récupération juste après le "#", ce que son
    // détecteur automatique (detectSessionInUrl) sait lire de façon fiable.
    // C'est le listener PASSWORD_RECOVERY ci-dessus qui navigue ensuite vers
    // l'écran de saisie du nouveau mot de passe.
    const { error } = await _sb.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}${window.location.pathname}`,
    });
    if (error) _throwNormalized('server_error');
    return {};
  },

  registerNationalAdmin(payload) { return _edge('auth-register-national-admin', payload, { auth: false }); },
  nationalAdminBootstrapStatus() { return _edge('auth-register-national-admin', null, { method: 'GET', auth: false }); },

  async resetPassword(_token, newPassword) {
    // Le lien envoyé par Supabase Auth établit déjà une session temporaire
    // dans ce navigateur ; on ne fait que définir le nouveau mot de passe.
    const { error } = await _sb.auth.updateUser({ password: newPassword });
    if (error) _throwNormalized('password_min_length');
    return {};
  },

  async me() {
    if (!_cachedSupabaseUser) _throwNormalized('unauthorized');
    const profile = _flattenRole(await _query(
      _sb.from('profiles').select('id, email, first_name, last_name, phone, photo_url, language_pref, establishment_id, must_change_password, roles(code, label_fr, label_en), establishments!profiles_establishment_id_fkey(education_level)').eq('id', _cachedSupabaseUser.id).single()
    ));
    const { data: factors } = await _sb.auth.mfa.listFactors();
    const totpEnabled = (factors?.totp || []).some((f) => f.status === 'verified');
    return { user: { ...profile, establishment_education_level: profile.establishments?.education_level ?? null, totp_enabled: totpEnabled } };
  },

  async logout() {
    await _sb.auth.signOut();
    return {};
  },

  async changePassword(currentPassword, newPassword) {
    // Supabase Auth ne demande pas l'ancien mot de passe pour updateUser() ;
    // on le revérifie nous-mêmes par cohérence avec le comportement d'origine.
    if (_cachedSupabaseUser?.email) {
      const { error: reauthError } = await _sb.auth.signInWithPassword({ email: _cachedSupabaseUser.email, password: currentPassword });
      if (reauthError) _throwNormalized('login_invalid_credentials');
    }
    const { error } = await _sb.auth.updateUser({ password: newPassword });
    if (error) _throwNormalized('password_min_length');
    await _query(_sb.from('profiles').update({ must_change_password: false }).eq('id', _cachedSupabaseUser.id));
    return {};
  },

  // ==================== Établissements ====================
  async searchEstablishments(q, educationLevel) {
    const data = await _rpc('search_establishments', { q: q || null, p_education_level: educationLevel || null });
    return { establishments: data };
  },

  // ==================== Changement d'administrateur (section 5) ====================
  requestAdminChange(payload) { return _edge('admin-change-request', payload); },
  async adminChangeStatus(token) {
    const data = await _rpc('admin_change_status', { p_token: token });
    if (data?.error) _throwNormalized(data.error);
    return data;
  },
  confirmAdminChange(token, password) { return _edge('admin-change-manage', { action: 'confirm', token, password }, { auth: false }); },

  // ==================== Espace administrateur national ====================
  async listEstablishmentsAdmin(query = '') {
    const params = new URLSearchParams(query.replace(/^\?/, ''));
    let q = _sb.from('establishments').select('*').order('created_at', { ascending: false }).limit(100);
    if (params.get('status')) q = q.eq('status', params.get('status'));
    if (params.get('region')) q = q.eq('region', params.get('region'));
    const establishments = await _query(q);
    const countsRaw = await _rpc('establishment_counts_by_status');
    const counts_by_status = {};
    (countsRaw || []).forEach((r) => { counts_by_status[r.status] = Number(r.n); });
    return { establishments, counts_by_status };
  },
  approveEstablishment(id) { return _edge('establishments-transition', { establishment_id: id, action: 'approve' }); },
  rejectEstablishment(id, reason) { return _edge('establishments-transition', { establishment_id: id, action: 'reject', reason }); },
  suspendEstablishment(id, reason) { return _edge('establishments-transition', { establishment_id: id, action: 'suspend', reason }); },
  reactivateEstablishment(id) { return _edge('establishments-transition', { establishment_id: id, action: 'reactivate' }); },
  async listAdminChangeRequests(status = '') {
    let q = _sb.from('admin_change_requests').select('*, establishments(name, code), profiles!admin_change_requests_old_admin_profile_id_fkey(first_name, last_name)').order('created_at', { ascending: false }).limit(100);
    if (status) q = q.eq('status', status);
    const rows = await _query(q);
    return {
      requests: rows.map((r) => ({
        ...r, establishment_name: r.establishments?.name, establishment_code: r.establishments?.code,
        old_admin_first_name: r.profiles?.first_name, old_admin_last_name: r.profiles?.last_name,
      })),
    };
  },
  validateAdminChangeRequest(id) { return _edge('admin-change-manage', { action: 'validate', request_id: id }); },
  rejectAdminChangeRequest(id, reason) { return _edge('admin-change-manage', { action: 'reject', request_id: id, reason }); },

  // ==================== Personnel (section 6) ====================
  async listStaff(query = '') {
    const params = new URLSearchParams(query.replace(/^\?/, ''));
    let q = _sb.from('profiles').select('id, first_name, last_name, email, phone, status, roles(code, label_fr, label_en)')
      .not('role_id', 'in', `(${await _staffExcludedRoleIds()})`)
      .order('last_name');
    if (params.get('status')) q = q.eq('status', params.get('status'));
    const rows = await _query(q);
    return { staff: rows.map(_flattenRole) };
  },
  async getStaff(id) {
    const row = await _query(_sb.from('profiles').select('*, roles(code, label_fr, label_en)').eq('id', id).single());
    return { staff: _flattenRole(row) };
  },
  createStaff(payload) { return _edge('staff-manage', { action: 'create', ...payload }); },
  async updateStaff(id, payload) {
    const row = await _query(_sb.from('profiles').update(payload).eq('id', id).select().single());
    return { staff: _flattenRole(row) };
  },
  archiveStaff(id, reason) { return _edge('staff-manage', { action: 'archive', staff_id: id, reason }); },
  async reactivateStaff(id) {
    await _query(_sb.from('profiles').update({ status: 'active', archived_at: null, archived_reason: null }).eq('id', id));
    return {};
  },
  resetStaffPassword(id) { return _edge('staff-manage', { action: 'reset_password', staff_id: id }); },

  // ==================== Années scolaires ====================
  async listSchoolYears() { return { school_years: await _query(_sb.from('school_years').select('*').order('start_date', { ascending: false })) }; },
  async createSchoolYear(payload) { return { school_year: await _query(_sb.from('school_years').insert(payload).select().single()) }; },
  async setCurrentSchoolYear(id) {
    const row = await _query(_sb.from('school_years').select('establishment_id').eq('id', id).single());
    await _query(_sb.from('school_years').update({ is_current: false }).eq('establishment_id', row.establishment_id));
    await _query(_sb.from('school_years').update({ is_current: true }).eq('id', id));
    return {};
  },

  // ==================== Matières (catalogue + modèles par niveau) ====================
  async listSubjects(status = 'active') { return { subjects: await _query(_sb.from('subjects').select('*').eq('status', status).order('name')) }; },
  async createSubject(payload) { return { subject: await _query(_sb.from('subjects').insert(payload).select().single()) }; },
  async updateSubject(id, payload) { return { subject: await _query(_sb.from('subjects').update(payload).eq('id', id).select().single()) }; },
  async archiveSubject(id) { await _query(_sb.from('subjects').update({ status: 'archived' }).eq('id', id)); return {}; },
  async listLevelTemplates(level, series) {
    let q = _sb.from('level_subject_templates').select('*, subjects(name)');
    if (level) q = q.eq('level', level);
    if (series !== undefined && series !== null && series !== '') q = q.eq('series', series);
    const rows = await _query(q);
    return { templates: rows.map((r) => ({ ...r, subject_name: r.subjects?.name })) };
  },
  async addLevelTemplateSubject(payload) { return { template: await _query(_sb.from('level_subject_templates').insert(payload).select().single()) }; },
  async updateLevelTemplateSubject(id, coefficient) { return { template: await _query(_sb.from('level_subject_templates').update({ coefficient }).eq('id', id).select().single()) }; },
  async removeLevelTemplateSubject(id) { await _query(_sb.from('level_subject_templates').delete().eq('id', id)); return {}; },

  // ==================== Classes ====================
  async listClasses(query = '') {
    const params = new URLSearchParams(query.replace(/^\?/, ''));
    let q = _sb.from('classes').select('*, profiles!classes_homeroom_teacher_id_fkey(first_name, last_name), class_subjects(count)').order('level').order('series').order('section');
    if (params.get('school_year_id')) q = q.eq('school_year_id', params.get('school_year_id'));
    if (params.get('status')) q = q.eq('status', params.get('status'));
    const rows = await _query(q);
    return { classes: rows.map((c) => ({ ...c, homeroom_first_name: c.profiles?.first_name, homeroom_last_name: c.profiles?.last_name, subjects_count: c.class_subjects?.[0]?.count ?? 0 })) };
  },
  async getClass(id) {
    const cls = await _query(_sb.from('classes').select('*, profiles!classes_homeroom_teacher_id_fkey(first_name, last_name)').eq('id', id).single());
    const subjects = await _query(_sb.from('class_subjects').select('*, subjects(name), profiles(first_name, last_name)').eq('class_id', id));
    const { count: studentCount } = await _sb.from('students').select('id', { count: 'exact', head: true }).eq('class_id', id).eq('status', 'active');
    return {
      class: {
        ...cls, homeroom_first_name: cls.profiles?.first_name, homeroom_last_name: cls.profiles?.last_name, student_count: studentCount ?? 0,
        subjects: subjects.map((s) => ({ ...s, subject_name: s.subjects?.name, teacher_first_name: s.profiles?.first_name, teacher_last_name: s.profiles?.last_name })),
      },
    };
  },
  async createClass(payload) { return { class: await _query(_sb.from('classes').insert(payload).select().single()) }; },
  async updateClass(id, payload) { return { class: await _query(_sb.from('classes').update(payload).eq('id', id).select().single()) }; },
  async archiveClass(id) { await _query(_sb.from('classes').update({ status: 'archived' }).eq('id', id)); return {}; },
  async addClassSubject(classId, payload) { return { class_subject: await _query(_sb.from('class_subjects').insert({ ...payload, class_id: classId }).select().single()) }; },
  async updateClassSubject(_classId, rowId, payload) { return { class_subject: await _query(_sb.from('class_subjects').update(payload).eq('id', rowId).select().single()) }; },
  async removeClassSubject(_classId, rowId) { await _query(_sb.from('class_subjects').delete().eq('id', rowId)); return {}; },

  // ==================== Élèves & parents (sections 9 et 10) ====================
  async listStudents(query = '') {
    const params = new URLSearchParams(query.replace(/^\?/, ''));
    let q = _sb.from('students').select('*, classes(level, series, section)').order('last_name').order('first_name').limit(500);
    if (params.get('class_id')) q = q.eq('class_id', params.get('class_id'));
    if (params.get('status')) q = q.eq('status', params.get('status'));
    if (params.get('q')) q = q.or(`first_name.ilike.%${params.get('q')}%,last_name.ilike.%${params.get('q')}%,matricule.ilike.%${params.get('q')}%`);
    const rows = await _query(q);
    return { students: rows.map((s) => ({ ...s, level: s.classes?.level, series: s.classes?.series, section: s.classes?.section })) };
  },
  async getStudent(id) {
    const student = await _query(_sb.from('students').select('*, classes(level, series, section)').eq('id', id).single());
    const parentLinks = await _query(_sb.from('student_parents').select('relationship, profiles(id, first_name, last_name, email, phone)').eq('student_id', id));
    const pendingInvitations = await _query(_sb.from('parent_invitations').select('invited_first_name, invited_last_name, invited_email, created_at').eq('student_id', id).eq('status', 'pending'));
    return {
      student: {
        ...student, level: student.classes?.level, series: student.classes?.series, section: student.classes?.section,
        user_id: student.profile_id,
        parents: parentLinks.map((p) => ({ ...p.profiles, relationship: p.relationship })),
        pending_invitations: pendingInvitations,
      },
    };
  },
  async createStudent(payload) { return { student: await _query(_sb.from('students').insert(payload).select().single()) }; },
  async updateStudent(id, payload) { return { student: await _query(_sb.from('students').update(payload).eq('id', id).select().single()) }; },
  async archiveStudent(id) { await _query(_sb.from('students').update({ status: 'archived' }).eq('id', id)); return {}; },
  inviteParent(studentId, payload) { return _edge('student-invite-parent', { student_id: studentId, ...payload }); },
  createStudentAccount(studentId) { return _edge('student-create-login', { student_id: studentId }); },
  async parentInvitationStatus(token) {
    const rows = await _rpc('get_parent_invitation_status', { p_token: token });
    if (!rows || !rows.length) _throwNormalized('invitation_link_invalid');
    return { invitation: rows[0] };
  },
  confirmParentInvitation(token, password) { return _edge('parent-confirm-invitation', { token, password }, { auth: false }); },
  async myChildren() {
    const rows = await _query(_sb.from('student_parents').select('relationship, students(*, classes(level, series, section))').eq('parent_id', API.getCachedSupabaseUser()?.id));
    return { children: rows.map((r) => ({ ...r.students, level: r.students?.classes?.level, series: r.students?.classes?.series, section: r.students?.classes?.section, relationship: r.relationship })) };
  },

  // ==================== Notes (section 11) ====================
  async listSequences(schoolYearId) {
    let q = _sb.from('sequences').select('*').order('order_index');
    if (schoolYearId) q = q.eq('school_year_id', schoolYearId);
    return { sequences: await _query(q) };
  },
  async createSequence(payload) { return { sequence: await _query(_sb.from('sequences').insert(payload).select().single()) }; },
  async getGradeSheet(classSubjectId, sequenceId) {
    const classSubject = await _query(_sb.from('class_subjects').select('class_id, coefficient, subjects(name)').eq('id', classSubjectId).single());
    const sequence = await _query(_sb.from('sequences').select('id, label').eq('id', sequenceId).single());
    const validation = await _query(_sb.from('class_sequence_validations').select('status').eq('class_id', classSubject.class_id).eq('sequence_id', sequenceId).maybeSingle());
    const students = await _query(_sb.from('students').select('id, matricule, first_name, last_name').eq('class_id', classSubject.class_id).eq('status', 'active').order('last_name'));
    const grades = await _query(_sb.from('grades').select('*').eq('class_subject_id', classSubjectId).eq('sequence_id', sequenceId));
    const byStudent = new Map(grades.map((g) => [g.student_id, g]));
    return {
      subject_name: classSubject.subjects?.name,
      coefficient: classSubject.coefficient,
      sequence: { id: sequence.id, label: sequence.label },
      locked: validation?.status === 'validated',
      students: students.map((s) => ({ ...s, score: byStudent.get(s.id)?.score ?? null, grade_id: byStudent.get(s.id)?.id ?? null })),
    };
  },
  async saveGradeSheet(classSubjectId, sequenceId, grades) {
    const entries = grades.map((g) => ({ student_id: g.student_id, score: g.score, reason: g.reason || '' }));
    const saved = await _rpc('save_grade_sheet', { p_class_subject_id: classSubjectId, p_sequence_id: sequenceId, p_entries: entries });
    return { saved };
  },
  getClassSequenceSummary(classId, sequenceId) { return _rpc('compute_class_sequence_summary', { p_class_id: classId, p_sequence_id: sequenceId }); },
  validateSequence(classId, sequenceId, force = false) { return _edge('grades-validate-sequence', { class_id: classId, sequence_id: sequenceId, action: 'validate', force }); },
  unvalidateSequence(classId, sequenceId) { return _edge('grades-validate-sequence', { class_id: classId, sequence_id: sequenceId, action: 'unvalidate' }); },
  async studentGradesSummary(studentId, sequenceId) {
    const student = await _query(_sb.from('students').select('class_id').eq('id', studentId).single());
    const sequence = await _query(_sb.from('sequences').select('id, label').eq('id', sequenceId).single());
    const summary = await _rpc('compute_class_sequence_summary', { p_class_id: student.class_id, p_sequence_id: sequenceId });
    const own = summary?.students?.[studentId];
    if (!own) return { sequence, average: null, rank: null, class_size: summary?.class_size ?? 0, class_average: summary?.class_average ?? null, mention: null, subjects: [] };

    const classSubjects = await _query(_sb.from('class_subjects').select('id, coefficient, subjects(name)').eq('class_id', student.class_id));
    const grades = await _query(_sb.from('grades').select('score, class_subject_id').eq('student_id', studentId).eq('sequence_id', sequenceId));
    const scoreByClassSubject = new Map(grades.map((g) => [g.class_subject_id, g.score]));
    const mentionFor = (score) => (score === null || score === undefined ? null : score >= 14 ? 'bien' : score >= 10 ? 'passable' : 'insuffisant');

    const subjects = classSubjects
      .map((cs) => ({ subject_name: cs.subjects?.name, coefficient: cs.coefficient, score: scoreByClassSubject.get(cs.id) ?? null, mention: mentionFor(scoreByClassSubject.get(cs.id) ?? null) }))
      .sort((a, b) => String(a.subject_name).localeCompare(String(b.subject_name)));

    return { sequence, average: own.average, rank: own.rank, class_size: summary.class_size, class_average: summary.class_average, mention: own.mention, subjects };
  },
  async studentTermSummary() {
    // HORS PÉRIMÈTRE (voir la note de l'étape 6 du projet schoolar-supabase) :
    // moyenne trimestrielle agrégée sur plusieurs séquences, pas encore
    // implémentée côté base de données.
    _throwNormalized('route_not_found');
  },

  // ==================== Présences (section 18) ====================
  getAttendanceSession(classSubjectId, date, period = '') { return _rpc('get_or_create_attendance_session', { p_class_subject_id: classSubjectId, p_session_date: date, p_period_label: period }); },
  saveAttendanceSession(classSubjectId, date, records, period = '') { return _edge('attendance-save-session', { class_subject_id: classSubjectId, session_date: date, period_label: period, records }); },
  alertParent(recordId) { return _edge('attendance-alert-parent', { record_id: recordId }); },
  async studentAttendanceHistory(studentId) {
    const rows = await _query(_sb.from('attendance_records').select('status, justified, justification_note, attendance_sessions(session_date, period_label, class_subjects(subjects(name)))').eq('student_id', studentId).order('id', { ascending: false }).limit(200));
    const history = rows.map((r) => ({ status: r.status, justified: r.justified, justification_note: r.justification_note, session_date: r.attendance_sessions?.session_date, period_label: r.attendance_sessions?.period_label, subject_name: r.attendance_sessions?.class_subjects?.subjects?.name }));
    return {
      history,
      stats: {
        absent_count: history.filter((h) => h.status === 'absent').length,
        late_count: history.filter((h) => h.status === 'late').length,
      },
    };
  },
  classAttendanceSummary(classId, date) { return _rpc('attendance_class_summary_today', { p_class_id: classId, p_date: date }); },

  // ==================== Discipline (section 15) ====================
  async listDisciplineReports(query = '') {
    const params = new URLSearchParams(query.replace(/^\?/, ''));
    let q = _sb.from('discipline_reports').select('*, students(first_name, last_name, matricule, classes(level, series, section)), profiles!discipline_reports_reported_by_profile_id_fkey(first_name, last_name)').order('created_at', { ascending: false }).limit(200);
    if (params.get('status')) q = q.eq('status', params.get('status'));
    if (params.get('class_id')) q = q.eq('class_id', params.get('class_id'));
    const rows = await _query(q);
    return {
      reports: rows.map((r) => ({
        ...r, student_first_name: r.students?.first_name, student_last_name: r.students?.last_name, student_matricule: r.students?.matricule,
        level: r.students?.classes?.level, series: r.students?.classes?.series, section: r.students?.classes?.section,
        reported_by_first_name: r.profiles?.first_name, reported_by_last_name: r.profiles?.last_name,
      })),
    };
  },
  async getDisciplineReport(id) {
    const row = await _query(_sb.from('discipline_reports').select('*, students(first_name, last_name, matricule)').eq('id', id).single());
    return { report: { ...row, student_first_name: row.students?.first_name, student_last_name: row.students?.last_name, student_matricule: row.students?.matricule } };
  },
  createDisciplineReport(payload) { return _edge('discipline-create-report', payload); },
  async resolveDisciplineReport(id, resolutionNote) {
    const row = await _query(_sb.from('discipline_reports').update({ status: 'resolved', resolution_note: resolutionNote }).eq('id', id).select().single());
    return { report: row };
  },
  async studentDisciplineHistory(studentId) { return { history: await _query(_sb.from('discipline_reports').select('*').eq('student_id', studentId).order('created_at', { ascending: false })) }; },

  // ==================== Emplois du temps (section 16) ====================
  async getClassTimetable(classId) {
    const rows = await _query(_sb.from('timetable_entries').select('*, class_subjects(subjects(name), profiles(first_name, last_name))').eq('class_id', classId).order('day_of_week').order('start_time'));
    return { entries: rows.map((e) => ({ ...e, subject_name: e.class_subjects?.subjects?.name, teacher_first_name: e.class_subjects?.profiles?.first_name, teacher_last_name: e.class_subjects?.profiles?.last_name })) };
  },
  createTimetableEntry(classId, payload) { return _edge('timetable-manage', { action: 'create', class_id: classId, ...payload }); },
  updateTimetableEntry(_classId, entryId, payload) { return _edge('timetable-manage', { action: 'update', entry_id: entryId, ...payload }); },
  deleteTimetableEntry(_classId, entryId) { return _edge('timetable-manage', { action: 'delete', entry_id: entryId }); },
  getTimetableHistory(classId) { return _rpc('timetable_history', { p_class_id: classId }).then((history) => ({ history })); },
  async myTimetable() {
    const uid = API.getCachedSupabaseUser()?.id;
    const rows = await _query(_sb.from('timetable_entries').select('*, classes(level, series, section), class_subjects!inner(teacher_id, subjects(name))').eq('class_subjects.teacher_id', uid).order('day_of_week').order('start_time'));
    return { entries: rows.map((e) => ({ ...e, subject_name: e.class_subjects?.subjects?.name, class_level: e.classes?.level, class_series: e.classes?.series, class_section: e.classes?.section })) };
  },

  // ==================== Progression pédagogique (section 13) ====================
  async listProgression(classSubjectId) { return { items: await _query(_sb.from('progression_items').select('*').eq('class_subject_id', classSubjectId).order('order_index')) }; },
  async addProgressionItem(classSubjectId, payload) { return { item: await _query(_sb.from('progression_items').insert({ ...payload, class_subject_id: classSubjectId }).select().single()) }; },
  async updateProgressionItem(_classSubjectId, itemId, payload) { return { item: await _query(_sb.from('progression_items').update(payload).eq('id', itemId).select().single()) }; },
  async deleteProgressionItem(_classSubjectId, itemId) { await _query(_sb.from('progression_items').delete().eq('id', itemId)); return {}; },
  completeProgressionItem(_classSubjectId, itemId) { return _edge('progression-complete-item', { item_id: itemId }); },
  async reopenProgressionItem(_classSubjectId, itemId) { return { item: await _query(_sb.from('progression_items').update({ completed: false }).eq('id', itemId).select().single()) }; },
  classProgressionSummary(classId) { return _rpc('progression_class_summary', { p_class_id: classId }); },

  // ==================== Devoirs à domicile (section 14) ====================
  async listHomework(classSubjectId) { return { assignments: await _query(_sb.from('homework_assignments').select('*, homework_submissions(count)').eq('class_subject_id', classSubjectId).order('due_date', { ascending: false })) }; },
  async createHomework(classSubjectId, payload) { return { assignment: await _query(_sb.from('homework_assignments').insert({ ...payload, class_subject_id: classSubjectId }).select().single()) }; },
  async getHomework(id) {
    const assignment = await _query(_sb.from('homework_assignments').select('*, class_subjects(class_id)').eq('id', id).single());
    const classId = assignment.class_subjects?.class_id;
    const allStudents = await _query(_sb.from('students').select('id, first_name, last_name, matricule').eq('class_id', classId).eq('status', 'active').order('last_name'));
    const submissions = await _query(_sb.from('homework_submissions').select('*, students(first_name, last_name, matricule)').eq('homework_id', id));
    const submittedIds = new Set(submissions.map((s) => s.student_id));
    return {
      assignment,
      submissions: submissions.map((s) => ({ ...s, first_name: s.students?.first_name, last_name: s.students?.last_name, matricule: s.students?.matricule })),
      not_submitted: allStudents.filter((s) => !submittedIds.has(s.id)),
    };
  },
  async updateHomework(id, payload) { return { assignment: await _query(_sb.from('homework_assignments').update(payload).eq('id', id).select().single()) }; },
  async deleteHomework(id) { await _query(_sb.from('homework_assignments').delete().eq('id', id)); return {}; },
  submitHomework(id, studentId, file) {
    const formData = new FormData();
    formData.append('homework_id', id);
    formData.append('student_id', studentId);
    formData.append('file', file);
    return _edgeForm('homework-submit', formData);
  },
  downloadHomeworkSubmissionUrl(submissionId) { return _signedDownloadUrl('homework-download', 'id', submissionId); },
  async reviewHomeworkSubmission(submissionId, reviewNote) {
    const row = await _query(_sb.from('homework_submissions').update({ reviewed: true, review_note: reviewNote, reviewed_at: new Date().toISOString() }).eq('id', submissionId).select().single());
    return { submission: row };
  },
  async studentHomework(studentId) {
    const student = await _query(_sb.from('students').select('class_id').eq('id', studentId).single());
    const assignments = await _query(_sb.from('homework_assignments').select('*, class_subjects!inner(class_id, subjects(name))').eq('class_subjects.class_id', student.class_id).order('due_date', { ascending: false }));
    const submissions = await _query(_sb.from('homework_submissions').select('*').eq('student_id', studentId));
    const byHomework = new Map(submissions.map((s) => [s.homework_id, s]));
    return { assignments: assignments.map((a) => ({ ...a, subject_name: a.class_subjects?.subjects?.name, submission: byHomework.get(a.id) ?? null })) };
  },

  // ==================== Messagerie ====================
  async listConversations() { return { conversations: await _rpc('list_my_conversations') }; },
  async searchContacts(q = '') {
    const uid = API.getCachedSupabaseUser()?.id;
    let query = _sb.from('profiles').select('id, first_name, last_name, roles(code, label_fr)').neq('id', uid).eq('status', 'active').limit(30);
    if (q) query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`);
    const rows = await _query(query);
    return { contacts: rows.map(_flattenRole) };
  },
  async startConversation(recipientUserId) { return _rpc('start_or_get_conversation', { p_recipient_id: recipientUserId }); },
  async getMessages(conversationId) {
    const rows = await _query(_sb.from('messages').select('*').eq('conversation_id', conversationId).order('created_at'));
    await _query(_sb.from('conversation_participants').update({ last_read_at: new Date().toISOString() }).eq('conversation_id', conversationId).eq('profile_id', API.getCachedSupabaseUser()?.id));
    return { messages: rows };
  },
  sendMessage(conversationId, body) { return _edge('messaging-send', { conversation_id: conversationId, body }); },

  // ==================== Annonces ====================
  async listAnnouncements() {
    const rows = await _query(_sb.from('announcements').select('*, profiles!announcements_created_by_profile_id_fkey(first_name, last_name), classes(level, series, section)').order('created_at', { ascending: false }).limit(100));
    return {
      announcements: rows.map((a) => ({
        ...a, author_id: a.created_by_profile_id, author_first_name: a.profiles?.first_name, author_last_name: a.profiles?.last_name,
        level: a.classes?.level, series: a.classes?.series, section: a.classes?.section,
      })),
    };
  },
  createAnnouncement(payload) { return _edge('announcements-create', payload); },
  async deleteAnnouncement(id) { await _query(_sb.from('announcements').delete().eq('id', id)); return {}; },

  // ==================== Notifications in-app ====================
  async listNotifications() { return { notifications: await _query(_sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(50)) }; },
  async unreadNotificationCount() {
    const { count } = await _sb.from('notifications').select('id', { count: 'exact', head: true }).eq('profile_id', API.getCachedSupabaseUser()?.id).is('read_at', null);
    return { count: count ?? 0 };
  },
  async markNotificationRead(id) { await _query(_sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)); return {}; },
  async markAllNotificationsRead() {
    await _query(_sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('profile_id', API.getCachedSupabaseUser()?.id).is('read_at', null));
    return {};
  },

  // ==================== Paiements : frais de scolarité ====================
  async listFeeStructures(schoolYearId = '') {
    let q = _sb.from('fee_structures').select('*').order('created_at', { ascending: false });
    if (schoolYearId) q = q.eq('school_year_id', schoolYearId);
    return { fee_structures: await _query(q) };
  },
  async createFeeStructure(payload) { return { fee_structure: await _query(_sb.from('fee_structures').insert(payload).select().single()) }; },
  async updateFeeStructure(id, payload) { return { fee_structure: await _query(_sb.from('fee_structures').update(payload).eq('id', id).select().single()) }; },
  async archiveFeeStructure(id) { await _query(_sb.from('fee_structures').update({ status: 'archived' }).eq('id', id)); return {}; },
  generateInvoices(feeStructureId) { return _rpc('generate_fee_invoices', { p_fee_structure_id: feeStructureId }); },
  async listInvoices(query = '') {
    const params = new URLSearchParams(query.replace(/^\?/, ''));
    let q = _sb.from('student_fees').select('*, students(first_name, last_name, matricule, classes(level)), fee_structures(label)').order('created_at', { ascending: false }).limit(500);
    if (params.get('status')) q = q.eq('status', params.get('status'));
    const rows = await _query(q);
    return { invoices: rows.map((r) => ({ ...r, first_name: r.students?.first_name, last_name: r.students?.last_name, matricule: r.students?.matricule, level: r.students?.classes?.level, fee_label: r.fee_structures?.label })) };
  },
  async getInvoice(id) {
    const row = await _query(_sb.from('student_fees').select('*, students(first_name, last_name, matricule), fee_structures(label)').eq('id', id).single());
    const payments = await _query(_sb.from('payments').select('*').eq('student_fee_id', id).order('created_at', { ascending: false }));
    return { invoice: { ...row, student_first_name: row.students?.first_name, student_last_name: row.students?.last_name, fee_label: row.fee_structures?.label }, payments };
  },
  async recordManualPayment(invoiceId, payload) {
    const invoice = await _query(_sb.from('student_fees').select('establishment_id').eq('id', invoiceId).single());
    const uid = API.getCachedSupabaseUser()?.id;
    // Le trigger payments_apply_effects (migration 0011) applique le
    // paiement à la facture, génère le reçu, et refuse tout dépassement de
    // solde — un simple insert suffit, comme le permet la policy
    // payments_insert_manual (méthode cash/bank_card uniquement).
    const payment = await _query(_sb.from('payments').insert({
      establishment_id: invoice.establishment_id, student_fee_id: invoiceId,
      amount: payload.amount, method: payload.method || 'cash', status: 'completed',
      initiated_by_profile_id: uid,
    }).select().single());
    return { payment_id: payment.id, payment };
  },
  async studentFees(studentId) { return { invoices: await _query(_sb.from('student_fees').select('*, fee_structures(label)').eq('student_id', studentId)) }; },

  // ==================== Paiements : Mobile Money ====================
  payInvoiceMobileMoney(invoiceId, payload) { return _rpc('invoice_pay_mobile_money', { p_invoice_id: invoiceId, p_method: payload.method, p_phone: payload.phone }); },
  confirmPayment(paymentId, success = true) { return _edge('payments-confirm-dev', { payment_id: paymentId, success }); },
  getReceipt(paymentId) { return _rpc('payment_receipt', { p_payment_id: paymentId }); },

  // ==================== Premium Parents ====================
  async premiumStatus(studentId) {
    const row = await _query(_sb.from('premium_subscriptions').select('*').eq('student_id', studentId).order('created_at', { ascending: false }).limit(1).maybeSingle());
    return { subscription: row, is_active: row?.status === 'active' };
  },
  subscribePremium(studentId, payload) { return _rpc('premium_subscribe', { p_student_id: studentId, p_method: payload.method, p_phone: payload.phone }); },
  async cancelPremium(studentId) {
    await _query(_sb.from('premium_subscriptions').update({ status: 'cancelled' }).eq('student_id', studentId).eq('parent_id', API.getCachedSupabaseUser()?.id).eq('status', 'active'));
    return {};
  },
  premiumCheckoutTimes(studentId) { return _rpc('premium_checkout_history', { p_student_id: studentId }).then((checkouts) => ({ checkouts })); },

  // ==================== Gestion documentaire ====================
  async listDocuments(query = '') {
    const params = new URLSearchParams(query.replace(/^\?/, ''));
    let q = _sb.from('documents').select('*, students(first_name, last_name, matricule)').order('created_at', { ascending: false }).limit(200);
    if (params.get('category')) q = q.eq('category', params.get('category'));
    q = params.get('trashed') === 'true' ? q.not('deleted_at', 'is', null) : q.is('deleted_at', null);
    const rows = await _query(q);
    return { documents: rows.map((d) => ({ ...d, student_first_name: d.students?.first_name, student_last_name: d.students?.last_name, matricule: d.students?.matricule })) };
  },
  async studentDocuments(studentId) { return { documents: await _query(_sb.from('documents').select('*').eq('student_id', studentId).is('deleted_at', null)) }; },
  createDocument(payload) {
    const formData = new FormData();
    Object.entries(payload).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== '') formData.append(k, v); });
    formData.append('action', 'upload');
    return _edgeForm('documents-manage', formData);
  },
  downloadDocumentUrl(id) { return _signedDownloadUrl('documents-download', 'id', id); },
  async trashDocument(id) { await _query(_sb.from('documents').update({ deleted_at: new Date().toISOString() }).eq('id', id)); return {}; },
  async restoreDocument(id) { await _query(_sb.from('documents').update({ deleted_at: null }).eq('id', id)); return {}; },
  deleteDocument(id) { return _edge('documents-manage', { action: 'destroy', document_id: id }); },

  // ==================== Bibliothèque numérique ====================
  async listLibrary(query = '') {
    const params = new URLSearchParams(query.replace(/^\?/, ''));
    let q = _sb.from('library_resources').select('*, subjects(name)').order('created_at', { ascending: false }).limit(200);
    if (params.get('category')) q = q.eq('category', params.get('category'));
    if (params.get('level')) q = q.eq('level', params.get('level'));
    q = params.get('trashed') === 'true' ? q.not('deleted_at', 'is', null) : q.is('deleted_at', null);
    const rows = await _query(q);
    return { resources: rows.map((r) => ({ ...r, subject_name: r.subjects?.name })) };
  },
  createLibraryResource(payload) {
    const formData = new FormData();
    Object.entries(payload).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== '') formData.append(k, v); });
    formData.append('action', 'upload');
    return _edgeForm('library-manage', formData);
  },
  downloadLibraryResourceUrl(id) { return _signedDownloadUrl('library-download', 'id', id); },
  async trashLibraryResource(id) { await _query(_sb.from('library_resources').update({ deleted_at: new Date().toISOString() }).eq('id', id)); return {}; },
  async restoreLibraryResource(id) { await _query(_sb.from('library_resources').update({ deleted_at: null }).eq('id', id)); return {}; },
  deleteLibraryResource(id) { return _edge('library-manage', { action: 'destroy', resource_id: id }); },

  // ==================== Orientation scolaire (IA Claude) ====================
  async orientationHistory(studentId) { return { assessments: await _query(_sb.from('career_assessments').select('*').eq('student_id', studentId).order('created_at', { ascending: false })) }; },
  generateOrientation(studentId) { return _edge('orientation-generate', { student_id: studentId }); },

  // ==================== Préparation aux concours (IA GPT) ====================
  async concoursStatus(studentId) {
    const row = await _query(_sb.from('concours_subscriptions').select('*').eq('student_id', studentId).order('created_at', { ascending: false }).limit(1).maybeSingle());
    const isActive = row?.status === 'active';
    let quotaRemaining = null;
    if (isActive && row.tier === 'limited') {
      const { count } = await _sb.from('exam_papers').select('id', { count: 'exact', head: true }).eq('requested_by_student_id', studentId);
      quotaRemaining = Math.max(0, 5 - (count ?? 0));
    }
    return { subscription: row, is_active: isActive, quota_remaining: quotaRemaining };
  },
  subscribeConcours(studentId, payload) { return _rpc('concours_subscribe', { p_student_id: studentId, p_tier: payload.tier, p_method: payload.method, p_phone: payload.phone }); },
  generateExam(studentId, payload) { return _edge('exam-generate', { student_id: studentId, ...payload }); },
  async listExams(studentId) {
    const exams = await _query(_sb.from('exam_papers').select('*').eq('requested_by_student_id', studentId).order('created_at', { ascending: false }));
    const attempts = await _query(_sb.from('exam_attempts').select('exam_paper_id, status, score, max_score').eq('student_id', studentId));
    const byExam = new Map(attempts.map((a) => [a.exam_paper_id, a]));
    return { exams: exams.map((e) => ({ ...e, attempt_status: byExam.get(e.id)?.status ?? null, score: byExam.get(e.id)?.score ?? null, max_score: byExam.get(e.id)?.max_score ?? null })) };
  },
  async getExam(id) {
    const exam = await _query(_sb.from('exam_papers').select('*').eq('id', id).single());
    const attempt = await _query(_sb.from('exam_attempts').select('*').eq('exam_paper_id', id).maybeSingle());
    return { exam, attempt };
  },
  async startExam(id) {
    const uid = API.getCachedSupabaseUser()?.id;
    const student = await _query(_sb.from('students').select('id').eq('profile_id', uid).single());
    const row = await _query(_sb.from('exam_attempts').insert({ exam_paper_id: id, student_id: student.id }).select().single());
    return { attempt: row };
  },
  submitExam(id, answers) { return _edge('exam-submit', { exam_paper_id: id, answers }); },
  async examRanking(id) { return { ranking: await _rpc('exam_ranking', { p_exam_paper_id: id }), scope: 'establishment' }; },

  // ==================== Bulletins pilotés par IA ====================
  async bulletinStatus(studentId) {
    const row = await _query(_sb.from('bulletin_subscriptions').select('*').eq('student_id', studentId).order('created_at', { ascending: false }).limit(1).maybeSingle());
    const { data: student } = await _sb.from('students').select('class_id').eq('id', studentId).single();
    let template = null;
    if (student?.class_id) {
      const { data: tpl } = await _sb.from('bulletin_templates').select('id').eq('class_id', student.class_id).maybeSingle();
      template = tpl;
    }
    return { subscription: row, is_active: row?.status === 'active', template_available: !!template };
  },
  subscribeBulletin(studentId, payload) { return _rpc('bulletin_subscribe', { p_student_id: studentId, p_method: payload.method, p_phone: payload.phone }); },
  uploadBulletinTemplate(classId, file) {
    const formData = new FormData();
    formData.append('class_id', classId);
    formData.append('file', file);
    return _edgeForm('bulletin-template-upload', formData);
  },
  generateBulletin(studentId, sequenceId) { return _edge('bulletin-generate', { student_id: studentId, sequence_id: sequenceId }); },
  async listBulletins(studentId) {
    const rows = await _query(_sb.from('bulletins').select('*, sequences(label, term_label)').eq('student_id', studentId).order('created_at', { ascending: false }));
    return { bulletins: rows.map((b) => ({ ...b, sequence_label: b.sequences?.label, term_label: b.sequences?.term_label })) };
  },
  async getBulletin(id) {
    const row = await _query(_sb.from('bulletins').select('*, sequences(label, term_label), students(first_name, last_name, matricule, classes(level, series))').eq('id', id).single());
    return {
      bulletin: {
        ...row, sequence_label: row.sequences?.label, term_label: row.sequences?.term_label,
        first_name: row.students?.first_name, last_name: row.students?.last_name, matricule: row.students?.matricule,
        level: row.students?.classes?.level, series: row.students?.classes?.series,
      },
    };
  },

  // ==================== Vérification publique de bulletin (QR code) ====================
  verifyBulletin(code) { return _rpc('verify_bulletin', { p_code: code }); },

  // ==================== Tableau de bord national ====================
  nationalStatsOverview() { return _rpc('national_stats_overview'); },
  nationalStatsByRegion() { return _rpc('national_stats_by_region').then((regions) => ({ regions })); },
  nationalStatsByDepartment(region = '') { return _rpc('national_stats_by_department', { p_region: region || null }).then((departments) => ({ departments })); },
  nationalStatsMap() { return _rpc('national_stats_map').then((establishments) => ({ establishments })); },
  async setEstablishmentCoordinates(id, payload) { return { establishment: await _query(_sb.from('establishments').update(payload).eq('id', id).select().single()) }; },

  // ==================== 2FA (native Supabase Auth) ====================
  async setup2fa() {
    const { data, error } = await _sb.auth.mfa.enroll({ factorType: 'totp' });
    if (error) _throwNormalized('server_error');
    return { factor_id: data.id, secret: data.totp.secret, provisioning_uri: data.totp.uri };
  },
  async confirm2fa(code) {
    const { data: factors } = await _sb.auth.mfa.listFactors();
    const factor = (factors?.totp || []).find((f) => f.status === 'unverified') || (factors?.totp || [])[0];
    if (!factor) _throwNormalized('server_error');
    const { data: challenge, error: challengeError } = await _sb.auth.mfa.challenge({ factorId: factor.id });
    if (challengeError) _throwNormalized('server_error');
    const { error } = await _sb.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.id, code });
    if (error) _throwNormalized('account_verification_invalid_code');

    // Codes de secours (voir migration 0017) : générés et affichés une seule
    // fois ici. LIMITE CONNUE : la connexion via un code de secours (perte du
    // téléphone) n'est pas câblée côté auth-login — voir le README.
    const plainCodes = Array.from({ length: 8 }, () => Math.random().toString(36).slice(2, 6).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase());
    const hashes = await Promise.all(plainCodes.map(async (c) => {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(c));
      return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }));
    await _query(_sb.from('mfa_backup_codes').insert(hashes.map((h) => ({ profile_id: _cachedSupabaseUser.id, code_hash: h }))));

    return { backup_codes: plainCodes };
  },
  async disable2fa(password) {
    if (_cachedSupabaseUser?.email) {
      const { error: reauthError } = await _sb.auth.signInWithPassword({ email: _cachedSupabaseUser.email, password });
      if (reauthError) _throwNormalized('login_invalid_credentials');
    }
    const { data: factors } = await _sb.auth.mfa.listFactors();
    for (const f of factors?.totp || []) {
      await _sb.auth.mfa.unenroll({ factorId: f.id });
    }
    return {};
  },

  // ==================== Journal des connexions/actions & alertes de sécurité ====================
  async auditLog(query = '') {
    const params = new URLSearchParams(query.replace(/^\?/, ''));
    let q = _sb.from('audit_log').select('*, profiles(first_name, last_name)').order('created_at', { ascending: false }).limit(200);
    if (params.get('only_logins') === 'true') q = q.like('action', 'auth.login%');
    const rows = await _query(q);
    return { entries: rows.map((r) => ({ ...r, first_name: r.profiles?.first_name, last_name: r.profiles?.last_name })) };
  },
  async securityAlerts(query = '') {
    const params = new URLSearchParams(query.replace(/^\?/, ''));
    let q = _sb.from('security_alerts').select('*').order('created_at', { ascending: false }).limit(100);
    if (params.get('acknowledged') === 'false') q = q.is('acknowledged_at', null);
    else if (params.get('acknowledged') === 'true') q = q.not('acknowledged_at', 'is', null);
    return { alerts: await _query(q) };
  },
  async acknowledgeAlert(id) {
    await _query(_sb.from('security_alerts').update({ acknowledged_by_profile_id: API.getCachedSupabaseUser()?.id, acknowledged_at: new Date().toISOString() }).eq('id', id));
    return {};
  },

  // ==================== Exports CSV ====================
  exportUrl(path, format) {
    // path reprend la forme des anciennes routes PHP (ex: "/export/students?class_id=..")
    // pour rester un simple remplacement d'URL, sans toucher aux pages appelantes.
    const m = path.match(/^\/export\/(\w+)(?:\/([^/?]+)\/([^/?]+))?(\?.*)?$/);
    const token = _cachedToken || '';
    if (!m) return `${FUNCTIONS_URL}/export-csv?resource=unknown&token=${encodeURIComponent(token)}`;
    const [, resource, classId, sequenceId, qs = ''] = m;
    const extra = new URLSearchParams(qs.replace(/^\?/, ''));
    if (classId) extra.set('class_id', classId);
    if (sequenceId) extra.set('sequence_id', sequenceId);
    extra.set('token', token);
    return `${FUNCTIONS_URL}/export-csv?resource=${resource}&${extra.toString()}`;
  },

  // ==================== Calendrier ICS ====================
  icsExportUrl() {
    // HORS PÉRIMÈTRE (voir note de l'étape 8 du projet schoolar-supabase) —
    // export .ics non implémenté côté Supabase pour l'instant.
    return null;
  },

  // ==================== Recherche globale ====================
  async globalSearch(q) {
    const [students, staff] = await Promise.all([
      _sb.from('students').select('id, first_name, last_name, matricule').or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,matricule.ilike.%${q}%`).limit(10),
      _sb.from('profiles').select('id, first_name, last_name, email').or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`).limit(10),
    ]);
    return { students: students.data || [], staff: staff.data || [] };
  },

  // ==================== Clés d'API ====================
  async listApiKeys() {
    const rows = await _query(_sb.from('api_keys').select('id, label, key_prefix, scopes, last_used_at, revoked_at, created_at').order('created_at', { ascending: false }));
    // scopes est un jsonb (déjà un tableau JS natif) ; la page fait elle-même
    // JSON.parse(k.scopes), donc on le repasse en chaîne pour rester compatible.
    return { keys: rows.map((k) => ({ ...k, scopes: JSON.stringify(k.scopes) })) };
  },
  createApiKey(payload) { return _rpc('create_api_key', { p_label: payload.label, p_scopes: payload.scopes || ['students.read'] }); },
  async revokeApiKey(id) { await _query(_sb.from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', id)); return {}; },

  // ==================== Vérification du compte administrateur (code à 6 chiffres) ====================
  verifyAccount(payload) { return _edge('auth-verify-account', { action: 'verify', ...payload }, { auth: false }); },
  resendVerificationCode(payload) { return _edge('auth-verify-account', { action: 'resend', ...payload }, { auth: false }); },

  // ==================== Export "PDF" (page imprimable — voir note étapes 11/13) ====================
  bulletinPdfUrl(id) { return _signedDownloadUrl('bulletin-pdf-view', 'id', id); },
  receiptPdfUrl(paymentId) { return _signedDownloadUrl('receipt-pdf-view', 'id', paymentId); },
};

// Compte le nombre de rôles exclus de la liste "personnel" (direction, admin
// national, élève, parent) — remplace le NOT IN (...) littéral du SQL PHP.
let _staffExcludedRoleIdsCache = null;
async function _staffExcludedRoleIds() {
  if (_staffExcludedRoleIdsCache) return _staffExcludedRoleIdsCache;
  const { data } = await _sb.from('roles').select('id').in('code', ['proviseur', 'principal', 'directeur', 'admin_national', 'eleve', 'parent']);
  _staffExcludedRoleIdsCache = (data || []).map((r) => r.id).join(',') || '0';
  return _staffExcludedRoleIdsCache;
}
