# Anniversaire de Tone – site de fiches

Site pour l'anniversaire de Tone (30 novembre). Les viewers remplissent une fiche, les modérateurs la valident, et Tone découvre le tout le jour J. Le résumé (sans les mots) s'ouvre à tout le monde le 30 novembre ; « Les mots » ne sont lisibles que par Tone.

## Comment ça marche

| Partie | Où |
|---|---|
| La page (ce dépôt) | GitHub Pages |
| Fiches, comptes de l'équipe, dessins | Supabase (base de données, authentification, stockage) |
| Vérification des clips Twitch (chaîne, titre, miniature) | Fonction Supabase `submit-fiche` |

- Les viewers n'écrivent jamais directement dans la base : leur fiche passe par la fonction `submit-fiche`, qui vérifie le jeu, le clip (auprès de Twitch), le mot et le dessin.
- Le public ne lit que les fiches **validées**, à partir du **30 novembre 2026 à 00 h (heure de Paris)**, et jamais la colonne « mot ». Cette règle est dans la base, pas dans la page.
- Les modérateurs voient toutes les fiches et peuvent changer leur statut. Tone voit les fiches validées avec les mots, à partir du 30 novembre.

## Mettre le site en ligne (GitHub Pages)

1. Pousser ce dossier sur un dépôt GitHub (public).
2. Dépôt > **Settings** > **Pages** > *Deploy from a branch*, branche `main`, dossier `/ (root)`, **Save**.
3. Après une minute, l'adresse du site s'affiche en haut de la page Pages.

## Réglages

`assets/js/config.js` contient l'adresse du projet Supabase et la clé **publishable** (publique par conception). Ne jamais y mettre la clé `secret` / `service_role` ni le Client Secret Twitch.

Pour essayer la page sans serveur (mode démo : fiches stockées dans le navigateur, boutons « Voir un aperçu »), vider `supabaseUrl` et `publishableKey`.

## Mise en place de Supabase (déjà faite pour ce projet)

1. SQL Editor : lancer `supabase/supabase-setup.sql`, puis `supabase/supabase-setup-2.sql`.
2. Edge Functions > Secrets : `TWITCH_CLIENT_ID` et `TWITCH_CLIENT_SECRET` (application créée sur dev.twitch.tv/console).
3. Edge Functions : déployer `supabase/supabase-function-submit-fiche.ts` sous le nom `submit-fiche`, avec « Verify JWT » désactivé.
4. Authentication : inscriptions libres désactivées ; comptes créés à la main (`tone@anniv.fr`, `moderation@anniv.fr`) avec « Auto Confirm User ».
5. SQL Editor : attribuer les rôles dans la table `equipe` (voir la fin de `supabase-setup.sql`).

## Connexion de l'équipe

Dans le pied de page : **Espace modérateur** et **Espace streamer**. On saisit l'identifiant sans le domaine (`tone`, `moderation`) et le mot de passe.

## Liste des jeux

La liste est dans `assets/js/app.js` (constante `GAMES`) **et** dans la fonction `supabase/supabase-function-submit-fiche.ts`. Pour ajouter ou retirer un jeu, modifier les deux (puis redéployer la fonction).
