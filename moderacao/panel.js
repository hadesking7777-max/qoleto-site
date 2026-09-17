// Painel de moderação - Etapa 3.
//
// Everything here is a thin shell over three database functions:
//   moderation_queue(status, limit)   the listings waiting for a verdict
//   moderation_alerts_list(open)      what the automations flagged
//   resolve_moderation_alert(id)      mark one alert as dealt with
//   moderate_producer(id, action, r)  approve, or reject with a reason
//   categories / producer_categories  what each listing says it produces
//
// All three check public.admins on the server, so this page can be public: a
// visitor who is not a moderator sees an empty queue. The key below is the
// publishable one, the same value shipped inside the app.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://dshqzppwbzdeumwlkpfi.supabase.co';
const SUPABASE_KEY = 'sb_publishable_FcuGYckk4FyG9kR9e5iBCQ_NGY_O0Fg';
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = id => document.getElementById(id);
const login = $('login');
const board = $('board');
const list = $('list');
const state = $('state');

let status = 'pending';
let categoryNames = new Map();

/* ------------------------------------------------------------------ auth */

async function paintSession() {
  const { data } = await db.auth.getSession();
  const user = data.session?.user ?? null;
  login.hidden = Boolean(user);
  board.hidden = !user;
  $('signout').hidden = !user;
  $('who').textContent = user?.email ?? '';
  if (user) load();
}

$('enter').addEventListener('click', async () => {
  const email = $('email').value.trim();
  const password = $('password').value;
  if (!email) return say('Informe o e-mail.');
  if (!password) return sendMagicLink(email);
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) return say('Não consegui entrar: ' + error.message);
  paintSession();
});

$('magic').addEventListener('click', () => {
  const email = $('email').value.trim();
  if (!email) return say('Informe o e-mail.');
  sendMagicLink(email);
});

async function sendMagicLink(email) {
  const { error } = await db.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href },
  });
  say(error ? 'Não consegui enviar o link: ' + error.message
            : 'Link enviado. Abra o e-mail neste mesmo aparelho.');
}

$('signout').addEventListener('click', async () => {
  await db.auth.signOut();
  paintSession();
});

const say = msg => { $('loginMsg').textContent = msg; };

/* ------------------------------------------------------------------ queue */

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('on'));
    tab.classList.add('on');
    status = tab.dataset.status;
    load();
  });
});
$('reload').addEventListener('click', () => load());

async function categoryLabels() {
  if (categoryNames.size) return categoryNames;
  const { data } = await db.from('categories').select('slug, name_pt');
  for (const row of data ?? []) categoryNames.set(row.slug, row.name_pt);
  return categoryNames;
}

async function load() {
  state.textContent = 'Carregando...';
  list.innerHTML = '';
  if (status === 'alerts') return loadAlerts();
  const [{ data, error }] = await Promise.all([
    db.rpc('moderation_queue', { p_status: status, p_limit: 100 }),
    categoryLabels(),
  ]);
  if (error) { state.textContent = 'Erro ao carregar: ' + error.message; return; }
  const rows = data ?? [];
  if (!rows.length) {
    state.textContent = status === 'pending'
      ? 'Nenhum cadastro esperando revisão.'
      : 'Nada aqui por enquanto.';
    return;
  }
  state.textContent = `${rows.length} cadastro(s).`;

  const ids = rows.map(r => r.id);
  const { data: cats } = await db.from('producer_categories')
    .select('producer_id, category_slug, is_primary').in('producer_id', ids);
  const byProducer = new Map();
  for (const c of cats ?? []) {
    if (!byProducer.has(c.producer_id)) byProducer.set(c.producer_id, []);
    byProducer.get(c.producer_id).push(c);
  }

  for (const row of rows) list.appendChild(card(row, byProducer.get(row.id) ?? []));
}

/* ------------------------------------------------------------------ card */

