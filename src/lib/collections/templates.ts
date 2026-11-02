import type { T } from '@/lib/i18n/core';
import type { CollectionDefinition, CollectionField } from './schema';

export function collectionTemplates(t: T) {
  const text = (id: string, label: string, required = false): CollectionField => ({ id, label, type: 'text', required });
  const def = (title: string, fields: CollectionField[], view: 'table' | 'cards' = 'table'): CollectionDefinition => ({ title, description: '', fields, titleFieldId: 'name', view });
  return [
    { id: 'customers', title: t('客户跟进'), description: t('客户档案与联系记录，通过关联字段连接。'),
      parent: def(t('客户档案'), [text('name', t('客户名称'), true), text('contact', t('联系人')), text('phone', t('联系电话')),
        { id: 'stage', label: t('合作阶段'), type: 'select', required: false, options: [t('初次联系'), t('沟通中'), t('已合作')] },
        { id: 'next_date', label: t('下次联系日期'), type: 'date', required: false },
        { id: 'notes', label: t('备注'), type: 'longText', required: false }]),
      child: def(t('客户联系记录'), [text('name', t('记录标题'), true), { id: 'parent', label: t('关联客户'), type: 'reference', required: true, targetCollectionId: 'parent' },
        { id: 'date', label: t('联系日期'), type: 'date', required: true }, { id: 'content', label: t('沟通内容'), type: 'longText', required: false }]) },
    { id: 'pets', title: t('宠物档案'), description: t('宠物档案与照护记录，支持日期、体重及关联字段。'),
      parent: def(t('宠物档案'), [text('name', t('宠物名字'), true), text('species', t('种类')), { id: 'birthday', label: t('出生日期'), type: 'date', required: false },
        { id: 'weight', label: t('体重（千克）'), type: 'number', required: false }, { id: 'notes', label: t('备注'), type: 'longText', required: false }], 'cards'),
      child: def(t('宠物照护记录'), [text('name', t('记录标题'), true), { id: 'parent', label: t('关联宠物'), type: 'reference', required: true, targetCollectionId: 'parent' },
        { id: 'date', label: t('记录日期'), type: 'date', required: true }, { id: 'kind', label: t('照护类型'), type: 'select', required: false, options: [t('疫苗'), t('就诊'), t('驱虫'), t('日常照护')] },
        { id: 'content', label: t('记录内容'), type: 'longText', required: false }]) },
  ];
}
