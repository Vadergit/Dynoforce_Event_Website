import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CATEGORIES,categoryOf,eventGroupKey,groupEvents,groupRankings,demoTemplateId,medalForRank} from '../app/dynotouch/rankings.js';
import {normalizeParticipantName,competitionKey,knownNames,nameCheckState,readParticipantProfile,saveParticipantProfile,clearParticipantProfile} from '../app/dynotouch/claim-names.js';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('DynoTouch retains isolated routing and a dashboard return link',()=>{
  const main=read('app/main.js');
  const client=read('app/dynotouch/event-client.tsx');
  assert.match(main,/segments\[0\]\s*===?\s*['"]dynotouch['"]/);
  for(const page of ['dashboard','setup','branding','live','games','public','display'])assert.match(main,new RegExp(page+':'));
  assert.match(main,/cleanupDynoTouch\(\)/);
  assert.match(client,/href="#\/".*Dashboard/);
  assert.match(client,/Alle DynoTouch Events/);
});

test('organizer retains Firebase identity, existing presets, and approved uploads',()=>{
  const client=read('app/dynotouch/event-client.tsx');
  assert.match(client,/auth.currentUser.getIdToken\(\)/);
  assert.match(client,/X-Event-Session/);
  assert.doesNotMatch(client,/auth\.openai|ChatGPT|moderatorSession.*localStorage/);
  assert.match(client,/collection\(db,'brandingPresets'\)/);
  assert.match(client,/getDownloadURL/);
  for(const venue of ['bouba-baden','kraftreaktor-lenzburg-aarau','mito-zuerich','minimum-zuerich','grindelboulder-bassersdorf','boulderlounge-schlieren'])assert.ok(client.includes(venue));
});

test('claim requires one of the three competition categories',()=>{
  const client=read('app/dynotouch/event-client.tsx');
  assert.match(client,/'claim\/'.*'POST',\{name:cleanName,consent,category\}/);
  assert.match(client,/type="radio" name="category"/);
  assert.match(client,/!consent\|\|!ready/);
  assert.match(client,/data.claimed/);
  assert.match(client,/data.expired/);
  assert.match(client,/Ergebnis speichern/);
  assert.match(client,/Spiele so oft du möchtest/);
  assert.match(client,/nur dein bestes Ergebnis zählt/);
  assert.doesNotMatch(client,/Einmalig eintragen|Korrekturen sind danach nur durch den Veranstalter möglich/);
  assert.doesNotMatch(client,/Ohne Kategorie speichern|legacyClaimAvailable/);
  assert.match(client,/Kategorie korrigieren/);
});

test('single and multi target share an event when name and day match',()=>{
  const basic={name:'Kraftreaktor Challenge',starts:1793718000000,ends:1793757600000};
  const single={...basic,id:'one',rules:{mode:'single',targetMs:5000,mask:7}};
  const multi={...basic,id:'two',rules:{mode:'multi',targetMs:5000,mask:7}};
  assert.equal(eventGroupKey(single),eventGroupKey(multi));
  const groups=groupEvents([single,multi]);
  assert.equal(groups.length,1);
  assert.equal(groups[0].children.length,2);
});

test('explicit event group ID takes precedence and does not mix unrelated events',()=>{
  const first={id:'one',name:'A',groupId:'challenge-x',rules:{mode:'single'}};
  const second={id:'two',name:'B',eventGroupId:'challenge-x',rules:{mode:'multi'}};
  const unrelated={id:'three',name:'C',groupId:'challenge-y'};
  assert.equal(groupEvents([first,second,unrelated]).length,2);
  assert.equal(groupEvents([{...first,organiserScope:'one'},{...second,organiserScope:'two'}]).length,2);
});

test('categories are explicit; legacy runs without a category remain unknown',()=>{
  assert.deepEqual(CATEGORIES.map(c=>c.key),['male','female','youth']);
  assert.equal(categoryOf({category:'u16'}),'youth');
  assert.equal(categoryOf({gender:'female'}),'female');
  assert.equal(categoryOf({name:'Alex'}),'unknown');
});

test('leaderboard ranks are per discipline and category, with shared ranks on ties',()=>{
  const single={id:'single',rules:{mode:'single',mask:31,targetMs:5000}};
  const multi={id:'multi',rules:{mode:'multi',mask:31,targetMs:5000}};
  const rankings=groupRankings([
    {event:single,entries:[
      {id:'a',name:'Alice',category:'female',score:8,duration:3000},
      {id:'b',name:'Bea',category:'female',score:8,duration:3000},
      {id:'c',name:'Cora',category:'female',score:7,duration:1000},
      {id:'d',name:'Junior',category:'youth',score:20,duration:2000}
    ]},
    {event:multi,entries:[{id:'e',name:'Alex',category:'male',score:4,duration:1000}]}
  ]);
  assert.equal(rankings.length,2);
  const female=rankings.find(r=>r.mode==='single').sections.find(c=>c.key==='female');
  assert.deepEqual(female.entries.map(e=>e.rank),[1,1,3]);
  assert.equal(rankings.find(r=>r.mode==='single').sections.find(c=>c.key==='youth').entries.length,1);
  assert.equal(rankings.find(r=>r.mode==='multi').sections.find(c=>c.key==='male').entries[0].rank,1);
});
test('boards with identical rules combine while different rules remain separate',()=>{
  const event={rules:{mode:'single',mask:31,targetMs:5000}};
  assert.equal(groupRankings([{event:{...event,id:'a'},entries:[]},{event:{...event,id:'b'},entries:[]}]).length,1);
  assert.equal(groupRankings([{event:{...event,id:'a'},entries:[]},{event:{...event,id:'b',rules:{...event.rules,targetMs:3000}},entries:[]}]).length,2);
  assert.equal(groupRankings([{event:{...event,id:'a'},entries:[]},{event:{...event,id:'b',rules:{...event.rules,delayMs:1000}},entries:[]}]).length,2);
});

test('DynoTouch demo defaults to Kraftreaktor without changing regular event branding',()=>{
  assert.equal(demoTemplateId({name:'DynoTouch Demo Event'}),'kraftreaktor-lenzburg-aarau');
  assert.equal(demoTemplateId({id:'demo-single-target',name:'Example'}),'kraftreaktor-lenzburg-aarau');
  assert.equal(demoTemplateId({name:'Kraftreaktor Challenge'}),'');
  assert.equal(demoTemplateId({name:'Demo Event',brandingTemplate:'mito-zuerich'}),'');
  const client=read('app/dynotouch/event-client.tsx');
  assert.match(client,/demoTemplateId\(event\)/);
  assert.match(client,/supplied,\.\.\.presetBranding\(preset\)/);
  assert.match(client,/header:'header-banner-2400x600.jpg'/);
});


test('public DynoTouch leaderboards show the identical medals as DynoForce',()=>{
  assert.equal(medalForRank(1),'🏆');
  assert.equal(medalForRank(2),'🥈');
  assert.equal(medalForRank(3),'🥉');
  assert.equal(medalForRank(4),'4');
  const event={id:'s',rules:{mode:'single',mask:31,targetMs:1500}};
  const groups=groupRankings([{event,entries:[
    {id:'a',name:'First',category:'male',score:10,duration:1000},
    {id:'b',name:'Tied',category:'male',score:10,duration:1000},
    {id:'c',name:'Third',category:'male',score:9,duration:500},
    {id:'x',name:'Old result',score:50,duration:1000},
  ]}]);
  assert.deepEqual(groups[0].sections.map(c=>c.label),['Mann','Frau','Jugendliche unter 16']);
  assert.deepEqual(groups[0].sections[0].entries.map(row=>medalForRank(row.rank)),['🏆','🏆','🥉']);
  assert.ok(!groups[0].sections.some(c=>c.entries.some(row=>row.id==='x')));
  const client=read('app/dynotouch/event-client.tsx');
  assert.match(client,/medalForRank\(entry\.rank\)/);
  assert.doesNotMatch(client,/section\.key!=='unknown'/);
  assert.doesNotMatch(client,/Nicht zugeordnet/);
  assert.match(client,/Kategorie auswählen<\/option>/);
  const css=read('app/dynotouch/dynotouch.css');
  assert.match(css,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css,/\.dt-shell \.leaderboard-table \.rank-pill\{[^}]*width:30px;height:30px/);
});


test('live name checks do not debounce: no per-keystroke HTTP calls',()=>{
  const client=read('app/dynotouch/event-client.tsx');
  assert.match(client,/setKnown\(knownNames\(batches\.flat\(\)\)\)/);
  assert.match(client,/nameCheckState\(\{name,category,known,profile,loading:checking/);
  assert.match(client,/fetchAllEntries\(event,String\(event\.id\)===eventId/);
  assert.match(client,/competitionKey\(other\)===competitionKey\(selected\)/);
  assert.doesNotMatch(client,/setTimeout\(/);
  assert.match(client,/Ja, das bin ich/);
  assert.match(client,/Nein, anderer Name/);
  assert.match(client,/saveParticipantProfile\(claimStorage\(\),eventId,cleanName,category\)/);
  assert.match(client,/readParticipantProfile\(claimStorage\(\),eventId\)/);
  assert.match(client,/allowExistingName/);
});

test('same name belongs to a specific event, discipline, rule set and category',()=>{
  const base={name:'Demo',starts:1793718000000,ends:1793757600000};
  const single={...base,id:'single',rules:{mode:'single',mask:31,targetMs:5000}};
  const multi={...base,id:'multi',rules:{mode:'multi',mask:31,targetMs:5000}};
  const differentRule={...single,rules:{...single.rules,targetMs:2500}};
  const renamed={...single,id:'duplicate',name:'Demo'};
  assert.notEqual(competitionKey(single),competitionKey(multi));
  assert.notEqual(competitionKey(single),competitionKey(differentRule));
  assert.equal(competitionKey(single),competitionKey(renamed));
  assert.equal(normalizeParticipantName('  Älex   Müller  '),'älex müller');
  const matches=knownNames([
    {name:' Alex  Test ',category:'male'},
    {name:'Alex Test',category:'female'},
    {name:'Invisible',category:'male',hidden:1},
  ]);
  assert.equal(nameCheckState({name:'alex test',category:'male',known:matches,loading:false}),'duplicate');
  assert.equal(nameCheckState({name:'Alex Test',category:'youth',known:matches,loading:false}),'available');
  assert.equal(nameCheckState({name:'Invisible',category:'male',known:matches,loading:false}),'available');
  assert.equal(nameCheckState({name:'Alex Test',category:'male',known:null,loading:true}),'checking');
  assert.equal(nameCheckState({name:'Alex Test',category:'male',known:matches,loading:false,allowReuse:false}),'blocked');
  assert.equal(nameCheckState({name:'Someone New',category:'male',known:new Set(),loading:false,error:true}),'unverified');
});

test('a successful claim can prefill the last participant on exactly the same device and event',()=>{
  const map=new Map();
  const storage={
    getItem:key=>map.get(key)||null,
    setItem:(key,value)=>map.set(key,value),
    removeItem:key=>map.delete(key)
  };
  assert.equal(readParticipantProfile(storage,'event-single'),null);
  assert.equal(saveParticipantProfile(storage,'event-single','Dario','male'),true);
  const profile=readParticipantProfile(storage,'event-single');
  assert.deepEqual(profile,{eventId:'event-single',name:'Dario',category:'male'});
  assert.equal(readParticipantProfile(storage,'event-multi'),null);
  const matches=new Set(['male|dario']);
  assert.equal(nameCheckState({name:'Dario',category:'male',profile,known:null,loading:true}),'returning');
  assert.equal(nameCheckState({name:'Dario',category:'female',profile,known:matches,loading:false}),'available');
  assert.equal(nameCheckState({name:'Dario',category:'male',profile,known:matches,loading:false,allowReuse:false}),'blocked');
  assert.equal(nameCheckState({name:'Other',category:'male',profile,known:new Set(['male|other']),loading:false}),'duplicate');
  assert.equal(saveParticipantProfile({setItem:()=>{throw Error('Denied')}},'event','Other','male'),false);
  assert.equal(clearParticipantProfile(storage,'event-single'),true);
  assert.equal(readParticipantProfile(storage,'event-single'),null);
  assert.match(read('app/dynotouch/event-client.tsx'),/Anderer Teilnehmer/);
});

test('the optimized claim response can provide names without extra requests',()=>{
  const client=read('app/dynotouch/event-client.tsx');
  assert.match(client,/Array\.isArray\(data\.nameIndex\)\?data\.nameIndex:null/);
  assert.match(client,/if\(providedNames\)\{/);
  assert.match(client,/setKnown\(knownNames\(providedNames\)\)/);
  assert.match(client,/setChecking\(false\)/);
});
