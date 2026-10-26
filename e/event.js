// What the QR Code of an event opens: https://qoleto.com/e/?t=<token> (and
// https://qoleto.com/e/<token>, which the site's 404 page forwards here).
// It names the event and its producer and sends the person to the app, where
// the review is open during the event without the farm's GPS rule (0059).
// event_by_token answers only for published producers; the key is the
// publishable one, as on the producer pages.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const db = createClient('https://dshqzppwbzdeumwlkpfi.supabase.co', 'sb_publishable_FcuGYckk4FyG9kR9e5iBCQ_NGY_O0Fg');
const $ = id => document.getElementById(id);

const T = {
  pt: { kicker: 'Evento no Qoleto', lead: 'Avalie a sua visita: abra o app e a avaliação já está pronta para você.', app: 'Abrir no app e avaliar', over: 'Este evento já terminou. A página do produtor continua no app.', gone: 'Este código não é de um evento disponível.', soon: 'Qoleto: o mapa dos pequenos produtores artesanais e familiares. Em breve na App Store e no Google Play.', home: 'Ver o Qoleto' },
  en: { kicker: 'Event on Qoleto', lead: 'Review your visit: open the app and the review is ready for you.', app: 'Open the app and review', over: 'This event has ended. The producer page is still in the app.', gone: 'This code does not belong to an available event.', soon: 'Qoleto: the map of small artisanal and family producers. Coming soon to the App Store and Google Play.', home: 'See Qoleto' },
  es: { kicker: 'Evento en Qoleto', lead: 'Valora tu visita: abre la app y la valoración ya está lista.', app: 'Abrir la app y valorar', over: 'Este evento ya terminó. La página del productor sigue en la app.', gone: 'Este código no es de un evento disponible.', soon: 'Qoleto: el mapa de los pequeños productores artesanales y familiares. Pronto en App Store y Google Play.', home: 'Ver Qoleto' },
  fr: { kicker: 'Événement sur Qoleto', lead: "Donnez votre avis : ouvrez l'application, l'avis est déjà prêt.", app: "Ouvrir l'application et donner mon avis", over: "Cet événement est terminé. La page du producteur reste dans l'application.", gone: "Ce code n'appartient à aucun événement disponible.", soon: "Qoleto : la carte des petits producteurs artisanaux et familiaux. Bientôt sur l’App Store et Google Play.", home: 'Voir Qoleto' },
  it: { kicker: 'Evento su Qoleto', lead: "Recensisci la tua visita: apri l'app e la recensione è già pronta.", app: "Apri l'app e recensisci", over: "Questo evento è finito. La pagina del produttore resta nell'app.", gone: 'Questo codice non appartiene a un evento disponibile.', soon: 'Qoleto: la mappa dei piccoli produttori artigianali e familiari. Presto su App Store e Google Play.', home: 'Vedi Qoleto' },
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
  $('title').textContent = e.title;
  const day = d => new Date(d).toLocaleString(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  $('meta').textContent = `${e.producer_name} · ${day(e.starts_at)} - ${day(e.ends_at)}`;
  $('lead').textContent = e.active ? t.lead : t.over;
  const app = `qoleto://e/${token}`;
  $('actions').innerHTML = `<a class="pbtn primary" href="${app}">${t.app}</a>`;
  $('note').textContent = t.soon;
  // straight to the app when it is installed; the page stays as the fallback
  if (e.active) setTimeout(() => { location.href = app; }, 300);
}
main();
