import React,{useEffect,useState} from 'react';
import {auth,db,storage} from '../firebase.js';
import {collection,getDocs,query,where} from 'firebase/firestore';
import {getDownloadURL,ref,uploadBytes} from 'firebase/storage';
import {CATEGORIES,categoryOf,groupEvents,groupRankings,modeOf,eventGroupKey,demoTemplateId,medalForRank} from './rankings.js';
import {competitionKey,knownNames,normalizeParticipantName,nameCheckState,readParticipantProfile,saveParticipantProfile,clearParticipantProfile} from './claim-names.js';

const EVENT_API=import.meta.env.VITE_DYNOTOUCH_API_URL||'https://dynoforce-events.dario-neuenschwander.chatgpt.site';
let moderatorSession='';
type Any=Record<string,any>;

const STANDARD_TEMPLATES=[
  {id:'bouba-baden',name:'BOUBA Boulder Baden',folder:'bouba-baden',header:'header-banner-2400x600.jpg',logo:'eventlogo-df-1000x1000.png',sponsor:'sponsor-footer-2500x500.jpg'},
  {id:'boulderlounge-schlieren',name:'BoulderLounge Schlieren',folder:'boulderlounge-schlieren',header:'header-banner-logo-left-2400x600.jpg',logo:'eventlogo-1000x1000.png',venue:'hallenlogo-1000x1000.png',sponsor:'sponsor-banner-2500x500.jpg'},
  {id:'grindelboulder-bassersdorf',name:'GrindelBoulder Bassersdorf',folder:'grindelboulder-bassersdorf',header:'header-banner-2400x600.jpg',logo:'eventlogo-df-1000x1000.png',sponsor:'sponsor-footer-2500x500.jpg'},
  {id:'kraftreaktor-lenzburg-aarau',name:'Kraftreaktor Lenzburg/Aarau',folder:'kraftreaktor-lenzburg-aarau',header:'header-banner-2400x600.jpg',logo:'eventlogo-df-1000x1000.png',sponsor:'sponsor-footer-2500x500.jpg'},
  {id:'minimum-zuerich',name:'Minimum Zürich',folder:'minimum-zuerich',header:'header-banner-2400x600.jpg',logo:'eventlogo-df-1000x1000.png',sponsor:'sponsor-footer-2500x500.jpg'},
  {id:'mito-zuerich',name:'MITO Bouldering Zürich',folder:'mito-zuerich',header:'header-banner-2400x600.jpg',logo:'eventlogo-df-1000x1000.png',sponsor:'sponsor-footer-2500x500.jpg'},
];
const DEFAULT_BRANDING={eventLogo:'/dynoforce-icon.png',venueLogo:'',headerBanner:'/dynoforce-event-banner-template.png',sponsorBanner:'',showVenueLogo:false,primaryColor:'#1f4f46'};

