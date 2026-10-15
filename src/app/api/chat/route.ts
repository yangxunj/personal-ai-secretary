import { runChat } from '@/lib/chat-agent';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;
export const POST = (req: Request) => runChat(req);
