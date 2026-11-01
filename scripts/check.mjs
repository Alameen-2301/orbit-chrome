import {readFile,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
const ext=path.join(root,'extension');
async function files(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);out.push(...(e.isDirectory()?await files(p):[p]));}return out;}
const manifest=JSON.parse(await readFile(path.join(ext,'manifest.json'),'utf8'));
assert.equal(manifest.manifest_version,3);
assert.ok(!manifest.host_permissions?.length,'Website access must be optional.');
assert.ok(!manifest.permissions.includes('debugger'));
const html=await readFile(path.join(ext,'sidepanel.html'),'utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size,'Duplicate HTML IDs.');
const ui=await readFile(path.join(ext,'sidepanel.js'),'utf8');
for(const match of ui.matchAll(/\$\('([^']+)'\)/g))assert.ok(ids.includes(match[1]),`Missing HTML ID ${match[1]}`);
for(const match of html.matchAll(/(?:src|href)="([^"#][^"]+)"/g)){
  assert.ok(!/^https?:/.test(match[1]),'No remote resources allowed.');await readFile(path.join(ext,match[1]));
}
for(const file of await files(ext)){
  if(!file.endsWith('.js'))continue;
  const source=await readFile(file,'utf8');assert.ok(!/\beval\s*\(|new\s+Function\s*\(/.test(source),'No arbitrary code execution.');
  assert.ok(!source.includes('.innerHTML'),'Use safe text rendering.');
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  for(const match of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g))await readFile(path.resolve(path.dirname(file),match[1]));
}
for(const icon of Object.values(manifest.icons)){
  const bytes=await readFile(path.join(ext,icon));assert.equal(bytes.subarray(1,4).toString(),'PNG');
}
console.log('Manifest, icons, module imports, DOM bindings, resource isolation, and JavaScript syntax passed.');
