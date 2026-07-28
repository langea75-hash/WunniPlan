'use strict';

const API = 'https://v6.db.transport.rest';
const stations = {
  // Feste DB-Stationsnummern: weniger API-Aufrufe und dadurch zuverlässiger.
  wunstorf: { display: 'Wunstorf', id: '8000268' },
  hannover: { display: 'Hannover Hbf', id: '8000152' }
};

let direction = 'toHannover';
let installPrompt = null;
let refreshTimer = null;

const $ = (id) => document.getElementById(id);
const results = $('results');
const statusText = $('statusText');

function localDateParts(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(Math.floor(date.getMinutes() / 5) * 5)}`
  };
}

function setNowInputs() {
  const now = localDateParts();
  $('dateInput').value = now.date;
  $('timeInput').value = now.time;
}

function currentRoute() {
  return direction === 'toHannover'
    ? { from: stations.wunstorf, to: stations.hannover }
    : { from: stations.hannover, to: stations.wunstorf };
}

function updateRouteLabels() {
  const route = currentRoute();
  $('fromName').textContent = route.from.display;
  $('toName').textContent = route.to.display;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function selectedDepartureIso() {
  const date = $('dateInput').value;
  const time = $('timeInput').value;
  if (!date || !time) return new Date().toISOString();
  return new Date(`${date}T${time}:00`).toISOString();
}

function formatTime(value) {
  if (!value) return '–';
  return new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function minutesBetween(start, end) {
  if (!start || !end) return null;
  return Math.max(0, Math.round((new Date(end) - new Date(start)) / 60000));
}

function delayMinutes(seconds) {
  if (seconds == null) return 0;
  return Math.max(0, Math.round(seconds / 60));
}

function trainLegs(journey) {
  return (journey.legs || []).filter((leg) => !leg.walking && leg.line);
}

function meaningfulRemarks(journey) {
  const texts = [];
  for (const leg of journey.legs || []) {
    for (const remark of leg.remarks || []) {
      const text = remark.text || remark.summary;
      if (text && !texts.includes(text)) texts.push(text);
    }
  }
  return texts.slice(0, 2);
}

function stopName(stopover) {
  return stopover?.stop?.name || stopover?.station?.name || 'Bahnhof';
}

function renderStopovers(container, legs) {
  const railLegs = legs.filter((leg) => !leg.walking && leg.line);
  let visibleStops = 0;

  railLegs.forEach((leg, legIndex) => {
    const stopovers = leg.stopovers || [];
    if (!stopovers.length) return;

    if (railLegs.length > 1) {
      const heading = document.createElement('div');
      heading.className = 'leg-heading';
      heading.textContent = `${leg.line?.name || 'Bahn'}: ${leg.origin?.name || ''} → ${leg.destination?.name || ''}`;
      container.appendChild(heading);
    }

    stopovers.forEach((stopover, index) => {
      const isFirst = index === 0;
      const isLast = index === stopovers.length - 1;
      if (legIndex > 0 && isFirst) return;

      const row = document.createElement('div');
      row.className = `stop-row${isFirst || isLast ? ' endpoint' : ''}`;

      const time = stopover.departure || stopover.arrival || stopover.plannedDeparture || stopover.plannedArrival;
      const actualPlatform = stopover.departurePlatform || stopover.arrivalPlatform;
      const plannedPlatform = stopover.plannedDeparturePlatform || stopover.plannedArrivalPlatform;
      const delay = Math.max(delayMinutes(stopover.departureDelay), delayMinutes(stopover.arrivalDelay));

      const timeEl = document.createElement('span');
      timeEl.className = 'stop-time';
      timeEl.textContent = formatTime(time);

      const marker = document.createElement('span');
      marker.className = 'stop-marker';
      marker.setAttribute('aria-hidden', 'true');

      const info = document.createElement('span');
      info.className = 'stop-info';
      const name = document.createElement('strong');
      name.textContent = stopName(stopover);
      info.appendChild(name);

      const metaParts = [];
      if (actualPlatform) metaParts.push(actualPlatform !== plannedPlatform && plannedPlatform ? `Gleis ${actualPlatform} statt ${plannedPlatform}` : `Gleis ${actualPlatform}`);
      if (delay > 0) metaParts.push(`+${delay} Min.`);
      if (stopover.cancelled) metaParts.push('Halt fällt aus');
      if (metaParts.length) {
        const meta = document.createElement('small');
        meta.textContent = metaParts.join(' · ');
        info.appendChild(meta);
      }

      row.append(timeEl, marker, info);
      container.appendChild(row);
      visibleStops += 1;
    });
  });

  return visibleStops;
}

function renderJourney(journey) {
  const template = $('journeyTemplate').content.cloneNode(true);
  const article = template.querySelector('.journey');
  const legs = trainLegs(journey);
  const first = legs[0] || journey.legs?.[0] || {};
  const last = legs[legs.length - 1] || journey.legs?.at(-1) || {};
  const canceled = legs.some((leg) => leg.cancelled);
  const dep = first.departure || first.plannedDeparture;
  const arr = last.arrival || last.plannedArrival;
  const depDelay = delayMinutes(first.departureDelay);
  const arrDelay = delayMinutes(last.arrivalDelay);
  const totalDelay = Math.max(depDelay, arrDelay);
  const duration = minutesBetween(dep, arr);

  template.querySelector('.departure-time').textContent = formatTime(dep);
  template.querySelector('.arrival-time').textContent = formatTime(arr);
  template.querySelector('.duration').textContent = duration == null ? '' : `${duration} Min.`;
  template.querySelector('.train').textContent = legs.map((leg) => leg.line?.name).filter(Boolean).join(' · ') || 'Bahn';

  const platform = first.departurePlatform || first.plannedDeparturePlatform;
  const plannedPlatform = first.plannedDeparturePlatform;
  const platformEl = template.querySelector('.platform');
  platformEl.textContent = platform ? `Gleis ${platform}` : 'Gleis offen';
  if (platform && plannedPlatform && platform !== plannedPlatform) {
    platformEl.classList.add('platform-change');
    platformEl.textContent = `Gleis ${platform} statt ${plannedPlatform}`;
  }

  const transfers = Math.max(0, legs.length - 1);
  template.querySelector('.transfers').textContent = transfers === 0 ? 'Direkt' : `${transfers}× umsteigen`;

  const delayRow = template.querySelector('.delay-row');
  if (canceled) {
    article.classList.add('canceled');
    delayRow.className = 'delay-row canceled-text';
    delayRow.textContent = 'Fahrt fällt aus';
  } else if (totalDelay > 0) {
    delayRow.className = 'delay-row delayed';
    delayRow.textContent = `+${totalDelay} Min. Verspätung`;
  } else {
    delayRow.className = 'delay-row on-time';
    delayRow.textContent = 'Pünktlich';
  }

  const remarks = meaningfulRemarks(journey);
  const remarksEl = template.querySelector('.remarks');
  remarksEl.textContent = remarks.join(' · ');
  if (!remarks.length) remarksEl.remove();

  const toggle = template.querySelector('.stops-toggle');
  const stopoversEl = template.querySelector('.stopovers');
  const stopCount = renderStopovers(stopoversEl, journey.legs || []);
  if (stopCount <= 2) {
    toggle.remove();
    stopoversEl.remove();
  } else {
    toggle.textContent = `${Math.max(0, stopCount - 2)} Zwischenbahnhöfe anzeigen`;
    toggle.addEventListener('click', () => {
      const opening = stopoversEl.hidden;
      stopoversEl.hidden = !opening;
      toggle.setAttribute('aria-expanded', String(opening));
      toggle.textContent = opening
        ? 'Zwischenbahnhöfe ausblenden'
        : `${Math.max(0, stopCount - 2)} Zwischenbahnhöfe anzeigen`;
    });
  }

  results.appendChild(template);
}

function officialDbUrl() {
  const route = currentRoute();
  // Die DB-Webseite ändert ihre internen Suchparameter regelmäßig.
  // Diese einfache Startseite füllt Start und Ziel zuverlässig vor.
  const url = new URL('https://www.bahn.de/buchung/start');
  url.hash = `?SO=${encodeURIComponent(route.from.display)}&ZO=${encodeURIComponent(route.to.display)}`;
  return url.toString();
}

function showApiError(error) {
  console.error(error);
  const box = document.createElement('div');
  box.className = 'error';
  const strong = document.createElement('strong');
  strong.textContent = 'Live-Datenquelle antwortet gerade nicht.';
  const text = document.createElement('p');
  text.textContent = 'Die kostenlose Live-Schnittstelle ist gerade nicht erreichbar. Start und Ziel kannst du direkt bei der Deutschen Bahn öffnen.';
  const link = document.createElement('a');
  link.className = 'db-fallback';
  link.href = officialDbUrl();
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'Wunstorf ↔ Hannover bei DB öffnen';
  box.append(strong, text, link);
  if (error?.message) {
    const detail = document.createElement('small');
    detail.textContent = `Technischer Fehler: ${error.message}`;
    box.appendChild(detail);
  }
  results.innerHTML = '';
  results.appendChild(box);
  statusText.textContent = 'Live-Aktualisierung fehlgeschlagen';
}

function departureToJourney(dep, targetId) {
  const stopovers = dep.stopovers || [];
  const targetIndex = stopovers.findIndex((s) => String(s.stop?.id || s.station?.id || '') === String(targetId));
  if (targetIndex < 0) return null;
  const target = stopovers[targetIndex];
  const relevantStops = stopovers.slice(0, targetIndex + 1);
  const originStop = relevantStops[0] || {
    stop: dep.stop,
    departure: dep.when,
    plannedDeparture: dep.plannedWhen,
    departureDelay: dep.delay,
    departurePlatform: dep.platform,
    plannedDeparturePlatform: dep.plannedPlatform
  };
  originStop.departure ||= dep.when;
  originStop.plannedDeparture ||= dep.plannedWhen;
  originStop.departureDelay ??= dep.delay;
  originStop.departurePlatform ||= dep.platform;
  originStop.plannedDeparturePlatform ||= dep.plannedPlatform;
  return {
    legs: [{
      origin: originStop.stop || dep.stop,
      destination: target.stop || target.station,
      departure: dep.when || originStop.departure,
      plannedDeparture: dep.plannedWhen || originStop.plannedDeparture,
      departureDelay: dep.delay ?? originStop.departureDelay,
      departurePlatform: dep.platform || originStop.departurePlatform,
      plannedDeparturePlatform: dep.plannedPlatform || originStop.plannedDeparturePlatform,
      arrival: target.arrival || target.plannedArrival,
      plannedArrival: target.plannedArrival,
      arrivalDelay: target.arrivalDelay,
      arrivalPlatform: target.arrivalPlatform,
      plannedArrivalPlatform: target.plannedArrivalPlatform,
      line: dep.line,
      cancelled: dep.cancelled,
      remarks: dep.remarks || [],
      stopovers: relevantStops
    }]
  };
}

async function requestJourneys(route) {
  const url = new URL(`${API}/journeys`);
  url.searchParams.set('from', route.from.id);
  url.searchParams.set('to', route.to.id);
  url.searchParams.set('departure', selectedDepartureIso());
  url.searchParams.set('results', '8');
  url.searchParams.set('stopovers', 'true');
  url.searchParams.set('remarks', 'true');
  url.searchParams.set('language', 'de');
  url.searchParams.set('nationalExpress', 'true');
  url.searchParams.set('national', 'true');
  url.searchParams.set('regionalExpress', 'true');
  url.searchParams.set('regional', 'true');
  url.searchParams.set('suburban', 'true');
  url.searchParams.set('bus', 'false');
  url.searchParams.set('tram', 'false');
  url.searchParams.set('subway', 'false');
  url.searchParams.set('ferry', 'false');
  url.searchParams.set('taxi', 'false');

  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await fetchJson(url);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }
  throw lastError;
}

async function loadJourneys({ silent = false } = {}) {
  if (!silent) {
    results.innerHTML = '<div class="empty">Verbindungen werden geladen …</div>';
    statusText.textContent = 'Live-Daten werden geladen …';
  }

  try {
    const route = currentRoute();
    const data = await requestJourneys(route);
    const journeys = Array.isArray(data) ? data : (data.journeys || []);

    results.innerHTML = '';
    if (!journeys.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Keine Verbindung gefunden.';
      const link = document.createElement('a');
      link.className = 'db-fallback';
      link.href = officialDbUrl();
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Bei DB suchen';
      empty.appendChild(link);
      results.appendChild(empty);
    } else {
      journeys.forEach(renderJourney);
    }
    statusText.textContent = `Aktualisiert: ${formatTime(new Date())} Uhr`;
  } catch (error) {
    if (!silent || !results.children.length) showApiError(error);
    else statusText.textContent = 'Aktualisierung fehlgeschlagen';
  }
}

function restartAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    const chosen = new Date(`${$('dateInput').value}T${$('timeInput').value || '00:00'}:00`);
    if (Math.abs(Date.now() - chosen.getTime()) < 20 * 60 * 1000) {
      setNowInputs();
      loadJourneys({ silent: true });
    }
  }, 60000);
}

$('swapBtn').addEventListener('click', () => {
  direction = direction === 'toHannover' ? 'toWunstorf' : 'toHannover';
  updateRouteLabels();
  setNowInputs();
  loadJourneys();
});
$('nowBtn').addEventListener('click', () => { setNowInputs(); loadJourneys(); });
$('searchBtn').addEventListener('click', () => loadJourneys());
$('refreshBtn').addEventListener('click', () => loadJourneys());

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

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.error));
}

setNowInputs();
updateRouteLabels();
restartAutoRefresh();
loadJourneys();
