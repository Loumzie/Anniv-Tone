// =====================================================================
// Fonction « submit-fiche » : reçoit une fiche, la vérifie, l'enregistre.
//
// Où la mettre : Supabase > Edge Functions > « Deploy a new function »
// > « Via Editor », nom : submit-fiche, coller ce fichier, « Deploy ».
//
// Secrets à créer (Edge Functions > Secrets) :
//   TWITCH_CLIENT_ID       identifiant de ton application Twitch
//   TWITCH_CLIENT_SECRET   secret de ton application Twitch (jamais dans la page)
// Facultatif :
//   TWITCH_BROADCASTER_ID  identifiant de la chaîne (par défaut : ToneEUW, 141222256)
//
// Réglage de la fonction : désactiver « Verify JWT » (la clé publique
// « sb_publishable_… » n'est pas un JWT). La fonction se protège elle-même :
// elle vérifie chaque champ avant d'écrire quoi que ce soit.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TWITCH_ID = Deno.env.get("TWITCH_CLIENT_ID") ?? "";
const TWITCH_SECRET = Deno.env.get("TWITCH_CLIENT_SECRET") ?? "";
const BROADCASTER_ID = Deno.env.get("TWITCH_BROADCASTER_ID") ?? "141222256"; // ToneEUW
const CHANNEL = "toneeuw";

// Même liste que dans le formulaire.
const GAMES = new Set<string>(["Grand Theft Auto V", "Satisfactory", "ELDEN RING", "Lycans", "Age of Empires IV", "League of Legends", "PUBG: BATTLEGROUNDS", "WARDOGS", "Marathon", "Resonance: A Plague Tale Legacy", "MECCHA CHAMELEON", "Zwift", "Big Walk", "World of Warcraft", "OneState", "Corsair Cove", "Guild Wars 2", "Shift at Midnight", "OK Boomer", "Mewgenics", "Street Fighter 6", "Peekablock", "Farming Simulator 25", "Jackbox Party Packs", "Pizza House Simulator", "Hozy", "Marbles on Stream", "S.O.N.A.R.: Submarine Operators Not Actually Ready", "Subnautica 2", "Counter-Strike", "Minecraft", "DayZ", "Keep Talking and Nobody Explodes", "Hades II"]);

const MAX_WORD_CHARS = 500;      // caractères visibles
const MAX_WORD_HTML = 3000;      // taille du texte enregistré
const MAX_DRAWING_BYTES = 300_000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (status: number, field: string | null, message: string) =>
  json(status, { ok: false, field, message });
const str = (v: unknown) => (typeof v === "string" ? v : "");

// ---------- Mot : on ne garde que gras, italique, souligné, barré, retours à la ligne ----------
const ALLOWED = new Set(["b", "i", "u", "s", "br", "div"]);
const ALIAS: Record<string, string> = { strong: "b", em: "i", strike: "s", del: "s", p: "div" };

function cleanHtml(input: string): string {
  let out = "";
  for (const m of input.matchAll(/(<[^>]*>)|([^<]+)|(<)/g)) {
    if (m[1]) {
      const t = /^<\s*(\/?)\s*([a-zA-Z0-9]+)/.exec(m[1]);
      if (!t) continue;
      const lower = t[2].toLowerCase();
      const name = ALIAS[lower] ?? lower;
      if (!ALLOWED.has(name)) continue;
      out += name === "br" ? (t[1] ? "" : "<br>") : `<${t[1]}${name}>`;
    } else if (m[2]) {
      out += m[2].replace(/&(?!(?:amp|lt|gt|quot|#39|nbsp);)/g, "&amp;").replace(/>/g, "&gt;");
    } else {
      out += "&lt;";
    }
  }
  return out;
}
function visibleLength(html: string): number {
  const text = html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  return [...text.trim()].length;
}

// ---------- Clip : lien Twitch -> identifiant du clip ----------
function parseClip(raw: string): { slug: string } | { error: string } {
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : "https://" + raw);
  } catch {
    return { error: "Ce texte n'est pas un lien. Colle l'adresse complète du clip." };
  }
  if (!/^https?:$/.test(u.protocol) || !/\.[a-z]{2,}$/i.test(u.hostname)) {
    return { error: "Ce texte n'est pas un lien. Colle l'adresse complète du clip." };
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
  const segs = u.pathname.split("/").filter(Boolean);
  let slug = "";
  if (host === "clips.twitch.tv") {
    slug = segs[0] === "embed" ? (u.searchParams.get("clip") ?? "") : (segs[0] ?? "");
  } else if (host === "twitch.tv") {
    if (segs[0]?.toLowerCase() === "clip") slug = segs[1] ?? "";
    else if (segs[1] === "clip") slug = segs[2] ?? "";
  } else {
    return { error: "Ce lien ne vient pas de Twitch. Seuls les clips de la chaîne Twitch de Tone sont acceptés." };
  }
  if (!slug) {
    return { error: "Ce lien n'est pas celui d'un clip précis. Ouvre le clip sur Twitch et copie son adresse." };
  }
  if (!/^[A-Za-z0-9_-]{5,100}$/.test(slug)) {
    return { error: "Le lien du clip semble incomplet ou abîmé. Recopie-le en entier depuis la barre d'adresse." };
  }
  return { slug };
}

// ---------- Twitch : jeton d'accès et lecture du clip ----------
let tokenCache: { token: string; exp: number } | null = null;

async function twitchToken(): Promise<string> {
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const r = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: TWITCH_ID, client_secret: TWITCH_SECRET, grant_type: "client_credentials" }),
  });
  if (!r.ok) throw new Error("twitch token " + r.status);
  const j = await r.json();
  tokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return tokenCache.token;
}

