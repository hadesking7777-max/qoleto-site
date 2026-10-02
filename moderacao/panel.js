// Qoleto - Moderação.
//
// A thin shell over database functions that check the moderator list on the
// server (0014, 0018, 0026, 0034, 0035):
//   admin_counts()                       the numbers the board opens on
//   admin_producers(search, status, category, flag, limit, offset)
//   admin_update_producer(id, patch)     edit any field of any listing
//   admin_my_role()                      'owner' or 'moderator' (0039)
//   admin_producer_plan / admin_grant_plan   the plan of a listing, granted by an owner
//   admin_team / admin_set_team_member / admin_remove_team_member   the team, owner only
//   admin_bulk(ids, action, reason)      approve, reject, pause, reactivate many
//   moderate_producer(id, action, r)     one verdict from the review queue
//   moderation_alerts_list(open)         what the automations flagged
//   resolve_moderation_alert(id)         mark one alert as dealt with
//   admin_events(limit)                  every event producers announced (0037)
//   admin_delete_event(id)               take one event down
//
// Redesigned on 23/09 in the client's visual direction. The calls above are
// the same ones the panel bench exercises (tests/panel-live-tests.js).

import { db, DEMO, ART_PHOTO } from './db.js';

const $ = id => document.getElementById(id);

/* Everything shown here comes from producers themselves, so it is escaped
   before it touches the page - a listing name is data, never markup. */
const text = v => String(v ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const attr = v => encodeURI(String(v ?? ''));
const icon = (name, cls = '') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

const PAGE = 50;
const DAYS = [[1, 'Seg'], [2, 'Ter'], [3, 'Qua'], [4, 'Qui'], [5, 'Sex'], [6, 'Sáb'], [0, 'Dom']];
const DAY_NAMES = { 1: 'Segunda', 2: 'Terça', 3: 'Quarta', 4: 'Quinta', 5: 'Sexta', 6: 'Sábado', 0: 'Domingo' };
const REASONS = [
  'As fotos não mostram o produto ou o lugar.',
  'O endereço está incompleto ou não confere com o pino.',
  'A categoria não corresponde ao que é produzido.',
  'Parece ser o cadastro de outro produtor já publicado.',
  'Faltam os horários de funcionamento.',
];

const VIEWS = {
  overview: { hash: 'visao', eyebrow: 'Painel', title: 'Visão geral', sub: 'O que o catálogo precisa hoje, num relance.' },
  queue: { hash: 'fila', eyebrow: 'Moderação', title: 'Fila de revisão', sub: 'Cada cadastro novo ou alterado espera aqui antes de aparecer no mapa.' },
  all: { hash: 'todos', eyebrow: 'Catálogo', title: 'Todos os cadastros', sub: 'Busque, filtre e ajuste vários cadastros de uma vez.' },
  alerts: { hash: 'alertas', eyebrow: 'Automações', title: 'Alertas', sub: 'O que as verificações automáticas pediram para uma pessoa olhar.' },
  events: { hash: 'eventos', eyebrow: 'Agenda', title: 'Eventos', sub: 'Feiras, degustações, colheitas e portas abertas que os produtores anunciaram, com o formato e o plano de cada um.' },
  team: { hash: 'equipe', eyebrow: 'Acesso', title: 'Equipe', sub: 'Quem modera o Qoleto e em qual nível.' },
};

let view = 'overview';
let allStatus = 'all';
let page = 0;
let rowsOnScreen = [];
let queueRows = [];
let focusIdx = 0;
let isModerator = true;
// 'owner' or 'moderator' (0039): only an owner grants plans and manages the
// team; the server enforces it, the panel only shows what each level can do
let role = null;
const isOwner = () => role === 'owner';
const PLANS = { free: 'Free', premium_a: 'Premium A', premium_b: 'Premium B', premium_c: 'Premium C' };
const PLAN_TERMS = [['1', '1 mês'], ['3', '3 meses'], ['6', '6 meses'], ['12', '1 ano'], ['', 'Vitalício']];
const EVENT_FORMATS = { local: 'No local', agendamento: 'Por agendamento', envio: 'Envio' };
const dateText = iso => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const selected = new Set();
const categoryNames = new Map();
let categoryTree = [];

/* ------------------------------------------------------------------ small parts */

function toast(message, tone = 'good') {
  const el = document.createElement('div');
  el.className = 'toast' + (tone === 'bad' ? ' bad' : '');
  el.innerHTML = `${icon(tone === 'bad' ? 'x' : 'check')}<span>${text(message)}</span>`;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}

const price = n => (n ? '$'.repeat(n) : 'Não informada');
const catName = slug => categoryNames.get(slug) || slug || '-';

function statusPill(r) {
  if (r.moderation_status === 'pending') return '<span class="pill warn">Na fila</span>';
  if (r.moderation_status === 'rejected') return '<span class="pill bad">Recusado</span>';
  if (r.moderation_status === 'draft') return '<span class="pill">Rascunho</span>';
  if (r.admin_paused || r.owner_paused) return '<span class="pill">Pausado</span>';
  return '<span class="pill good">Publicado</span>';
}

/** The flags on a listing; `short` for the table, where the detail sits in the editor. */
function signals(r, short = false) {
  const out = [];
  if (r.duplicate_of || r.duplicate_detail) {
    const d = r.duplicate_detail ?? {};
    const where = d.same_place ? 'mesmo local no Google'
      : d.distance_m != null ? `a ${d.distance_m} m` : 'mesmo endereço';
    out.push(short
      ? `<span class="pill warn" title="${text(`${d.name || 'outro cadastro'} (${where})`)}">Possível duplicado</span>`
      : `<span class="pill warn">Possível duplicado de ${text(d.name || 'outro cadastro')} (${text(where)})</span>`);
  }
  const flagged = Object.values(r.photo_check ?? {}).filter(v => v && v.verdict === 'flagged').length;
  if (flagged) out.push(`<span class="pill warn">${flagged === 1 ? '1 foto' : flagged + ' fotos'} para conferir</span>`);
  if (short && r.tier === 'premium') out.push('<span class="pill brass plain">Premium</span>');
  if (r.prevalidated) out.push('<span class="pill good">Encontrado no Google</span>');
  if (r.admin_paused) out.push('<span class="pill">Pausado pela moderação</span>');
  else if (r.owner_paused) out.push('<span class="pill">Pausado pelo produtor</span>');
  return out.join('');
}

/** "Seg a Sex 09:00 - 18:00 · Sáb 09:00 - 13:00" from the hours rows. */
function hoursSummary(hours) {
  if (!hours?.length) return 'Sem horários informados';
  const byDay = new Map();
  hours.forEach(h => byDay.set(h.weekday, `${String(h.opens).slice(0, 5)} - ${String(h.closes).slice(0, 5)}`));
  const runs = [];
  for (const [d, name] of DAYS) {
    const span = byDay.get(d);
    const last = runs[runs.length - 1];
    if (span && last && last.span === span && last.next === d) { last.to = name; last.next = (d + 1) % 7; continue; }
    if (span) runs.push({ from: name, to: name, span, next: (d + 1) % 7 });
  }
  return runs.map(r => `${r.from === r.to ? r.from : `${r.from} a ${r.to}`} ${r.span}`).join(' · ');
}

/* ------------------------------------------------------------------ confirm and reason */

function ask({ title, body = '', reasons = null, field = false, fieldLabel = 'Motivo', ok = 'Confirmar', danger = false }) {
  const dlg = $('modal');
  const input = $('modalInput');
  $('modalTitle').textContent = title;
  $('modalText').textContent = body;
  $('modalText').hidden = !body;
  $('modalField').hidden = !field;
  $('modalFieldLabel').textContent = fieldLabel;
  input.value = '';
  const box = $('modalReasons');
  box.hidden = !reasons;
  box.innerHTML = (reasons ?? []).map((r, i) => `<button type="button" data-r="${i}">${text(r)}</button>`).join('');
  box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    const r = reasons[Number(b.dataset.r)];
    input.value = input.value.trim() ? `${input.value.trim()} ${r}` : r;
    input.focus();
  }));
  const okBtn = $('modalOk');
  okBtn.textContent = ok;
  okBtn.className = 'btn ' + (danger ? 'danger' : 'primary');

  return new Promise(resolve => {
    const finish = result => {
      $('modalForm').onsubmit = null;
      $('modalCancel').onclick = null;
      dlg.onclose = null;
      if (dlg.open) dlg.close();
      resolve(result);
    };
    $('modalForm').onsubmit = e => {
      e.preventDefault();
      if (field && !input.value.trim()) { input.focus(); return; }
      finish({ ok: true, value: input.value.trim() });
    };
    $('modalCancel').onclick = () => finish({ ok: false });
    dlg.onclose = () => finish({ ok: false });
    dlg.showModal();
    (field ? input : okBtn).focus();
  });
}

