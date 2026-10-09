# SCHOOLAR — Version 100% Supabase / PostgreSQL

Conversion complète du backend PHP pur + MySQL vers Supabase (PostgreSQL +
Auth + Storage + Edge Functions). **Le frontend (HTML/CSS/JS) est strictement
inchangé visuellement** — seul `frontend/js/api.js` (le point de passage
unique de toutes les requêtes), `frontend/js/store.js`, `frontend/env-config.js`,
`frontend/index.html` (ajout d'un script) et `frontend/js/pages/verify-bulletin.js`
(un seul appel réseau qui contournait api.js) ont changé de TRANSPORT — aucune
page n'a changé de logique, d'apparence ou de comportement.

```
schoolar-supabase-final/
├── frontend/           ← à héberger tel quel (Netlify, Vercel, Apache, nginx...)
└── supabase/
    ├── migrations/     ← 16 fichiers SQL, à appliquer dans l'ordre
    └── functions/      ← 35 Edge Functions (Deno)
```

## 1. Créer le projet Supabase

1. Créez un projet sur [supabase.com](https://supabase.com) (ou une instance
   auto-hébergée).
2. Récupérez dans **Project Settings → API** :
   - `Project URL`
   - la clé `anon` `public`
   - la clé `service_role` (secrète — jamais dans le frontend)

## 2. Appliquer les migrations

**Deux façons de faire — choisissez-en UNE :**

### Option A (recommandée) — CLI Supabase

```bash
supabase login
supabase link --project-ref VOTRE_REF_PROJET
supabase db push          # applique les 19 migrations dans l'ordre, automatiquement
```

### Option B — Éditeur SQL du Dashboard (sans CLI)

⚠️ **Point critique** : si vous collez les fichiers un par un dans l'éditeur SQL,
vous DEVEZ les exécuter **dans l'ordre numérique strict (0001 → 0019), un par un,
en attendant que chacun réussisse avant de lancer le suivant**. Une table
comme `establishments` est créée à l'étape 1 ; toute étape qui la référence
avant qu'elle existe échouera avec une erreur du type `relation
"establishments" does not exist` — c'est l'erreur classique quand on exécute
les fichiers dans le désordre ou depuis plusieurs onglets ouverts en parallèle.

Pour éviter tout risque, un fichier **`supabase/ALL_MIGRATIONS_COMBINED.sql`**
est fourni : il concatène les 17 migrations dans le bon ordre en un seul
fichier. Collez-le en une seule fois dans l'éditeur SQL et exécutez-le — c'est
la méthode la plus sûre si vous n'utilisez pas la CLI.

(J'ai vérifié programmatiquement les 17 fichiers : aucune table n'est jamais
référencée avant sa création, et l'extension nécessaire — `pgcrypto` — est
bien activée dès la première migration. Aucune dépendance à l'extension
`unaccent`, qui n'est pas activée par défaut sur un nouveau projet Supabase.)

## 3. Déployer les Edge Functions

```bash
supabase functions deploy --no-verify-jwt \
  auth-login auth-register-establishment auth-register-national-admin \
  auth-verify-account admin-change-manage parent-confirm-invitation \
  payments-confirm-dev public-api documents-download \
  library-download homework-download bulletin-pdf-view receipt-pdf-view \
  export-csv
supabase functions deploy   # toutes les autres (JWT vérifié automatiquement)
```

> Les fonctions listées avec `--no-verify-jwt` sont celles appelées AVANT
> connexion (inscription, mot de passe oublié...) ou via un token en query
> string plutôt qu'un en-tête `Authorization` classique (téléchargements,
> exports, vérification publique). Réajustez cette liste si votre CLI diffère.

## 4. Configurer les secrets des Edge Functions

Dans **Project Settings → Edge Functions → Secrets** (ou `supabase secrets set`) :

| Secret | Description |
|---|---|
| `FRONTEND_URL` | URL publique du frontend (liens dans les emails) |
| `FRONTEND_ORIGINS` | Origines autorisées en CORS, séparées par des virgules |
| `RESEND_API_KEY` | Clé API [Resend](https://resend.com) pour l'envoi d'emails (optionnel en dev — sans clé, les emails sont journalisés dans les logs de la fonction au lieu d'être envoyés) |
| `MAIL_FROM` | Adresse d'expédition des emails |
| `SMS_GATEWAY_API_KEY` | Fournisseur SMS camerounais de votre choix (non branché par défaut — voir `_shared/notify.ts`) |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | Pour l'orientation scolaire (IA Claude) |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | Pour les épreuves concours et les bulletins IA (GPT) |
| `APP_DEBUG` | `true` en développement (active `payments-confirm-dev`, le simulateur Mobile Money — **à laisser absent/false en production**) |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY` sont
injectées automatiquement par Supabase, rien à faire.

## 5. Créer le tout premier compte (administrateur national)

Une fois déployé, ouvrez le frontend → écran d'inscription de l'admin
national (`registerNationalAdmin`) — il ne peut être créé qu'une seule fois.

## 6. Configurer le frontend

Éditez `frontend/env-config.js` :

```js
window.SCHOOLAR_SUPABASE_URL = 'https://VOTRE-PROJET.supabase.co';
window.SCHOOLAR_SUPABASE_ANON_KEY = 'VOTRE_CLE_ANON_PUBLIQUE';
```

Puis hébergez le dossier `frontend/` sur n'importe quel serveur web statique
(Netlify, Vercel, Apache, nginx, GitHub Pages...) — c'est un fichier
`index.html` unique avec routing côté client, aucune configuration serveur
particulière requise au-delà d'un fallback SPA classique si votre hébergeur
en a besoin (Supabase utilise des ancres `#/...`, donc même pas nécessaire ici).

## 7. Paiements Mobile Money — IMPORTANT

`payments-confirm-dev` est un **simulateur de développement** qui remplace
le webhook signé Orange Money / MTN MoMo. Avant toute mise en production
réelle avec de l'argent, il faut :
1. Souscrire aux API Orange Money / MTN MoMo côté marchand.
2. Remplacer `payments-confirm-dev` par une vraie fonction de webhook qui
   vérifie la signature du fournisseur avant de mettre à jour `payments`.
3. Retirer/laisser `APP_DEBUG` à `false` en production.

## Fonctionnalités volontairement non couvertes (repli existant, ou hors périmètre)

- **Export PDF réel** (reçus, bulletins) : remplacé par une page HTML
  imprimable (`bulletin-pdf-view`, `receipt-pdf-view`) — bouton
  "Imprimer / Enregistrer en PDF" du navigateur, exactement le repli que le
  PHP d'origine utilisait déjà quand la bibliothèque PDF n'était pas installée.
- **Export calendrier `.ics`** : non implémenté (`icsExportUrl()` renvoie `null`).
- **Moyenne trimestrielle agrégée** (`studentTermSummary`) : non implémentée.
- **Export Excel (`.xlsx`)** : seul le CSV est disponible.

## Où regarder en cas de souci pendant les tests

Le fichier `frontend/js/api.js` est **le seul point de passage** de toutes
les requêtes. Si une page affiche un comportement inattendu, le problème (et
sa correction) se trouve presque toujours dans la méthode correspondante de
ce fichier — jamais dans les fichiers de `frontend/js/pages/`, qui n'ont pas
été modifiés.
"# Schoolar-v1" 
