import path from 'node:path';
import { UPLOAD_DIR } from '@/lib/storage';
export function piDirectory(conversationId:string) {
  if(!/^(legacy|[a-z0-9]{20,40})$/.test(conversationId))throw new Error('Invalid Pi conversation id');
  return path.resolve(UPLOAD_DIR,'../pi-sessions',conversationId);
}
