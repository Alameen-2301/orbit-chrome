// Optional real-Chromium integration suite. No real API key or external server is used.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,cp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
let chromium;
try {({chromium}=await import('playwright'));}
catch {console.error('Optional browser suite: run npm install --no-save playwright, then npx playwright install chromium.');process.exit(1);}
const fixtureHtml=await readFile(path.join(root,'tests/fixture.html'),'utf8');
let fixtureId,mode='flow';
const requests=[];
const server=createServer(async(req,res)=>{
  if(req.method==='GET'&&req.url==='/fixture'){res.setHeader('Content-Type','text/html');res.end(fixtureHtml);return;}
  if(req.method==='POST'&&req.url==='/v1/chat/completions'){
    let body='';for await(const chunk of req)body+=chunk;
    const payload=JSON.parse(body);requests.push(payload);
    const userMessages=payload.messages.filter(m=>m.role==='user');
    const last=userMessages.at(-1)?.content || '';
    const actions=payload.messages.filter(m=>m.role==='assistant'&&m.content.includes('"action"')).length;
    const snapshots=userMessages.filter(m=>m.content.startsWith('UNTRUSTED_BROWSER_DATA'));
    let snapshot;
    for(const observation of snapshots){try{const parsed=JSON.parse(observation.content.slice(observation.content.indexOf('\n')+1));if(parsed.elements)snapshot=parsed;}catch{}}
    const target=label=>snapshot?.elements.find(e=>e.label===label||e.text===label)?.target;
    const action=(tool,args,message)=>({message,action:{tool,args}});
    let reply;
    if(mode==='decline')reply=actions===0?action('read_page',{tabId:fixtureId},'Read the practice page.'):action('fill',{tabId:fixtureId,target:target('Message'),value:'SHOULD NOT BE WRITTEN'},'Propose a change for review.');
    else if(mode==='stale'){
      if(actions===0)reply=action('read_page',{tabId:fixtureId},'Read the practice page.');
      else if(actions===1)reply=action('fill',{tabId:fixtureId,target:target('Message'),value:'STALE CHANGE'},'Review a field edit.');
      else reply={message:'The page changed. No new edit was applied.',done:true};
    }else{
      if(actions===0)reply=action('read_page',{tabId:fixtureId},'Read the form.');
      else if(actions===1)reply=action('fill',{tabId:fixtureId,target:target('Recipient'),value:'sam@example.test'},'Fill the recipient.');
      else if(actions===2)reply=action('fill',{tabId:fixtureId,target:target('Message'),value:'Hello Sam, see you tomorrow.'},'Write the message.');
      else if(actions===3)reply=action('read_page',{tabId:fixtureId},'Verify the completed draft.');
      else if(actions===4)reply=action('click',{tabId:fixtureId,target:target('Send message')},'Send the reviewed draft.');
      else if(actions===5)reply=action('read_page',{tabId:fixtureId},'Verify the result.');
      else reply={message:last.includes('Message sent to sam@example.test')?'Verified: the practice page reports the message was sent.':'Could not verify sending.',done:true};
    }
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(reply)},finish_reason:'stop'}]}));return;
  }
  res.writeHead(404);res.end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port,base=`http://localhost:${port}`;
const temp=await mkdtemp(path.join(tmpdir(),'orbit-browser-test-'));
const extension=path.join(temp,'extension');await cp(path.join(root,'extension'),extension,{recursive:true});
// Test-only copy pre-grants loopback access. Production keeps all hosts optional.
const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));manifest.host_permissions=['http://localhost/*'];
await writeFile(path.join(extension,'manifest.json'),JSON.stringify(manifest));
let context;
try{
  context=await chromium.launchPersistentContext(path.join(temp,'profile'),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
  const fixture=await context.newPage();await fixture.goto(base+'/fixture');
  const panel=await context.newPage();const errors=[];panel.on('pageerror',e=>errors.push(e.message));await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await panel.waitForFunction(()=>document.querySelector('#page-state').textContent==='Attach on send');
  fixtureId=await panel.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,base+'/fixture');
  await panel.locator('#attach-page').uncheck();await panel.locator('#open-settings').click();
  await panel.locator('#provider').selectOption('custom');await panel.locator('details.advanced summary').click();
  await panel.locator('#base-url').fill(base+'/v1');await panel.locator('#model').fill('fixture-model');await panel.locator('#auth-mode').selectOption('none');await panel.locator('#save-profile').click();
  await panel.locator('#settings-dialog').waitFor({state:'hidden'});
  await panel.locator('#prompt').fill('Fill and send the practice form.');await panel.locator('#send').click();
  for(let i=0;i<3;i++){
    await panel.locator('#approval-dialog').waitFor({state:'visible'});await panel.locator('#approve-action').click();await panel.locator('#approval-dialog').waitFor({state:'hidden'});
  }
  await panel.locator('#stop').waitFor({state:'hidden'});
  assert.match(await fixture.locator('#sent').textContent(),/sam@example.test: Hello Sam, see you tomorrow/);
  assert.match(await panel.locator('#messages').textContent(),/Verified:/);
  assert.ok(!JSON.stringify(requests).includes('fixture-password-secret'));
  assert.ok(!JSON.stringify(requests).includes('private-marker-must-not-be-read'));
  assert.ok(!JSON.stringify(requests).includes('hidden-marker-must-not-be-read'));

  mode='decline';await panel.locator('#new-chat').click();await panel.locator('#prompt').fill('Propose a field edit.');await panel.locator('#send').click();
  await panel.locator('#approval-dialog').waitFor({state:'visible'});await panel.locator('#decline-action').click();await panel.locator('#stop').waitFor({state:'hidden'});
  assert.equal(await fixture.locator('#draft').inputValue(),'Hello Sam, see you tomorrow.');
  assert.match(await panel.locator('#messages').textContent(),/Action declined/);

  mode='stale';await panel.locator('#new-chat').click();await panel.locator('#prompt').fill('Propose another edit.');await panel.locator('#send').click();await panel.locator('#approval-dialog').waitFor({state:'visible'});
  await fixture.locator('#draft').fill('Manual edit after preview');await panel.locator('#approve-action').click();await panel.locator('#stop').waitFor({state:'hidden'});
  assert.equal(await fixture.locator('#draft').inputValue(),'Manual edit after preview');
  assert.match(await panel.locator('#messages').textContent(),/page changed/);
  assert.deepEqual(errors,[]);
  console.log('Browser smoke passed: UI setup, read/fill/review/send/verify, sensitive redaction, decline, and stale-target rejection.');
}finally{await context?.close();await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true});}
