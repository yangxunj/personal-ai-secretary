'use client';
import { useTransition } from 'react';
import { updateTaskOwner } from '@/app/(app)/actions';
import { useT } from '@/lib/i18n/client';
import TaskOwnerSelect from '@/components/tasks/shared/TaskOwnerSelect';

export default function OwnerSelect({ taskId, owner, members, className = '' }: {
  taskId: string; owner: string | null; members: string[]; className?: string;
}) {
  const [pending, start] = useTransition();
  const t = useT();
  return <TaskOwnerSelect owner={owner} members={members} disabled={pending} t={t} className={className}
    onChange={value => start(() => { updateTaskOwner(taskId, value); })} />;
}
