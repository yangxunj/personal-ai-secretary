'use client';
import { useTransition } from 'react';
import { updateTaskStatus } from '@/app/(app)/actions';
import { useT } from '@/lib/i18n/client';
import TaskStatusSelect from '@/components/tasks/shared/TaskStatusSelect';

export default function StatusSelect({ taskId, status }: { taskId: string; status: string }) {
  const [pending, start] = useTransition();
  const t = useT();
  return <TaskStatusSelect status={status} disabled={pending} t={t}
    onChange={value => start(() => void updateTaskStatus(taskId, value))} />;
}
