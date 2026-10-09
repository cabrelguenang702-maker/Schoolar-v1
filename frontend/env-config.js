/**
 * SCHOOLAR — Configuration d'environnement du frontend (Supabase).
 *
 * Renseignez ici l'URL de votre projet Supabase et sa clé publique "anon"
 * (Dashboard Supabase → Project Settings → API). La clé "anon" est conçue
 * pour être exposée côté client : c'est la Row Level Security côté base de
 * données qui protège réellement les données, pas le secret de cette clé.
 *
 * NE JAMAIS mettre ici la clé "service_role" (celle-ci reste uniquement
 * dans les secrets des Edge Functions, jamais dans le frontend).
 */
window.SCHOOLAR_SUPABASE_URL = 'https://VOTRE-PROJET.supabase.co';
window.SCHOOLAR_SUPABASE_ANON_KEY = 'VOTRE_CLE_ANON_PUBLIQUE';
