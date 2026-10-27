import { db } from '@/lib/db';
import { sessionIsCurrent } from '@/lib/auth';
import { recoverAgentTurns, cancelAgentConversation } from '@/lib/agent-turns';
import { getCodexToolVersion } from '@/lib/codex/tool-profile';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(req:Request) {
  if(!(await sessionIsCurrent()))return new Response('Unauthorized',{status:401});
  await recoverAgentTurns();
  const conversationId=new URL(req.url).searchParams.get('conversationId') || '';
  const turn=await db.codexTurn.findFirst({where:{conversationId},orderBy:{createdAt:'desc'},select:{status:true,error:true,id:true}});
  const conversation=await db.conversation.findUnique({where:{id:conversationId},select:{backend:true,codexThreadId:true}});
  const version=conversation?.backend==='codex'?await getCodexToolVersion(conversationId,conversation.codexThreadId):3;
  return Response.json({...turn||{status:'idle'},fileToolsAvailable:version>=1,businessToolsAvailable:version>=2&&conversation?.backend!=='api',visualToolsAvailable:version>=3&&conversation?.backend!=='api'},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(req:Request) {
  if(!(await sessionIsCurrent()))return new Response('Unauthorized',{status:401});
  const origin=req.headers.get('origin');const host=req.headers.get('x-forwarded-host') || req.headers.get('host');
  if(!origin || new URL(origin).host!==host)return new Response('Invalid origin',{status:403});
  const {conversationId}=await req.json();
  if(typeof conversationId!=='string')return new Response('Invalid conversation',{status:400});
  await cancelAgentConversation(conversationId);return Response.json({ok:true});
}
