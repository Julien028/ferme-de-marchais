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
  Le compte Cloudflare utilisé n'a pas été vérifié.
- Réglages faits dans le tableau de bord Cloudflare, à ne pas écraser :
  liaison KV `DISTRIBUTEUR`, secret `ADMIN_PASSWORD`, variable facultative `ADMIN_ID`.
- **Ne pas ajouter de fichier `wrangler.toml` / `wrangler.jsonc` sans vérifier** : sur un
  projet Pages, il remplace les réglages du tableau de bord et peut faire sauter la liaison KV.
- Un projet Pages créé par dépôt direct ne peut pas être relié à GitHub après coup.
  Publication prévue : `npx wrangler pages deploy public --project-name ferme-de-marchais`
  (vérifier d'abord que wrangler est connecté au bon compte Cloudflare).
- Le contenu modifié dans l'administration vit dans Cloudflare KV, pas dans ces fichiers :
  `depart.json` n'est que le contenu de départ.

## Règles à ne pas perdre en chemin

- L'adresse du site ne doit pas changer : elle est sur l'affiche et le QR code.
- Ne jamais écrire le mot de passe d'administration dans un fichier du dépôt.
