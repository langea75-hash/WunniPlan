'use strict';

const API = 'https://v6.db.transport.rest/journeys';

const stations = {
  wunstorf: {
    label: 'Wunstorf',
    id: '8000268'
  },
  hannover: {
    label: 'Hannover Hbf',
    id: '8000152'
  }
};

let direction = 'toHannover';
let installPrompt = null;
const $ = id => document.getElementById(id);

function route() {
  return direction === 'toHannover'
    ? { from: stations.wunstorf, to: stations.hannover }
    : { from: stations.hannover, to: stations.wunstorf };
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function setNow() {
  const now = new Date();
  $('dateInput').value =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  $('timeInput').value =
    `${pad(now.getHours())}:${pad(Math.floor(now.getMinutes() / 5) * 5)}`;
}

function selectedDate() {
  const date = $('dateInput').value;
  const time = $('timeInput').value;
  if (!date || !time) throw new Error('Bitte Datum und Uhrzeit auswählen.');

  // Lokale Zeit mit Zeitzonenoffset senden.
  const local = new Date(`${date}T${time}:00`);
  if (Number.isNaN(local.getTime())) throw new Error('Datum oder Uhrzeit ist ungültig.');
  return local.toISOString();
}

function updateLabels() {
  const current = route();
  $('fromName').textContent = current.from.label;
  $('toName').textContent = current.to.label;
  $('routeTitle').textContent = `${current.from.label} → ${current.to.label}`;
}

function formatTime(value) {
  if (!value) return '–';
  return new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function formatDuration(start, end) {
  const minutes = Math.max(0, Math.round((new Date(end) - new Date(start)) / 60000));
  return `${minutes} Min.`;
}

function delayMinutes(seconds) {
  if (typeof seconds !== 'number') return 0;
  return Math.round(seconds / 60);
}

function isAllowedTrain(leg) {
  const product = leg?.line?.product;
  return ['suburban', 'regional', 'regionalExp'].includes(product);
}

function trainLegs(journey) {
  return (journey.legs || []).filter(leg => leg.line && isAllowedTrain(leg));
}

function hasUnwantedLeg(journey) {
  return (journey.legs || []).some(leg => {
    if (leg.walking || leg.transfer) return false;
    return leg.line && !isAllowedTrain(leg);
  });
}

function isDirectRailJourney(journey) {
  const legs = trainLegs(journey);
  return legs.length === 1 && !hasUnwantedLeg(journey);
}

function trainName(leg) {
  const raw = leg?.line?.name || leg?.line?.fahrtNr || '';
  if (raw) return String(raw).replace(/^S\s?/, 'S ');
  const product = leg?.line?.product;
  if (product === 'suburban') return 'S-Bahn';
  if (product === 'regionalExp') return 'RE';
  return 'RB';
}

function platform(actual, planned) {
  return actual || planned || '';
}

function stopTime(stop) {
  return stop.departure || stop.arrival ||
    stop.plannedDeparture || stop.plannedArrival || null;
}

function renderStop(stop) {
  const actual = stopTime(stop);
  const delay = delayMinutes(stop.departureDelay ?? stop.arrivalDelay);
  const track = platform(
    stop.departurePlatform || stop.arrivalPlatform,
    stop.plannedDeparturePlatform || stop.plannedArrivalPlatform
  );

  return `<li>
    <strong>${formatTime(actual)}</strong>
    <span>${escapeHtml(stop.stop?.name || 'Bahnhof')}
      ${delay > 0 ? `<small class="delay">+${delay}</small>` : ''}
    </span>
    <small>${track ? `Gl. ${escapeHtml(track)}` : ''}</small>
  </li>`;
}

function intermediateStops(leg) {
  const stops = [];

  stops.push({
    stop: leg.origin,
    departure: leg.departure,
    plannedDeparture: leg.plannedDeparture,
    departureDelay: leg.departureDelay,
    departurePlatform: leg.departurePlatform,
    plannedDeparturePlatform: leg.plannedDeparturePlatform
  });

  for (const stop of leg.stopovers || []) {
    const id = stop.stop?.id;
    if (id === leg.origin?.id || id === leg.destination?.id) continue;
    stops.push(stop);
  }

  stops.push({
    stop: leg.destination,
    arrival: leg.arrival,
    plannedArrival: leg.plannedArrival,
    arrivalDelay: leg.arrivalDelay,
    arrivalPlatform: leg.arrivalPlatform,
    plannedArrivalPlatform: leg.plannedArrivalPlatform
  });

  return stops;
}

function renderJourney(journey) {
  const leg = trainLegs(journey)[0];
  if (!leg) return '';

  const departure = leg.departure || leg.plannedDeparture;
  const arrival = leg.arrival || leg.plannedArrival;
  const depDelay = delayMinutes(leg.departureDelay);
  const arrDelay = delayMinutes(leg.arrivalDelay);
  const depPlatform = platform(leg.departurePlatform, leg.plannedDeparturePlatform);
  const arrPlatform = platform(leg.arrivalPlatform, leg.plannedArrivalPlatform);
  const cancelled = Boolean(leg.cancelled);

  return `<article class="journey ${cancelled ? 'cancelled' : ''}">
    <div class="journey-top">
      <div>
        <span class="label">Abfahrt</span>
        <span class="time">${formatTime(departure)}</span>
        ${depDelay > 0 ? `<span class="delay">+${depDelay}</span>` : ''}
      </div>
      <div class="duration">
        ${formatDuration(departure, arrival)}
        <small>direkt</small>
      </div>
      <div class="arrival">
        <span class="label">Ankunft</span>
        <span class="time">${formatTime(arrival)}</span>
        ${arrDelay > 0 ? `<span class="delay">+${arrDelay}</span>` : ''}
      </div>
    </div>

    <div class="train-row">
      <span class="train-badge">${escapeHtml(trainName(leg))}</span>
      <span>${escapeHtml(leg.direction || '')}</span>
    </div>

    <div class="platform">
      ${depPlatform ? `Abfahrt: Gleis ${escapeHtml(depPlatform)}` : ''}
      ${depPlatform && arrPlatform ? ' · ' : ''}
      ${arrPlatform ? `Ankunft: Gleis ${escapeHtml(arrPlatform)}` : ''}
    </div>

    ${cancelled
      ? '<div class="cancel-note">Diese Verbindung fällt aus.</div>'
      : ''}

    <details>
      <summary>Zwischenbahnhöfe anzeigen</summary>
      <ul class="stops">
        ${intermediateStops(leg).map(renderStop).join('')}
      </ul>
    </details>
  </article>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function buildDbUrl() {
  const current = route();
  const date = $('dateInput').value;
  const time = $('timeInput').value;
  const params = new URLSearchParams({
    STS: 'true',
    so: current.from.label,
    zo: current.to.label,
    hd: `${date}T${time}:00`
  });
  return `https://int.bahn.de/de/buchung/fahrplan/suche?${params}`;
}

async function fetchJourneys() {
  const current = route();

  const params = new URLSearchParams({
    from: current.from.id,
    to: current.to.id,
    departure: selectedDate(),
    results: '12',
    stopovers: 'true',
    transfers: '0',

    // Nur S-Bahn, RE und RB.
    nationalExpress: 'false',
    national: 'false',
    regionalExp: 'true',
    regional: 'true',
    suburban: 'true',
    bus: 'false',
    ferry: 'false',
    subway: 'false',
    tram: 'false',
    taxi: 'false'
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${API}?${params}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store'
    });

    if (!response.ok) {
      let detail = '';
      try {
        const error = await response.json();
        detail = error.message || error.error || '';
      } catch (_) {}
      throw new Error(detail || `Datenserver: Fehler ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function search() {
  $('errorBox').hidden = true;
  $('results').innerHTML = '';
  $('statusText').textContent = 'Live-Verbindungen werden geladen …';
  $('searchBtn').disabled = true;

  try {
    const data = await fetchJourneys();
    const journeys = (data.journeys || [])
      .filter(isDirectRailJourney)
      .slice(0, 8);

    if (!journeys.length) {
      throw new Error('Für diese Uhrzeit wurden keine direkten S-Bahn-, RE- oder RB-Verbindungen gefunden.');
    }

    $('results').innerHTML = journeys.map(renderJourney).join('');
    $('statusText').textContent =
      `Aktualisiert: ${new Intl.DateTimeFormat('de-DE', {
        hour: '2-digit',
        minute: '2-digit'
      }).format(new Date())}`;
  } catch (error) {
    console.error(error);
    $('statusText').textContent = 'Live-Aktualisierung fehlgeschlagen';
    $('errorText').textContent =
      error.name === 'AbortError'
        ? 'Die Datenquelle antwortet zu langsam.'
        : error.message || 'Unbekannter Fehler.';
    $('dbLink').href = buildDbUrl();
    $('errorBox').hidden = false;
  } finally {
    $('searchBtn').disabled = false;
  }
}

$('nowBtn').addEventListener('click', () => {
  setNow();
  search();
});

$('searchBtn').addEventListener('click', search);
$('refreshBtn').addEventListener('click', search);

$('swapBtn').addEventListener('click', () => {
  direction = direction === 'toHannover' ? 'toWunstorf' : 'toHannover';
  updateLabels();
  search();
});

window.addEventListener('beforeinstallprompt', event => {
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
  setNow();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js?v=2.0').catch(console.error);
  }

  search();
});
