// Painel de moderação - Etapa 3.
//
// Everything here is a thin shell over database functions that check
// public.admins on the server (0014, 0018, 0026):
//   admin_producers(search, status, category, flag, limit, offset)
//                                     every listing, with filters and pages
//   admin_update_producer(id, patch)  edit any field of any listing
//   admin_bulk(ids, action, reason)   approve, reject, pause, reactivate many
//   moderate_producer(id, action, r)  approve, or reject with a reason
//   moderation_alerts_list(open)      what the automations flagged
//   resolve_moderation_alert(id)      mark one alert as dealt with
//
// Item 6 of the proposal: approve, reject, EDIT and MANAGE listings IN VOLUME.
// The page can be public: a visitor who is not a moderator signs in and gets
// nothing back. The key below is the publishable one, the same the app ships.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://dshqzppwbzdeumwlkpfi.supabase.co';
const SUPABASE_KEY = 'sb_publishable_FcuGYckk4FyG9kR9e5iBCQ_NGY_O0Fg';
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = id => document.getElementById(id);
const login = $('login');
const board = $('board');
const list = $('list');
const state = $('state');

const PAGE = 50;
const WEEKDAYS = [[1, 'Segunda'], [2, 'Terça'], [3, 'Quarta'], [4, 'Quinta'], [5, 'Sexta'], [6, 'Sábado'], [0, 'Domingo']];
const STATUS_LABEL = { pending: 'Na fila', approved: 'Aprovado', rejected: 'Recusado', draft: 'Rascunho' };

let status = 'pending';          // pending | all | alerts
let page = 0;
let rowsOnScreen = [];
const selected = new Set();
const categoryNames = new Map(); // slug -> name
let categoryTree = [];           // [{ slug, name, children: [{ slug, name }] }]

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
  if (!password) return sendCode(email);
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) return say('Não consegui entrar: ' + error.message);
  paintSession();
});

$('magic').addEventListener('click', () => {
  const email = $('email').value.trim();
  if (!email) return say('Informe o e-mail.');
  sendCode(email);
});

// The project's sign-in e-mail carries a 6-digit code, not a link (the app
// signs in with that code), so the panel asks for the code the same way. Only
// existing accounts can ask for one here: the panel never creates users.
async function sendCode(email) {
  const { error } = await db.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  if (error) return say('Não consegui enviar o código: ' + error.message);
  $('codeStep').hidden = false;
  $('code').value = '';
  $('code').focus();
  say('Código enviado para ' + email + '. Digite os números do e-mail.');
}

async function confirmCode() {
  const email = $('email').value.trim();
  const token = $('code').value.replace(/\D/g, '');
  if (!email || token.length < 6) return say('Digite o código de 6 números.');
  say('Confirmando...');
  const { error } = await db.auth.verifyOtp({ email, token, type: 'email' });
  if (error) return say('Código inválido ou expirado. Peça um novo.');
  $('codeStep').hidden = true;
  say('');
  paintSession();
}

$('confirm').addEventListener('click', confirmCode);
$('code').addEventListener('keydown', e => { if (e.key === 'Enter') confirmCode(); });

$('signout').addEventListener('click', async () => {
  await db.auth.signOut();
  paintSession();
});

const say = msg => { $('loginMsg').textContent = msg; };

/* ------------------------------------------------------------------ tabs */

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('on'));
    tab.classList.add('on');
    status = tab.dataset.status;
    page = 0;
    load();
  });
});
$('reload').addEventListener('click', () => load());