/* ------------------------------------------------------------------ theme */

function readTheme() { try { return localStorage.getItem('qoleto.panel.theme'); } catch { return null; } }
function saveTheme(t) { try { localStorage.setItem('qoleto.panel.theme', t); } catch { /* per-browser only */ } }
function currentTheme() {
  return document.documentElement.dataset.theme
    || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
function paintThemeIcon() {
  const name = currentTheme() === 'dark' ? 'sun' : 'moon';
  document.querySelectorAll('#theme use, #themeM use').forEach(u => u.setAttribute('href', `#i-${name}`));
}
function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  saveTheme(next);
  paintThemeIcon();
}
const saved = readTheme();
if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
paintThemeIcon();
$('theme').addEventListener('click', toggleTheme);
$('themeM').addEventListener('click', toggleTheme);

/* ------------------------------------------------------------------ sign in */

let step = 'email';            // email | code | password
const say = (msg, bad = false) => { $('loginMsg').textContent = msg; $('loginMsg').classList.toggle('bad', bad); };

function paintStep() {
  $('stepPassword').hidden = step !== 'password';
  $('stepCode').hidden = step !== 'code';
  $('email').readOnly = step === 'code';
  $('authGo').textContent = step === 'code' ? 'Confirmar código' : step === 'password' ? 'Entrar com senha' : 'Receber código';
  $('authSwap').hidden = step === 'code';
  $('authSwap').textContent = step === 'password' ? 'Prefiro receber um código' : 'Tenho uma senha';
  $('authBack').hidden = step !== 'code';
  $('authLead').textContent = step === 'code'
    ? `Enviamos um código de 6 números para ${$('email').value.trim()}. Ele vale por alguns minutos.`
    : 'Enviamos um código de 6 números para o seu e-mail. A conta é criada no primeiro acesso.';
}

$('authSwap').addEventListener('click', () => { step = step === 'password' ? 'email' : 'password'; say(''); paintStep(); });
$('authBack').addEventListener('click', () => { step = 'email'; say(''); paintStep(); $('email').focus(); });
$('code').addEventListener('input', e => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
  if (e.target.value.length === 6) $('authForm').requestSubmit();
});

$('authForm').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('email').value.trim();
  if (!email) { say('Informe o e-mail.', true); $('email').focus(); return; }
  $('authGo').disabled = true;
  try {
    if (step === 'password') {
      const { error } = await db.auth.signInWithPassword({ email, password: $('password').value });
      if (error) { say('E-mail ou senha não conferem.', true); return; }
    } else if (step === 'email') {
      // The account is created on the first code, as in the app: an address
      // that had never opened the app used to be refused with "Signups not
      // allowed for otp" (client review, 22/09). What a person may SEE is
      // decided by the moderator list on the server, never by signing in.
      const { error } = await db.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) { say('Não consegui enviar o código: ' + error.message, true); return; }
      step = 'code';
      say('');
      paintStep();
      $('code').value = '';
      $('code').focus();
      return;
    } else {
      const token = $('code').value.replace(/\D/g, '');
      if (token.length < 6) { say('Digite os 6 números do código.', true); return; }
      say('Confirmando...');
      const { error } = await db.auth.verifyOtp({ email, token, type: 'email' });
      if (error) { say('Código inválido ou expirado. Peça um novo.', true); return; }
    }
    say('');
    step = 'email';
    paintSession();
  } finally {
    $('authGo').disabled = false;
  }
});

async function signOut() {
  await db.auth.signOut();
  step = 'email';
  paintStep();
  paintSession();
}
$('signout').addEventListener('click', signOut);
$('signoutM').addEventListener('click', signOut);

// Supabase announces the session on subscribe and on every sign in, and the
// panel also asks once at start: only a change of person repaints the board.
let shownFor;

async function paintSession() {
  const { data } = await db.auth.getSession();
  const user = data.session?.user ?? null;
  if ((user?.email ?? '') === shownFor) return;
  shownFor = user?.email ?? '';
  $('login').hidden = Boolean(user);
  $('app').hidden = !user;
  $('who').textContent = user?.email ?? '';
  if (user) {
    const fromHash = Object.keys(VIEWS).find(k => `#${VIEWS[k].hash}` === location.hash);
    setView(fromHash || view);
  }
}

/* ------------------------------------------------------------------ navigation */

document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => setView(b.dataset.go)));
$('reload').addEventListener('click', () => setView(view));

