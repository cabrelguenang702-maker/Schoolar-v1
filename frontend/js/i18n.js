/**
 * SCHOOLAR — Multilinguisme (section 21 du cahier des charges)
 * Bascule FR/EN accessible à tout moment, persistée en localStorage.
 */
const I18N = {
  current: localStorage.getItem('schoolar_lang') || 'fr',

  dict() {
    return this.current === 'en' ? window.SCHOOLAR_I18N_EN : window.SCHOOLAR_I18N_FR;
  },

  t(key) {
    return this.dict()[key] || key;
  },

  setLang(lang) {
    this.current = lang;
    localStorage.setItem('schoolar_lang', lang);
    document.documentElement.lang = lang;
    window.dispatchEvent(new CustomEvent('schoolar:lang-changed'));
  },
};

function t(key) {
  return I18N.t(key);
}
