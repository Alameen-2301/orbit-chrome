import test from 'node:test';
import assert from 'node:assert/strict';
import {storageArea} from './helpers.js';
import {secureStorage, saveConnection, loadSecrets, deleteConnection} from '../extension/lib/storage.js';

test('keys are session-only by default and never appear in profile configuration', async () => {
  globalThis.chrome={storage:{session:storageArea(),local:storageArea()}};
  await secureStorage();
  const profile={id:'p1',name:'test',remember:false};const secrets={apiKey:'private-key',extraHeaders:{'X-Secret':'private-header'}};
  await saveConnection(profile,secrets,[],{maxSteps:16});
  assert.equal(chrome.storage.local.access,'TRUSTED_CONTEXTS');assert.equal(chrome.storage.session.access,'TRUSTED_CONTEXTS');
  assert.deepEqual(await loadSecrets('p1'),secrets);
  assert.ok(!JSON.stringify(chrome.storage.local.values).includes('private-key'));
  assert.ok(!JSON.stringify(chrome.storage.local.values).includes('private-header'));
});

test('opting into persistent credentials and back removes the previous copy', async () => {
  globalThis.chrome={storage:{session:storageArea(),local:storageArea()}};
  let profiles=await saveConnection({id:'p1',remember:false},{apiKey:'key'},[],{});
  profiles=await saveConnection({id:'p1',remember:true},{apiKey:'key'},profiles,{});
  assert.equal(chrome.storage.session.values['credentials:p1'],undefined);
  assert.equal(chrome.storage.local.values['credentials:p1'].apiKey,'key');
  profiles=await saveConnection({id:'p1',remember:false},{apiKey:'new-key'},profiles,{});
  assert.equal(chrome.storage.local.values['credentials:p1'],undefined);
  assert.equal(chrome.storage.session.values['credentials:p1'].apiKey,'new-key');
  assert.equal(profiles.length,1);
});

test('deleting a connection clears both credential stores and keeps other profiles', async () => {
  globalThis.chrome={storage:{session:storageArea({'credentials:p1':{apiKey:'key'}}),local:storageArea({'credentials:p1':{apiKey:'old-key'}})}};
  const next=await deleteConnection('p1',[{id:'p1'},{id:'p2'}]);
  assert.deepEqual(next,[{id:'p2'}]);assert.equal(chrome.storage.local.values['credentials:p1'],undefined);assert.equal(chrome.storage.session.values['credentials:p1'],undefined);
  assert.equal(chrome.storage.local.values['orbit-selected'],'p2');
});