function setView(v) {
  view = v;
  const meta = VIEWS[v];
  document.querySelectorAll('[data-view]').forEach(b => {
    if (b.dataset.view === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  Object.keys(VIEWS).forEach(k => { $(`view-${k}`).hidden = k !== v || !isModerator || (k === 'team' && !isOwner()); });
  $('viewEyebrow').textContent = meta.eyebrow;
  $('viewTitle').textContent = meta.title;
  $('viewSub').textContent = meta.sub;
  try { history.replaceState(null, '', `#${meta.hash}`); } catch { /* inside a frame that refuses it */ }
  selected.clear();
  paintBulk();
  $('state').textContent = '';
  load();
}

$('globalQ').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  page = 0;
  if (view !== 'all') setView('all'); else load();
});

async function load() {
  await Promise.all([loadCounts(), categories()]);
  if (!isModerator) return;
  if (view === 'overview') return loadOverview();
  if (view === 'queue') return loadQueue();
  if (view === 'all') return loadAll();
  if (view === 'events') return loadEvents();
  if (view === 'team') return loadTeam();
  return loadAlerts();
}

async function categories() {
  if (categoryNames.size) return;
  const { data } = await db.from('categories').select('slug, name_pt, parent_slug');
  const rows = data ?? [];
  rows.forEach(r => categoryNames.set(r.slug, r.name_pt));
  const byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR');
  categoryTree = rows.filter(r => !r.parent_slug)
    .map(s => ({
      slug: s.slug,
      name: s.name_pt,
      children: rows.filter(c => c.parent_slug === s.slug).map(c => ({ slug: c.slug, name: c.name_pt })).sort(byName),
    }))
    .sort(byName);
  $('fCategory').innerHTML = '<option value="">Todas as categorias</option>' + categoryOptions('');
}

const categoryOptions = current => categoryTree.map(s =>
  `<optgroup label="${text(s.name)}">${s.children.map(c =>
    `<option value="${text(c.slug)}"${c.slug === current ? ' selected' : ''}>${text(c.name)}</option>`).join('')}</optgroup>`,
).join('');

/* ------------------------------------------------------------------ board */

let counts = {};

async function loadCounts() {
  const { data, error } = await db.rpc('admin_counts');
  if (error || !data) return;
  // Signed in but not a moderator: the server answers an empty object, and
  // the person is told so instead of staring at empty lists.
  isModerator = Object.keys(data).length > 0;
  if (!isModerator) {
    Object.keys(VIEWS).forEach(k => { $(`view-${k}`).hidden = true; });
    $('viewEyebrow').textContent = 'Acesso';
    $('viewTitle').textContent = 'Esta conta não é de moderação';
    $('viewSub').textContent = 'Você entrou, mas este e-mail não está na lista de moderadores do Qoleto. Peça acesso ao responsável pelo projeto.';
    return;
  }
  // "paused" on the server counts only the producer's own pause; a listing
  // is on the map when approved and paused by nobody, so the gap between the
  // two is everything approved but off the map, whoever paused it.
  await loadRole();
  counts = { ...data, offMap: Math.max(0, Number(data.approved ?? 0) - Number(data.published ?? 0)) };
  document.querySelectorAll('.navN').forEach(el => {
    const n = Number(data[el.dataset.count] ?? 0);
    el.textContent = n ? String(n) : '';
  });
}

async function loadRole() {
  const { data, error } = await db.rpc('admin_my_role');
  role = error ? 'moderator' : (data || 'moderator');
  $('role').hidden = false;
  $('role').textContent = isOwner() ? 'admin_owner' : 'admin_moderator';
  document.querySelectorAll('.ownerOnly').forEach(el => { el.hidden = !isOwner(); });
  // the team view opened from the address bar waits for the level to be known
  $('view-team').hidden = !(view === 'team' && isOwner());
  if (view === 'team' && !isOwner()) setView('overview');
}

const KPIS = [
  { key: 'pending', label: 'Esperando revisão', icon: 'inbox', go: 'queue', attn: true, foot: 'Abrir a fila' },
  { key: 'published', label: 'Publicados no mapa', icon: 'pin', tone: 'goodTone', foot: 'Visíveis no app agora' },
  { key: 'duplicates', label: 'Possíveis duplicados', icon: 'twins', go: 'all', flag: 'duplicate', attn: true, foot: 'Conferir os sinais' },
  { key: 'alerts', label: 'Alertas abertos', icon: 'bell', go: 'alerts', attn: true, foot: 'Ver os alertas' },
  { key: 'week', label: 'Novos em 7 dias', icon: 'spark', tone: 'brassTone', foot: 'Cadastros recebidos' },
  { key: 'rejected', label: 'Recusados', icon: 'x', go: 'all', status: 'rejected', foot: 'Esperando correção do produtor' },
  { key: 'offMap', label: 'Pausados', icon: 'pause', go: 'all', status: 'paused', foot: 'Fora do mapa por enquanto' },
  { key: 'reviews', label: 'Avaliações', icon: 'star', tone: 'brassTone', foot: 'Publicadas pelos visitantes' },
];

function loadOverview() {
  $('kpis').innerHTML = KPIS.map(k => {
    const n = Number(counts[k.key] ?? 0);
    const cls = ['kpi', k.attn && n > 0 ? 'attn' : '', k.tone ?? ''].join(' ');
    const tag = k.go ? 'button' : 'div';
    const data = k.go ? ` type="button" data-kgo="${k.go}" data-kflag="${k.flag ?? ''}" data-kstatus="${k.status ?? ''}"` : '';
    return `<${tag} class="${cls}"${data}>
      <div class="kpiHead"><span class="kpiLabel">${text(k.label)}</span><span class="kpiIcon">${icon(k.icon)}</span></div>
      <span class="kpiN">${n.toLocaleString('pt-BR')}</span>
      <span class="kpiFoot">${text(k.foot)}</span>
    </${tag}>`;
  }).join('');
  $('kpis').querySelectorAll('[data-kgo]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.kgo === 'all') {
      allStatus = b.dataset.kstatus || 'all';
      $('fFlag').value = b.dataset.kflag || '';
      paintSeg();
    }
    setView(b.dataset.kgo);
  }));

  // the catalogue by status, as one bar: what is live, what waits, what not
  const parts = [
    { label: 'Publicados', n: Number(counts.published ?? 0), color: 'var(--good)' },
    { label: 'Na fila', n: Number(counts.pending ?? 0), color: 'var(--warn)' },
    { label: 'Pausados', n: Number(counts.offMap ?? 0), color: 'var(--muted)' },
    { label: 'Recusados', n: Number(counts.rejected ?? 0), color: 'var(--bad)' },
  ];
  const total = parts.reduce((s, p) => s + p.n, 0);
  $('catalogTotal').textContent = `${total.toLocaleString('pt-BR')} cadastros no total`;
  $('catalogBar').innerHTML = total
    ? parts.filter(p => p.n).map(p => `<span style="width:${(p.n / total) * 100}%;background:${p.color}" title="${text(p.label)}: ${p.n}"></span>`).join('')
    : '';
  $('catalogLegend').innerHTML = parts.map(p =>
    `<div><i style="background:${p.color}"></i>${text(p.label)} <b>${p.n.toLocaleString('pt-BR')}</b></div>`).join('');

  loadNextQueue();
  loadNextAlerts();
}

async function loadNextQueue() {
  const { data } = await db.rpc('admin_producers', { p_status: 'pending', p_limit: 4 });
  const rows = data ?? [];
  $('nextQueue').innerHTML = rows.length ? rows.map(r => {
    const cover = r.cover_url || r.photos?.[0];
    return `<button class="miniRow" type="button" data-id="${text(r.id)}">
      ${cover ? `<img src="${attr(cover)}" alt="">` : '<span class="ph"></span>'}
      <span><strong>${text(r.name)}</strong><span>${text(catName(r.category_slug))} · ${text(r.city || 'sem cidade')}</span></span>
      <span class="muted small">${text(ago(r.submitted_at))}</span>
    </button>`;
  }).join('') : `<div class="emptyNote"><strong>Fila vazia.</strong>Nenhum cadastro esperando revisão.</div>`;
  $('nextQueue').querySelectorAll('[data-id]').forEach(b => b.addEventListener('click', () => {
    focusAfterLoad = b.dataset.id;
    setView('queue');
  }));
}

async function loadNextAlerts() {
  const { data } = await db.rpc('moderation_alerts_list', { p_open: true, p_limit: 3 });
  const rows = data ?? [];
  $('nextAlerts').innerHTML = rows.length ? rows.map(r => `
    <button class="miniRow" type="button" data-go-alerts>
      <span class="ph" style="display:grid;place-items:center;color:var(--warn);background:var(--warn-soft)">${icon(r.kind === 'duplicate' ? 'twins' : 'photo')}</span>
      <span><strong>${text(alertKind(r))}</strong><span>${text(r.producer_name || r.detail?.attempted_name || '')}</span></span>
      <span class="muted small">${text(ago(r.created_at))}</span>
    </button>`).join('') : `<div class="emptyNote"><strong>Tudo em dia.</strong>Nenhum alerta aberto.</div>`;
  $('nextAlerts').querySelectorAll('[data-go-alerts]').forEach(b => b.addEventListener('click', () => setView('alerts')));
}

