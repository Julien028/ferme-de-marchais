/*
 * SERVEUR DU SITE (Cloudflare Pages, mode "_worker.js")
 * - sert les fichiers du site (index.html, photos…)
 * - enregistre le contenu du distributeur et les photos dans Cloudflare KV
 * - protège les modifications par l'identifiant et le mot de passe administrateur
 *
 * Réglages à faire dans Cloudflare (voir LISEZMOI.txt) :
 *   liaison KV nommée   DISTRIBUTEUR
 *   secret              ADMIN_PASSWORD   (mot de passe de l'administration)
 *   variable (facult.)  ADMIN_ID         (identifiant, "clotilde" par défaut)
 */
const CLE_CONTENU = "contenu";
const DUREE_SESSION = 12 * 3600;                 // 12 heures
const TAILLE_PHOTO_MAX = 3 * 1024 * 1024;        // 3 Mo (les photos sont réduites avant l'envoi)
const TYPES_PHOTO = ["image/jpeg", "image/png", "image/webp"];
const LONGUEURS = { nom: 80, court: 30, prix: 30, contenance: 40, description: 1200, origine: 150, conseils: 1200 };

const json = (data, status = 200, entetes = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...entetes } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);   // le site lui-même
    if (!env.DISTRIBUTEUR) return json({ erreur: "Stockage KV non configuré" }, 503);
    try {
      return await api(request, env, url);
    } catch (e) {
      return json({ erreur: "Erreur du serveur" }, 500);
    }
  }
};

