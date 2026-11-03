import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CATEGORIES,categoryOf,eventGroupKey,groupEvents,groupRankings} from '../app/dynotouch/rankings.js';
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
  assert.doesNotMatch(client,/auth\.openai|ChatGPT|localStorage/);
  assert.match(client,/collection\(db,'brandingPresets'\)/);
  assert.match(client,/getDownloadURL/);
  for(const venue of ['bouba-baden','kraftreaktor-lenzburg-aarau','mito-zuerich','minimum-zuerich','grindelboulder-bassersdorf','boulderlounge-schlieren'])assert.ok(client.includes(venue));
});

test('claim requires one of the three competition categories',()=>{
  const client=read('app/dynotouch/event-client.tsx');
  assert.match(client,/'claim\/'.*'POST',\{name,consent,category\}/);
  assert.match(client,/type="radio" name="category"/);
  assert.match(client,/!consent\|\|!category/);
  assert.match(client,/data.claimed/);
  assert.match(client,/data.expired/);
  assert.match(client,/Ergebnis speichern/);
  assert.match(client,/Spiele so oft du möchtest/);
  assert.match(client,/nur dein bestes Ergebnis zählt/);
  assert.doesNotMatch(client,/Einmalig eintragen|Korrekturen sind danach nur durch den Veranstalter möglich/);
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
});

test('categories are explicit; legacy runs without a category remain unknown',()=>{
  assert.deepEqual(CATEGORIES.slice(0,3).map(c=>c.key),['male','female','youth']);
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
});
