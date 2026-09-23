/**
 * One real page per published producer, at /p/<codigo>/.
 *
 * "Compartilhar" sends https://qoleto.com/p/<codigo>. On GitHub Pages a path
 * with no file behind it answers 404 (the 404 page forwards the reader to the
 * right place, but the address bar says 404 and WhatsApp shows no preview of
 * the link). So every published producer gets its own small page here: HTTP
 * 200, its name in the tab, and og: tags with its photo, which is what a
 * messenger reads to draw the card.
 *
 * The page itself carries no data beyond those tags: producer.js reads the
 * code from the path and asks the server, as it does for /p/?c=<codigo>. So a
 * producer that changes its photo or hours does not need this run again; only
 * NEW producers do.
 *
 * The code is the first 12 characters of the id without dashes (0031), so it
 * can be worked out here without asking the server for each one.
 *
 *   node tools/build-producer-pages.js          writes the pages
 *   node tools/build-producer-pages.js --check  says what would change
 */

const fs = require('fs');
const path = require('path');

const BASE = 'https://dshqzppwbzdeumwlkpfi.supabase.co';
const KEY = 'sb_publishable_FcuGYckk4FyG9kR9e5iBCQ_NGY_O0Fg';
const SITE = 'https://qoleto.com';
const OUT = path.join(__dirname, '..', 'p');
const check = process.argv.includes('--check');

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const codeOf = id => String(id).replace(/-/g, '').slice(0, 12);

/** The cover, asked for at a size a link preview likes. */
function cover(url) {
  if (!url) return `${SITE}/og-default.jpg`;
  const rendered = url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
  return `${rendered}${rendered.includes('?') ? '&' : '?'}width=1200&quality=75`;
}

function page(p) {
  const code = codeOf(p.id);
  const title = `${p.name} - Qoleto`;
  const where = [p.neighbourhood, p.city].filter(Boolean).join(', ');
  const desc = where
    ? `${p.category_name ?? 'Produtor'} em ${where}. Veja no Qoleto, o mapa dos pequenos produtores.`
    : 'Veja no Qoleto, o mapa dos pequenos produtores artesanais e familiares.';
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${SITE}/p/${code}/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Qoleto">
<meta property="og:url" content="${SITE}/p/${code}/">
<meta property="og:title" content="${esc(p.name)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(cover(p.cover_url))}">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<main class="wrap card-wrap">
  <a class="brand" href="/">Qoleto</a>

  <article id="card" class="pcard" hidden>
    <div class="pcover" id="cover"></div>
    <div class="pbody">
      <div class="pchips" id="chips"></div>
      <h1 id="name">${esc(p.name)}</h1>
      <p class="ptagline" id="tagline" hidden></p>
      <p class="pmeta" id="meta"></p>
      <p class="pdesc" id="desc" hidden></p>
      <div class="phours" id="hours" hidden></div>
      <div class="pactions" id="actions"></div>
      <p class="muted pnote" id="note"></p>
    </div>
  </article>

  <p id="state" class="pstate">...</p>
</main>
<footer class="foot">© 2026 Qoleto</footer>
<script type="module" src="/p/producer.js"></script>
</body>
</html>
`;
}

(async () => {
  const r = await fetch(`${BASE}/rest/v1/rpc/producers_in_bbox`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ min_lng: -180, min_lat: -85, max_lng: 180, max_lat: 85, p_limit: 5000 }),
  });
  if (!r.ok) throw new Error(`the producers could not be read: HTTP ${r.status}`);
  const rows = await r.json();
  if (!Array.isArray(rows) || !rows.length) throw new Error('no published producer came back');

  let written = 0;
  let same = 0;
  for (const p of rows) {
    const dir = path.join(OUT, codeOf(p.id));
    const file = path.join(dir, 'index.html');
    const html = page(p);
    const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (before === html) { same++; continue; }
    if (!check) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, html);
    }
    written++;
  }
  console.log(`${rows.length} published producers | ${written} page(s) ${check ? 'would be written' : 'written'} | ${same} already current`);
})().catch(e => { console.log('FAILED:', e.message); process.exit(1); });
