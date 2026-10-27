import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import { z } from 'zod';

// Create a genuine profile-1 registration from the unchanged legacy tool definitions.
// The test must not simply label a tool-less thread as a file-capable old thread.
export async function legacyDynamicTools(root,databaseUrl,conversationId,taskId){
  process.env.DATABASE_URL=databaseUrl;
  const hooks=registerHooks({resolve(s,c,next){
    if(s==='next/cache')return{url:'data:text/javascript,export const revalidatePath=()=>{};',shortCircuit:true};
    let base;if(s.startsWith('@/'))base=path.join(root,'src',s.slice(2));else if(s.startsWith('.')&&c.parentURL?.startsWith('file:'))base=fileURLToPath(new URL(s,c.parentURL));
    if(base){const file=['','.ts','/index.ts'].map(e=>base+e).find(p=>existsSync(p)&&path.extname(p));if(file)return{url:pathToFileURL(file).href,shortCircuit:true};}return next(s,c);
  },load(url,c,next){if(url.startsWith('file:')&&url.endsWith('.ts')&&!url.includes('/node_modules/'))return{format:'module',source:ts.transpileModule(readFileSync(fileURLToPath(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,shortCircuit:true};return next(url,c);}});
  try{
    const {buildChatTools}=await import('../src/lib/task-chat-tools.ts'),{buildAgentFileTools}=await import('../src/lib/agent-files.ts');
    const tools={...buildChatTools({incoming:[],conversationId,taskId}),...buildAgentFileTools(conversationId,taskId,'test-assistant')};
    return Object.entries(tools).map(([name,t])=>({name,description:t.description,inputSchema:z.toJSONSchema(t.inputSchema,{io:'input'})}));
  }finally{hooks.deregister();}
}
