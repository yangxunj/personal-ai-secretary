import { sessionIsCurrent } from '@/lib/auth';
import { titleStatus, queueConversationTitle, startTitleWorker } from '@/lib/conversation-titles';
import { getLocale } from '@/lib/i18n/server';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const valid=(id:unknown):id is string=>typeof id==='string'&&/^(legacy|[a-z0-9]{20,40})$/.test(id);
export async function GET(req:Request) {
  if(!(await sessionIsCurrent()))return new Response('Unauthorized',{status:401});
  const id=new URL(req.url).searchParams.get('conversationId');
  if(!valid(id))return new Response('Invalid conversation',{status:400});
  await startTitleWorker();
  const state=await titleStatus(id);
  return state?Response.json(state,{headers:{'Cache-Control':'no-store'}}):new Response('Not found',{status:404});
}
export async function POST(req:Request) {
  if(!(await sessionIsCurrent()))return new Response('Unauthorized',{status:401});
  try {
    const origin=req.headers.get('origin'),host=req.headers.get('x-forwarded-host')||req.headers.get('host');
    if(!origin||new URL(origin).host!==host)return new Response('Invalid origin',{status:403});
  } catch {return new Response('Invalid origin',{status:403});}
  let id:unknown;try{id=(await req.json()).conversationId;}catch{return new Response('Invalid body',{status:400});}
  if(!valid(id))return new Response('Invalid conversation',{status:400});
  const state=await titleStatus(id);
  if(!state)return new Response('Not found',{status:404});
  if(!state.canRegenerate)return new Response('Title generation unavailable',{status:409});
  try {return Response.json(await queueConversationTitle(id,await getLocale(),true),{status:202,headers:{'Cache-Control':'no-store'}});}
  catch {return new Response('Title request unavailable. Finish the conversation and retry.',{status:409});}
}
