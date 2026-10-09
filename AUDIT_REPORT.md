# SCHOOLAR — Rapport d'audit (09/10/2026)

Méthode : les 17 migrations ont été appliquées une à une sur un vrai projet Supabase (région eu-west-3),
puis testées avec des utilisateurs fictifs (proviseur, enseignant, parent, élève, admin national) en
simulant leurs jetons (`role authenticated` + `request.jwt.claims`). Chaque test d'attaque a été rejoué
après correction.

## Failles critiques corrigées (0018)
| # | Faille | Preuve | Correctif |
|---|--------|--------|-----------|
| 1 | Un parent pouvait se promouvoir proviseur (`profiles_update_self` sans restriction de colonnes) | rôle effectif = proviseur | trigger `profiles_guard_sensitive` |
| 2 | Un parent pouvait confirmer lui-même son paiement Mobile Money (facture passée à « paid » sans payer) | statut facture = paid | `payments_update_confirm` réservée aux paiements cash/carte, annulation seule pour l'initiateur, `UPDATE` limité à la colonne `status` ; `payments-confirm-dev` passe par le service role |
| 3 | Récursion infinie des politiques RLS (`classes`↔`class_subjects`, `students`↔`student_parents`, messagerie) : accès impossible aux classes, matières, élèves, notes, messages pour tous les rôles non-admin | `infinite recursion detected in policy` | fonctions `SECURITY DEFINER` d'appartenance |
| 4 | Vue `student_validated_averages` en SECURITY DEFINER, lisible hors RLS | alerte ERROR du linter Supabase | `security_invoker` + droits retirés |

## Autres défauts corrigés
- `create_api_key` / `verify_api_key` : `gen_random_bytes` introuvable (search_path) → clés API inutilisables.
- `generate_fee_invoices` : CTE hors de portée du 2ᵉ `SELECT` + aucune policy d'insertion sur `student_fees` → génération des factures toujours en erreur (0018 + 0019).
- Parents/élèves ne voyaient aucune note, présence ni devoir (jointures RLS sur tables fermées) → 0019.
- Notes écrivables directement par l'enseignant, contournant verrou de séquence, motif obligatoire et audit → écriture uniquement via `save_grade_sheet`.
- Élève pouvant s'attribuer 20/20 (`exam_attempts` avec `status='graded'`) → insertion limitée à une tentative vierge.
- Jeton de validation de changement d'administrateur lisible par tout membre de l'établissement.
- Tout parent/élève pouvait lire emails et téléphones de tous les profils de l'établissement.
- `revoke select (checkout_at)` sans effet (privilège de table) → privilèges par colonne.
- `security_alerts_acknowledge … with check (true)`.
- `LIMIT` sans effet dans `exam_ranking`, `timetable_history`, `premium_checkout_history`.
- Fonctions internes et RPC exécutables par `anon` → seules 5 RPC publiques restent ouvertes.
- README : fonction `verify-bulletin` inexistante dans la commande de déploiement, compteurs de migrations/fonctions.

## Tests réussis après correction (extraits)
Notes (saisie, motif obligatoire ≥ 8 pts, alerte d'anomalie, verrou après validation, moyenne/rang), présences,
paiements (annulation parent, confirmation serveur → facture soldée, idempotence des factures), messagerie
(non lus, isolation des non-participants), emploi du temps (détection de conflit, audit à la suppression),
progression, discipline (double résolution refusée), tableaux de bord nationaux (refusés au parent), clé API.

## Reste à faire / à connaître
1. **Edge Functions non déployées ni testées** (35 fonctions Deno) : seul le SQL a été validé.
2. **Test visuel (TinyFish)** : nécessite le frontend hébergé sur une URL publique.
3. **Paiements réels** : `payments-confirm-dev` est un simulateur (`APP_DEBUG=true`) ; il faut brancher un webhook signé Orange Money / MTN MoMo (service role) avant production.
4. Activer « Leaked password protection » dans Supabase Auth (réglage du tableau de bord, plan Pro).
5. `start_or_get_conversation` autorise toute paire d'utilisateurs actifs de l'établissement (parent↔parent, élève↔élève) : décision produit à confirmer.
6. Les données de test (5 comptes `…@test.cm`, mot de passe `Test1234!`) sont dans le projet de test uniquement.
