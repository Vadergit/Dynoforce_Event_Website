import React,{useEffect,useState} from "react";
import {auth} from "../firebase.js";
const EVENT_API=import.meta.env.VITE_DYNOTOUCH_API_URL||"https://dynoforce-events.dario-neuenschwander.chatgpt.site";
let moderatorSession="";
type Any=Record<string,any>;
async function api(path:string,method="GET",body?:unknown){
  const headers:Record<string,string>=body?{'Content-Type':'application/json'}:{};
  if(path.startsWith('owner/')||path.endsWith('/manage')){
    if(auth.currentUser)headers.Authorization='Bearer '+await auth.currentUser.getIdToken();
    if(moderatorSession)headers['X-Event-Session']=moderatorSession;
  }
  const response=await fetch(EVENT_API+'/api/'+path,{method,cache:'no-store',headers,body:body?JSON.stringify(body):undefined});
  const result:any=await response.json();if(!response.ok)throw Error(result.error||'Anfrage fehlgeschlagen');if(result.sessionToken)moderatorSession=result.sessionToken;return result;
}
function date(value:number){return new Date(value).toLocaleString('de-CH',{timeZone:'Europe/Zurich',dateStyle:'medium',timeStyle:'short'});}
function seconds(value:number){return (value/1000).toFixed(3)+' s';}
function Rules({event}:{event:Any}){const r=event.rules;return <div className="chips"><span>{r.mode==='multi'?'Multi Target':'Single Target'}</span><span>{r.targetMs/1000} s / Target</span><span>{r.mask.toString(2).split('1').length-1} Targets</span></div>;}
export default function EventClient({kind,id='',signedIn=false}:{kind:'home'|'event'|'claim'|'admin'|'manage';id?:string;signedIn?:boolean}){
  const [data,setData]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[name,setName]=useState(''),[consent,setConsent]=useState(false),[password,setPassword]=useState(''),[paired,setPaired]=useState<Any|null>(null);
  const [offset,setOffset]=useState(0);
  async function load(){try{
    const path=kind==='home'?'events':kind==='claim'?'claim/'+id:kind==='event'?'events/'+id+'?offset='+offset:kind==='manage'?'events/'+id+'/manage':'owner/events';
    setData(await api(path));setError('');
  }catch(e){setError((e as Error).message);}}
  useEffect(()=>{if(kind!=='admin'||signedIn)load();if(kind==='event'){const timer=setInterval(load,15000);return()=>clearInterval(timer);}},[kind,id,offset,signedIn]);
  async function action(fn:()=>Promise<void>){setBusy(true);setError('');try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <main>
    <header><a href="#/dynotouch" className="brand"><img src="/dynoforce-icon.png" alt="DynoForce"/><span>DYNOFORCE<span className="brand-sub">EVENTS</span></span></a><a className="quiet-link" href={kind==='admin'?'#/dynotouch':'#/dynotouch/admin'}>{kind==='admin'?'Ranglisten':'Veranstalter ↗'}</a></header>
    {error&&<div className="notice error" role="alert">{error}</div>}
    {kind==='home'&&<><div className="eyebrow">DYNOTOUCH · LIVE LEADERBOARDS</div><h1>Dein Run.<br/>Dein Platz.</h1><p className="intro">Spiel am Board, scanne deinen persönlichen QR-Code und sichere dir deinen Eintrag.</p>
      <div className="event-grid">{data?.map((e:Any)=><a className="card event-card" key={e.id} href={'#/dynotouch/e/'+e.id}><div className="eyebrow">{Date.now()<e.starts?'DEMNÄCHST':Date.now()<e.ends?'EVENT AKTIV':'ABGESCHLOSSEN'}</div><h2>{e.name}</h2><p>{date(e.starts)} – {date(e.ends)}</p><Rules event={e}/><span className="text-link">Rangliste ansehen →</span></a>)}</div>
      {data?.length===0&&<div className="card empty"><h2>Bereit für das nächste Battle.</h2><p>Noch kein Event angelegt. Veranstalter können ein Board verbinden und anschliessend direkt im DynoTouch-Webportal ein Event erstellen.</p></div>}
    </>}
    {kind==='claim'&&data&&<section className="claim card"><div className="eyebrow">{data.eventName}</div><h1 className="compact">Dein Ergebnis</h1><div className="result"><strong>{data.score}</strong><span>PUNKTE · {seconds(data.durationMs)}</span></div>
      {data.claimed?<div className="notice">Dieses Ergebnis ist bereits gespeichert. Spiele erneut und scanne den neuen QR-Code für deinen nächsten Versuch.</div>:data.expired?<div className="notice">Die Zeit für dieses Ergebnis ist abgelaufen. Du kannst jederzeit erneut spielen.</div>:<form onSubmit={e=>{e.preventDefault();action(async()=>{const result=await api('claim/'+id,'POST',{name,consent});window.location.hash='/dynotouch/e/'+result.eventId;});}}>
        <label htmlFor="player">Dein Anzeigename</label><input id="player" value={name} onChange={e=>setName(e.target.value)} maxLength={32} minLength={2} autoComplete="nickname" placeholder="z. B. Alex" required/>
        <label className="check"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} required/><span>Mein Anzeigename, Punkte und Spieldauer dürfen öffentlich in dieser Event-Rangliste erscheinen. Ich kann auch einen Spitznamen verwenden.</span></label>
        <button disabled={busy||!consent} className="primary">{busy?'Wird gespeichert …':'Ergebnis speichern →'}</button><p className="small">Spiele so oft du möchtest. Verwende immer denselben Namen – nur dein bestes Ergebnis zählt.</p>
      </form>}<a className="text-link" href={'#/dynotouch/e/'+data.eventId}>Zur Rangliste →</a>
    </section>}
    {kind==='event'&&data&&<><div className="eyebrow">ÖFFENTLICHE RANGLISTE</div><h1 className="compact">{data.event.name}</h1><p className="intro">{date(data.event.starts)} – {date(data.event.ends)}</p><Rules event={data.event}/>
      <div className="card board"><div className="board-top"><h2>Leaderboard</h2><span className="live-dot">Live · aktualisiert alle 15 s</span></div><div className="table-wrap"><table><thead><tr><th>Platz</th><th>Name</th><th className="right">Punkte</th><th className="right">Spieldauer</th></tr></thead><tbody>{data.entries.map((r:Any)=><tr key={r.id}><td className="rank">{r.rank.toString().padStart(2,'0')}</td><td className="player">{r.name}</td><td className="right score">{r.score}</td><td className="right mono">{seconds(r.duration)}</td></tr>)}</tbody></table></div>{!data.entries.length&&<p className="empty">Der erste Platz wartet noch auf dich.</p>}
      <div className="pagination"><button disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-100))}>← Zurück</button><span>Seite {offset/100+1}</span><button disabled={data.entries.length<100} onClick={()=>setOffset(offset+100)}>Weiter →</button></div></div>
      <p className="small">Pro Name zählt nur das beste Ergebnis: mehr Punkte zuerst, bei gleicher Punktzahl die kürzere Spieldauer. Du kannst beliebig oft spielen.</p><a className="quiet-link" href={'#/dynotouch/e/'+id+'/manage'}>Event verwalten</a>
    </>}
    {kind==='admin'&&<><div className="eyebrow">FÜR VERANSTALTER</div><h1 className="compact">Dein Event.<br/>Dein Board.</h1>
      {!signedIn?<section className="card"><p>Die Geräteverwaltung ist geschützt. Melde dich an, um ein Board zu koppeln. Event-Ranglisten und die QR-Namenseingabe brauchen kein Konto.</p><a className="primary" href="#/">Zur bestehenden Anmeldung →</a></section>:<>
      <section className="card"><h2>Board koppeln</h2><p>Erzeuge einen Geräteschlüssel und hinterlege ihn einmalig unter DynoTouch → Settings → Events. Der Schlüssel wird danach nicht mehr angezeigt.</p>
      <form className="inline-form" onSubmit={e=>{e.preventDefault();action(async()=>{setPaired(await api('owner/devices','POST',{name}));setName('');});}}><input aria-label="Gerätename" value={name} onChange={e=>setName(e.target.value)} placeholder="Boardname" required maxLength={60}/><button className="primary" disabled={busy}>Schlüssel erstellen</button></form>
      {paired&&<div className="notice"><strong>{paired.name} – einmaliger Geräteschlüssel</strong><code className="secret">{paired.key}</code><p className="small">Nur ins eigene DynoTouch-Webportal kopieren. Nicht öffentlich teilen.</p></div>}</section>
      <section className="card"><h2>Deine Events</h2><p>Neue Events mit Zeitraum, Regeln und Moderationspasswort werden direkt im DynoTouch-Webportal erstellt.</p>{data?.map((e:Any)=><div className="admin-event" key={e.id}><div><a href={'#/dynotouch/e/'+e.id}><strong>{e.name}</strong></a><p className="small">{date(e.starts)} – {date(e.ends)}</p></div><div className="actions"><a href={'#/dynotouch/e/'+e.id+'/manage'}>Verwalten</a><button disabled={busy} onClick={()=>action(async()=>{await api('owner/events','PATCH',{id:e.id,enabled:!e.enabled});await load();})}>{e.enabled?'Deaktivieren':'Aktivieren'}</button></div></div>)}</section>
      <a className="quiet-link" href="#/">Zur Hauptseite</a></>}
    </>}
    {kind==='manage'&&<><div className="eyebrow">GESCHÜTZTE EVENT-VERWALTUNG</div><h1 className="compact">Namen & Einträge</h1>
      {!data?<section className="card"><p>Verwende das beim Erstellen des Events festgelegte Moderationspasswort oder melde dich als Veranstalter an.</p><form onSubmit={e=>{e.preventDefault();action(async()=>{await api('events/'+id+'/login','POST',{password});setPassword('');await load();});}}><label htmlFor="event-password">Event-Passwort</label><input id="event-password" type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" required/><button className="primary" disabled={busy}>Anmelden</button></form><a className="text-link" href="#/">Als Veranstalter anmelden →</a></section>:<section className="card"><h2>{data.event.name}</h2><p>Umbenennen und Ausblenden sind protokolliert. Der QR-Code wird dadurch nicht wieder freigegeben.</p>{data.entries.map((r:Any)=><ModerationRow key={r.id} run={r} busy={busy} save={(changes:Any)=>action(async()=>{await api('events/'+id+'/manage','PATCH',{id:r.id,...changes});await load();})}/>)}{!data.entries.length&&<p>Noch keine eingetragenen Namen.</p>}</section>}
      <a className="text-link" href={'#/dynotouch/e/'+id}>← Zur öffentlichen Rangliste</a>
    </>}
    {!data&&kind!=='admin'&&!error&&<p className="loading">Wird geladen …</p>}
    <footer>DYNOFORCE · DYNOTOUCH<span>Präzise Runs. Echte Ergebnisse.</span></footer>
  </main>;
}
function ModerationRow({run,busy,save}:{run:Any;busy:boolean;save:(changes:Any)=>void}){
  const [name,setName]=useState(run.name);
  return <div className="moderation-row"><div><strong>{run.score} Punkte</strong><span className="small"> · {seconds(run.duration)}</span>{run.hidden===1&&<span className="badge">Ausgeblendet</span>}</div><div className="inline-form"><input aria-label="Anzeigename bearbeiten" maxLength={32} value={name} onChange={e=>setName(e.target.value)}/><button disabled={busy||name===run.name} onClick={()=>save({name})}>Speichern</button><button disabled={busy} onClick={()=>save({hidden:!run.hidden})}>{run.hidden?'Einblenden':'Ausblenden'}</button></div></div>;
}
