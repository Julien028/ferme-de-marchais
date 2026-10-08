# Site du distributeur — Ferme de Marchais

Site d'un distributeur automatique à la ferme, avec une administration protégée par
mot de passe : le contenu (produits, prix, photos, textes) se modifie en ligne et
s'enregistre côté serveur.

Julien Pichot n'est pas développeur. Réponds en français, explique ce que tu fais en
mots simples, et évite le jargon quand un mot courant suffit.

## Où est quoi

| Élément | Contenu |
|---|---|
| `public/` | **Le site tel qu'il est déposé sur Cloudflare.** `index.html` (le site), `_worker.js` (la partie serveur), `depart.json` (contenu de départ), `affiche.html` + `qrcode.js` (affiche A4), `photos/`. |
| `docs/LISEZMOI-origine.txt` | La notice de mise en ligne d'origine : stockage KV, liaisons, mot de passe. |

## En ligne — À CONFIRMER AVEC JULIEN AVANT TOUTE PUBLICATION

Ce site n'est pas fait comme les autres applis (voir `../LISEZ-MOI-applications.md`).

- Adresse : https://ferme-de-marchais.pages.dev/ (donnée par Julien le 07/10/2026).
  C'est un projet **Cloudflare Pages** nommé `ferme-de-marchais`, déposé à la main par zip.
  La notice d'origine parle de `distributeur-marchais` : ce n'est pas le nom retenu.
  Compte vérifié le 07/10/2026 : celui de bretonvilliers28@gmail.com, le même que wrangler
  sur ce poste.
- Réglages faits dans le tableau de bord Cloudflare, à ne pas écraser :
  liaison KV `DISTRIBUTEUR`, secret `ADMIN_PASSWORD`, variable facultative `ADMIN_ID`.
- **Ne pas ajouter de fichier `wrangler.toml` / `wrangler.jsonc` sans vérifier** : sur un
  projet Pages, il remplace les réglages du tableau de bord et peut faire sauter la liaison KV.
- Un projet Pages créé par dépôt direct ne peut pas être relié à GitHub après coup.
  Publication prévue, **avec l'accord de Julien à chaque fois** :
  `npx wrangler pages deploy public --project-name ferme-de-marchais --branch main`
  Le `--branch main` est indispensable : la version en ligne est sur la branche `main`,
  alors que le git local s'appelle `master`. Sans lui, la publication part en simple
  aperçu et le site ne change pas. Après publication, vérifier l'adresse et
  `/api/session` (doit répondre `{"admin":false}`, preuve que la liaison KV tient).
- Le contenu modifié dans l'administration vit dans Cloudflare KV, pas dans ces fichiers :
  `depart.json` n'est que le contenu de départ.

## Mes produits

- Décision de Julien (08/10/2026) : une seule liste de produits. Un produit est « en vente »
  uniquement quand il est placé dans une case ; pas d'interrupteur à part.
- Liste `produits` du contenu KV (`[{ id, nom, prix, …, photos }]`), modifiée par
  `PUT /api/produits`. Chaque case garde une copie de la fiche + `produit` (l'identifiant) ;
  à chaque enregistrement de la liste, le serveur recopie la fiche dans les cases liées et
  relie les cases d'avant la liste par nom + prix.
- Tant que la liste n'a jamais été enregistrée, le site la tire des cases (`catalogue()`).

## Banque de photos et affiches

- La banque de photos est la liste `banque` du contenu KV (`[{ id, nom }]`), modifiée par
  `PUT /api/banque` (administrateur). Les photos elles-mêmes restent dans KV (`photo:…`)
  ou dans `public/photos/`. Tant qu'elle n'existe pas, le site propose `BANQUE_DEPART`
  (les 4 photos du site). Toute photo ajoutée à une fiche produit y est aussi rangée.
- `affiche.html` fabrique l'affiche A4 ou les flyers A5/A6 à partir de la banque.
  Le QR code part de `location.origin` : Cloudflare raccourcit `/affiche.html` en `/affiche`.
- Essai en local avec stockage et mot de passe d'essai : configuration
  `ferme-de-marchais-admin` dans `Site-ferme/.claude/launch.json` (port 8790, mot de passe
  d'essai indiqué dans cette configuration, données dans `.wrangler/essai`, non versionné).

## Règles à ne pas perdre en chemin

- L'adresse du site ne doit pas changer : elle est sur l'affiche et le QR code.
- Ne jamais écrire le mot de passe d'administration dans un fichier du dépôt.
