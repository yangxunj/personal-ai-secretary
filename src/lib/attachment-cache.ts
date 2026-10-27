// Memory only: no rendered copies or private document contents outside the upload store.
const cache=new Map<string,{value:unknown;size:number}>();let size=0;
export async function cachedAttachment<T>(key:string,load:()=>Promise<T>):Promise<T>{
  const hit=cache.get(key);if(hit){cache.delete(key);cache.set(key,hit);return hit.value as T;}
  const value=await load(),bytes=Buffer.byteLength(JSON.stringify(value));
  if(bytes<=8*1024*1024){const previous=cache.get(key);if(previous)size-=previous.size;cache.set(key,{value,size:bytes});size+=bytes;
    while(size>16*1024*1024||cache.size>8){const oldest=cache.keys().next().value!;size-=cache.get(oldest)!.size;cache.delete(oldest);}}
  return value;
}
