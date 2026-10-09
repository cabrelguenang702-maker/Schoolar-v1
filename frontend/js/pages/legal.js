/**
 * SCHOOLAR — Pages légales (mentions légales / CGU / politique de
 * confidentialité). Accessible sans connexion (#/legal/:tab).
 *
 * IMPORTANT : le contenu ci-dessous est un CANEVAS DE DÉPART rédigé pour
 * couvrir les points essentiels (identité de l'éditeur, nature des données
 * traitées — y compris celles de mineurs —, droits des personnes, contact).
 * Il doit être RELU ET COMPLÉTÉ par un professionnel du droit camerounais
 * avant mise en production réelle (raison sociale exacte, numéro RCCM,
 * délégué à la protection des données le cas échéant, hébergeur définitif).
 * Les champs entre crochets [comme ceci] sont à compléter par l'éditeur.
 */
const LegalPage = {
  render(root, params) {
    const tab = params.tab || 'mentions';

    const tabs = [
      { key: 'mentions', label_fr: 'Mentions légales', label_en: 'Legal notice' },
      { key: 'cgu', label_fr: "Conditions d'utilisation", label_en: 'Terms of use' },
      { key: 'confidentialite', label_fr: 'Politique de confidentialité', label_en: 'Privacy policy' },
    ];

    root.innerHTML = `
      <div style="max-width:860px;margin:0 auto;padding:32px 20px;">
        <div class="logo-row"><div class="logo-box">${UI.logoSvg()}</div><div class="logo-word">${t('app_name')}</div></div>

        <div class="role-tabs mt-24">
          ${tabs.map(tb => `<button type="button" class="role-tab ${tab === tb.key ? 'active' : ''}" data-tab="${tb.key}">${I18N.current === 'fr' ? tb.label_fr : tb.label_en}</button>`).join('')}
        </div>

        <div class="card mt-24" style="line-height:1.7;">
          ${this.content(tab)}
        </div>

        <p class="mt-24"><a href="#/login">${t('back_to_login')}</a></p>
      </div>
    `;

    root.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => { window.location.hash = `#/legal/${btn.dataset.tab}`; });
    });
  },

  content(tab) {
    const fr = I18N.current === 'fr';

    if (tab === 'cgu') {
      return fr ? `
        <h2>Conditions générales d'utilisation</h2>
        <p class="text-muted text-sm">Dernière mise à jour : [à compléter par l'éditeur]</p>

        <h3>1. Objet</h3>
        <p>SCHOOLAR est une plateforme numérique de gestion scolaire destinée aux établissements d'enseignement secondaire du Cameroun (notes, présences, discipline, communication, paiements). L'utilisation de la plateforme implique l'acceptation pleine et entière des présentes conditions.</p>

        <h3>2. Comptes et rôles</h3>
        <p>L'accès à SCHOOLAR est organisé par rôle : administrateur national (opérateur de la plateforme), administration d'établissement (proviseur, principal, censeur...), personnel enseignant, parents et élèves. Chaque utilisateur est responsable de la confidentialité de ses identifiants et s'engage à ne pas les partager.</p>

        <h3>3. Inscription d'un établissement</h3>
        <p>Tout établissement s'inscrivant sur SCHOOLAR reste soumis à une validation par l'administration nationale avant activation de son espace. L'établissement s'engage à fournir des informations exactes et à jour.</p>

        <h3>4. Utilisation loyale</h3>
        <p>L'utilisateur s'engage à ne pas détourner la plateforme à des fins frauduleuses, à ne pas tenter d'accéder à des données d'un autre établissement, et à respecter la confidentialité des informations concernant les élèves.</p>

        <h3>5. Disponibilité et responsabilité</h3>
        <p>[À compléter par l'éditeur : niveau de service, limitation de responsabilité en cas d'indisponibilité, garanties.]</p>

        <h3>6. Résiliation</h3>
        <p>[À compléter par l'éditeur : conditions de suspension ou de résiliation d'un compte établissement.]</p>

        <h3>7. Droit applicable</h3>
        <p>Les présentes conditions sont soumises au droit camerounais. Tout litige relève des juridictions compétentes du Cameroun.</p>
      ` : `
        <h2>Terms of Use</h2>
        <p class="text-muted text-sm">Last updated: [to be completed by the publisher]</p>
        <h3>1. Purpose</h3>
        <p>SCHOOLAR is a digital school management platform for secondary schools in Cameroon (grades, attendance, discipline, communication, payments). Using the platform implies full acceptance of these terms.</p>
        <h3>2. Accounts and roles</h3>
        <p>Access to SCHOOLAR is organized by role: national administrator (platform operator), school administration, teaching staff, parents and students. Each user is responsible for keeping their credentials confidential.</p>
        <h3>3. School registration</h3>
        <p>Any school registering on SCHOOLAR remains subject to validation by the national administration before its space is activated.</p>
        <h3>4. Fair use</h3>
        <p>Users agree not to misuse the platform, not to attempt to access another school's data, and to respect student data confidentiality.</p>
        <h3>5. Availability and liability</h3>
        <p>[To be completed by the publisher.]</p>
        <h3>6. Termination</h3>
        <p>[To be completed by the publisher.]</p>
        <h3>7. Governing law</h3>
        <p>These terms are governed by Cameroonian law. Any dispute falls under the jurisdiction of Cameroonian courts.</p>
      `;
    }

    if (tab === 'confidentialite') {
      return fr ? `
        <h2>Politique de confidentialité</h2>
        <p class="text-muted text-sm">Dernière mise à jour : [à compléter par l'éditeur]</p>

        <h3>1. Données collectées</h3>
        <p>SCHOOLAR traite des données concernant : le personnel des établissements (nom, email, téléphone), les parents (nom, email, téléphone, lien avec l'élève), et <strong>les élèves, y compris mineurs</strong> (nom, date et lieu de naissance, sexe, photo le cas échéant, notes, présences, informations disciplinaires).</p>

        <h3>2. Données concernant les mineurs</h3>
        <p>La grande majorité des élèves inscrits sur SCHOOLAR sont mineurs. Leurs données sont traitées sous la responsabilité de l'établissement scolaire, avec l'autorisation implicite des parents/tuteurs légaux du fait de leur inscription dans l'établissement. Ces données ne sont utilisées qu'aux fins strictement pédagogiques et administratives prévues par la plateforme (suivi scolaire, communication avec les familles, gestion administrative).</p>

        <h3>3. Finalités du traitement</h3>
        <p>Gestion des inscriptions, suivi des résultats scolaires, gestion des présences et de la discipline, communication établissement-familles, gestion des paiements scolaires, génération de bulletins et documents officiels.</p>

        <h3>4. Partage des données</h3>
        <p>Les données d'un établissement ne sont jamais accessibles à un autre établissement. Aucune donnée n'est vendue à des tiers. Les seuls partages externes concernent les prestataires techniques strictement nécessaires (hébergement, envoi d'email/SMS, passerelle de paiement mobile) et, le cas échéant, l'administration nationale de l'éducation dans le cadre de ses missions de supervision.</p>

        <h3>5. Durée de conservation</h3>
        <p>[À compléter par l'éditeur : durée de conservation des dossiers élèves après leur sortie de l'établissement, politique d'archivage.]</p>

        <h3>6. Sécurité</h3>
        <p>Les mots de passe sont stockés de façon chiffrée (jamais en clair). Les accès sont protégés par authentification et cloisonnés par établissement. Des mesures de limitation des tentatives de connexion sont en place.</p>

        <h3>7. Droits des personnes</h3>
        <p>Toute personne (ou, pour un élève mineur, son représentant légal) peut demander l'accès, la rectification ou la suppression de ses données en s'adressant à l'administration de son établissement, ou directement à [contact à compléter par l'éditeur].</p>

        <h3>8. Contact</h3>
        <p>Pour toute question relative à cette politique : [email à compléter par l'éditeur].</p>
      ` : `
        <h2>Privacy Policy</h2>
        <p class="text-muted text-sm">Last updated: [to be completed by the publisher]</p>
        <h3>1. Data collected</h3>
        <p>SCHOOLAR processes data about: school staff, parents, and <strong>students, including minors</strong> (name, date and place of birth, sex, photo where applicable, grades, attendance, disciplinary information).</p>
        <h3>2. Data about minors</h3>
        <p>Most students on SCHOOLAR are minors. Their data is processed under the responsibility of the school, with the implicit authorization of parents/legal guardians resulting from enrollment. This data is used only for the strictly educational and administrative purposes of the platform.</p>
        <h3>3. Purposes</h3>
        <p>Enrollment management, academic tracking, attendance and discipline management, school-family communication, tuition payment management, report card and official document generation.</p>
        <h3>4. Data sharing</h3>
        <p>One school's data is never accessible to another school. No data is sold to third parties. External sharing is limited to strictly necessary technical providers (hosting, email/SMS delivery, mobile payment gateway) and, where applicable, the national education administration.</p>
        <h3>5. Retention period</h3>
        <p>[To be completed by the publisher.]</p>
        <h3>6. Security</h3>
        <p>Passwords are stored encrypted (never in plain text). Access is authenticated and isolated per school. Login attempt limits are in place.</p>
        <h3>7. Rights</h3>
        <p>Anyone (or, for a minor student, their legal guardian) may request access to, correction of, or deletion of their data by contacting their school's administration, or directly [contact to be completed].</p>
        <h3>8. Contact</h3>
        <p>For any question about this policy: [email to be completed by the publisher].</p>
      `;
    }

    // Mentions legales (par defaut)
    return fr ? `
      <h2>Mentions légales</h2>
      <h3>Éditeur de la plateforme</h3>
      <p>[Raison sociale à compléter] — [Forme juridique] — [Numéro RCCM] — [Adresse du siège social, Cameroun] — [Numéro de contribuable]</p>
      <h3>Directeur de publication</h3>
      <p>[Nom à compléter]</p>
      <h3>Hébergement</h3>
      <p>[Nom et adresse de l'hébergeur à compléter une fois le déploiement en production effectué]</p>
      <h3>Contact</h3>
      <p>[Email de contact à compléter]</p>
      <h3>Propriété intellectuelle</h3>
      <p>L'ensemble des éléments de la plateforme SCHOOLAR (structure, textes, logos, base de données) est protégé par le droit de la propriété intellectuelle. Toute reproduction non autorisée est interdite.</p>
    ` : `
      <h2>Legal Notice</h2>
      <h3>Platform publisher</h3>
      <p>[Company name to be completed] — [Legal form] — [Registration number] — [Registered address, Cameroon]</p>
      <h3>Publication director</h3>
      <p>[Name to be completed]</p>
      <h3>Hosting</h3>
      <p>[Host name and address to be completed once deployed to production]</p>
      <h3>Contact</h3>
      <p>[Contact email to be completed]</p>
      <h3>Intellectual property</h3>
      <p>All elements of the SCHOOLAR platform (structure, text, logos, database) are protected by intellectual property law. Unauthorized reproduction is prohibited.</p>
    `;
  },
};
