import { z } from 'zod';
import type { T } from '@/lib/i18n/core';

export const MAX_RECORDS = 2000;
export const fieldTypes = ['text', 'longText', 'number', 'date', 'select', 'boolean', 'reference'] as const;
export const fieldSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/).refine(id => !['__proto__', 'constructor', 'prototype'].includes(id)),
  label: z.string().trim().min(1).max(60),
  type: z.enum(fieldTypes),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  targetCollectionId: z.string().min(1).max(100).optional(),
}).strict();
export const definitionSchema = z.object({
  title: z.string().trim().min(1).max(80), description: z.string().trim().max(500).default(''),
  view: z.enum(['table', 'cards']).default('table'),
  titleFieldId: z.string().min(1), fields: z.array(fieldSchema).min(1).max(20),
}).strict().superRefine((definition, ctx) => {
  const ids = definition.fields.map(f => f.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Duplicate field IDs' });
  if (!definition.fields.some(f => f.id === definition.titleFieldId && f.type === 'text' && f.required)) ctx.addIssue({ code: 'custom', message: 'Title must be a required short text field' });
  for (const f of definition.fields) {
    if (f.type === 'select' && (!f.options?.length || new Set(f.options).size !== f.options.length)) ctx.addIssue({ code: 'custom', message: 'Select options must be nonempty and unique' });
    if (f.type === 'reference' && !f.targetCollectionId) ctx.addIssue({ code: 'custom', message: 'Reference target required' });
    if (f.type !== 'reference' && f.targetCollectionId || f.type !== 'select' && f.options) ctx.addIssue({ code: 'custom', message: 'Unexpected field configuration' });
  }
});
export type CollectionDefinition = z.infer<typeof definitionSchema>;
export type CollectionField = CollectionDefinition['fields'][number];
export type RecordValues = Record<string, string | number | boolean | null>;
export type CollectionInfo = { id: string; definition: CollectionDefinition; enabled: boolean; draft: boolean; version: number };

export class CollectionError extends Error {
  constructor(public code: string, public field = '') { super(code); }
}
export function parseDefinition(value: unknown): CollectionDefinition {
  if (JSON.stringify(value).length > 24000) throw new CollectionError('definition');
  const parsed = definitionSchema.safeParse(value);
  if (!parsed.success) throw new CollectionError('definition');
  return parsed.data;
}
export function validateValues(def: CollectionDefinition, input: unknown): RecordValues {
  if (!input || typeof input !== 'object' || Array.isArray(input) || JSON.stringify(input).length > 40000) throw new CollectionError('values');
  const values = input as Record<string, unknown>, out: RecordValues = {};
  if (Object.keys(values).some(key => !def.fields.some(f => f.id === key))) throw new CollectionError('unknownField');
  for (const field of def.fields) {
    let value = values[field.id];
    if (typeof value === 'string') value = value.trim();
    if (value === undefined || value === null || value === '') {
      if (field.required) throw new CollectionError('required', field.label);
      continue;
    }
    let valid = false;
    switch (field.type) {
      case 'text': valid = typeof value === 'string' && value.length <= 200; break;
      case 'longText': valid = typeof value === 'string' && value.length <= 20000; break;
      case 'number': valid = typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e12; break;
      case 'boolean': valid = typeof value === 'boolean'; break;
      case 'select': valid = typeof value === 'string' && !!field.options?.includes(value); break;
      case 'date': valid = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; break;
      case 'reference': valid = typeof value === 'string' && value.length <= 100; break;
    }
    if (!valid) throw new CollectionError('type', field.label);
    out[field.id] = value as string | number | boolean;
  }
  return out;
}
export function collectionError(error: unknown, t: T): string {
  if (!(error instanceof CollectionError)) return t('操作未完成，请稍后重试。');
  switch (error.code) {
    case 'definition': return t('请检查栏目名称、字段及选项；标题字段须为必填短文本，字段标识不可重复。');
    case 'required': return t('请填写「{field}」。', { field: error.field });
    case 'type': return t('「{field}」的内容不符合字段类型或可选值。', { field: error.field });
    case 'unknownField': return t('记录包含未定义的字段，请重新读取栏目配置。');
    case 'disabled': return t('栏目尚未启用，请先在栏目目录中启用。');
    case 'missing': return t('栏目或记录不存在。');
    case 'conflict': return t('数据或配置已被更新，请刷新后重试，避免覆盖他人的修改。');
    case 'usedField': return t('已有记录使用这个字段，暂不能删除、改变类型或关联目标；可以修改显示名称。');
    case 'reference': return t('关联记录不存在、已归档或所属栏目未启用。');
    case 'limit': return t('已达到试点上限：每个栏目最多 2000 条记录，最多 100 个栏目。');
    case 'filter': return t('筛选条件与字段类型不匹配。');
    default: return t('请检查记录内容。');
  }
}
