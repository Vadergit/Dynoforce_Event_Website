// Fast, synchronous name checks using a prefetched snapshot of one competition.
// Every competition scope includes the event group and *all* scoring rules.
import {categoryOf,eventGroupKey,modeOf} from './rankings.js';

export function normalizeParticipantName(value) {
  return String(value||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('de-CH');
}

export function competitionKey(event) {
  const rules=event?.rules||{};
  return eventGroupKey(event)+'|'+[modeOf(event),rules.mask,rules.targetMs,rules.delayMs,
    rules.challenge,rules.mpr].map(v=>String(v??'')).join('|');
}

export function knownNames(entries) {
  const names=new Set();
  for(const entry of Array.isArray(entries)?entries:[]) {
    if(!entry||entry.hidden===true||entry.hidden===1)continue;
    const name=normalizeParticipantName(entry.name);
    if(name)names.add(categoryOf(entry)+'|'+name);
  }
  return names;
}

export function participantProfileKey(eventId) {
  return 'dynotouch:claim-profile:v1:'+encodeURIComponent(String(eventId||''));
}

export function readParticipantProfile(storage,eventId) {
  if(!eventId||!storage)return null;
  try {
    const value=JSON.parse(storage.getItem(participantProfileKey(eventId))||'null');
    if(value&&typeof value.name==='string'&&normalizeParticipantName(value.name)&&
       ['male','female','youth'].includes(value.category)&&value.eventId===String(eventId)) {
      return {name:value.name,category:value.category,eventId:value.eventId};
    }
  }catch { /* Storage can be blocked in private browsing. */ }
  return null;
}

export function saveParticipantProfile(storage,eventId,name,category) {
  if(!storage||!eventId||!normalizeParticipantName(name)||!['male','female','youth'].includes(category))return false;
  try {
    storage.setItem(participantProfileKey(eventId),JSON.stringify({
      eventId:String(eventId),name:String(name).trim(),category
    }));
    return true;
  }catch { return false; }
}

export function nameCheckState({name,category,known,profile,loading,error=false,allowReuse=true}) {
  const clean=normalizeParticipantName(name);
  if(clean.length<2||!['male','female','youth'].includes(category))return 'empty';
  const matchingProfile=profile&&normalizeParticipantName(profile.name)===clean&&profile.category===category;
  if(matchingProfile&&allowReuse)return 'returning';
  if(loading||!known)return 'checking';
  const taken=known.has(category+'|'+clean);
  if(taken)return allowReuse?'duplicate':'blocked';
  if(error)return 'unverified';
  return 'available';
}