async function api(request, env, url) {
  const chemin = url.pathname, methode = request.method;

  // ----- Lecture publique -----
  if (chemin === "/api/contenu" && methode === "GET") return json(await lireContenu(env, url));
  if (chemin.startsWith("/api/photos/") && methode === "GET") {
    const id = chemin.slice("/api/photos/".length);
    if (!/^[a-f0-9]{24}$/.test(id)) return new Response("Introuvable", { status: 404 });
    const { value, metadata } = await env.DISTRIBUTEUR.getWithMetadata("photo:" + id, { type: "arrayBuffer" });
    if (!value) return new Response("Introuvable", { status: 404 });
    return new Response(value, { headers: { "Content-Type": metadata?.type || "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" } });
  }
  if (chemin === "/api/session" && methode === "GET") return json({ admin: await estAdmin(request, env) });

  // ----- Connexion / déconnexion -----
  if (chemin === "/api/connexion" && methode === "POST") {
    if (!env.ADMIN_PASSWORD) return json({ erreur: "Mot de passe administrateur non configuré" }, 503);
    const { identifiant = "", motDePasse = "" } = await request.json().catch(() => ({}));
    const idAttendu = (env.ADMIN_ID || "clotilde").toLowerCase();
    const ok = await egal(String(identifiant).trim().toLowerCase(), idAttendu) & await egal(String(motDePasse), env.ADMIN_PASSWORD);
    if (!ok) { await new Promise(r => setTimeout(r, 800)); return json({ erreur: "Identifiant ou mot de passe incorrect." }, 401); }
    const jeton = await fabriquerJeton(env);
    return json({ admin: true }, 200, { "Set-Cookie": `session=${jeton}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${DUREE_SESSION}` });
  }
  if (chemin === "/api/deconnexion" && methode === "POST")
    return json({ admin: false }, 200, { "Set-Cookie": "session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0" });

  // ----- Tout le reste est réservé à l'administrateur -----
  if (!(await estAdmin(request, env))) return json({ erreur: "Connexion administrateur nécessaire." }, 401);
  if (request.headers.get("X-Demande") !== "distributeur") return json({ erreur: "Requête refusée." }, 403);

  if (chemin === "/api/casiers" && methode === "PUT") {
    const { nos, contenu } = await request.json();
    if (!Array.isArray(nos) || !nos.length || nos.length > 100 || typeof contenu !== "object") return json({ erreur: "Données invalides." }, 400);
    const donnees = await lireContenu(env, url);
    const propre = nettoyerCasier(contenu, donnees.familles);
    if (!propre) return json({ erreur: "Données invalides." }, 400);
    for (const n of nos) {
      if (!donnees.casiers[String(n)]) return json({ erreur: "Casier inconnu : " + n }, 400);
      donnees.casiers[String(n)] = { no: Number(n), ...propre };
    }
    await env.DISTRIBUTEUR.put(CLE_CONTENU, JSON.stringify(donnees));
    return json({ ok: true });
  }

  if (chemin === "/api/familles" && methode === "PUT") {
    const { liste } = await request.json();
    if (!Array.isArray(liste) || liste.length > 40) return json({ erreur: "Données invalides." }, 400);
    const propres = liste.map(f => ({
      id: String(f.id || "").slice(0, 40).replace(/[^a-z0-9-]/g, ""),
      nom: String(f.nom || "").trim().slice(0, 30),
      couleur: /^#[0-9a-fA-F]{6}$/.test(f.couleur) ? f.couleur : "#3f4a56"
    })).filter(f => f.id && f.nom && f.id !== "vide");
    const donnees = await lireContenu(env, url);
    donnees.familles = propres;
    await env.DISTRIBUTEUR.put(CLE_CONTENU, JSON.stringify(donnees));
    return json({ ok: true });
  }

  if (chemin === "/api/infos" && methode === "PUT") {
    const { infos } = await request.json();
    if (!infos || typeof infos !== "object") return json({ erreur: "Données invalides." }, 400);
    const propres = {};
    for (const [cle, valeur] of Object.entries(infos)) {
      if (!/^[a-zA-Z0-9]{1,20}$/.test(cle)) continue;
      propres[cle] = String(valeur ?? "").trim().slice(0, 600);
    }
    const donnees = await lireContenu(env, url);
    donnees.infos = propres;
    await env.DISTRIBUTEUR.put(CLE_CONTENU, JSON.stringify(donnees));
    return json({ ok: true });
  }

  // Liste des produits. Un produit est "en vente" quand une case du distributeur le contient.
  // Après l'enregistrement, chaque case liée à un produit reprend sa fiche (nom, prix, photos…),
  // pour qu'un changement fait dans la liste s'applique à toutes ses cases.
  if (chemin === "/api/produits" && methode === "PUT") {
    const { liste } = await request.json();
    if (!Array.isArray(liste) || liste.length > 500) return json({ erreur: "Données invalides." }, 400);
    const donnees = await lireContenu(env, url);
    const vus = new Set(), produits = [];
    for (const p of liste) {
      const id = String(p?.id || "");
      if (!ID_PRODUIT.test(id) || vus.has(id)) continue;
      const propre = nettoyerCasier({ ...p, produit: "" }, donnees.familles);
      if (!propre || propre.famille === "vide") continue;
      delete propre.produit;
      vus.add(id); produits.push({ id, ...propre });
    }
    donnees.produits = produits;
    const parId = new Map(produits.map(p => [p.id, p]));
    const cle = p => (p.nom || "").trim().toLowerCase() + "|" + (p.prix || "").trim();
    const parNom = new Map(produits.map(p => [cle(p), p]));
    for (const [no, c] of Object.entries(donnees.casiers)) {
      if (!c || c.famille === "vide") continue;
      // case déjà liée, ou case d'avant la liste reconnue par son nom et son prix
      const p = c.produit ? parId.get(c.produit) : parNom.get(cle(c));
      if (p) { const { id, ...fiche } = p; donnees.casiers[no] = { no: Number(no), ...fiche, produit: id }; }
      else if (c.produit) delete c.produit;      // produit supprimé de la liste : la case garde sa fiche
    }
    await env.DISTRIBUTEUR.put(CLE_CONTENU, JSON.stringify(donnees));
    return json({ ok: true, contenu: donnees });
  }

  // Banque de photos : la liste des photos rangées (distributeur, ferme, produits…), avec un nom.
  // Les photos elles-mêmes restent dans KV ("photo:…") ; seule la liste change ici.
  if (chemin === "/api/banque" && methode === "PUT") {
    const { liste } = await request.json();
    if (!Array.isArray(liste) || liste.length > 300) return json({ erreur: "Données invalides." }, 400);
    const vues = new Set();
    const propres = liste.map(p => ({ id: String(p?.id || ""), nom: String(p?.nom ?? "").trim().slice(0, 60) }))
      .filter(p => estPhotoValide(p.id) && !vues.has(p.id) && vues.add(p.id));
    const donnees = await lireContenu(env, url);
    donnees.banque = propres;
    await env.DISTRIBUTEUR.put(CLE_CONTENU, JSON.stringify(donnees));
    return json({ ok: true });
  }

  if (chemin === "/api/photos" && methode === "POST") {
    const type = (request.headers.get("Content-Type") || "").split(";")[0];
    if (!TYPES_PHOTO.includes(type)) return json({ erreur: "Format accepté : JPEG, PNG ou WebP." }, 400);
    const octets = await request.arrayBuffer();
    if (!octets.byteLength || octets.byteLength > TAILLE_PHOTO_MAX) return json({ erreur: "Photo trop lourde (3 Mo maximum)." }, 400);
    const id = [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, "0")).join("");
    await env.DISTRIBUTEUR.put("photo:" + id, octets, { metadata: { type } });
    return json({ id: "/api/photos/" + id });
  }

  return json({ erreur: "Action inconnue." }, 404);
}

