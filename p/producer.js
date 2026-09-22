// The page behind "Compartilhar" in the app: https://qoleto.com/p/?c=<code>
// (and https://qoleto.com/p/<code>, which the site's 404 page forwards here).
//
// It reads one published producer through producer_by_code (0031), a function
// that answers with the same public fields the app shows. The key below is the
// publishable one, the same the app ships and the panel uses; an unpublished
// or unknown code answers null and the page says the listing is not available.
//
// Five languages, chosen from the browser, like the rest of the site.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://dshqzppwbzdeumwlkpfi.supabase.co';
const SUPABASE_KEY = 'sb_publishable_FcuGYckk4FyG9kR9e5iBCQ_NGY_O0Fg';
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = id => document.getElementById(id);

const T = {
  pt: {
    loading: 'Abrindo...', gone: 'Este produtor não está disponível.',
    home: 'Ver o Qoleto', open: 'Aberto agora', closed: 'Fechado agora',
    app: 'Abrir no app', whats: 'Falar no WhatsApp', route: 'Como chegar',
    soon: 'Qoleto: o mapa dos pequenos produtores artesanais e familiares. Em breve na App Store e no Google Play.',
    reviews: n => `${n} ${n === 1 ? 'avaliação' : 'avaliações'}`,
    days: ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'],
  },
  en: {
    loading: 'Opening...', gone: 'This producer is not available.',
    home: 'See Qoleto', open: 'Open now', closed: 'Closed now',
    app: 'Open in the app', whats: 'Message on WhatsApp', route: 'Directions',
    soon: 'Qoleto: the map of small artisanal and family producers. Coming soon to the App Store and Google Play.',
    reviews: n => `${n} ${n === 1 ? 'review' : 'reviews'}`,
    days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  },
  es: {
    loading: 'Abriendo...', gone: 'Este productor no está disponible.',
    home: 'Ver Qoleto', open: 'Abierto ahora', closed: 'Cerrado ahora',
    app: 'Abrir en la app', whats: 'Escribir por WhatsApp', route: 'Cómo llegar',
    soon: 'Qoleto: el mapa de los pequeños productores artesanales y familiares. Pronto en App Store y Google Play.',
    reviews: n => `${n} ${n === 1 ? 'reseña' : 'reseñas'}`,
    days: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'],
  },
  fr: {
    loading: 'Ouverture...', gone: 'Ce producteur n’est pas disponible.',
    home: 'Voir Qoleto', open: 'Ouvert maintenant', closed: 'Fermé maintenant',
    app: 'Ouvrir dans l’app', whats: 'Écrire sur WhatsApp', route: 'Itinéraire',
    soon: 'Qoleto : la carte des petits producteurs artisanaux et familiaux. Bientôt sur l’App Store et Google Play.',
    reviews: n => `${n} ${n === 1 ? 'avis' : 'avis'}`,
    days: ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'],
  },
  it: {
    loading: 'Apertura...', gone: 'Questo produttore non è disponibile.',
    home: 'Vedi Qoleto', open: 'Aperto ora', closed: 'Chiuso ora',
    app: 'Apri nell’app', whats: 'Scrivi su WhatsApp', route: 'Indicazioni',
    soon: 'Qoleto: la mappa dei piccoli produttori artigianali e familiari. Presto su App Store e Google Play.',
    reviews: n => `${n} ${n === 1 ? 'recensione' : 'recensioni'}`,
    days: ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'],
  },
};

const lang = (navigator.language || 'en').slice(0, 2).toLowerCase();
const t = T[lang] || T.en;
document.documentElement.lang = lang in T ? (lang === 'pt' ? 'pt-BR' : lang) : 'en';

