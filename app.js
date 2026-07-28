'use strict';

const places = {
  wunstorf: {
    lat: 52.42335,
    lon: 9.43531,
    name: 'Wunstorf Bahnhof',
    type: 'PLACE'
  },
  hannover: {
    lat: 52.37722,
    lon: 9.74142,
    name: 'Hannover Hauptbahnhof',
    type: 'PLACE'
  }
};

let direction = 'toHannover';
let installPrompt = null;

const $ = (id) => document.getElementById(id);

function route() {
  return direction === 'toHannover'
    ? { from: places.wunstorf, to: places.hannover, fromLabel: 'Wunstorf', toLabel: 'Hannover Hbf' }
    : { from: places.hannover, to: places.wunstorf, fromLabel: 'Hannover Hbf', toLabel: 'Wunstorf' };
}

function updateLabels() {
  const current = route();
  $('fromName').textContent = current.fromLabel;
  $('toName').textContent = current.toLabel;
  $('routeTitle').textContent = `${current.fromLabel} → ${current.toLabel}`;
}

function renderWidget() {
  const box = $('searchbox');
  box.innerHTML = '';
  $('errorBox').hidden = true;
  $('loadingText').hidden = false;

  const current = route();
  try {
    if (typeof window.createTransitousWidget !== 'function') {
      throw new Error('Transitous-Widget nicht verfügbar');
    }
    window.createTransitousWidget('searchbox', current.from, current.to);
    $('loadingText').hidden = true;
  } catch (error) {
    console.error(error);
    $('loadingText').hidden = true;
    $('errorBox').hidden = false;
  }
}

$('swapBtn').addEventListener('click', () => {
  direction = direction === 'toHannover' ? 'toWunstorf' : 'toHannover';
  updateLabels();
  renderWidget();
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  $('installBtn').hidden = false;
});

$('installBtn').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('installBtn').hidden = true;
});

window.addEventListener('load', () => {
  updateLabels();
  // Externe Skripte bekommen kurz Zeit. Das Internet ist keine Magie, nur ähnlich unberechenbar.
  setTimeout(renderWidget, 250);
});