type TwitchClip = { broadcaster_id: string; title: string; thumbnail_url: string };

async function twitchClip(slug: string): Promise<TwitchClip | null> {
  const call = (token: string) =>
    fetch("https://api.twitch.tv/helix/clips?id=" + encodeURIComponent(slug), {
      headers: { Authorization: `Bearer ${token}`, "Client-Id": TWITCH_ID },
    });
  let r = await call(await twitchToken());
  if (r.status === 401) { tokenCache = null; r = await call(await twitchToken()); }
  if (!r.ok) throw new Error("twitch clips " + r.status);
  const j = await r.json();
  return j.data?.[0] ?? null;
}

// ---------- Dessin : image JPEG envoyée en texte (data URL) ----------
function decodeDrawing(raw: string): Uint8Array | { error: string } {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(raw);
  if (!m || m[1].length > Math.ceil(MAX_DRAWING_BYTES * 4 / 3) + 8) {
    return { error: "Le dessin n'est pas dans un format accepté ou il est trop lourd." };
  }
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
  } catch {
    return { error: "Le dessin est abîmé. Redessine-le puis renvoie ta fiche." };
  }
  if (bytes.length > MAX_DRAWING_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return { error: "Le dessin n'est pas dans un format accepté ou il est trop lourd." };
  }
  return bytes;
}

// ---------- Jaquettes des jeux (Twitch « Get Games »), mises en cache 6 h ----------
let artCache: { at: number; games: Record<string, string> } | null = null;

async function gameArt(): Promise<Record<string, string>> {
  if (artCache && Date.now() - artCache.at < 6 * 3600_000) return artCache.games;
  const games: Record<string, string> = {};
  if (TWITCH_ID && TWITCH_SECRET) {
    const names = [...GAMES];
    const byLower = new Map(names.map((n) => [n.toLowerCase(), n]));
    for (let i = 0; i < names.length; i += 100) {
      const qs = names.slice(i, i + 100).map((n) => "name=" + encodeURIComponent(n)).join("&");
      const call = (token: string) =>
        fetch("https://api.twitch.tv/helix/games?" + qs, {
          headers: { Authorization: `Bearer ${token}`, "Client-Id": TWITCH_ID },
        });
      let r = await call(await twitchToken());
      if (r.status === 401) { tokenCache = null; r = await call(await twitchToken()); }
      if (!r.ok) throw new Error("twitch games " + r.status);
      const j = await r.json();
      for (const g of j.data ?? []) {
        const ours = byLower.get(String(g.name).toLowerCase());
        if (ours && g.box_art_url) {
          games[ours] = String(g.box_art_url).replace("{width}", "285").replace("{height}", "380");
        }
      }
    }
  }
  artCache = { at: Date.now(), games };
  return games;
}