function presetBranding(preset:Any):Any{
  const url=(filename:string)=>filename?'/branding/'+preset.folder+'/'+filename:'';
  return {...DEFAULT_BRANDING,eventLogo:url(preset.logo),venueLogo:url(preset.venue),headerBanner:url(preset.header),sponsorBanner:url(preset.sponsor),showVenueLogo:!!preset.venue};
}
function brandingFor(event:Any):Any{
  const demoTemplate=demoTemplateId(event);
  const preset=STANDARD_TEMPLATES.find(p=>p.id===(event?.brandingTemplate||demoTemplate));
  const supplied=event?.branding&&typeof event.branding==='object'?event.branding:{};
  // For the demo, render the Kraftreaktor assets even if the legacy backend
  // returns generic/empty branding fields. Explicitly selected templates win.
  if(demoTemplate&&preset)return {...DEFAULT_BRANDING,...supplied,...presetBranding(preset)};
  return {...DEFAULT_BRANDING,...(preset?presetBranding(preset):{}),...supplied};
}
async function api(path:string,method='GET',body?:unknown){
  const headers:Record<string,string>=body?{'Content-Type':'application/json'}:{};
  if(path.startsWith('owner/')||path.endsWith('/manage')){
    if(auth.currentUser)headers.Authorization='Bearer '+await auth.currentUser.getIdToken();
    if(moderatorSession)headers['X-Event-Session']=moderatorSession;
  }
  const response=await fetch(EVENT_API+'/api/'+path,{method,cache:'no-store',headers,body:body?JSON.stringify(body):undefined});
  const result:any=await response.json();
  if(!response.ok){const error=new Error(result.error||'Anfrage fehlgeschlagen') as Error & {status:number;data:Any};error.status=response.status;error.data=result;throw error;}
  if(result.sessionToken)moderatorSession=result.sessionToken;
  return result;
}
function date(value:number){return value?new Date(value).toLocaleString('de-CH',{timeZone:'Europe/Zurich',dateStyle:'medium',timeStyle:'short'}):'–';}
function seconds(value:number){return ((Number(value)||0)/1000).toFixed(3)+' s';}
function Rules({event}:{event:Any}){
  const r=event.rules||{};
  const count=Number(r.mask||0).toString(2).replace(/0/g,'').length;
  return <div className="chips"><span>{modeOf(event)==='multi'?'Multi Target':'Single Target'}</span>{r.targetMs&&<span>{r.targetMs/1000} s / Target</span>}{count>0&&<span>{count} Targets</span>}</div>;
}
async function fetchAllEntries(event:Any,firstPage?:Any[]){
  const hasFirstPage=Array.isArray(firstPage);
  const collected:Any[]=hasFirstPage?[...firstPage!]:[];
  // The claim form can reuse the first page already returned by GET /events/:id.
  if(hasFirstPage&&collected.length<100)return collected;
  // Full rankings are fetched for correct per-category ranks (server pages are 100 entries).
  for(let offset=hasFirstPage?100:0;;offset+=100){
    const page=await api('events/'+encodeURIComponent(event.id)+'?offset='+offset);
    const entries=Array.isArray(page.entries)?page.entries:[];
    collected.push(...entries);
    if(entries.length<100)break;
  }
  return collected;
}
async function fetchCombinedEvent(id:string){
  const all=await api('events');
  const events:Array<Any>=Array.isArray(all)?all:[];
  let selected=events.find(e=>String(e.id)===String(id));
  if(!selected){
    const direct=await api('events/'+encodeURIComponent(id));
    selected=direct.event;
  }
  if(!selected)throw Error('Event nicht gefunden.');
  const group=events.filter(e=>eventGroupKey(e)===eventGroupKey(selected));
  const members=group.length?group:[selected];
  const challenges=await Promise.all(members.map(async event=>({event,entries:await fetchAllEntries(event)})));
  return {event:selected,challenges};
}
function EventHero({event}:{event:Any}){
  const b=brandingFor(event);
  return <div className="card brand-hero dt-event-hero" style={{'--primary':b.primaryColor} as React.CSSProperties}>
    {b.headerBanner&&<div className="brand-hero-media"><img className="brand-hero-banner" src={b.headerBanner} alt="Eventbanner"/></div>}
    <div className="brand-hero-content">
      <div className="brand-hero-logos">{b.eventLogo&&<img src={b.eventLogo} alt="Eventlogo"/>}{b.showVenueLogo&&b.venueLogo&&<img src={b.venueLogo} alt="Hallenlogo"/>}</div>
      <div className="brand-hero-copy"><div className="eyebrow">DynoForce · DynoTouch Event</div><h1 className="hero-title">{event.name}</h1>
        <div className="brand-hero-meta">{date(event.starts)} – {date(event.ends)}{event.location?' · '+event.location:''}</div>
        <p>{event.description||'Teste deine Reaktion am DynoTouch-Board und vergleiche deine Bestleistung.'}</p>
        <a className="brand-hero-link" href="https://dynoforce.ch" target="_blank" rel="noopener noreferrer">Mehr über DynoForce</a>
      </div>
    </div>
  </div>;
}
function Leaderboards({challenges}:{challenges:Array<{event:Any,entries:Any[]}>}){
  return <div className="leaderboard-direction-groups is-public">
    {groupRankings(challenges).map(group=><section className="leaderboard-direction-group" key={group.event.id}>
      <header className="leaderboard-direction-header"><span className="leaderboard-direction-symbol" aria-hidden="true">{group.mode==='multi'?'M':'S'}</span>
        <div className="leaderboard-direction-title"><small>Disziplin</small><h3>{group.mode==='multi'?'Multi Target':'Single Target'}</h3></div><Rules event={group.event}/></header>
      <div className="leaderboard-gender-grid">
        {group.sections.map(section=><section className="leaderboard-gender-card" key={section.key}>
          <div className="leaderboard-gender-heading"><h4>{section.label}</h4><span>Kategorie</span></div>
          <div className="table-wrap"><table className="leaderboard-table grouped-leaderboard-table"><thead><tr><th>#</th><th>Name</th><th className="right">Punkte</th><th className="right">Zeit</th></tr></thead>
            <tbody>{section.entries.map((entry:Any)=><tr key={entry.id}><td className="rank"><span className="rank-pill">{medalForRank(entry.rank)}</span></td><td className="player">{entry.name}</td><td className="right score">{entry.score}</td><td className="right mono">{seconds(entry.duration??entry.durationMs)}</td></tr>)}
              {!section.entries.length&&<tr className="leaderboard-empty-row"><td colSpan={4}>Noch kein Ergebnis</td></tr>}</tbody></table></div>
        </section>)}
      </div>
    </section>)}
  </div>;
}
const EMPTY_DRAFT={description:'',organiser:'',location:'',eventGroupId:'',brandingTemplate:'',branding:{...DEFAULT_BRANDING},allowExistingName:true};
function EventSettings({event,onSaved}:{event:Any,onSaved:()=>Promise<void>}){
  const [draft,setDraft]=useState<Any>(EMPTY_DRAFT);
  const [presets,setPresets]=useState<Any[]>([]);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  useEffect(()=>{
    setDraft({description:event.description||'',organiser:event.organiser||'',location:event.location||'',
      eventGroupId:event.eventGroupId||event.groupId||'',brandingTemplate:event.brandingTemplate||'',branding:brandingFor(event),allowExistingName:event.allowExistingName!==false});
    setMessage('');
  },[event.id]);
  useEffect(()=>{
    let mounted=true;
    const owner=auth.currentUser?.uid;
    if(owner)getDocs(query(collection(db,'brandingPresets'),where('ownerUid','==',owner)))
      .then(result=>{if(mounted)setPresets(result.docs.map(doc=>({id:doc.id,name:doc.data().name||'Branding',branding:doc.data().branding||{}})));})
      .catch(()=>{if(mounted)setMessage('Gespeicherte Branding-Vorlagen konnten nicht geladen werden.');});
    return()=>{mounted=false;};
  },[]);
  function change(field:string,value:any){setDraft((previous:Any)=>({...previous,[field]:value}));}
  function changeBranding(field:string,value:any){setDraft((previous:Any)=>({...previous,branding:{...previous.branding,[field]:value}}));}
  function applyPreset(value:string){
    if(!value)return;
    const built=STANDARD_TEMPLATES.find(p=>p.id===value);
    const saved=presets.find(p=>p.id===value);
    const b=built?presetBranding(built):saved?.branding;
    if(!b)return;
    setDraft((previous:Any)=>({...previous,brandingTemplate:built?built.id:'',branding:{...DEFAULT_BRANDING,...b}}));
  }
  async function upload(field:string,file:File|undefined){
    if(!file||!auth.currentUser)return;
    if(!file.type.startsWith('image/')){setMessage('Bitte eine Bilddatei wählen.');return;}
    setBusy(true);
    try{
      const path='event-branding/'+auth.currentUser.uid+'/'+event.id+'/dynotouch-'+field+'-'+Date.now()+'-'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
      const storageRef=ref(storage,path);
      await uploadBytes(storageRef,file,{contentType:file.type});
      changeBranding(field,await getDownloadURL(storageRef));
      setMessage('Bild hochgeladen. Mit «Event-Design speichern» veröffentlichen.');
    }catch(e){setMessage('Upload fehlgeschlagen: '+(e as Error).message);}finally{setBusy(false);}
  }
  async function save(){
    setBusy(true);setMessage('');
    try{
      await api('owner/events','PATCH',{id:event.id,description:draft.description,organiser:draft.organiser,location:draft.location,
        eventGroupId:draft.eventGroupId||null,brandingTemplate:draft.brandingTemplate,branding:draft.branding,allowExistingName:!!draft.allowExistingName});
      // Do not report success when the deployed backend ignores the new metadata.
      const check=await api('events/'+encodeURIComponent(event.id));
      const e=check.event||{};
      if(['description','organiser','location','brandingTemplate','eventGroupId'].some(key=>(e[key]||'')!==String(draft[key]||'').trim())
        ||Object.keys(DEFAULT_BRANDING).some(key=>e.branding?.[key]!==draft.branding[key])
        ||e.allowExistingName!==!!draft.allowExistingName){
        throw Error('Der DynoTouch-API-Server unterstützt das Speichern der Event-Daten noch nicht. Backend-Erweiterung erforderlich.');
      }
      setMessage('Event-Design und Informationen gespeichert.');
      await onSaved();
    }catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
  }
  const allPresets=[...STANDARD_TEMPLATES.map(p=>({id:p.id,name:p.name})),...presets.map(p=>({id:p.id,name:p.name+' (gespeichert)'}))];
  return <section className="card dt-editor"><h2>Event-Design und Informationen</h2><p>Gleiches Branding wie bei den DynoForce-Challenges: Banner, Logos, Sponsor, Primärfarbe und vorhandene Hallenvorlagen.</p>
    <div className="dt-editor-grid"><label>Veranstalter<input value={draft.organiser} onChange={e=>change('organiser',e.target.value)}/></label><label>Ort<input value={draft.location} onChange={e=>change('location',e.target.value)}/></label></div>
    <label>Beschreibung<textarea value={draft.description} onChange={e=>change('description',e.target.value)} rows={3}/></label>
    <label>Gemeinsame Event-ID (Single und Multi verbinden)<input value={draft.eventGroupId} onChange={e=>change('eventGroupId',e.target.value)} placeholder="z. B. kraftreaktor-2026"/></label>
    <label>Branding-Vorlage
      <select value="" onChange={e=>applyPreset(e.target.value)}><option value="">Vorlage auswählen ...</option>{allPresets.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
    </label>
    <div className="dt-editor-grid">{([['headerBanner','Header-Banner'],['eventLogo','Eventlogo'],['venueLogo','Hallenlogo'],['sponsorBanner','Sponsor-Banner']] as const).map(([field,label])=><label key={field}>{label}
      <input value={draft.branding[field]||''} onChange={e=>changeBranding(field,e.target.value)} placeholder="Bild-URL"/>
      <input type="file" accept="image/*" onChange={e=>upload(field,e.target.files?.[0])}/>
    </label>)}</div>
    <label className="check"><input type="checkbox" checked={!!draft.branding.showVenueLogo} onChange={e=>changeBranding('showVenueLogo',e.target.checked)}/>Hallenlogo anzeigen</label>
    <label>Primärfarbe <input type="color" value={draft.branding.primaryColor||'#1f4f46'} onChange={e=>changeBranding('primaryColor',e.target.value)}/></label>
    <label className="check"><input type="checkbox" checked={!!draft.allowExistingName} onChange={e=>change('allowExistingName',e.target.checked)}/>Bestehende Namen nach Bestätigung erneut verwenden (bester Versuch zählt)</label>
    <div className="dt-editor-preview"><EventHero event={{...event,...draft}}/></div>
    {message&&<div className="notice" role="status">{message}</div>}
    <button className="primary" disabled={busy} onClick={save}>{busy?'Speichert …':'Event-Design speichern'}</button>
  </section>;
}

function ClaimForm({data,id}:{data:Any;id:string}){
  const eventId=String(data.eventId||'');
  // Only a display preference is kept locally. Consent, tokens and scores are never stored.
  function claimStorage(){try{return window.localStorage;}catch{return null;}}
  const [profile,setProfile]=useState<Any|null>(()=>readParticipantProfile(claimStorage(),eventId));
  const [name,setName]=useState(()=>profile?.name||'');
  const [category,setCategory]=useState(()=>profile?.category||'');
  const [consent,setConsent]=useState(false);
  // Optimized backend: GET /claim/:token can deliver this index with the QR data.
  const providedNames=Array.isArray(data.nameIndex)?data.nameIndex:null;
  const [known,setKnown]=useState<Set<string>|null>(()=>providedNames?knownNames(providedNames):null);
  const [checking,setChecking]=useState(!providedNames);
  const [lookupError,setLookupError]=useState('');
  const [allowReuse,setAllowReuse]=useState(data.allowExistingName!==false);
  const [discipline,setDiscipline]=useState('dieser Disziplin');
  const [confirmedFor,setConfirmedFor]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  useEffect(()=>{
    let alive=true;
    setLookupError('');
    if(providedNames){
      // One response, instant lookup: avoids all additional network roundtrips.
      setKnown(knownNames(providedNames));
      setAllowReuse(data.allowExistingName!==false);
      setChecking(false);
      return;
    }
    setKnown(null);setChecking(true);
    // Fetch once in the background while the participant types, not on every keystroke.
    // Reuse the selected event's first page and fetch all pages so even rank 101+ is checked.
    (async()=>{
      const [detail,listing]=await Promise.all([
        api('events/'+encodeURIComponent(eventId)),
        api('events').catch(()=>null)
      ]);
      const selected=detail?.event;
      if(!selected)throw Error('Event konnte nicht geladen werden.');
      if(alive)setDiscipline(modeOf(selected)==='multi'?'Multi Target':'Single Target');
      const all=Array.isArray(listing)?listing:[];
      const matching=all.filter((other:Any)=>competitionKey(other)===competitionKey(selected));
      const members=matching.some((event:Any)=>String(event.id)===eventId)?matching:[selected,...matching];
      const batches=await Promise.all(members.map((event:Any)=>
        fetchAllEntries(event,String(event.id)===eventId&&Array.isArray(detail.entries)?detail.entries:undefined)));
      if(!alive)return;
      setKnown(knownNames(batches.flat()));
      setAllowReuse(selected.allowExistingName!==false);
    })().catch(e=>{
      if(!alive)return;
      // Never claim a name is available if the check failed.
      setKnown(new Set());
      setLookupError((e as Error).message);
    }).finally(()=>{if(alive)setChecking(false);});
    return()=>{alive=false;};
  },[eventId]);

  const status=nameCheckState({name,category,known,profile,loading:checking,error:!!lookupError,allowReuse});
  const lookupKey=category+'|'+normalizeParticipantName(name);
  const confirmed=confirmedFor===lookupKey;
  const ready=status==='available'||status==='returning'||
    ((status==='duplicate'||status==='unverified')&&confirmed);

  async function save(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(busy||!consent||!ready)return;
    setBusy(true);setError('');
    try{
      const cleanName=name.trim().replace(/\s+/g,' ');
      // All runs are immutable. The existing leaderboard groups identical names
      // *within the same discipline and category* to show only the best result.
      const confirmExistingName=status==='returning'||confirmed;
      const result=await api('claim/'+encodeURIComponent(id),'POST',{name:cleanName,consent,category,confirmExistingName});
      saveParticipantProfile(claimStorage(),eventId,cleanName,category);
      setProfile({eventId,name:cleanName,category});
      window.location.hash='/dynotouch/e/'+encodeURIComponent(result.eventId||eventId);
    }catch(err){
      const failure=err as Error & {data?:Any};
      if(['NAME_CONFIRMATION_REQUIRED','NAME_TAKEN'].includes(failure.data?.code)){
        setKnown(knownNames(failure.data?.nameIndex));setAllowReuse(failure.data?.allowExistingName!==false);
        setChecking(false);setLookupError('');setConfirmedFor('');
      }
      setError(failure.message);
    }
    finally{setBusy(false);}
  }

  return <section className="claim card">
    <div className="eyebrow">{data.eventName}</div><h1 className="compact">Dein Ergebnis</h1>
    <div className="result"><strong>{data.score}</strong><span>PUNKTE · {seconds(data.durationMs)}</span></div>
    {data.claimed?<div className="notice">Dieses Ergebnis wurde bereits eingetragen. Für einen weiteren Versuch scanne einen neuen QR-Code.</div>
      :data.expired?<div className="notice">Der QR-Code ist abgelaufen. Du kannst erneut spielen.</div>
      :<form onSubmit={save}>
        {profile&&<div className="dt-returning-hint"><span>Angaben vom letzten Versuch auf diesem Natel übernommen.</span><button type="button" onClick={()=>{
          clearParticipantProfile(claimStorage(),eventId);setProfile(null);setName('');setCategory('');setConfirmedFor('');
          document.getElementById('player')?.focus();
        }}>Anderer Teilnehmer</button></div>}
        <label htmlFor="player">Dein Anzeigename</label>
        <input id="player" value={name} onChange={e=>setName(e.target.value)} maxLength={32} minLength={2} autoComplete="nickname" placeholder="z. B. Alex" required/>
        <fieldset className="dt-category"><legend>Kategorie auswählen (Pflichtfeld)</legend>
          {CATEGORIES.map(c=><label key={c.key}><input type="radio" name="category" value={c.key} checked={category===c.key} onChange={()=>setCategory(c.key)} required/>{c.label}</label>)}
        </fieldset>
        <div className="dt-name-check" role="status" aria-live="polite">
          {status==='checking'&&<span className="dt-name-neutral">Namen werden geladen – die Prüfung reagiert anschliessend sofort beim Tippen.</span>}
          {status==='available'&&<span className="dt-name-success">✓ Name verfügbar</span>}
          {status==='returning'&&<span className="dt-name-success">✓ Dein bisheriger Name ist auf diesem Natel gespeichert. Keine erneute Bestätigung nötig.</span>}
          {status==='blocked'&&<span className="dt-name-warning">Dieser Name ist in dieser Disziplin und Kategorie bereits belegt. Der Veranstalter hat die Wiederverwendung deaktiviert. Bitte einen anderen Namen wählen.</span>}
          {status==='duplicate'&&<div className="dt-name-conflict">
            <strong>Dieser Name ist bereits vorhanden!</strong>
            <p>In {discipline} und dieser Kategorie gibt es bereits ein Ergebnis mit diesem Namen. Bist du dieselbe Person?</p>
            {confirmed?<div className="dt-name-success">✓ Bestätigt. Der neue Versuch wird mit diesem Namen gewertet; der bessere Wert zählt.</div>
              :<div className="dt-name-actions">
                <button type="button" onClick={()=>setConfirmedFor(lookupKey)}>Ja, das bin ich</button>
                <button type="button" onClick={()=>{setName('');document.getElementById('player')?.focus();}}>Nein, anderer Name</button>
              </div>}
          </div>}
          {status==='unverified'&&<div className="dt-name-conflict">
            <strong>Namensprüfung gerade nicht verfügbar</strong>
            <p>Die Rangliste konnte nicht geladen werden. Bitte prüfe selbst, ob du deinen bisherigen Namen verwenden möchtest.</p>
            {confirmed?<div className="dt-name-warning">Du hast das Speichern ohne Namensprüfung bestätigt.</div>
              :<button type="button" onClick={()=>setConfirmedFor(lookupKey)}>Trotzdem mit diesem Namen fortfahren</button>}
          </div>}
        </div>
        <label className="check"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} required/>
          <span>Mein Anzeigename, Kategorie, Punkte und Spieldauer dürfen in der öffentlichen Rangliste erscheinen. Ich kann einen Spitznamen verwenden.</span></label>
        <button disabled={busy||!consent||!ready} className="primary">{busy?'Wird gespeichert …':'Ergebnis speichern →'}</button>
        <p className="small">{allowReuse?'Spiele so oft du möchtest. Verwende immer denselben Namen – nur dein bestes Ergebnis zählt.':'Spiele so oft du möchtest. Für jeden Versuch ist in dieser Disziplin und Kategorie ein neuer Anzeigename erforderlich.'}</p>
        {error&&<div className="notice error" role="alert">{error}</div>}
      </form>}
    <a className="text-link" href={'#/dynotouch/e/'+encodeURIComponent(eventId)}>Zur Rangliste →</a>
  </section>;
}

