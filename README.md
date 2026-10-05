# Anniversaire de Tone – site de fiches (aperçu)

Premier aperçu du site pour l'anniversaire de Tone (30 novembre). Les viewers remplissent une fiche, les modérateurs la valident, et Tone découvre le tout le jour J.

> **Ceci est un prototype de présentation, pas la version finale.** Il n'y a pas encore de serveur : voir la section « Ce qui reste à brancher ».

## Voir le site

**En local :** ouvrir `index.html` dans un navigateur (double-clic, rien à installer).

**En ligne avec GitHub Pages :**
1. Pousser ce dossier sur un dépôt GitHub.
2. Dépôt > **Settings** > **Pages**.
3. *Build and deployment* : **Deploy from a branch**, branche `main`, dossier `/ (root)`, puis **Save**.
4. Après une minute, l'adresse du site s'affiche en haut de la page Pages.

Le site contient une balise `noindex` pour ne pas apparaître dans les moteurs de recherche.

## Parcourir l'aperçu

- **Formulaire** : pseudo, jeu (choix dans la liste des jeux joués par Tone), clip (uniquement un clip de la chaîne de Tone), dessin, mot (avec mise en forme et emoji).
- **Espace modérateur** : lien en bas de page > **Voir un aperçu**. Onglets *À valider*, *Validées*, *Refusées*.
- **Espace streamer** : lien en bas de page > **Voir un aperçu**. Onglets *Les fiches*, *Les jeux*, *Les clips*, *Les dessins* et *Les mots* (réservé à Tone).
- **Bouton « Résumé »** (en haut de la page, accessible à tous) : normalement visible seulement à partir du 30 novembre. Dans l'aperçu, il apparaît dès qu'un des deux boutons « Voir un aperçu » a été utilisé. Il ouvre le résumé **sans** l'onglet *Les mots*.
- S'il n'y a aucune vraie fiche, des **fiches d'exemple** s'affichent dans les espaces modérateur et streamer.
- Pour tester le parcours complet : remplir une fiche, la valider dans l'espace modérateur, puis la retrouver dans l'espace streamer.

## Ce qui est volontairement simplifié

| Sujet | État actuel |
|---|---|
| Stockage des fiches | `localStorage` : chaque navigateur ne voit que ses propres fiches, rien n'est partagé |
| Accès modérateur / streamer | Aucune authentification, les boutons « Voir un aperçu » ouvrent tout |
| Verrou du 30 novembre | Vérifié dans le navigateur, donc contournable |
| « Les mots » réservé à Tone | Masqué à l'écran seulement |
| Clip | Vérification du lien uniquement (`twitch.tv/toneeuw/clip/…`) |
| Titre et miniature des clips | Pas récupérés : vignette de remplacement |

## Ce qui reste à brancher (backend)

Le code est prévu pour que ça se fasse à quelques endroits, tous repérés par un commentaire `BACKEND` dans `assets/js/app.js` :

- `saveFiche()`, `loadFiches()` et `updateStatus()` : enregistrement des fiches et changement de statut (`pending`, `approved`, `rejected`).
- **Accès** : connexion réservée aux modérateurs et à Tone. Le serveur ne doit renvoyer que les fiches `approved` à l'espace streamer et au résumé public, et les mots uniquement à Tone (et aux modérateurs). L'ouverture à la date du 30 novembre doit aussi être décidée côté serveur.
- **Clips** : appeler l'API Twitch (*Get Clips*, avec Client ID et secret gardés côté serveur) au moment de l'envoi pour vérifier que le clip existe et vient bien de la chaîne de Tone, puis enregistrer `clipTitle` et `clipThumb` avec la fiche. La page affiche déjà `clipThumb` quand il est présent.
- Adresse de l'espace modérateur : ne pas la laisser en lien visible dans le pied de page.

## Réglages rapides (haut de `assets/js/app.js`)

- `UNLOCK` : date d'ouverture du résumé (30 novembre 2026).
- `KEY` : clé de stockage local.
- `CHANNEL` : chaîne Twitch autorisée pour les clips (`toneeuw`).
- `GAMES` : liste des jeux proposés dans le formulaire.

## Structure

```
index.html
assets/
  css/style.css
  js/app.js
  img/chat.png
  img/tone-logo.png
```

Polices chargées depuis Google Fonts : Anton, Archivo, Permanent Marker.
