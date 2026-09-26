import type { Dict } from '../core';

/** 中文原文 → 英文。key 必须跟 t('…') 里的字符串一字不差。多处共用的放这里 */
export const common: Dict = {
  家庭管家: 'Household Steward',
  私人生活秘书平台: 'Your personal life secretary',
  // 导航
  对话: 'Chat',
  任务: 'Tasks',
  资料: 'Vault',
  财务: 'Finance',
  健康: 'Health',
  专题: 'Topics',
  文件: 'Files',
  页面: 'Pages',
  搜索: 'Search',
  设置: 'Settings',
  // 任务状态（lib/format.ts TASK_STATUS）
  待办: 'To do',
  进行中: 'In progress',
  卡住了: 'Blocked',
  已完成: 'Done',
  已取消: 'Cancelled',
  // 任务分类（CATEGORIES）；「健康」「财务」上面有了
  保险: 'Insurance',
  出行: 'Travel',
  教育: 'Education',
  证件: 'IDs',
  居家: 'Home',
  其他: 'Other',
  // 资料分类（VAULT_CATEGORIES）；重复的上面有了
  银行: 'Bank',
  学校: 'School',
  住址: 'Address',
  公用事业: 'Utilities',
  税务: 'Tax',
  医疗: 'Medical',
  会员: 'Memberships',
  工作: 'Work',
  // lib/format.ts 里中英分支直接写死了，这三条只是让对账脚本认得
  刚刚: 'just now',
  今天: 'Today',
  昨天: 'Yesterday',
  // 通用按钮
  保存: 'Save',
  取消: 'Cancel',
  删除: 'Delete',
  编辑: 'Edit',
  关闭: 'Close',
  返回: 'Back',
  复制: 'Copy',
  已复制: 'Copied',
};
