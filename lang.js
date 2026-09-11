// One document, five languages. Without JavaScript every language shows, one
// after another; with it, the reader sees one - the phone's language when we
// have it, English otherwise - and the buttons switch. #pt, #en, #es, #fr and
// #it in the address open a language directly.
(function () {
  var langs = ['pt', 'en', 'es', 'fr', 'it'];
  var sections = {};
  langs.forEach(function (l) { sections[l] = document.getElementById(l); });
  var buttons = document.querySelectorAll('.langs button');

  function show(l) {
    if (langs.indexOf(l) < 0) l = 'en';
    langs.forEach(function (x) { if (sections[x]) sections[x].hidden = x !== l; });
    buttons.forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.lang === l ? 'true' : 'false'); });
    document.documentElement.lang = l === 'pt' ? 'pt-BR' : l;
  }

  buttons.forEach(function (b) {
    b.addEventListener('click', function () {
      show(b.dataset.lang);
      history.replaceState(null, '', '#' + b.dataset.lang);
    });
  });

  var fromHash = location.hash.replace('#', '');
  var fromPhone = (navigator.language || 'en').slice(0, 2).toLowerCase();
  show(langs.indexOf(fromHash) >= 0 ? fromHash : fromPhone);
})();
