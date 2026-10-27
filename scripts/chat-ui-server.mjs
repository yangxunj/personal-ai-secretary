// Isolated browser QA fixture. No business DB or real upstream credentials are used.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const root=path.resolve(import.meta.dirname,'..');
const phase=process.argv.includes('--baseline')?'baseline':'optimized';
const dir=path.join(root,'data/chat-ui-qa',phase+'-'+Date.now());
await fs.mkdir(dir,{recursive:true});
const env={...process.env,DATABASE_URL:'file:'+path.join(dir,'test.db').replaceAll('\\','/'),UPLOAD_DIR:path.join(dir,'uploads'),AUTH_ENABLED:'false',ALLOW_INSECURE_LOCAL:'true',APP_PASSWORD_HASH:'',SESSION_SECRET:'synthetic-chat-ui-secret-'.repeat(3),ENABLE_LOCAL_CODEX:'false',DESKTOP_APP:'0',APP_INSTANCE:'test',AI_API_KEY:'synthetic-key',AI_MODEL:'synthetic-model',SECRETARY_BUILD_DIR:'.next-pi-qa',NEXT_TELEMETRY_DISABLED:'1'};
execFileSync(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),'db','push','--skip-generate'],{cwd:root,env,stdio:'pipe'});
const db=new PrismaClient({datasourceUrl:env.DATABASE_URL});
const task=await db.task.create({data:{title:'Synthetic long task'}});
const conversations=[];
for(const taskId of [null,task.id]){
  const conv=await db.conversation.create({data:{backend:'api',title:'Synthetic long conversation',taskId}});
  await db.message.createMany({data:Array.from({length:720},(_,i)=>({id:'qa'+(taskId?'t':'g')+String(i).padStart(27,'0'),conversationId:conv.id,role:i%2?'secretary':'user',status:'read',createdAt:new Date(Date.UTC(2026,0,1,0,0,Math.floor(i/3))),content:`Synthetic message ${i}\n\n**Markdown evidence**\n\n| Key | Value |\n| --- | --- |\n| Row | ${i} |\n\n`+'Synthetic test text. '.repeat(25)}))});
  conversations.push(conv.id);
}
await db.$disconnect();
let calls=0;
const upstream=http.createServer(async(req,res)=>{
  let raw='';for await(const part of req)raw+=part;
  const payload=JSON.parse(raw);calls++;
  await fs.appendFile(path.join(dir,'upstream.jsonl'),JSON.stringify({stream:!!payload.stream,tools:(payload.tools||[]).map(t=>t.function?.name),messages:payload.messages.length})+'\n');
  if(!payload.stream){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:'qa-title',object:'chat.completion',model:'synthetic-model',choices:[{index:0,message:{role:'assistant',content:'Synthetic title'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:3,total_tokens:13}}));return;}
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const send=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'qa',object:'chat.completion.chunk',model:'synthetic-model',choices:[{index:0,delta,finish_reason}]})+'\n\n');
  send({role:'assistant',content:''});
  for(let i=0;i<30&&!res.destroyed;i++){send({content:`Synthetic streamed part ${i}. `});await new Promise(r=>setTimeout(r,100));}
  if(!res.destroyed){send({},'stop');res.end('data: [DONE]\n\n');}
});
await new Promise(r=>upstream.listen(0,'127.0.0.1',r));env.AI_BASE_URL=`http://127.0.0.1:${upstream.address().port}/v1`;
const portServer=http.createServer();await new Promise(r=>portServer.listen(0,'127.0.0.1',r));const port=portServer.address().port;await new Promise(r=>portServer.close(r));
const standalone=path.join(root,'.next-pi-qa/standalone');
const guard=path.join(dir,'standalone-guard.cjs');
await fs.writeFile(guard,`const{registerHooks}=require('node:module');const{fileURLToPath}=require('node:url');const{realpathSync}=require('node:fs');const path=require('node:path');const own=${JSON.stringify(standalone)};const parent=${JSON.stringify(path.join(root,'node_modules'))};registerHooks({resolve(s,c,next){const r=next(s,c);if(r.url.startsWith('file:')){const file=realpathSync(fileURLToPath(r.url));if(file.startsWith(parent+path.sep)&&!file.startsWith(own+path.sep))throw new Error('Missing standalone dependency: '+s);}return r;}});`);
for(const name of await fs.readdir(standalone))if(name==='.env'||name.startsWith('.env.'))await fs.unlink(path.join(standalone,name));
await fs.cp(path.join(root,'.next-pi-qa/static'),path.join(standalone,'.next-pi-qa/static'),{recursive:true});
await fs.cp(path.join(root,'public'),path.join(standalone,'public'),{recursive:true});
const log=await fs.open(path.join(dir,'next.log'),'a');
const child=spawn(path.join(root,'desktop/node_modules/electron/dist/electron.exe'),['--require',guard,path.join(standalone,'server.js')],{cwd:standalone,env:{...env,ELECTRON_RUN_AS_NODE:'1',HOSTNAME:'127.0.0.1',PORT:String(port),NODE_ENV:'production'},stdio:['ignore',log.fd,log.fd],windowsHide:true});
const origin=`http://127.0.0.1:${port}`;
let ready=false;
for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/agent/state')).ok){ready=true;break;}}catch{}if(child.exitCode!==null)throw new Error('Next exited: '+dir);await new Promise(r=>setTimeout(r,300));}
if(!ready){child.kill();upstream.close();throw new Error('Next did not become ready: '+dir);}
const receipt={phase,origin,dir,conversations,taskId:task.id,pid:child.pid};
await fs.writeFile(path.join(dir,'server.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
process.on('SIGINT',()=>{child.kill();upstream.close();process.exit(0);});
process.on('SIGTERM',()=>{child.kill();upstream.close();process.exit(0);});
child.on('exit',()=>{upstream.close();void log.close();process.exitCode=0;});
