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
window.SCHOOLAR_SUPABASE_URL = 'https://muupxklrxugczabqgghm.supabase.co';
window.SCHOOLAR_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im11dXB4a2xyeHVnY3phYnFnZ2htIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0OTc1MzEsImV4cCI6MjEwNzA3MzUzMX0.-KLeiWLNB9PMfaaQAof-Mb7SV40To9YsRgNCVXHEti4';