export default function EventClient({kind,id='',signedIn=false}:{kind:'home'|'event'|'claim'|'admin'|'manage';id?:string;signedIn?:boolean}){
  const [data,setData]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),
    [name,setName]=useState(''),
    [password,setPassword]=useState(''),[paired,setPaired]=useState<Any|null>(null),[activeId,setActiveId]=useState('');
  async function load(){
    try{
      const result=kind==='home'?await api('events'):kind==='claim'?await api('claim/'+encodeURIComponent(id))
        :kind==='event'?await fetchCombinedEvent(id):kind==='manage'?await api('events/'+encodeURIComponent(id)+'/manage'):await api('owner/events');
      setData(result);setError('');
    }catch(e){setError((e as Error).message);}
  }
  useEffect(()=>{
    if(kind==='admin'&&!signedIn){setData(null);return;}
    setData(null);void load();
    if(kind==='event'){const timer=setInterval(()=>void load(),15000);return()=>clearInterval(timer);}
  },[kind,id,signedIn]);
  async function action(fn:()=>Promise<void>){setBusy(true);setError('');try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  const homeEvents=Array.isArray(data)?groupEvents(data):[];
  const adminEvents=kind==='admin'&&Array.isArray(data)?data:[];
  const active=adminEvents.find((e:Any)=>e.id===(activeId||adminEvents[0]?.id));
  const group=data?.challenges||[];
  const event=data?.event||{};
  const brand=brandingFor(event);
  return <main className="dt-page" style={{'--primary':brand.primaryColor,'--primary-soft':'#e8f0ec'} as React.CSSProperties}>
    <header className="dt-header"><a href="#/" className="brand"><img src="/dynoforce-icon.png" alt="DynoForce"/><span>DYNOFORCE<span className="brand-sub">EVENTS · DYNOTOUCH</span></span></a>
      <nav className="dt-nav"><a href="#/">← Dashboard</a><a href="#/dynotouch">Alle DynoTouch Events</a>{kind==='admin'?<a href="#/dynotouch">Ranglisten</a>:<a href="#/dynotouch/admin">Veranstalter</a>}</nav>
    </header>
    {error&&<div className="notice error" role="alert">{error}</div>}
    {kind==='home'&&<><div className="eyebrow">DYNOTOUCH · EVENTS</div><h1 className="compact">Events & Ranglisten</h1><p className="intro">Single Target und Multi Target gemeinsam pro Event – mit eigener Rangliste für jede Disziplin und Kategorie.</p>
      <div className="event-grid">{homeEvents.map((e:Any)=><a className="card event-card" key={eventGroupKey(e)} href={'#/dynotouch/e/'+encodeURIComponent(e.children[0].id)}>
        <div className="dt-card-banner">{brandingFor(e).headerBanner&&<img src={brandingFor(e).headerBanner} alt="Eventbanner"/>}</div>
        <div className="eyebrow">{Date.now()<e.starts?'DEMNÄCHST':Date.now()<e.ends?'EVENT AKTIV':'ABGESCHLOSSEN'}</div><h2>{e.name}</h2>
        <p>{date(e.starts)} – {date(e.ends)}</p><div className="chips">{e.children.map((child:Any)=><span key={child.id}>{modeOf(child)==='multi'?'Multi Target':'Single Target'}</span>)}</div><span className="text-link">Alle Ranglisten ansehen →</span>
      </a>)}</div>
      {data&&homeEvents.length===0&&<div className="card empty"><h2>Noch keine DynoTouch Events</h2><p>Events werden im DynoTouch-Webportal erstellt und anschliessend hier angezeigt.</p></div>}
    </>}
    {kind==='claim'&&data&&<ClaimForm key={id} data={data} id={id}/>}
    {kind==='event'&&data&&<><EventHero event={event}/>
      <div className="grid two public-summary-grid dt-summary">
        <div className="card compact-public-card event-info-card"><div className="card-header"><div><h3>{event.name}</h3><p>{date(event.starts)} – {date(event.ends)}</p></div></div>
          <div className="metric-list compact"><div className="metric-line"><span>Veranstalter</span><strong>{event.organiser||'DynoForce'}</strong></div>{event.location&&<div className="metric-line"><span>Ort</span><strong>{event.location}</strong></div>}
          <div className="metric-line"><span>Beschreibung</span><strong>{event.description||'Reaktionschallenge mit DynoTouch.'}</strong></div></div></div>
        <div className="card compact-public-card event-stats-card"><div className="card-header"><div><h3>Event-Statistik</h3><p>Live · aktualisiert alle 15 Sekunden</p></div></div>
          <div className="metric-list compact"><div className="metric-line"><span>Disziplinen</span><strong>{group.length}</strong></div>
            <div className="metric-line"><span>Ergebnisse</span><strong>{group.reduce((sum:number,c:Any)=>sum+c.entries.length,0)}</strong></div>
            <div className="metric-line"><span>Wertung</span><strong>Beste Punktzahl, dann kürzere Zeit</strong></div></div></div>
      </div>
      <div className="card public-leaderboard-card dt-leaderboard"><div className="card-header"><div><h3>Komplette Ranglisten</h3><p>Single Target und Multi Target · getrennt nach Mann, Frau und Jugendlichen unter 16 Jahren.</p></div></div>
        <Leaderboards challenges={group}/></div>
      {brand.sponsorBanner&&<footer className="brand-sponsor-footer" aria-label="Event Partner"><div className="brand-sponsor-footer-frame"><img className="brand-hero-sponsor" src={brand.sponsorBanner} alt="Sponsor-Banner"/></div></footer>}
      <div className="dt-page-links"><a className="text-link" href="#/dynotouch">← Alle DynoTouch Events</a><a className="quiet-link" href={'#/dynotouch/e/'+id+'/manage'}>Event verwalten</a></div>
    </>}
    {kind==='admin'&&<><div className="eyebrow">FÜR VERANSTALTER</div><h1 className="compact">DynoTouch verwalten</h1>
      {!signedIn?<section className="card"><p>Melde dich mit dem bestehenden DynoForce-Eventkonto an, um ein Board zu koppeln und das Branding zu bearbeiten.</p><a className="primary" href="#/">Zum Login im Dashboard →</a></section>:<>
      <section className="card"><h2>Board koppeln</h2><p>Geräteschlüssel einmalig erstellen und unter DynoTouch → Settings → Events hinterlegen.</p>
        <form className="inline-form" onSubmit={e=>{e.preventDefault();action(async()=>{setPaired(await api('owner/devices','POST',{name}));setName('');});}}><input aria-label="Gerätename" value={name} onChange={e=>setName(e.target.value)} placeholder="Boardname" required maxLength={60}/><button className="primary" disabled={busy}>Schlüssel erstellen</button></form>
        {paired&&<div className="notice"><strong>{paired.name} – einmaliger Geräteschlüssel</strong><code className="secret">{paired.key}</code><p className="small">Nur ins eigene DynoTouch-Webportal kopieren. Nicht öffentlich teilen.</p></div>}</section>
      <section className="card"><h2>Deine Events</h2><p>Events und Regeln werden weiterhin im DynoTouch-Webportal erstellt. Hier bearbeitest du Darstellung und Eventinformationen.</p>
        {adminEvents.map((e:Any)=><div className="admin-event" key={e.id}><div><a href={'#/dynotouch/e/'+e.id}><strong>{e.name}</strong></a><p className="small">{date(e.starts)} – {date(e.ends)} · {modeOf(e)==='multi'?'Multi Target':'Single Target'}</p></div>
          <div className="actions"><button onClick={()=>setActiveId(e.id)}>Design bearbeiten</button><a href={'#/dynotouch/e/'+e.id+'/manage'}>Moderieren</a><button disabled={busy} onClick={()=>action(async()=>{await api('owner/events','PATCH',{id:e.id,enabled:!e.enabled});await load();})}>{e.enabled?'Deaktivieren':'Aktivieren'}</button></div></div>)}
        {adminEvents.length===0&&<p>Noch keine Events erstellt.</p>}
      </section>
      {active&&<EventSettings key={active.id} event={active} onSaved={load}/>}
      </>}
    </>}
    {kind==='manage'&&<><div className="eyebrow">GESCHÜTZTE EVENT-VERWALTUNG</div><h1 className="compact">Namen & Einträge</h1>
      {!data?<section className="card"><p>Verwende das Moderationspasswort des Events oder melde dich als Veranstalter an.</p><form onSubmit={e=>{e.preventDefault();action(async()=>{await api('events/'+id+'/login','POST',{password});setPassword('');await load();});}}><label htmlFor="event-password">Event-Passwort</label><input id="event-password" type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" required/><button className="primary" disabled={busy}>Anmelden</button></form><a className="text-link" href="#/">Als Veranstalter anmelden →</a></section>:<section className="card"><h2>{data.event.name}</h2><p>Umbenennen und Ausblenden werden protokolliert. Ein verwendeter QR-Code bleibt gesperrt.</p>{data.entries.map((r:Any)=><ModerationRow key={r.id} run={r} busy={busy} save={(changes:Any)=>action(async()=>{await api('events/'+id+'/manage','PATCH',{id:r.id,...changes});await load();})}/>)}{!data.entries.length&&<p>Noch keine eingetragenen Namen.</p>}</section>}
      <a className="text-link" href={'#/dynotouch/e/'+id}>← Zur öffentlichen Rangliste</a>
    </>}
    {!data&&kind!=='admin'&&!error&&<p className="loading">Wird geladen …</p>}
    <footer className="dt-footer">DYNOFORCE · DYNOTOUCH<span>Präzise Runs. Echte Ergebnisse.</span></footer>
  </main>;
}
function ModerationRow({run,busy,save}:{run:Any;busy:boolean;save:(changes:Any)=>void}){
  const [name,setName]=useState(run.name);
  const [category,setCategory]=useState(categoryOf(run));
  return <div className="moderation-row"><div><strong>{run.score} Punkte</strong><span className="small"> · {seconds(run.duration)}</span>{run.hidden===1&&<span className="badge">Ausgeblendet</span>}</div><div className="inline-form"><input aria-label="Anzeigename bearbeiten" maxLength={32} value={name} onChange={e=>setName(e.target.value)}/><select aria-label="Kategorie korrigieren" value={CATEGORIES.some(c=>c.key===category)?category:''} onChange={e=>setCategory(e.target.value)} required><option value="" disabled>Kategorie auswählen</option>{CATEGORIES.map(c=><option key={c.key} value={c.key}>{c.label}</option>)}</select><button disabled={busy||!CATEGORIES.some(c=>c.key===category)||(name===run.name&&category===categoryOf(run))} onClick={()=>save({name,category})}>Speichern</button><button disabled={busy} onClick={()=>save({hidden:!run.hidden})}>{run.hidden?'Einblenden':'Ausblenden'}</button></div></div>;
}
