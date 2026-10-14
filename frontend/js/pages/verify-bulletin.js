/**
 * SCHOOLAR — Vérification publique d'authenticité d'un bulletin (section 20).
 * Accessible sans connexion : c'est le but même du QR code imprimé sur le
 * bulletin (un tiers — employeur, université — peut vérifier l'authenticité
 * sans avoir de compte SCHOOLAR).
 */
const VerifyBulletinPage = {
  async render(root, params) {
    root.innerHTML = `
      <div class="auth-screen">
        <div class="auth-panel-form" style="margin:auto;">
          <div class="logo-row"><div class="logo-box">${UI.logoSvg()}</div><div class="logo-word">${t('app_name')}</div></div>
          <div id="verify-result" class="mt-24"><div class="boot-spinner" style="margin:20px auto;"></div></div>
        </div>
      </div>
    `;

    const box = root.querySelector('#verify-result');
    try {
      const data = await API.verifyBulletin(params.code);

      if (!data || !data.valid) {
        box.innerHTML = `<div class="alert alert-error">${t('verify_invalid')}</div>`;
        return;
      }

      const b = data.bulletin;
      box.innerHTML = `
        <div class="alert alert-success">${t('verify_valid')}</div>
        <div class="card mt-16">
          <p><strong>${I18N.current === 'fr' ? 'Élève' : 'Student'} :</strong> ${UI.esc(b.first_name)} ${UI.esc(b.last_name)} (${UI.esc(b.matricule)})</p>
          <p class="mt-8"><strong>${I18N.current === 'fr' ? 'Établissement' : 'School'} :</strong> ${UI.esc(b.establishment_name)} (${b.establishment_code})</p>
          <p class="mt-8"><strong>${I18N.current === 'fr' ? 'Séquence' : 'Sequence'} :</strong> ${UI.esc(b.sequence_label)}</p>
          <p class="mt-8"><strong>${I18N.current === 'fr' ? 'Généré le' : 'Generated on'} :</strong> ${new Date(b.created_at).toLocaleDateString()}</p>
        </div>
      `;
    } catch (err) {
      box.innerHTML = `<div class="alert alert-error">${t('verify_invalid')}</div>`;
    }
  },
};
