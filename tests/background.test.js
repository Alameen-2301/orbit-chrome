import test from 'node:test';
import assert from 'node:assert/strict';
import {storageArea} from './helpers.js';

test('background broker protects browser actions and approvals', async t => {
  let listener,performed=0,injections=0,hasPermission=true;
  const tabs=new Map([[12,{id:12,windowId:1,url:'https://example.test/form',title:'Form',status:'complete'}],[13,{id:13,windowId:2,url:'https://example.test/other',title:'Other',status:'complete'}]]);
  const sender={id:'orbit-test',url:'chrome-extension://orbit-test/sidepanel.html',documentId:'panel-a'};
  const context={runId:'test-run',windowId:1,pageLimit:18000};
  const target='12345678-abcd-1234-abcd-123456789abc:1';
  globalThis.chrome={
    storage:{local:storageArea(),session:storageArea()},
    runtime:{id:'orbit-test',getURL:path=>'chrome-extension://orbit-test/'+path,getManifest:()=>({version:'1.0.0'}),onMessage:{addListener:fn=>{listener=fn;}}},
    sidePanel:{setPanelBehavior:async()=>{}},permissions:{contains:async()=>hasPermission},
    scripting:{executeScript:async()=>{injections++;}},
    tabs:{get:async id=>{if(!tabs.has(id))throw new Error('Missing tab');return {...tabs.get(id)};},query:async ({windowId})=>[...tabs.values()].filter(tab=>tab.windowId===windowId),
      sendMessage:async(id,message)=>{
        if(message.command==='inspect')return {ok:true,result:{url:tabs.get(id).url,documentId:'doc-a',fingerprint:'unchanged',element:{target,sensitive:false,label:'Send'}}};
        if(message.command==='perform'){performed++;return {ok:true,result:{performed:'clicked',expected:message.expected}};}
        return {ok:true,result:{text:'Visible page',url:tabs.get(id).url}};
      },
      create:async options=>{performed++;const tab={id:99,status:'complete',...options};tabs.set(99,tab);return tab;},
      update:async(id,options)=>{performed++;Object.assign(tabs.get(id),options);return tabs.get(id);},
      remove:async id=>{performed++;tabs.delete(id);},
    },
  };
  await import('../extension/background.js?broker-tests');
  const call=(type,body={},from=sender)=>new Promise(resolve=>listener({type,...body},from,resolve));
  const prepare=()=>call('PREPARE_ACTION',{action:{tool:'click',args:{tabId:12,target}},context});

  await t.test('rejects messages from a website content script',async()=>{
    const result=await call('READ_TOOL',{action:{tool:'list_tabs',args:{}},context},{id:'orbit-test',url:'https://example.test/form',documentId:'page'});
    assert.equal(result.ok,false);assert.match(result.error,/Only the Orbit/);
  });
  await t.test('denies direct unapproved writes',async()=>{
    const result=await call('READ_TOOL',{action:{tool:'click',args:{tabId:12,target}},context});assert.equal(result.ok,false);assert.equal(performed,0);
  });
  await t.test('rejects tabs in a different window',async()=>{
    const result=await call('READ_TOOL',{action:{tool:'read_page',args:{tabId:13}},context});assert.equal(result.ok,false);assert.match(result.error,/another window/);
  });
  await t.test('missing host access returns a permission request without injection',async()=>{
    hasPermission=false;const before=injections;
    const result=await call('READ_TOOL',{action:{tool:'read_page',args:{tabId:12}},context});
    assert.equal(result.code,'HOST_PERMISSION');assert.equal(result.origin,'https://example.test/*');assert.equal(injections,before);hasPermission=true;
  });
  await t.test('preview causes no effect; an approval runs exactly once even under simultaneous replay',async()=>{
    const prepared=await prepare();assert.equal(prepared.ok,true);assert.equal(performed,0);
    assert.equal(prepared.result.preview.observed.element.label,'Send');
    const results=await Promise.all([call('EXECUTE_APPROVED',{token:prepared.result.token}),call('EXECUTE_APPROVED',{token:prepared.result.token})]);
    assert.equal(results.filter(r=>r.ok).length,1);assert.equal(performed,1);
    assert.equal(results.find(r=>r.ok).result.expected.fingerprint,'unchanged');
  });
  await t.test('navigation between preview and approval prevents the effect',async()=>{
    const prepared=await prepare();const before=performed;tabs.get(12).url='https://example.test/new';
    const result=await call('EXECUTE_APPROVED',{token:prepared.result.token});assert.equal(result.ok,false);assert.match(result.error,/navigated/);assert.equal(performed,before);tabs.get(12).url='https://example.test/form';
  });
  await t.test('expired approvals and approvals from a different panel are rejected',async()=>{
    let prepared=await prepare();const key='approval:'+prepared.result.token;chrome.storage.session.values[key].expires=Date.now()-1;
    assert.match((await call('EXECUTE_APPROVED',{token:prepared.result.token})).error,/expired/);
    prepared=await prepare();assert.match((await call('EXECUTE_APPROVED',{token:prepared.result.token},{...sender,documentId:'panel-b'})).error,/different panel/);
  });
  await t.test('declining invalidates the token',async()=>{
    const prepared=await prepare();const before=performed;
    await call('DISCARD_APPROVAL',{token:prepared.result.token});assert.equal((await call('EXECUTE_APPROVED',{token:prepared.result.token})).ok,false);assert.equal(performed,before);
  });
  await t.test('Stop cancels pending approvals and blocks more operations in that run',async()=>{
    const prepared=await prepare();const before=performed;await call('CANCEL_RUN',{runId:context.runId});
    assert.equal((await call('EXECUTE_APPROVED',{token:prepared.result.token})).ok,false);
    assert.equal((await prepare()).code,'CANCELLED');assert.equal(performed,before);
  });
});
