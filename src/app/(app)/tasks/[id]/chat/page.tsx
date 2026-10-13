import { redirect } from 'next/navigation';
export default async function TaskChatPage({params}:{params:Promise<{id:string}>}) {
  const {id}=await params; redirect('/tasks/'+encodeURIComponent(id)+'?chat=1');
}