// ?c=<code>, or the code as the last part of the path (/p/<code>).
function readCode() {
  const q = new URLSearchParams(location.search).get('c');
  if (q) return q.trim().toLowerCase();
  const last = location.pathname.replace(/\/+$/, '').split('/').pop();
  return /^[0-9a-f]{6,32}$/i.test(last) ? last.toLowerCase() : '';
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hhmm = s => String(s).slice(0, 5);

function stars(rating) {
  const full = Math.round(Number(rating) || 0);
  return '★★★★★'.slice(0, full) + '☆☆☆☆☆'.slice(0, 5 - full);
}

function render(p) {
  document.title = `${p.name} - Qoleto`;
  // Same resized delivery the app asks for, so a phone on mobile data does not
  // download the original photo.
  const raw = p.cover_url || (p.photos && p.photos[0]);
  const cover = raw && `${raw.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/')}${raw.includes('?') ? '&' : '?'}width=900&quality=70`;
  if (cover) $('cover').style.backgroundImage = `url("${cover.replace(/"/g, '%22')}")`;
  else $('cover').classList.add('nocover');

  const chips = [];
  if (p.category && p.category.name) chips.push(`<span class="pchip">${esc(p.category.name)}</span>`);
  if (p.is_open !== null && p.is_open !== undefined) {
    chips.push(`<span class="pchip ${p.is_open ? 'on' : 'off'}">${p.is_open ? t.open : t.closed}</span>`);
  }
  if (p.price_level) chips.push(`<span class="pchip">${'$'.repeat(p.price_level)}</span>`);
  $('chips').innerHTML = chips.join('');

  $('name').textContent = p.name;
  if (p.tagline) { $('tagline').textContent = p.tagline; $('tagline').hidden = false; }

  const meta = [];
  if (p.rating) meta.push(`<span class="pstars">${stars(p.rating)}</span> ${Number(p.rating).toFixed(1).replace('.', lang === 'en' ? '.' : ',')} <span class="muted">(${t.reviews(p.rating_count || 0)})</span>`);
  const where = [p.address, p.neighbourhood, p.city].filter(Boolean).join(', ');
  if (where) meta.push(esc(where));
  $('meta').innerHTML = meta.join(' · ');

  if (p.description) { $('desc').textContent = p.description; $('desc').hidden = false; }

  if (p.hours && p.hours.length) {
    const byDay = new Map();
    p.hours.forEach(h => {
      if (!byDay.has(h.weekday)) byDay.set(h.weekday, []);
      byDay.get(h.weekday).push(`${hhmm(h.opens)} - ${hhmm(h.closes)}`);
    });
    const order = [1, 2, 3, 4, 5, 6, 0];
    $('hours').innerHTML = order.filter(d => byDay.has(d))
      .map(d => `<div class="phour"><span>${t.days[d]}</span><span>${byDay.get(d).join(', ')}</span></div>`).join('');
    $('hours').hidden = false;
  }

  const acts = [];
  acts.push(`<a class="pbtn primary" href="qoleto://p/${encodeURIComponent(p.code)}">${t.app}</a>`);
  if (p.whatsapp) {
    acts.push(`<a class="pbtn" href="https://wa.me/${String(p.whatsapp).replace(/[^0-9]/g, '')}">${t.whats}</a>`);
  }
  if (p.lat && p.lng) {
    acts.push(`<a class="pbtn" href="https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}">${t.route}</a>`);
  }
  $('actions').innerHTML = acts.join('');
  $('note').textContent = t.soon;

  $('state').hidden = true;
  $('card').hidden = false;
}

(async () => {
  const code = readCode();
  $('state').textContent = t.loading;
  if (!code) { $('state').innerHTML = `${esc(t.gone)} <a href="/">${esc(t.home)}</a>`; return; }
  try {
    const { data, error } = await db.rpc('producer_by_code', { p_code: code });
    if (error) throw error;
    if (!data) { $('state').innerHTML = `${esc(t.gone)} <a href="/">${esc(t.home)}</a>`; return; }
    render(data);
  } catch (e) {
    console.warn('[qoleto]', e);
    $('state').innerHTML = `${esc(t.gone)} <a href="/">${esc(t.home)}</a>`;
  }
})();
