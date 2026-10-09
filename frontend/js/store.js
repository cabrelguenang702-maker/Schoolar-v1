/**
 * SCHOOLAR — Store de session
 * ------------------------------------------------------------------
 * Le PROFIL utilisateur reste mis en cache dans localStorage exactement
 * comme avant (pour un affichage instantané au chargement, avant même que
 * la session Supabase ait fini de se restaurer). Le JETON, lui, est
 * désormais lu depuis le cache synchrone tenu à jour par api.js
 * (API.getCachedToken()) plutôt que depuis localStorage : cela garantit
 * qu'un jeton expiré/rafraîchi automatiquement par supabase-js n'est jamais
 * périmé côté appelant.
 */
const Store = {
  KEY_TOKEN: 'schoolar_token', // conservé pour compatibilité (voir setSession)
  KEY_USER: 'schoolar_user',

  getToken() {
    const live = (typeof API !== 'undefined' && API.getCachedToken()) || null;
    return live || localStorage.getItem(this.KEY_TOKEN);
  },

  getUser() {
    const raw = localStorage.getItem(this.KEY_USER);
    return raw ? JSON.parse(raw) : null;
  },

  setSession(token, user) {
    if (token) localStorage.setItem(this.KEY_TOKEN, token);
    localStorage.setItem(this.KEY_USER, JSON.stringify(user));
  },

  clearSession() {
    localStorage.removeItem(this.KEY_TOKEN);
    localStorage.removeItem(this.KEY_USER);
  },

  isAuthenticated() {
    return !!this.getToken();
  },
};