// Contenu enregistré, ou contenu de départ (depart.json) la première fois
async function lireContenu(env, url) {
  const brut = await env.DISTRIBUTEUR.get(CLE_CONTENU);
  if (brut) return JSON.parse(brut);
  const r = await env.ASSETS.fetch(new Request(new URL("/depart.json", url)));
  return await r.json();
}

const ID_PRODUIT = /^[a-z0-9-]{1,40}$/;

// Une photo envoyée depuis l'administration, ou une photo livrée avec le site (dossier photos/)
const estPhotoValide = p => typeof p === "string" &&
  (/^\/api\/photos\/[a-f0-9]{24}$/.test(p) || /^photos\/[\w.-]+\.(jpg|jpeg|png|webp)$/.test(p));

function nettoyerCasier(c, familles) {
  const famille = String(c.famille || "");
  if (famille !== "vide" && !familles.some(f => f.id === famille)) return null;
  const propre = { famille, bio: !!c.bio };
  for (const [champ, max] of Object.entries(LONGUEURS)) propre[champ] = String(c[champ] ?? "").trim().slice(0, max);
  propre.photos = (Array.isArray(c.photos) ? c.photos : []).slice(0, 4).filter(estPhotoValide);
  if (ID_PRODUIT.test(String(c.produit || ""))) propre.produit = String(c.produit);   // produit de la liste
  if (famille === "vide") Object.assign(propre, { nom: "Casier vide", court: "", prix: "", contenance: "", description: "", origine: "", conseils: "", bio: false, photos: [] }), delete propre.produit;
  else if (!propre.nom) return null;
  return propre;
}

// ----- Jeton de session signé (HMAC), sans base de données -----
async function cle(env) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode("session|" + env.ADMIN_PASSWORD), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}
async function signer(env, texte) {
  const sig = await crypto.subtle.sign("HMAC", await cle(env), new TextEncoder().encode(texte));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function fabriquerJeton(env) {
  const expiration = Math.floor(Date.now() / 1000) + DUREE_SESSION;
  return expiration + "." + await signer(env, String(expiration));
}
async function estAdmin(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const m = (request.headers.get("Cookie") || "").match(/(?:^|;\s*)session=(\d+)\.([a-f0-9]{64})/);
  if (!m || Number(m[1]) < Date.now() / 1000) return false;
  return egal(m[2], await signer(env, m[1]));
}
// Comparaison à temps constant (évite de deviner un mot de passe caractère par caractère)
async function egal(a, b) {
  const ha = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(a)));
  const hb = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(b)));
  let d = 0; for (let i = 0; i < ha.length; i++) d |= ha[i] ^ hb[i];
  return d === 0;
}