// ---------- Réception d'une fiche ----------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method === "GET") {
    try {
      return json(200, { ok: true, games: await gameArt() });
    } catch (e) {
      console.error(e);
      return json(200, { ok: true, games: {} });
    }
  }
  if (req.method !== "POST") return fail(405, null, "Méthode non autorisée.");

  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body || typeof body !== "object") throw new Error();
  } catch {
    return fail(400, null, "Requête illisible.");
  }

  // Pseudo (obligatoire)
  const pseudo = str(body.pseudo).trim();
  if (!pseudo) return fail(422, "pseudo", "Indique ton pseudo pour envoyer ta fiche.");
  if ([...pseudo].length > 40) return fail(422, "pseudo", "Ton pseudo dépasse 40 caractères.");
  if (/[\u0000-\u001f\u007f]/.test(pseudo)) return fail(422, "pseudo", "Ton pseudo contient un caractère non accepté.");

  // Jeu (facultatif, uniquement dans la liste)
  const game = str(body.game).trim();
  if (game && !GAMES.has(game)) return fail(422, "game", "Choisis un jeu dans la liste.");

  // Mot (facultatif)
  const rawWord = str(body.word);
  let word: string | null = null;
  if (rawWord.trim()) {
    if (rawWord.length > 20_000) return fail(422, "word", "Ton mot est trop long.");
    const cleaned = cleanHtml(rawWord);
    const n = visibleLength(cleaned);
    if (n > MAX_WORD_CHARS) return fail(422, "word", `Ton mot dépasse ${MAX_WORD_CHARS} caractères. Raccourcis-le pour l'envoyer.`);
    if (cleaned.length > MAX_WORD_HTML) return fail(422, "word", "Ton mot contient trop de mise en forme. Simplifie-le.");
    word = n > 0 ? cleaned : null;
  }

  // Clip (facultatif) : doit exister et venir de la chaîne de Tone
  let clip: string | null = null, clipTitle: string | null = null, clipThumb: string | null = null;
  const rawClip = str(body.clip).trim();
  if (rawClip) {
    const parsed = parseClip(rawClip);
    if ("error" in parsed) return fail(422, "clip", parsed.error);
    if (!TWITCH_ID || !TWITCH_SECRET) {
      return fail(503, "clip", "La vérification des clips est momentanément indisponible. Tu peux envoyer ta fiche sans clip et réessayer plus tard.");
    }
    let tc: TwitchClip | null;
    try {
      tc = await twitchClip(parsed.slug);
    } catch (e) {
      console.error(e);
      return fail(502, "clip", "Twitch ne répond pas pour le moment. Réessaie dans quelques instants.");
    }
    if (!tc) return fail(422, "clip", "Ce clip est introuvable. Il a peut-être été supprimé : choisis-en un autre.");
    if (String(tc.broadcaster_id) !== BROADCASTER_ID) {
      return fail(422, "clip", "Ce clip ne vient pas de la chaîne de Tone. Choisis un clip de sa chaîne (" + CHANNEL + ").");
    }
    clip = `https://www.twitch.tv/${CHANNEL}/clip/${parsed.slug}`;
    clipTitle = String(tc.title ?? "").slice(0, 200) || null;
    clipThumb = String(tc.thumbnail_url ?? "").slice(0, 500) || null;
  }

  // Dessin (facultatif)
  let bytes: Uint8Array | null = null;
  const rawDrawing = str(body.drawing);
  if (rawDrawing) {
    const d = decodeDrawing(rawDrawing);
    if ("error" in d) return fail(422, "drawing", d.error);
    bytes = d;
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant");
    return fail(500, null, "Le site n'est pas encore bien configuré. Réessaie plus tard.");
  }
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let path: string | null = null;
  if (bytes) {
    path = `${crypto.randomUUID()}.jpg`;
    const { error } = await sb.storage.from("dessins").upload(path, bytes, { contentType: "image/jpeg", upsert: false });
    if (error) {
      console.error(error);
      return fail(500, "drawing", "Le dessin n'a pas pu être enregistré. Réessaie dans un instant.");
    }
  }

  const { error } = await sb.from("fiches").insert({
    pseudo,
    game: game || null,
    clip,
    clip_title: clipTitle,
    clip_thumb: clipThumb,
    word,
    drawing_path: path,
  });
  if (error) {
    console.error(error);
    if (path) await sb.storage.from("dessins").remove([path]);
    return fail(500, null, "La fiche n'a pas pu être enregistrée. Réessaie dans un instant.");
  }
  return json(200, { ok: true });
});
