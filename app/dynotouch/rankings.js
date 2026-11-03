// Shared, deterministic DynoTouch event grouping and ranking logic.
// Do not infer a competition category from a player's name.
export const CATEGORIES = [
  {key:'male',label:'Mann'},
  {key:'female',label:'Frau'},
  {key:'youth',label:'Jugendliche unter 16'},
  {key:'unknown',label:'Nicht zugeordnet'},
];

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
  if(event?.eventGroupId || event?.groupId)return 'group:'+String(event.eventGroupId||event.groupId);
  // Two challenges with the same event title and calendar dates belong together.
  return 'event:'+String(event?.name||'').trim().toLocaleLowerCase('de-CH')
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
    children:group.children.sort((a,b)=>modeOf(a).localeCompare(modeOf(b))||String(a.id).localeCompare(String(b.id)))
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
  return (Array.isArray(challenges)?challenges:[]).map(({event,entries})=>({
    event,
    mode:modeOf(event),
    sections:CATEGORIES.map(category=>({
      ...category,
      entries:bestResults((entries||[]).filter(entry=>categoryOf(entry)===category.key))
    }))
  }));
}
