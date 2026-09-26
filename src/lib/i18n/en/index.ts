import type { Dict } from '../core';
import { common } from './common';
import { tasks } from './tasks';
import { chat } from './chat';
import { content } from './content';
import { records } from './records';

/**
 * 英文词典，按页面区域分文件，合成一份。
 * 同一个中文在不同文件里出现、译法却不一样时，后面的覆盖前面的 ——
 * i18n-check 会报出来，统一到 common.ts。
 */
export const EN: Dict = { ...common, ...tasks, ...chat, ...content, ...records };