/* ------------------------------------------------------------------ review queue */

let focusAfterLoad = null;

async function loadQueue() {
  $('state').textContent = 'Carregando...';
  const { data, error } = await db.rpc('admin_producers', { p_status: 'pending', p_limit: 100 });
  if (error) { $('state').textContent = 'Não consegui carregar a fila: ' + error.message; return; }
  queueRows = data ?? [];
  $('state').textContent = '';
  const box = $('queue');
  box.innerHTML = '';
  if (!queueRows.length) {
    box.innerHTML = `<div class="panelBox"><div class="emptyNote"><strong>Fila vazia.</strong>Nenhum cadastro esperando revisão. Os novos aparecem aqui assim que o produtor envia.</div></div>`;
    return;
  }
  queueRows.forEach(r => box.appendChild(reviewCard(r)));
  // scroll only when a listing was picked on the board; a plain visit keeps the header in view
  const picked = focusAfterLoad;
  const at = picked ? queueRows.findIndex(r => r.id === picked) : 0;
  focusAfterLoad = null;
  setFocus(Math.max(0, at), Boolean(picked));
}

function setFocus(i, scroll) {
  const cards = [...$('queue').querySelectorAll('.review')];
  if (!cards.length) return;
  focusIdx = Math.min(Math.max(0, i), cards.length - 1);
  cards.forEach((c, n) => c.classList.toggle('focus', n === focusIdx));
  if (scroll) cards[focusIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function reviewCard(row) {
  const el = document.createElement('article');
  el.className = 'review';
  el.dataset.id = row.id;
  const photos = (row.photos ?? []).slice(0, 8);
  const cover = row.cover_url || photos[0];
  const cats = row.categories?.length ? row.categories : [row.category_slug];
  const where = [row.address, row.address_complement, row.neighbourhood, row.city].filter(Boolean).join(', ');
  const longDesc = (row.description ?? '').length > 240;

  el.innerHTML = `
    <div class="reviewMedia">
      ${cover ? `<img class="mainImg" src="${attr(cover)}" alt="Foto de capa de ${text(row.name)}">` : ''}
      ${row.tier === 'premium' ? '<span class="tierTag">Premium</span>' : ''}
      ${photos.length ? `<span class="mediaCount">${icon('photo')}${photos.length} ${photos.length === 1 ? 'foto' : 'fotos'}</span>` : ''}
    </div>
    <div class="reviewBody">
      <div class="reviewHead">
        <div class="chips">${cats.map(c => `<span class="pill cat plain${c === row.category_slug ? ' lead' : ''}">${text(catName(c))}</span>`).join('')}</div>
        <h3>${text(row.name)}</h3>
        ${row.tagline ? `<p class="tagline">${text(row.tagline)}</p>` : ''}
        <p class="meta"><span>${text(row.owner_email || 'sem e-mail')}</span><span>${icon('clock', 'small')} enviado ${text(ago(row.submitted_at))}</span></p>
      </div>
      ${signals(row) ? `<div class="signals">${signals(row)}</div>` : ''}
      ${row.description ? `<p class="desc">${text(row.description)}</p>${longDesc ? '<button class="linkBtn more" type="button">Ler tudo</button>' : ''}` : ''}
      <dl class="facts">
        <div><dt>Onde</dt><dd>${text(where || '-')} · <a href="https://www.google.com/maps?q=${row.lat},${row.lng}" target="_blank" rel="noopener">ver no mapa</a></dd></div>
        <div><dt>Horários</dt><dd>${text(hoursSummary(row.hours))}</dd></div>
        <div><dt>WhatsApp</dt><dd>${text(row.phone_whatsapp || '-')}</dd></div>
        <div><dt>Faixa de preço</dt><dd>${text(price(row.price_level))}</dd></div>
        <div><dt>Localização</dt><dd>${row.location_precision === 'approximate' ? 'Só a região (pino deslocado)' : 'Ponto exato'}</dd></div>
      </dl>
      ${photos.length > 1 ? `<div class="thumbs">${photos.map((p, i) =>
        `<button type="button" aria-pressed="${p === cover ? 'true' : 'false'}" data-i="${i}" aria-label="Ver foto ${i + 1}"><img src="${attr(p)}" alt=""></button>`).join('')}</div>` : ''}
      <div class="reviewActions">
        <button class="btn primary approve" type="button">${icon('check')}Aprovar e publicar</button>
        <button class="btn danger reject" type="button">${icon('x')}Recusar</button>
        <span class="spacer"></span>
        <button class="btn ghost edit" type="button">${icon('edit')}Editar</button>
      </div>
    </div>`;

  el.addEventListener('click', () => setFocus([...$('queue').children].indexOf(el)));
  el.querySelectorAll('.thumbs button').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    el.querySelector('.mainImg')?.setAttribute('src', attr(photos[Number(b.dataset.i)]));
    el.querySelectorAll('.thumbs button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  }));
  el.querySelector('.more')?.addEventListener('click', e => {
    const d = el.querySelector('.desc');
    d.classList.toggle('open');
    e.target.textContent = d.classList.contains('open') ? 'Mostrar menos' : 'Ler tudo';
  });
  el.querySelector('.approve').addEventListener('click', () => approve(row, el));
  el.querySelector('.reject').addEventListener('click', () => reject(row, el));
  el.querySelector('.edit').addEventListener('click', () => openEditor(row));
  return el;
}

function leave(el) {
  el.classList.add('leaving');
  setTimeout(() => {
    const cards = [...$('queue').querySelectorAll('.review')];
    const i = cards.indexOf(el);
    el.remove();
    queueRows = queueRows.filter(r => r.id !== el.dataset.id);
    if (!queueRows.length) loadQueue(); else setFocus(i, true);
    loadCounts();
  }, 340);
}

async function approve(row, el) {
  const { error } = await db.rpc('moderate_producer', { p_id: row.id, p_action: 'approve', p_reason: null });
  if (error) { toast('Não consegui aprovar: ' + error.message, 'bad'); return; }
  toast(`${row.name} está no mapa.`);
  leave(el);
}

async function reject(row, el) {
  const r = await ask({
    title: `Recusar ${row.name}`,
    body: 'O produtor recebe este texto e pode corrigir o cadastro para uma nova revisão.',
    reasons: REASONS, field: true, fieldLabel: 'O que precisa ser corrigido', ok: 'Recusar cadastro', danger: true,
  });
  if (!r.ok) return;
  const { error } = await db.rpc('moderate_producer', { p_id: row.id, p_action: 'reject', p_reason: r.value });
  if (error) { toast('Não consegui recusar: ' + error.message, 'bad'); return; }
  toast(`${row.name} foi recusado. O produtor já tem o motivo.`);
  leave(el);
}

document.addEventListener('keydown', e => {
  if (view !== 'queue' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, select') || document.querySelector('dialog[open]')) return;
  const cards = [...$('queue').querySelectorAll('.review')];
  if (!cards.length) return;
  const key = e.key.toLowerCase();
  const card = cards[focusIdx];
  const row = queueRows.find(r => r.id === card?.dataset.id);
  if (key === 'j') { e.preventDefault(); setFocus(focusIdx + 1, true); }
  else if (key === 'k') { e.preventDefault(); setFocus(focusIdx - 1, true); }
  else if (key === 'a' && row) { e.preventDefault(); approve(row, card); }
  else if (key === 'r' && row) { e.preventDefault(); reject(row, card); }
  else if (key === 'e' && row) { e.preventDefault(); openEditor(row); }
});

/* ------------------------------------------------------------------ all listings */

function paintSeg() {
  document.querySelectorAll('#statusSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.status === allStatus)));
}
document.querySelectorAll('#statusSeg button').forEach(b => b.addEventListener('click', () => {
  allStatus = b.dataset.status;
  paintSeg();
  page = 0;
  loadAll();
}));
['fCategory', 'fFlag'].forEach(id => $(id).addEventListener('change', () => { page = 0; loadAll(); }));
$('prev').addEventListener('click', () => { if (page > 0) { page--; loadAll(); } });
$('next').addEventListener('click', () => { page++; loadAll(); });

async function loadAll() {
  $('state').textContent = 'Carregando...';
  const { data, error } = await db.rpc('admin_producers', {
    p_search: $('globalQ').value.trim() || null,
    p_status: allStatus,
    p_category: $('fCategory').value || null,
    p_flag: $('fFlag').value || null,
    p_limit: PAGE,
    p_offset: page * PAGE,
  });
  if (error) { $('state').textContent = 'Não consegui carregar: ' + error.message; return; }
  rowsOnScreen = data ?? [];
  selected.clear();
  paintBulk();

  const total = Number(rowsOnScreen[0]?.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  $('state').textContent = total ? '' : 'Nenhum cadastro com esses filtros.';
  $('pager').hidden = pages < 2;
  $('pageInfo').textContent = total ? `${page * PAGE + 1}-${Math.min(total, (page + 1) * PAGE)} de ${total}` : '';
  $('prev').disabled = page === 0;
  $('next').disabled = page + 1 >= pages;
  if (!total) { $('allTable').innerHTML = ''; return; }

  $('allTable').innerHTML = `
    <div class="tableWrap"><table class="grid">
      <thead><tr>
        <th class="pickCell"><input type="checkbox" id="pickAll" aria-label="Selecionar todos"></th>
        <th>Cadastro</th><th>Categoria</th><th>Cidade</th><th>Situação</th><th>Sinais</th><th></th>
      </tr></thead>
      <tbody>${rowsOnScreen.map(r => {
        const cover = r.cover_url || r.photos?.[0];
        return `<tr data-id="${text(r.id)}">
          <td class="pickCell"><input type="checkbox" class="pick" aria-label="Selecionar ${text(r.name)}"></td>
          <td><div class="who2">${cover ? `<img src="${attr(cover)}" alt="">` : '<span class="ph"></span>'}
            <div><strong>${text(r.name)}</strong><span>${text(r.owner_email || '')}</span></div></div></td>
          <td data-l="Categoria">${text(catName(r.category_slug))}</td>
          <td data-l="Cidade">${text(r.city || '-')}</td>
          <td data-l="Situação">${statusPill(r)}</td>
          <td><div class="cellFlags">${signals(r, true)}</div></td>
          <td class="editCell"><button class="iconBtn edit" type="button" aria-label="Editar ${text(r.name)}">${icon('edit')}</button></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;

  const table = $('allTable');
  table.querySelector('#pickAll').addEventListener('change', e => {
    table.querySelectorAll('.pick').forEach(box => {
      box.checked = e.target.checked;
      box.closest('tr').classList.toggle('picked', e.target.checked);
    });
    rowsOnScreen.forEach(r => (e.target.checked ? selected.add(r.id) : selected.delete(r.id)));
    paintBulk();
  });
  table.querySelectorAll('tbody tr').forEach(tr => {
    const row = rowsOnScreen.find(r => r.id === tr.dataset.id);
    tr.querySelector('.pick').addEventListener('change', e => {
      if (e.target.checked) selected.add(row.id); else selected.delete(row.id);
      tr.classList.toggle('picked', e.target.checked);
      paintBulk();
    });
    // the whole row opens the editor, except the tick box that selects it
    tr.addEventListener('click', e => { if (!e.target.closest('.pickCell')) openEditor(row); });
  });
}

function paintBulk() {
  $('bulk').hidden = view !== 'all' || selected.size === 0;
  $('bulkCount').textContent = selected.size === 1 ? '1 selecionado' : `${selected.size} selecionados`;
}
$('bulkClear').addEventListener('click', () => {
  selected.clear();
  document.querySelectorAll('#allTable .pick, #pickAll').forEach(b => { b.checked = false; });
  document.querySelectorAll('#allTable tr.picked').forEach(tr => tr.classList.remove('picked'));
  paintBulk();
});

const BULK = {
  approve: { title: n => `Aprovar ${n === 1 ? '1 cadastro' : n + ' cadastros'}?`, body: 'Eles entram no mapa e cada produtor recebe o aviso.', ok: 'Aprovar', done: 'aprovado(s)' },
  pause: { title: n => `Pausar ${n === 1 ? '1 cadastro' : n + ' cadastros'}?`, body: 'Eles saem do mapa até a moderação reativar. Os produtores continuam vendo o cadastro.', ok: 'Pausar', done: 'pausado(s)' },
  unpause: { title: n => `Reativar ${n === 1 ? '1 cadastro' : n + ' cadastros'}?`, body: 'Os aprovados voltam ao mapa na hora.', ok: 'Reativar', done: 'reativado(s)' },
};

document.querySelectorAll('[data-bulk]').forEach(btn => btn.addEventListener('click', async () => {
  const action = btn.dataset.bulk;
  const ids = [...selected];
  if (!ids.length) return;
  let reason = null;
  if (action === 'reject') {
    const r = await ask({
      title: `Recusar ${ids.length === 1 ? '1 cadastro' : ids.length + ' cadastros'}`,
      body: 'Cada produtor recebe este texto e pode corrigir o cadastro.',
      reasons: REASONS, field: true, fieldLabel: 'Motivo da recusa', ok: 'Recusar', danger: true,
    });
    if (!r.ok) return;
    reason = r.value;
  } else {
    const b = BULK[action];
    const r = await ask({ title: b.title(ids.length), body: b.body, ok: b.ok });
    if (!r.ok) return;
  }
  const { data, error } = await db.rpc('admin_bulk', { p_ids: ids, p_action: action, p_reason: reason });
  if (error) { toast('Não consegui aplicar: ' + error.message, 'bad'); return; }
  toast(`${data} cadastro(s) ${action === 'reject' ? 'recusado(s)' : BULK[action].done}.`);
  loadCounts();
  loadAll();
}));

/* ------------------------------------------------------------------ editor */

function openEditor(row) {
  const dlg = $('editor');
  const hours = new Map((row.hours ?? []).map(h => [h.weekday, h]));
  const extra = new Set((row.categories ?? []).filter(c => c !== row.category_slug));
  const photos = row.photos ?? [];
  const keep = new Set(photos);
  let cover = row.cover_url || photos[0] || null;

  $('editorTitle').textContent = row.name;
  $('editorMeta').innerHTML = `${text(row.owner_email || 'sem e-mail')} · ${statusPill(row)}`;
  $('editorMsg').textContent = '';

  const field = (key, label, value, type = 'text') => `
    <label class="field"><span>${text(label)}</span>
      <input class="input" name="${key}" type="${type}" value="${text(value ?? '')}"${type === 'number' ? ' step="any"' : ''}></label>`;

  $('editorBody').innerHTML = `
    <section class="section"><h3>Sobre</h3>
      ${field('name', 'Nome', row.name)}
      ${field('owners', 'Quem está por trás', row.owners)}
      ${field('tagline', 'Uma linha sobre o produtor', row.tagline)}
      <label class="field"><span>Descrição</span><textarea class="textarea" name="description" rows="5">${text(row.description ?? '')}</textarea></label>
    </section>

    <section class="section"><h3>Categorias</h3>
      <label class="field"><span>Categoria principal (define o pino)</span>
        <select class="select" name="primary_category">${categoryOptions(row.category_slug)}</select></label>
      <div class="catChecks">${categoryTree.map(s => `<p class="catGroup">${text(s.name)}</p>${s.children.map(c => `
        <label class="check"><input type="checkbox" name="extra" value="${text(c.slug)}"${extra.has(c.slug) ? ' checked' : ''}> ${text(c.name)}</label>`).join('')}`).join('')}
      </div>
    </section>

    <section class="section"><h3>Onde</h3>
      ${field('address', 'Endereço', row.address)}
      <div class="two">${field('address_complement', 'Complemento', row.address_complement)}${field('neighbourhood', 'Bairro', row.neighbourhood)}</div>
      ${field('city', 'Cidade', row.city)}
      <div class="two">${field('lat', 'Latitude', row.lat, 'number')}${field('lng', 'Longitude', row.lng, 'number')}</div>
      <p class="small"><a href="https://www.google.com/maps?q=${row.lat},${row.lng}" target="_blank" rel="noopener">Conferir o ponto atual no mapa</a></p>
      <label class="field"><span>Como aparece no mapa</span>
        <select class="select" name="location_precision">
          <option value="exact"${row.location_precision !== 'approximate' ? ' selected' : ''}>No ponto exato</option>
          <option value="approximate"${row.location_precision === 'approximate' ? ' selected' : ''}>Só a região (pino deslocado)</option>
        </select></label>
    </section>

    <section class="section"><h3>Contato e plano</h3>
      ${field('phone_whatsapp', 'WhatsApp', row.phone_whatsapp)}
      <label class="field"><span>Faixa de preço</span><select class="select" name="price_level">
        <option value=""${row.price_level ? '' : ' selected'}>Não informada</option>
        ${[1, 2, 3, 4].map(n => `<option value="${n}"${row.price_level === n ? ' selected' : ''}>${'$'.repeat(n)}</option>`).join('')}
      </select></label>
      <div class="planBox" id="planBox"><p class="muted small">Carregando o plano...</p></div>
    </section>

    <section class="section"><h3>Horários</h3>
      <div class="hours">${DAYS.map(([d]) => {
        const h = hours.get(d);
        return `<div class="hourRow${h ? '' : ' off'}" data-day="${d}">
          <label class="check"><input type="checkbox" class="open"${h ? ' checked' : ''}> ${DAY_NAMES[d]}</label>
          <input class="input opens" type="time" value="${text(String(h?.opens ?? '09:00').slice(0, 5))}" aria-label="Abre às">
          <span class="muted small">às</span>
          <input class="input closes" type="time" value="${text(String(h?.closes ?? '18:00').slice(0, 5))}" aria-label="Fecha às">
        </div>`;
      }).join('')}</div>
    </section>

    ${photos.length ? `<section class="section"><h3>Fotos</h3>
      <p class="muted small">A capa é a foto que abre o cadastro no app. Remover tira a foto do cadastro ao salvar.</p>
      <div class="photoGrid" id="photoGrid"></div>
    </section>` : ''}

    ${row.duplicate_of || row.duplicate_detail ? `<section class="section"><h3>Duplicidade</h3>
      <div class="signals">${signals({ duplicate_of: row.duplicate_of, duplicate_detail: row.duplicate_detail })}</div>
      <label class="check"><input type="checkbox" name="clear_duplicate"> Conferido: não é duplicado (remove o sinal)</label>
    </section>` : ''}`;

  const body = $('editorBody');
  body.querySelectorAll('.hourRow .open').forEach(b => b.addEventListener('change', () => b.closest('.hourRow').classList.toggle('off', !b.checked)));

  const paintPhotos = () => {
    const grid = $('photoGrid');
    if (!grid) return;
    grid.innerHTML = photos.map((p, i) => `
      <div class="photoTile${p === cover ? ' cover' : ''}${keep.has(p) ? '' : ' dropped'}">
        ${p === cover ? '<span class="coverTag">Capa</span>' : ''}
        <img src="${attr(p)}" alt="">
        <div class="tileBar">
          <button type="button" data-cover="${i}"${p === cover || !keep.has(p) ? ' hidden' : ''}>Tornar capa</button>
          <button type="button" class="${keep.has(p) ? 'rm' : ''}" data-keep="${i}">${keep.has(p) ? 'Remover' : 'Manter'}</button>
        </div>
      </div>`).join('');
    grid.querySelectorAll('[data-cover]').forEach(b => b.addEventListener('click', () => { cover = photos[Number(b.dataset.cover)]; paintPhotos(); }));
    grid.querySelectorAll('[data-keep]').forEach(b => b.addEventListener('click', () => {
      const p = photos[Number(b.dataset.keep)];
      if (keep.has(p)) keep.delete(p); else keep.add(p);
      if (!keep.has(cover)) cover = photos.find(x => keep.has(x)) ?? null;
      paintPhotos();
    }));
  };
  paintPhotos();
  paintPlan(row);

  dlg.showModal();
  body.scrollTop = 0;

  $('editorSave').onclick = async () => {
    const val = name => body.querySelector(`[name="${name}"]`)?.value ?? '';
    const patch = {};
    const change = (key, before) => { const now = val(key).trim(); if (now !== String(before ?? '')) patch[key] = now; };
    ['name', 'owners', 'tagline', 'description', 'address', 'address_complement', 'neighbourhood', 'city', 'phone_whatsapp']
      .forEach(k => change(k, row[k]));
    if (val('location_precision') !== (row.location_precision || 'exact')) patch.location_precision = val('location_precision');
    if (val('price_level') !== String(row.price_level ?? '')) patch.price_level = val('price_level') ? Number(val('price_level')) : null;

    const lat = Number(val('lat'));
    const lng = Number(val('lng'));
    if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== row.lat || lng !== row.lng)) { patch.lat = lat; patch.lng = lng; }

    const primary = val('primary_category');
    const extras = [...body.querySelectorAll('[name="extra"]:checked')].map(b => b.value).filter(s => s !== primary);
    if (primary !== row.category_slug || extras.slice().sort().join(',') !== [...extra].sort().join(',')) {
      patch.primary_category = primary;
      patch.categories = [primary, ...extras];
    }

    const newHours = [...body.querySelectorAll('.hourRow')]
      .filter(r => r.querySelector('.open').checked)
      .map(r => ({ weekday: Number(r.dataset.day), opens: r.querySelector('.opens').value, closes: r.querySelector('.closes').value }));
    const hoursKey = hs => hs.map(h => `${h.weekday}-${String(h.opens).slice(0, 5)}-${String(h.closes).slice(0, 5)}`).sort().join('|');
    if (hoursKey(newHours) !== hoursKey(row.hours ?? [])) patch.hours = newHours;

    if (photos.length) {
      const kept = photos.filter(p => keep.has(p));
      if (kept.length !== photos.length) patch.photos = kept;
      if ((cover ?? null) !== (row.cover_url || photos[0] || null)) patch.cover_url = cover ?? '';
    }
    if (body.querySelector('[name="clear_duplicate"]')?.checked) patch.clear_duplicate = true;

    if (!Object.keys(patch).length) { $('editorMsg').textContent = 'Nada mudou.'; return; }
    $('editorSave').disabled = true;
    $('editorMsg').textContent = 'Salvando...';
    const { error } = await db.rpc('admin_update_producer', { p_id: row.id, patch });
    $('editorSave').disabled = false;
    if (error) { $('editorMsg').textContent = ''; toast('Não consegui salvar: ' + error.message, 'bad'); return; }
    dlg.close();
    toast('Alterações salvas.');
    load();
  };
}

/* The plan of a listing, inside the editor. Everyone who moderates sees which
   plan it is on; an admin_owner also grants one, for a term or for life, and
   sees every grant made before. The change is saved at once, on its own
   button: it does not wait for "Salvar". */
async function paintPlan(row) {
  const box = $('planBox');
  if (!box) return;
  const { data, error } = await db.rpc('admin_producer_plan', { p_id: row.id });
  if (error || !data) { box.innerHTML = '<p class="muted small">Não consegui ler o plano deste cadastro.</p>'; return; }
  const until = data.plan === 'free' ? '' : (data.plan_expires_at ? `vence em ${text(dateText(data.plan_expires_at))}` : 'sem vencimento');
  const limits = `${data.events_per_month} ${data.events_per_month === 1 ? 'evento' : 'eventos'} por mês · ${data.max_categories} ${data.max_categories === 1 ? 'categoria' : 'categorias'}`;
  const now = `<div class="planNow"><span>Plano atual:</span><strong>${text(PLANS[data.plan] || data.plan)}</strong>${until ? `<span class="pill brass plain">${until}</span>` : ''}<span class="muted small">${limits}</span></div>`;
  if (!data.can_grant) {
    box.innerHTML = now + '<p class="muted small">Só um admin_owner concede ou altera planos.</p>';
    return;
  }
  const history = (data.grants ?? []).map(g => `<li><b>${text(PLANS[g.plan] || g.plan)}</b><span>${g.plan === 'free' ? 'plano retirado' : (g.months ? `${g.months} ${g.months === 1 ? 'mês' : 'meses'}` : 'vitalício')}</span><span>${text(dateText(g.created_at))}</span><span>${text(g.granted_email || '')}</span>${g.note ? `<span>${text(g.note)}</span>` : ''}</li>`).join('');
  box.innerHTML = `${now}
    <div class="planGrant">
      <label class="field"><span>Conceder plano</span><select class="select" id="grantPlan">${Object.entries(PLANS).map(([k, v]) => `<option value="${k}"${k === data.plan ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field"><span>Prazo</span><select class="select" id="grantTerm">${PLAN_TERMS.map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label class="field wide"><span>Observação (opcional)</span><input class="input" id="grantNote" maxlength="300" placeholder="Ex.: parceiro estratégico, teste interno"></label>
      <button class="btn primary wide" id="grantGo" type="button">Conceder plano</button>
    </div>
    ${history ? `<ul class="planHistory" aria-label="Licenças concedidas">${history}</ul>` : '<p class="muted small">Nenhuma licença concedida por aqui ainda.</p>'}`;
  const term = $('grantTerm');
  const syncTerm = () => { term.disabled = $('grantPlan').value === 'free'; };
  $('grantPlan').addEventListener('change', syncTerm);
  syncTerm();
  $('grantGo').addEventListener('click', async () => {
    const plan = $('grantPlan').value;
    const months = plan === 'free' || !term.value ? null : Number(term.value);
    $('grantGo').disabled = true;
    const { error: e } = await db.rpc('admin_grant_plan', {
      p_producer: row.id, p_plan: plan, p_months: months, p_note: $('grantNote').value.trim() || null,
    });
    if (e) {
      $('grantGo').disabled = false;
      toast('Não consegui conceder: ' + (e.message.includes('owner_only') ? 'só um admin_owner altera planos.' : e.message), 'bad');
      return;
    }
    row.tier = plan === 'free' ? 'basic' : 'premium';
    toast(plan === 'free' ? 'Plano retirado: o cadastro voltou para Free.' : `${PLANS[plan]} concedido.`);
    paintPlan(row);
    load();
  });
}

$('editorCancel').addEventListener('click', () => $('editor').close());
$('editorClose').addEventListener('click', () => $('editor').close());

/* ------------------------------------------------------------------ alerts */

// check-photo answers in English; the moderator reads Portuguese
const VERDICTS = { clean: 'Sem problema', flagged: 'Para conferir', refused: 'Recusada automaticamente' };
const REASON_PT = { 'vision unavailable': 'verificação automática indisponível no momento' };

const alertKind = r => (r.kind === 'duplicate' ? 'Endereço duplicado' : r.kind === 'photo' ? 'Foto sinalizada' : 'Alerta');

async function loadAlerts() {
  $('state').textContent = 'Carregando...';
  const { data, error } = await db.rpc('moderation_alerts_list', { p_open: true, p_limit: 100 });
  if (error) { $('state').textContent = 'Não consegui carregar os alertas: ' + error.message; return; }
  const rows = data ?? [];
  $('state').textContent = '';
  const box = $('alertList');
  box.innerHTML = rows.length ? '' : `<div class="panelBox"><div class="emptyNote"><strong>Tudo em dia.</strong>Nenhum alerta aberto. As verificações automáticas avisam aqui quando algo precisar de uma pessoa.</div></div>`;
  rows.forEach(r => box.appendChild(alertCard(r)));
}

function alertCard(row) {
  const el = document.createElement('article');
  el.className = 'alertCard';
  const d = row.detail ?? {};
  const facts = row.kind === 'duplicate'
    ? [
        ['Tentativa', text([d.attempted_name, d.attempted_address].filter(Boolean).join(' - ') || '-')],
        ['Já cadastrado', text(d.existing_name || row.producer_name || '-')],
        ['Distância', text(d.distance_m != null ? d.distance_m + ' m' : d.reason === 'same google place' ? 'mesmo local no Google' : 'mesmo endereço')],
        ['Quem tentou', text(d.actor_email || row.actor_email || '-')],
        ['No mapa', d.attempted_lat != null ? `<a href="https://www.google.com/maps?q=${d.attempted_lat},${d.attempted_lng}" target="_blank" rel="noopener">ver o ponto</a>` : '-'],
      ]
    : [
        ['Veredito', text(VERDICTS[d.verdict] || d.verdict || '-')],
        ['Motivo', text((d.offending || []).join(', ') || REASON_PT[d.reason] || d.reason || 'sem assunto reconhecido')],
        ['Produtor', text(row.producer_name || '-')],
        ['Quem enviou', text(d.actor_email || row.actor_email || '-')],
        ['Rótulos', text((d.labels || []).map(l => l.description).join(', ') || '-')],
      ];
  el.innerHTML = `
    <span class="alertIcon">${icon(row.kind === 'duplicate' ? 'twins' : 'photo')}</span>
    <div class="reviewBody" style="padding:0">
      <div class="reviewHead"><h3>${text(alertKind(row))}</h3><p class="meta"><span>${text(ago(row.created_at))}</span></p></div>
      <dl class="facts">${facts.map(([k, v]) => `<div><dt>${text(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>
      <div class="reviewActions"><button class="btn primary resolve" type="button">${icon('check')}Marcar como resolvido</button></div>
    </div>`;
  el.querySelector('.resolve').addEventListener('click', async () => {
    const { error } = await db.rpc('resolve_moderation_alert', { p_id: row.id });
    if (error) { toast('Não consegui resolver: ' + error.message, 'bad'); return; }
    el.classList.add('leaving');
    toast('Alerta resolvido.');
    setTimeout(() => { el.remove(); loadCounts(); if (!$('alertList').children.length) loadAlerts(); }, 340);
  });
  return el;
}

/* ------------------------------------------------------------------ events */

const EVENT_KINDS = { feira: 'Feira', degustacao: 'Degustação', colheita: 'Colheita', agenda: 'Agenda aberta' };
let eventWhen = 'upcoming';

document.querySelectorAll('#eventSeg button').forEach(b => b.addEventListener('click', () => {
  eventWhen = b.dataset.when;
  document.querySelectorAll('#eventSeg button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  loadEvents();
}));

const whenText = (a, b) => {
  const d1 = new Date(a);
  const d2 = new Date(b);
  const day = d => d.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' });
  const hm = d => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d1.toDateString() === d2.toDateString()
    ? `${day(d1)} · ${hm(d1)} - ${hm(d2)}`
    : `${day(d1)} ${hm(d1)} - ${day(d2)} ${hm(d2)}`;
};

async function loadEvents() {
  $('state').textContent = 'Carregando...';
  const { data, error } = await db.rpc('admin_events', { p_limit: 300 });
  if (error) { $('state').textContent = 'Não consegui carregar os eventos: ' + error.message; return; }
  const now = new Date().toISOString();
  const rows = (data ?? [])
    .filter(e => (eventWhen === 'upcoming' ? e.ends_at > now : e.ends_at <= now))
    .sort((a, b) => (eventWhen === 'upcoming' ? a.starts_at.localeCompare(b.starts_at) : b.starts_at.localeCompare(a.starts_at)));
  $('state').textContent = '';
  const box = $('eventList');
  box.innerHTML = rows.length ? '' : `<div class="panelBox"><div class="emptyNote"><strong>${eventWhen === 'upcoming' ? 'Nenhum evento marcado.' : 'Nenhum evento passado.'}</strong>Os eventos que os produtores criam no app aparecem aqui.</div></div>`;
  rows.forEach(r => box.appendChild(eventCard(r)));
}

function eventCard(row) {
  const el = document.createElement('article');
  el.className = 'alertCard';
  el.innerHTML = `
    <span class="alertIcon" style="background:var(--primary-soft);color:var(--primary)">${icon('calendar')}</span>
    <div class="reviewBody" style="padding:0">
      <div class="reviewHead">
        <div class="chips"><span class="pill cat plain">${text(EVENT_KINDS[row.kind] || row.kind)}</span><span class="pill plain">${text(EVENT_FORMATS[row.format] || 'No local')}</span>${row.sold_out ? '<span class="pill bad plain">Esgotado</span>' : ''}</div>
        <h3>${text(row.title)}</h3>
        <p class="meta"><span>${icon('clock')} ${text(whenText(row.starts_at, row.ends_at))}</span></p>
      </div>
      ${row.description ? `<p class="desc">${text(row.description)}</p>` : ''}
      <dl class="facts">
        <div><dt>Produtor</dt><dd>${text(row.producer_name || '-')}</dd></div>
        <div><dt>Dono</dt><dd>${text(row.owner_email || '-')}</dd></div>
        <div><dt>Plano</dt><dd>${text(PLANS[row.plan] || '-')}</dd></div>
        <div><dt>Criado</dt><dd>${text(ago(row.created_at))}</dd></div>
      </dl>
      <div class="reviewActions"><button class="btn danger remove" type="button">${icon('trash')}Remover evento</button></div>
    </div>`;
  el.querySelector('.remove').addEventListener('click', async () => {
    const r = await ask({
      title: `Remover "${row.title}"?`,
      body: 'O evento sai do mapa e da página do produtor. O produtor continua podendo criar outros.',
      ok: 'Remover', danger: true,
    });
    if (!r.ok) return;
    const { data, error } = await db.rpc('admin_delete_event', { p_id: row.id });
    if (error || data !== true) { toast('Não consegui remover: ' + (error?.message || 'sem permissão'), 'bad'); return; }
    el.classList.add('leaving');
    toast('Evento removido.');
    setTimeout(() => { el.remove(); if (!$('eventList').children.length) loadEvents(); }, 340);
  });
  return el;
}

/* ------------------------------------------------------------------ team */

async function loadTeam() {
  if (!isOwner()) return;
  $('state').textContent = 'Carregando...';
  const { data, error } = await db.rpc('admin_team');
  if (error) { $('state').textContent = 'Não consegui carregar a equipe: ' + error.message; return; }
  $('state').textContent = '';
  const box = $('teamList');
  box.innerHTML = '';
  (data ?? []).forEach(m => {
    const el = document.createElement('div');
    el.className = 'teamRow';
    el.innerHTML = `<span class="mail">${text(m.email)}</span>
      <select class="select" aria-label="Perfil de ${text(m.email)}" style="width:auto">
        <option value="owner"${m.role === 'owner' ? ' selected' : ''}>admin_owner</option>
        <option value="moderator"${m.role !== 'owner' ? ' selected' : ''}>admin_moderator</option>
      </select>
      <button class="btn danger sm" type="button">Remover</button>`;
    el.querySelector('select').addEventListener('change', async ev => {
      const { error: e } = await db.rpc('admin_set_team_member', { p_email: m.email, p_role: ev.target.value });
      if (e) toast(teamError(e), 'bad'); else toast('Perfil atualizado.');
      loadTeam();
    });
    el.querySelector('button').addEventListener('click', async () => {
      const r = await ask({ title: `Remover ${m.email}?`, body: 'A pessoa perde o acesso ao painel na hora.', ok: 'Remover', danger: true });
      if (!r.ok) return;
      const { error: e } = await db.rpc('admin_remove_team_member', { p_email: m.email });
      if (e) toast(teamError(e), 'bad'); else toast('Removido da equipe.');
      loadTeam();
    });
    box.appendChild(el);
  });
}

const teamError = e => (e.message.includes('last_owner') ? 'É o único admin_owner: nomeie outro antes.'
  : e.message.includes('bad_email') ? 'Confira o e-mail.'
    : e.message.includes('owner_only') ? 'Só um admin_owner gerencia a equipe.'
      : 'Não consegui salvar: ' + e.message);

$('teamForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const email = $('teamEmail').value.trim();
  if (!email) return;
  const { error } = await db.rpc('admin_set_team_member', { p_email: email, p_role: $('teamRole').value });
  if (error) { toast(teamError(error), 'bad'); return; }
  $('teamEmail').value = '';
  toast('Adicionado à equipe.');
  loadTeam();
});

/* ------------------------------------------------------------------ start */

$('authArt').style.backgroundImage = `url("${ART_PHOTO}")`;
$('demoNote').hidden = !DEMO;
$('demoBadge').hidden = !DEMO;
paintStep();
db.auth.onAuthStateChange(() => paintSession());
paintSession();
