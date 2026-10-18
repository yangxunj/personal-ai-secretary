import PageHeader from '@/components/PageHeader';
import { getT } from '@/lib/i18n/server';
import MailPanel from './MailPanel';

export const dynamic = 'force-dynamic';
export default async function MailPage() {
  const t = await getT();
  return <><PageHeader title={t('邮件')} /><MailPanel /></>;
}
