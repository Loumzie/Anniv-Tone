/* Connexion à Supabase.
   Ces deux valeurs sont publiques par conception (la sécurité est assurée par les règles de la base) :
   on peut les laisser dans le dépôt GitHub. Ne jamais y mettre la clé « secret » / « service_role »,
   ni le Client Secret Twitch.
   Pour tester sans serveur (mode démo), laisser les deux valeurs vides. */
window.ANNIV_CONFIG = {
  supabaseUrl: 'https://sybsonsjibfozvqzucvi.supabase.co',
  publishableKey: 'sb_publishable_xY9EXkDdzB8opN3O07lewQ_9zbPete5',
  loginDomain: 'anniv.fr'   // « tone » se connecte comme tone@anniv.fr
};