function card(row, cats) {
  const el = document.createElement('article');
  el.className = 'card listing';

  const photos = (row.photos ?? []).slice(0, 6);
  const cover = row.cover_url || photos[0];
  const when = row.submitted_at ? new Date(row.submitted_at).toLocaleString('pt-BR') : '';
  const sorted = [...cats].sort((a, b) => Number(b.is_primary) - Number(a.is_primary));

  el.innerHTML = `
    <div class="listingTop">
      ${cover ? `<img class="cover" src="${attr(cover)}" alt="">` : '<div class="cover empty"></div>'}
      <div class="listingInfo">
        <h3>${text(row.name)}</h3>
        ${row.tagline ? `<p class="tagline">${text(row.tagline)}</p>` : ''}
        <p class="muted small">${text(row.owner_email || '')}${when ? ' &middot; ' + text(when) : ''}</p>
        <div class="chips">
          ${sorted.map(c => `<span class="chip${c.is_primary ? ' main' : ''}">${text(categoryNames.get(c.category_slug) || c.category_slug)}</span>`).join('')}
        </div>
      </div>
    </div>

    ${row.description ? `<p class="desc">${text(row.description)}</p>` : ''}

    <dl class="facts">
      <div><dt>Onde</dt><dd>${text([row.address, row.neighbourhood, row.city].filter(Boolean).join(', ') || '-')}</dd></div>
      <div><dt>Localização</dt><dd>${row.location_precision === 'approximate' ? 'Aproximada (pino deslocado)' : 'Exata'}
        &middot; <a href="https://www.google.com/maps?q=${row.lat},${row.lng}" target="_blank" rel="noopener">ver no mapa</a></dd></div>
      <div><dt>WhatsApp</dt><dd>${text(row.phone_whatsapp || '-')}</dd></div>
      <div><dt>Plano</dt><dd>${row.tier === 'premium' ? 'Premium' : 'Basic'}</dd></div>
    </dl>

    ${photos.length > 1 ? `<div class="thumbs">${photos.map(p => `<img src="${attr(p)}" alt="">`).join('')}</div>` : ''}

    <div class="verdict">
      <button class="primary approve">Aprovar</button>
      <button class="danger reject">Recusar</button>
      <span class="verdictMsg muted"></span>
    </div>
  `;

  const msg = el.querySelector('.verdictMsg');
  const decide = async (action, reason) => {
    msg.textContent = 'Enviando...';
    const { error } = await db.rpc('moderate_producer', { p_id: row.id, p_action: action, p_reason: reason ?? null });
    if (error) { msg.textContent = 'Falhou: ' + error.message; return; }
    el.classList.add('done');
    msg.textContent = action === 'approve' ? 'Aprovado.' : 'Recusado.';
    setTimeout(() => el.remove(), 900);
  };

  el.querySelector('.approve').addEventListener('click', () => decide('approve'));
  el.querySelector('.reject').addEventListener('click', () => {
    const reason = window.prompt('O que o produtor precisa corrigir? Esse texto aparece para ele.');
    if (reason && reason.trim()) decide('reject', reason.trim());
  });

  return el;
}

/* ------------------------------------------------------------------ alerts */

async function loadAlerts() {
  const { data, error } = await db.rpc('moderation_alerts_list', { p_open: true, p_limit: 100 });
  if (error) { state.textContent = 'Erro ao carregar: ' + error.message; return; }
  const rows = data ?? [];
  if (!rows.length) { state.textContent = 'Nenhum alerta aberto.'; return; }
  state.textContent = rows.length + ' alerta(s) aberto(s).';
  for (const row of rows) list.appendChild(alertCard(row));
}

function alertCard(row) {
  const el = document.createElement('article');
  el.className = 'card listing';
  const d = row.detail ?? {};
  const when = row.created_at ? new Date(row.created_at).toLocaleString('pt-BR') : '';
  const kind = row.kind === 'duplicate' ? 'Endereço duplicado'
    : row.kind === 'photo' ? 'Foto sinalizada' : 'Alerta';

  const facts = row.kind === 'duplicate'
    ? [
        ['Tentativa', [d.attempted_name, d.attempted_address].filter(Boolean).join(' - ') || '-'],
        ['Já cadastrado', text(d.existing_name || row.producer_name || '-')],
        ['Distância', d.distance_m != null ? d.distance_m + ' m' : d.reason === 'same google place' ? 'mesmo local no Google' : 'mesmo endereço'],
        ['Quem tentou', text(d.actor_email || row.actor_email || '-')],
        ['Coordenadas', d.attempted_lat != null ? `<a href="https://www.google.com/maps?q=${d.attempted_lat},${d.attempted_lng}" target="_blank" rel="noopener">ver no mapa</a>` : '-'],
      ]
    : [
        ['Veredito', text(d.verdict || '-')],
        ['Motivo', text((d.offending || []).join(', ') || d.reason || 'sem assunto reconhecido')],
        ['Produtor', text(row.producer_name || '-')],
        ['Quem enviou', text(d.actor_email || row.actor_email || '-')],
        ['Rótulos', text((d.labels || []).map(l => l.description).join(', ') || '-')],
      ];

  el.innerHTML = `
    <div class="listingTop">
      <div class="listingInfo">
        <h3>${text(kind)}</h3>
        <p class="muted small">${text(when)}</p>
        <dl class="facts">
          ${facts.map(([k, v]) => `<div><dt>${text(k)}</dt><dd>${v}</dd></div>`).join('')}
        </dl>
      </div>
    </div>
    <div class="verdict">
      <button class="primary resolve">Marcar como resolvido</button>
      <span class="verdictMsg muted"></span>
    </div>
  `;

  const msg = el.querySelector('.verdictMsg');
  el.querySelector('.resolve').addEventListener('click', async () => {
    msg.textContent = 'Enviando...';
    const { error } = await db.rpc('resolve_moderation_alert', { p_id: row.id });
    if (error) { msg.textContent = 'Falhou: ' + error.message; return; }
    el.classList.add('done');
    msg.textContent = 'Resolvido.';
    setTimeout(() => el.remove(), 900);
  });

  return el;
}

/* Everything below comes from producers themselves, so it is escaped before it
   touches the page - a listing name is data, never markup. */
const text = v => String(v ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const attr = v => encodeURI(String(v ?? ''));

db.auth.onAuthStateChange(() => paintSession());
paintSession();
