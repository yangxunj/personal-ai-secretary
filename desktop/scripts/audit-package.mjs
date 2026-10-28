#!/usr/bin/env node
// Read-only audit of the actual extracted app, not of a source checkout.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { GWS_BINARY_SHA256 } from './prepare-gws.mjs';
const {readBundledClient}=createRequire(import.meta.url)('../gmail.js');
const root=path.resolve(import.meta.dirname,'../..');
const app=path.resolve(process.argv.find(a=>a.startsWith('--app='))?.slice(6)||'desktop/dist/win-unpacked/resources/app');
assert.notEqual(app,root,'Audit the packaged app, not the checkout');
const privateValues=[];
for(const name of fs.readdirSync(root).filter(n=>n==='.env'||n.startsWith('.env.')&&n!=='.env.example')) {
  if(!fs.statSync(path.join(root,name)).isFile())continue;
  for(const [key,value] of Object.entries(parseEnv(fs.readFileSync(path.join(root,name),'utf8')))) {
    if(/KEY|SECRET|PASSPHRASE|PASSWORD_HASH/.test(key)&&value.length>=12)privateValues.push(Buffer.from(value));
  }
}
let files=0,bytes=0;
function walk(dir) {
  for(const item of fs.readdirSync(dir,{withFileTypes:true})) {
    const file=path.join(dir,item.name),relative=path.relative(app,file);
    assert.ok(!item.isSymbolicLink(),'Unexpected package link: '+relative);
    if(item.isDirectory()) {
      assert.ok(!['.git','.codex','.agents'].includes(item.name),'Private directory: '+relative);
      // SDK upload modules and compiled /api/.../data routes are code. Reject
      // actual app/runtime data roots; check credential bytes in every file.
      assert.ok(!/^(?:runtime\/)?(?:data|appdata|uploads|backups)$/.test(relative.replaceAll('\\','/')),'Private directory: '+relative);
      walk(file);
    }else {
      assert.ok(item.name!=='.env'&&!item.name.startsWith('.env.')&&!['secretary.db','credentials.enc','client_secret.json'].includes(item.name),'Private file: '+relative);
      const content=fs.readFileSync(file);files++;bytes+=content.length;
      for(const value of privateValues)assert.equal(content.includes(value),false,'Private credential found in '+relative);
    }
  }
}
walk(app);
const resources=path.join(app,'runtime/resources');
const cfg=JSON.parse(fs.readFileSync(path.join(resources,'ai.json'),'utf8'));
assert.deepEqual(cfg,{AI_BASE_URL:'https://api.deepseek.com',AI_API_KEY:'',AI_MODEL:'deepseek-flash'});
const db=new DatabaseSync(path.join(resources,'template.db'),{readOnly:true});
const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
try {
  for(const {name} of tables) {
    const count=db.prepare('SELECT COUNT(*) AS n FROM "'+name.replaceAll('"','""')+'"').get().n;
    assert.equal(count,name==='Setting'?1:0,'Unexpected template data in '+name);
  }
  assert.deepEqual(db.prepare('SELECT key,value FROM Setting').all().map(r=>({...r})),[{key:'ai.backend',value:'pi'}]);
  for(const name of ['CodexTurn','CodexToolRun','VoiceJob'])assert.ok(tables.some(t=>t.name===name),'Missing schema '+name);
  assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');
}finally{db.close();}
assert.equal(readBundledClient(path.join(resources,'gmail-oauth.json'))?.testing,true,'Missing validated Testing Desktop client');
const gws=fs.readFileSync(path.join(app,'tools/gws-0.22.5/gws.exe'));
assert.equal(createHash('sha256').update(gws).digest('hex'),GWS_BINARY_SHA256);
assert.ok(fs.existsSync(path.join(app,'tools/gws-0.22.5/LICENSE')));
const result={passed:true,files,bytes,privateCredentialValuesChecked:privateValues.length,businessTablesEmpty:true,defaultBackend:'pi',provider:'deepseek',gmailTestingClient:true,gwsChecksumVerified:true};
const receipt=process.argv.find(a=>a.startsWith('--receipt='))?.slice(10);
if(receipt)fs.writeFileSync(path.resolve(receipt),JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
