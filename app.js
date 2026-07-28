'use strict';

const API = 'https://api.transitous.org/api/v6/plan';
const stations = {
  wunstorf: { label: 'Wunstorf', api: '52.42335,9.43531' },
  hannover: { label: 'Hannover Hbf', api: '52.37722,9.74142' }
};
let direction = 'toHannover';
let installPrompt = null;
const $ = id => document.getElementById(id);

function currentRoute(){
  return direction === 'toHannover'
    ? {from:stations.wunstorf,to:stations.hannover}
    : {from:stations.hannover,to:stations.wunstorf};
}
function pad(n){return String(n).padStart(2,'0')}
function setNow(){
  const d=new Date();
  $('dateInput').value=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  $('timeInput').value=`${pad(d.getHours())}:${pad(Math.floor(d.getMinutes()/5)*5)}`;
}
function updateLabels(){
  const r=currentRoute();
  $('fromName').textContent=r.from.label;$('toName').textContent=r.to.label;
  $('routeTitle').textContent=`${r.from.label} → ${r.to.label}`;
}
function isoLocal(){
  const date=$('dateInput').value,time=$('timeInput').value;
  if(!date||!time) throw new Error('Datum und Uhrzeit fehlen.');
  const d=new Date(`${date}T${time}:00`);
  return d.toISOString();
}
function fmtTime(value){return new Intl.DateTimeFormat('de-DE',{hour:'2-digit',minute:'2-digit'}).format(new Date(value))}
function fmtDuration(sec){const min=Math.round(sec/60);return min<60?`${min} Min.`:`${Math.floor(min/60)} Std. ${min%60} Min.`}
function delayMinutes(real,planned){return Math.round((new Date(real)-new Date(planned))/60000)}
function safe(v,fallback=''){return v??fallback}
function transportLegs(it){return (it.legs||[]).filter(l=>['SUBURBAN','RAIL'].includes(l.mode))}
function displayTrain(leg){
  const text=safe(leg.displayName)||safe(leg.routeShortName)||safe(leg.tripShortName);
  if(text) return text;
  return leg.mode==='SUBURBAN'?'S-Bahn':'RE/RB';
}
function platformText(place,prefix){
  const p=safe(place?.track)||safe(place?.scheduledTrack);
  return p?`${prefix} Gleis ${p}`:'';
}
function stopTime(place){return place?.departure||place?.arrival||place?.scheduledDeparture||place?.scheduledArrival}
function stopPlanned(place){return place?.scheduledDeparture||place?.scheduledArrival||stopTime(place)}
function renderStops(leg){
  const all=[leg.from,...(leg.intermediateStops||[]),leg.to];
  return all.map((p,i)=>{
    const t=stopTime(p); const planned=stopPlanned(p); const delay=t&&planned?delayMinutes(t,planned):0;
    const platform=safe(p.track)||safe(p.scheduledTrack);
    return `<li><strong>${t?fmtTime(t):'–'}</strong><span>${safe(p.name,'Bahnhof')}${delay>0?` <small class="delay">+${delay}</small>`:''}</span><small>${platform?`Gl. ${platform}`:''}</small></li>`;
  }).join('');
}
function renderJourney(it,index){
  const legs=transportLegs(it); if(!legs.length) return '';
  const first=legs[0],last=legs[legs.length-1];
  const dep=it.startTime||first.startTime,arr=it.endTime||last.endTime;
  const depPlan=first.scheduledStartTime||dep,arrPlan=last.scheduledEndTime||arr;
  const depDelay=delayMinutes(dep,depPlan),arrDelay=delayMinutes(arr,arrPlan);
  const cancelled=legs.some(l=>l.cancelled);
  const badges=legs.map(l=>`<span class="train-badge">${displayTrain(l)}</span>`).join('');
  const detailLegs=legs.map(l=>`<div class="leg"><div class="leg-head"><span>${displayTrain(l)}</span><span>${fmtTime(l.startTime)}–${fmtTime(l.endTime)}</span></div><ul class="stops">${renderStops(l)}</ul></div>`).join('');
  return `<article class="journey ${cancelled?'cancelled':''}">
    <div class="journey-top">
      <div><span class="label">Abfahrt</span><span class="time">${fmtTime(dep)}</span>${depDelay>0?`<span class="delay">+${depDelay}</span>`:''}</div>
      <div class="duration">${fmtDuration(it.duration)}<br>${it.transfers===0?'direkt':`${it.transfers} Umstieg${it.transfers===1?'':'e'}`}</div>
      <div class="arrival"><span class="label">Ankunft</span><span class="time">${fmtTime(arr)}</span>${arrDelay>0?`<span class="delay">+${arrDelay}</span>`:''}</div>
    </div>
    <div class="train-row">${badges}</div>
    <div class="platform">${[platformText(first.from,'Abfahrt:'),platformText(last.to,'Ankunft:')].filter(Boolean).join(' · ')}</div>
    ${cancelled?'<div class="cancel-note">Diese Verbindung fällt ganz oder teilweise aus.</div>':''}
    <details class="details"><summary>Zwischenbahnhöfe anzeigen</summary>${detailLegs}</details>
  </article>`;
}
function dbUrl(){
  const r=currentRoute();
  const date=$('dateInput').value,time=$('timeInput').value;
  const base='https://int.bahn.de/de/buchung/fahrplan/suche';
  const params=new URLSearchParams({STS:'true',so:r.from.label,zo:r.to.label,hd:`${date}T${time}:00`});
  return `${base}?${params}`;
}
async function search(){
  $('errorBox').hidden=true;$('results').innerHTML='';$('statusText').textContent='Live-Verbindungen werden geladen …';
  $('searchBtn').disabled=true;
  try{
    const r=currentRoute();
    const params=new URLSearchParams({
      fromPlace:r.from.api,toPlace:r.to.api,time:isoLocal(),radius:'250',
      transitModes:'SUBURBAN,RAIL',directModes:'',preTransitModes:'',postTransitModes:'',
      maxTransfers:'0',numItineraries:'8',maxItineraries:'10',searchWindow:'3600',
      detailedLegs:'false',joinInterlinedLegs:'true',language:'de'
    });
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),25000);
    const response=await fetch(`${API}?${params}`,{headers:{Accept:'application/json'},signal:controller.signal});
    clearTimeout(timer);
    if(!response.ok) throw new Error(`Serverfehler ${response.status}`);
    const data=await response.json();
    const list=(data.itineraries||[]).filter(it=>transportLegs(it).length>0);
    if(!list.length) throw new Error('Keine Bahnverbindungen gefunden.');
    $('results').innerHTML=list.map(renderJourney).join('');
    $('statusText').textContent=`Aktualisiert: ${new Intl.DateTimeFormat('de-DE',{hour:'2-digit',minute:'2-digit'}).format(new Date())}`;
  }catch(err){
    console.error(err);$('statusText').textContent='Live-Aktualisierung fehlgeschlagen';
    $('errorText').textContent=err.name==='AbortError'?'Die Datenquelle antwortet zu langsam.':err.message;
    $('dbLink').href=dbUrl();$('errorBox').hidden=false;
  }finally{$('searchBtn').disabled=false}
}

$('nowBtn').addEventListener('click',()=>{setNow();search()});
$('searchBtn').addEventListener('click',search);$('refreshBtn').addEventListener('click',search);
$('swapBtn').addEventListener('click',()=>{direction=direction==='toHannover'?'toWunstorf':'toHannover';updateLabels();search()});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('installBtn').hidden=false});
$('installBtn').addEventListener('click',async()=>{if(!installPrompt)return;installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$('installBtn').hidden=true});
window.addEventListener('load',()=>{updateLabels();setNow();if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(console.error);search()});