async function categories() {
  if (categoryNames.size) return;
  const { data } = await db.from('categories').select('slug, name_pt, parent_slug');
  const rows = data ?? [];
  for (const r of rows) categoryNames.set(r.slug, r.name_pt);
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

async function load() {
  state.textContent = 'Carregando...';
  list.innerHTML = '';
  $('tools').hidden = status !== 'all';
  $('pager').hidden = true;
  paintBulk();
  if (status === 'alerts') return loadAlerts();
  await categories();
  if (status === 'all') return loadAll();

  const { data, error } = await db.rpc('admin_producers', { p_status: 'pending', p_limit: 100 });
  if (error) { state.textContent = 'Erro ao carregar: ' + error.message; return; }
  const rows = data ?? [];
  state.textContent = rows.length ? `${rows.length} cadastro(s) esperando revisão.` : 'Nenhum cadastro esperando revisão.';
  for (const row of rows) list.appendChild(card(row));
}

/* ------------------------------------------------------------------ queue card */

function signals(row) {
  const out = [];
  if (row.duplicate_of || row.duplicate_detail) {
    const d = row.duplicate_detail ?? {};
    const where = d.same_place ? 'mesmo local no Google'
      : d.distance_m != null ? `a ${d.distance_m} m` : 'mesmo endereço';
    out.push(`<span class="flag warn">Possível duplicado de ${text(d.name || 'outro cadastro')} (${text(where)})</span>`);
  }
  const flagged = Object.values(row.photo_check ?? {}).filter(v => v && v.verdict === 'flagged').length;
  if (flagged) out.push(`<span class="flag warn">${flagged} foto(s) para conferir</span>`);
  if (row.prevalidated) out.push('<span class="flag ok">Encontrado no Google</span>');
  if (row.admin_paused) out.push('<span class="flag">Pausado pela moderação</span>');
  else if (row.owner_paused) out.push('<span class="flag">Pausado pelo produtor</span>');
  return out.join('');
}

function card(row) {
  const el = document.createElement('article');
  el.className = 'card listing';

  const photos = (row.photos ?? []).slice(0, 6);
  const cover = row.cover_url || photos[0];
  const when = row.submitted_at ? new Date(row.submitted_at).toLocaleString('pt-BR') : '';
  const cats = row.categories ?? [row.category_slug];

  el.innerHTML = `
    <div class="listingTop">
      ${cover ? `<img class="cover" src="${attr(cover)}" alt="">` : '<div class="cover empty"></div>'}
      <div class="listingInfo">
        <h3>${text(row.name)}</h3>
        ${row.tagline ? `<p class="tagline">${text(row.tagline)}</p>` : ''}
        <p class="muted small">${text(row.owner_email || '')}${when ? ' &middot; ' + text(when) : ''}</p>
        <div class="chips">
          ${cats.map(c => `<span class="chip${c === row.category_slug ? ' main' : ''}">${text(categoryNames.get(c) || c)}</span>`).join('')}
        </div>
        <div class="flags">${signals(row)}</div>
      </div>
    </div>

    ${row.description ? `<p class="desc">${text(row.description)}</p>` : ''}

    <dl class="facts">
      <div><dt>Onde</dt><dd>${text([row.address, row.address_complement, row.neighbourhood, row.city].filter(Boolean).join(', ') || '-')}</dd></div>
      <div><dt>Localização</dt><dd>${row.location_precision === 'approximate' ? 'Aproximada (pino deslocado)' : 'Exata'}
        &middot; <a href="https://www.google.com/maps?q=${row.lat},${row.lng}" target="_blank" rel="noopener">ver no mapa</a></dd></div>
      <div><dt>WhatsApp</dt><dd>${text(row.phone_whatsapp || '-')}</dd></div>
      <div><dt>Plano</dt><dd>${row.tier === 'premium' ? 'Premium' : 'Basic'}</dd></div>
    </dl>

    ${photos.length > 1 ? `<div class="thumbs">${photos.map(p => `<img src="${attr(p)}" alt="">`).join('')}</div>` : ''}

    <div class="verdict">
      <button class="primary approve">Aprovar</button>
      <button class="danger reject">Recusar</button>
      <button class="ghost edit">Editar</button>
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
  el.querySelector('.edit').addEventListener('click', () => openEditor(row));

  return el;
}

/* ------------------------------------------------------------------ all listings */

['q', 'fStatus', 'fCategory', 'fFlag'].forEach(id => {
  const el = $(id);
  el.addEventListener(id === 'q' ? 'keydown' : 'change', e => {
    if (id === 'q' && e.key !== 'Enter') return;
    page = 0;
    load();
  });
});
$('search').addEventListener('click', () => { page = 0; load(); });
$('prev').addEventListener('click', () => { if (page > 0) { page--; load(); } });
$('next').addEventListener('click', () => { page++; load(); });

async function loadAll() {
  const { data, error } = await db.rpc('admin_producers', {
    p_search: $('q').value.trim() || null,
    p_status: $('fStatus').value || 'all',
    p_category: $('fCategory').value || null,
    p_flag: $('fFlag').value || null,
    p_limit: PAGE,
    p_offset: page * PAGE,
  });
  if (error) { state.textContent = 'Erro ao carregar: ' + error.message; return; }
  rowsOnScreen = data ?? [];
  selected.clear();
  paintBulk();

  const total = Number(rowsOnScreen[0]?.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  state.textContent = total
    ? `${total} cadastro(s)${pages > 1 ? ` - página ${page + 1} de ${pages}` : ''}.`
    : 'Nenhum cadastro com esses filtros.';
  $('pager').hidden = pages < 2;
  $('prev').disabled = page === 0;
  $('next').disabled = page + 1 >= pages;
  if (!total) return;

  const table = document.createElement('table');
  table.className = 'grid';
  table.innerHTML = `
    <thead><tr>
      <th><input type="checkbox" id="all" aria-label="Selecionar todos"></th>
      <th>Cadastro</th><th>Categoria</th><th>Cidade</th><th>Situação</th><th>Plano</th><th>Sinais</th><th></th>
    </tr></thead>
    <tbody>${rowsOnScreen.map(r => `
      <tr data-id="${text(r.id)}">
        <td><input type="checkbox" class="pick" aria-label="Selecionar ${text(r.name)}"></td>
        <td><strong>${text(r.name)}</strong><br><span class="muted small">${text(r.owner_email || '')}</span></td>
        <td>${text(categoryNames.get(r.category_slug) || r.category_slug)}</td>
        <td>${text(r.city || '-')}</td>
        <td><span class="status ${text(r.moderation_status)}">${text(STATUS_LABEL[r.moderation_status] || r.moderation_status)}</span></td>
        <td>${r.tier === 'premium' ? 'Premium' : 'Basic'}</td>
        <td class="flags">${signals(r)}</td>
        <td><button class="ghost small edit">Editar</button></td>
      </tr>`).join('')}
    </tbody>`;
  const wrap = document.createElement('div');
  wrap.className = 'gridWrap';
  wrap.appendChild(table);
  list.appendChild(wrap);

  table.querySelector('#all').addEventListener('change', e => {
    table.querySelectorAll('.pick').forEach(box => { box.checked = e.target.checked; });
    rowsOnScreen.forEach(r => (e.target.checked ? selected.add(r.id) : selected.delete(r.id)));
    paintBulk();
  });
  table.querySelectorAll('tbody tr').forEach(tr => {
    const row = rowsOnScreen.find(r => r.id === tr.dataset.id);
    tr.querySelector('.pick').addEventListener('change', e => {
      if (e.target.checked) selected.add(row.id); else selected.delete(row.id);
      paintBulk();
    });
    tr.querySelector('.edit').addEventListener('click', () => openEditor(row));
  });
}

/* ------------------------------------------------------------------ in volume */

function paintBulk() {
  $('bulk').hidden = status !== 'all' || selected.size === 0;
  $('bulkCount').textContent = `${selected.size} selecionado(s)`;
}

const BULK = {
  approve: { ask: n => `Aprovar ${n} cadastro(s)? Eles entram no mapa e cada produtor recebe o aviso.` },
  reject:  { ask: null },
  pause:   { ask: n => `Pausar ${n} cadastro(s)? Eles saem do mapa até a moderação reativar.` },
  unpause: { ask: n => `Reativar ${n} cadastro(s)?` },
};

document.querySelectorAll('[data-bulk]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const action = btn.dataset.bulk;
    const ids = [...selected];
    if (!ids.length) return;
    let reason = null;
    if (action === 'reject') {
      reason = window.prompt(`Motivo da recusa de ${ids.length} cadastro(s). Esse texto aparece para cada produtor.`);
      if (!reason || !reason.trim()) return;
    } else if (!window.confirm(BULK[action].ask(ids.length))) {
      return;
    }
    $('bulkMsg').textContent = 'Enviando...';
    const { data, error } = await db.rpc('admin_bulk', { p_ids: ids, p_action: action, p_reason: reason });
    $('bulkMsg').textContent = error ? 'Falhou: ' + error.message : `${data} cadastro(s) atualizado(s).`;
    if (!error) setTimeout(() => { $('bulkMsg').textContent = ''; load(); }, 900);
  });
});

/* ------------------------------------------------------------------ editor */

function openEditor(row) {
  const dlg = $('editor');
  const hours = new Map((row.hours ?? []).map(h => [h.weekday, h]));
  const extra = new Set((row.categories ?? []).filter(c => c !== row.category_slug));
  const photos = row.photos ?? [];

  const field = (key, label, value, type = 'text') => `
    <label>${text(label)}
      <input name="${key}" type="${type}" value="${text(value ?? '')}"${type === 'number' ? ' step="any"' : ''}>
    </label>`;

  $('editorBody').innerHTML = `
    <h2>${text(row.name)}</h2>
    <p class="muted small">${text(row.owner_email || '')} &middot; ${text(STATUS_LABEL[row.moderation_status] || row.moderation_status)}</p>

    <fieldset><legend>Sobre</legend>
      ${field('name', 'Nome', row.name)}
      ${field('owners', 'Quem está por trás', row.owners)}
      ${field('tagline', 'Uma linha', row.tagline)}
      <label>Descrição<textarea name="description" rows="5">${text(row.description ?? '')}</textarea></label>
    </fieldset>

    <fieldset><legend>Categorias</legend>
      <label>Categoria principal
        <select name="primary_category">${categoryOptions(row.category_slug)}</select>
      </label>
      <details><summary>Outras categorias (${extra.size})</summary>
        <div class="checks">${categoryTree.map(s => s.children.map(c => `
          <label class="check"><input type="checkbox" name="extra" value="${text(c.slug)}"${extra.has(c.slug) ? ' checked' : ''}> ${text(c.name)}</label>`).join('')).join('')}
        </div>
      </details>
    </fieldset>

    <fieldset><legend>Onde</legend>
      ${field('address', 'Endereço', row.address)}
      ${field('address_complement', 'Complemento', row.address_complement)}
      ${field('neighbourhood', 'Bairro', row.neighbourhood)}
      ${field('city', 'Cidade', row.city)}
      <div class="two">
        ${field('lat', 'Latitude', row.lat, 'number')}
        ${field('lng', 'Longitude', row.lng, 'number')}
      </div>
      <p class="small"><a href="https://www.google.com/maps?q=${row.lat},${row.lng}" target="_blank" rel="noopener">ver o ponto atual no mapa</a></p>
      <label>Localização no mapa
        <select name="location_precision">
          <option value="exact"${row.location_precision !== 'approximate' ? ' selected' : ''}>Ponto exato</option>
          <option value="approximate"${row.location_precision === 'approximate' ? ' selected' : ''}>Só a região (pino deslocado)</option>
        </select>
      </label>
    </fieldset>

    <fieldset><legend>Contato e plano</legend>
      ${field('phone_whatsapp', 'WhatsApp', row.phone_whatsapp)}
      <label>Plano
        <select name="tier">
          <option value="basic"${row.tier !== 'premium' ? ' selected' : ''}>Basic</option>
          <option value="premium"${row.tier === 'premium' ? ' selected' : ''}>Premium</option>
        </select>
      </label>
    </fieldset>

    <fieldset><legend>Horários</legend>
      ${WEEKDAYS.map(([d, name]) => {
        const h = hours.get(d);
        return `
        <div class="hourRow" data-day="${d}">
          <label class="check"><input type="checkbox" class="open"${h ? ' checked' : ''}> ${name}</label>
          <input type="time" class="opens" value="${text(h?.opens ?? '09:00')}">
          <span class="muted">às</span>
          <input type="time" class="closes" value="${text(h?.closes ?? '18:00')}">
        </div>`;
      }).join('')}
    </fieldset>

    ${photos.length ? `
    <fieldset><legend>Fotos</legend>
      <p class="muted small">Desmarque para remover. A capa é a foto que abre o cadastro.</p>
      <div class="photoGrid">${photos.map((p, i) => `
        <div class="photo">
          <img src="${attr(p)}" alt="">
          <label class="check"><input type="checkbox" class="keep" data-i="${i}" checked> manter</label>
          <label class="check"><input type="radio" name="cover" value="${i}"${(row.cover_url || photos[0]) === p ? ' checked' : ''}> capa</label>
        </div>`).join('')}
      </div>
    </fieldset>` : ''}

    ${row.duplicate_of || row.duplicate_detail ? `
    <fieldset><legend>Duplicidade</legend>
      <div class="flags">${signals({ duplicate_of: row.duplicate_of, duplicate_detail: row.duplicate_detail })}</div>
      <label class="check"><input type="checkbox" name="clear_duplicate"> Conferido: não é duplicado (remove o sinal)</label>
    </fieldset>` : ''}
  `;
  $('editorMsg').textContent = '';
  dlg.returnValue = '';
  dlg.showModal();

  $('editorSave').onclick = async () => {
    const f = $('editorBody');
    const val = name => f.querySelector(`[name="${name}"]`)?.value ?? '';
    const patch = {};
    const keep = (key, before) => { const now = val(key).trim(); if (now !== String(before ?? '')) patch[key] = now; };
    ['name', 'owners', 'tagline', 'description', 'address', 'address_complement', 'neighbourhood', 'city', 'phone_whatsapp']
      .forEach(k => keep(k, row[k]));
    if (val('location_precision') !== (row.location_precision || 'exact')) patch.location_precision = val('location_precision');
    if (val('tier') !== (row.tier || 'basic')) patch.tier = val('tier');

    const lat = Number(val('lat')), lng = Number(val('lng'));
    if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== row.lat || lng !== row.lng)) {
      patch.lat = lat; patch.lng = lng;
    }

    const primary = val('primary_category');
    const extras = [...f.querySelectorAll('[name="extra"]:checked')].map(b => b.value).filter(s => s !== primary);
    const before = [...extra].sort().join(',');
    if (primary !== row.category_slug || extras.slice().sort().join(',') !== before) {
      patch.primary_category = primary;
      patch.categories = [primary, ...extras];
    }

    const newHours = [...f.querySelectorAll('.hourRow')]
      .filter(r => r.querySelector('.open').checked)
      .map(r => ({ weekday: Number(r.dataset.day), opens: r.querySelector('.opens').value, closes: r.querySelector('.closes').value }));
    const hoursKey = hs => hs.map(h => `${h.weekday}-${h.opens}-${h.closes}`).sort().join('|');
    if (hoursKey(newHours) !== hoursKey(row.hours ?? [])) patch.hours = newHours;

    if (photos.length) {
      const kept = [...f.querySelectorAll('.keep')].filter(b => b.checked).map(b => photos[Number(b.dataset.i)]);
      const coverIdx = f.querySelector('[name="cover"]:checked')?.value;
      let cover = coverIdx != null ? photos[Number(coverIdx)] : row.cover_url;
      if (!kept.includes(cover)) cover = kept[0] ?? null;
      if (kept.length !== photos.length) patch.photos = kept;
      if ((cover ?? null) !== (row.cover_url || photos[0] || null)) patch.cover_url = cover ?? '';
    }

    if (f.querySelector('[name="clear_duplicate"]')?.checked) patch.clear_duplicate = true;

    if (!Object.keys(patch).length) { $('editorMsg').textContent = 'Nada mudou.'; return; }
    $('editorMsg').textContent = 'Salvando...';
    const { error } = await db.rpc('admin_update_producer', { p_id: row.id, patch });
    if (error) { $('editorMsg').textContent = 'Falhou: ' + error.message; return; }
    $('editorMsg').textContent = 'Salvo.';
    setTimeout(() => { dlg.close(); load(); }, 600);
  };
}

$('editorCancel').addEventListener('click', () => $('editor').close());

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
