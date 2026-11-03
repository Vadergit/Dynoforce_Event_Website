// Shared, deterministic DynoTouch event grouping and ranking logic.
// Do not infer a competition category from a player's name.
export const CATEGORIES = [
  {key:'male',label:'Mann'},
  {key:'female',label:'Frau'},
  {key:'youth',label:'Jugendliche unter 16'},
];

// Same podium symbols as the existing DynoForce event leaderboards.
// Use the actual rank, so equal scores and durations share the same medal.
export function medalForRank(rank) {
  if(rank===1)return '🏆';
  if(rank===2)return '🥈';
  if(rank===3)return '🥉';
  return String(rank);
}

export function categoryOf(entry) {
  const value=String(entry?.category || entry?.gender || entry?.division || '').trim().toLowerCase();
  if(['male','mann','m'].includes(value))return 'male';
  if(['female','frau','w','f'].includes(value))return 'female';
  if(['youth','u16','under16','under-16','jugendliche','junior'].includes(value))return 'youth';
  return 'unknown';
}

export function modeOf(event) {
  return event?.rules?.mode==='multi'?'multi':'single';
}

function localDay(value) {
  if(!value)return '';
  const time=new Date(value).getTime();
  return Number.isFinite(time)
    ? new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Zurich',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time))
    : '';
}

export function eventGroupKey(event) {
  const scope=String(event?.organiserScope||'');
  if(event?.eventGroupId || event?.groupId)return scope+'|group:'+String(event.eventGroupId||event.groupId);
  // Two challenges with the same event title and calendar dates belong together.
  return scope+'|event:'+String(event?.name||'').trim().toLocaleLowerCase('de-CH')
    .replace(/(?:\s*[-|·:]\s*|\s*\(\s*)(?:single|multi)\s*target\s*\)?$/i,'').trim()
    +'|'+localDay(event?.starts)+'|'+localDay(event?.ends);
}

export function groupEvents(events) {
  const groups=new Map();
  for(const event of Array.isArray(events)?events:[]) {
    const key=eventGroupKey(event);
    if(!groups.has(key))groups.set(key,{...event,children:[]});
    groups.get(key).children.push(event);
  }
  return [...groups.values()].map(group=>({
    ...group,
    children:group.children.sort((a,b)=>modeOf(b).localeCompare(modeOf(a))||String(a.id).localeCompare(String(b.id)))
  }));
}

export function bestResults(entries) {
  const sorted=[...(Array.isArray(entries)?entries:[])].filter(row=>row&&row.hidden!==true&&row.hidden!==1)
    .sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0)
      ||(Number(a.duration??a.durationMs)||0)-(Number(b.duration??b.durationMs)||0));
  const best=new Map();
  for(const row of sorted) {
    const name=String(row.name||'').trim().toLocaleLowerCase('de-CH');
    const key=name || 'id:'+String(row.id);
    if(!best.has(key))best.set(key,row);
  }
  const ranked=[...best.values()];
  let previous=null,rank=0;
  return ranked.map((row,index)=>{
    const signature=String(Number(row.score)||0)+'/'+String(Number(row.duration??row.durationMs)||0);
    if(signature!==previous)rank=index+1;
    previous=signature;
    return {...row,rank};
  });
}

export function groupRankings(challenges) {
  // Merge duplicate boards only if their competition rules are identical.
  const grouped=new Map();
  for(const {event,entries} of Array.isArray(challenges)?challenges:[]) {
    const mode=modeOf(event);
    const rules=event?.rules||{};
    const key=[mode,rules.mask,rules.targetMs,rules.delayMs,rules.challenge,rules.mpr].map(v=>String(v??'')).join('|');
    if(!grouped.has(key))grouped.set(key,{event,mode,entries:[]});
    grouped.get(key).entries.push(...(entries||[]));
  }
  return [...grouped.values()].sort((a,b)=>b.mode.localeCompare(a.mode)).map(group=>({
    event:group.event,
    mode:group.mode,
    sections:CATEGORIES.map(category=>({
      ...category,
      entries:bestResults(group.entries.filter(entry=>categoryOf(entry)===category.key))
    }))
  }));
}

// The public demo uses the existing Kraftreaktor template until its metadata
// can be persisted by the separate DynoTouch event API.
export function demoTemplateId(event) {
  if(event?.brandingTemplate)return '';
  const identifier=String(event?.name||'')+' '+String(event?.id||'');
  return /demo/i.test(identifier)?'kraftreaktor-lenzburg-aarau':'';
}
