// What the QR Code of an event opens: https://qoleto.com/e/?t=<token> (and
// https://qoleto.com/e/<token>, which the site's 404 page forwards here).
// Before the event it is the invitation (Capa-Convite, 27/10: the cover, the
// type, the date and the place, 0063); during it, it sends the person to the
// app, where the review is open without the farm's GPS rule (0059); after it,
// it says the event is over.
// event_by_token answers only for published producers; the key is the
// publishable one, as on the producer pages.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const db = createClient('https://dshqzppwbzdeumwlkpfi.supabase.co', 'sb_publishable_FcuGYckk4FyG9kR9e5iBCQ_NGY_O0Fg');
const $ = id => document.getElementById(id);

const T = {
  pt: { kicker: 'Evento no Qoleto', invite: 'Você está convidado. Abra no app do Qoleto para ver o produtor, marcar o evento e receber o lembrete.', open: 'Abrir no app', lead: 'Avalie a sua visita: abra o app e a avaliação já está pronta para você.', app: 'Abrir no app e avaliar', over: 'Este evento já terminou. A página do produtor continua no app.', gone: 'Este código não é de um evento disponível.', soon: 'Qoleto: o mapa dos pequenos produtores artesanais e familiares. Em breve na App Store e no Google Play.', home: 'Ver o Qoleto', place: 'Local', kinds: { feira: 'Feira', portas_abertas: 'Portas abertas / Venda direta', degustacao: 'Degustação', colheita: 'Colheita', oficina: 'Curso / Oficina', envio_encomenda: 'Envio / Encomenda' } },
  en: { kicker: 'Event on Qoleto', invite: "You're invited. Open it in the Qoleto app to see the producer, save the event and get the reminder.", open: 'Open in the app', lead: 'Review your visit: open the app and the review is ready for you.', app: 'Open the app and review', over: 'This event has ended. The producer page is still in the app.', gone: 'This code does not belong to an available event.', soon: 'Qoleto: the map of small artisanal and family producers. Coming soon to the App Store and Google Play.', home: 'See Qoleto', place: 'Location', kinds: { feira: 'Fair', portas_abertas: 'Open doors / Direct sale', degustacao: 'Tasting', colheita: 'Harvest', oficina: 'Course / Workshop', envio_encomenda: 'Shipping / Orders' } },
  es: { kicker: 'Evento en Qoleto', invite: 'Estás invitado. Ábrelo en la app de Qoleto para ver al productor, guardar el evento y recibir el recordatorio.', open: 'Abrir en la app', lead: 'Valora tu visita: abre la app y la valoración ya está lista.', app: 'Abrir la app y valorar', over: 'Este evento ya terminó. La página del productor sigue en la app.', gone: 'Este código no es de un evento disponible.', soon: 'Qoleto: el mapa de los pequeños productores artesanales y familiares. Pronto en App Store y Google Play.', home: 'Ver Qoleto', place: 'Lugar', kinds: { feira: 'Feria', portas_abertas: 'Puertas abiertas / Venta directa', degustacao: 'Degustación', colheita: 'Cosecha', oficina: 'Curso / Taller', envio_encomenda: 'Envío / Encargo' } },
  fr: { kicker: 'Événement sur Qoleto', invite: "Vous êtes invité. Ouvrez-le dans l'application Qoleto pour voir le producteur, enregistrer l'événement et recevoir le rappel.", open: "Ouvrir dans l'application", lead: "Donnez votre avis : ouvrez l'application, l'avis est déjà prêt.", app: "Ouvrir l'application et donner mon avis", over: "Cet événement est terminé. La page du producteur reste dans l'application.", gone: "Ce code n'appartient à aucun événement disponible.", soon: "Qoleto : la carte des petits producteurs artisanaux et familiaux. Bientôt sur l’App Store et Google Play.", home: 'Voir Qoleto', place: 'Lieu', kinds: { feira: 'Marché', portas_abertas: 'Portes ouvertes / Vente directe', degustacao: 'Dégustation', colheita: 'Récolte', oficina: 'Cours / Atelier', envio_encomenda: 'Envoi / Commande' } },
  it: { kicker: 'Evento su Qoleto', invite: "Sei invitato. Aprilo nell'app Qoleto per vedere il produttore, salvare l'evento e ricevere il promemoria.", open: "Apri nell'app", lead: "Recensisci la tua visita: apri l'app e la recensione è già pronta.", app: "Apri l'app e recensisci", over: "Questo evento è finito. La pagina del produttore resta nell'app.", gone: 'Questo codice non appartiene a un evento disponibile.', soon: 'Qoleto: la mappa dei piccoli produttori artigianali e familiari. Presto su App Store e Google Play.', home: 'Vedi Qoleto', place: 'Luogo', kinds: { feira: 'Fiera', portas_abertas: 'Porte aperte / Vendita diretta', degustacao: 'Degustazione', colheita: 'Raccolta', oficina: 'Corso / Laboratorio', envio_encomenda: 'Spedizione / Ordini' } },
};
const lang = (navigator.language || 'pt').slice(0, 2).toLowerCase();
const t = T[lang] || T.pt;
const locale = lang === 'pt' ? 'pt-BR' : lang;

const token = (new URLSearchParams(location.search).get('t') || '').toLowerCase().replace(/[^0-9a-f]/g, '');

async function main() {
  $('kicker').textContent = t.kicker;
  if (!token) { $('title').textContent = t.gone; return; }
  const { data: e } = await db.rpc('event_by_token', { p_token: token });
  if (!e) {
    $('title').textContent = t.gone;
    $('actions').innerHTML = `<a class="pbtn" href="/">${t.home}</a>`;
    return;
  }
  document.title = `${e.title} - ${e.producer_name} | Qoleto`;
  if (e.banner_url && /^https:\/\//.test(e.banner_url)) {
    $('cover').style.backgroundImage = `url("${encodeURI(e.banner_url)}")`;
    $('cover').hidden = false;
  }
  if (e.kind && t.kinds[e.kind]) {
    const chip = document.createElement('span');
    chip.className = 'pchip on';
    chip.textContent = t.kinds[e.kind];
    $('chips').appendChild(chip);
  }
  $('title').textContent = e.title;
  const day = d => new Date(d).toLocaleString(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  $('meta').textContent = `${e.producer_name} · ${day(e.starts_at)} - ${day(e.ends_at)}`;
  const where = e.place_address || e.city;
  if (where) $('place').textContent = `${t.place}: ${where}`;
  const before = !e.active && new Date(e.ends_at) > new Date();
  $('lead').textContent = e.active ? t.lead : before ? t.invite : t.over;
  const app = `qoleto://e/${token}`;
  $('actions').innerHTML = `<a class="pbtn primary" href="${app}">${e.active ? t.app : t.open}</a>`;
  $('note').textContent = t.soon;
  // straight to the app when it is installed; the page stays as the fallback
  if (e.active) setTimeout(() => { location.href = app; }, 300);
}
main();
