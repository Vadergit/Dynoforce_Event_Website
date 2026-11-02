import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('DynoTouch lives in its own route without replacing existing event pages',()=>{
  const main=read('app/main.js');
  assert.match(main,/segments\[0\]\s*===?\s*['"]dynotouch['"]/);
  for(const page of ['dashboard','setup','branding','live','games','public','display'])assert.match(main,new RegExp(page+':'));
  assert.match(main,/cleanupDynoTouch\(\)/);
});
test('organizer reuses Firebase identity and never asks for ChatGPT login',()=>{
  const client=read('app/dynotouch/event-client.tsx');
  assert.match(client,/auth.currentUser.getIdToken\(\)/);
  assert.match(client,/X-Event-Session/);
  assert.doesNotMatch(client,/auth\.openai|ChatGPT|localStorage/);
  assert.match(client,/JSON.stringify\(body\)/);
});
test('public claim sends nickname and consent, not editable scores',()=>{
  const client=read('app/dynotouch/event-client.tsx');
  assert.match(client,/'claim\/'.*'POST',\{name,consent\}/);
  assert.match(client,/data.claimed/);
  assert.match(client,/data.expired/);
  assert.match(client,/\/dynoforce-icon.png/);
});
