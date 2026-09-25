import { db } from '@/lib/db';

/**
 * 已装好的桌面端，启动时把表结构补到最新。
 *
 * 为什么需要：桌面端装到别人电脑上没有 prisma CLI，数据库是首次启动时从安装包里的
 * template.db 拷一份（desktop/main.js）。**之后升级安装包，template 不会再拷** ——
 * 老用户的库永远停在第一次装的那个结构。而 Prisma 默认 select 所有列，
 * 库里少一列，所有读 Message 的页面都会直接报错，不只是对话。
 *
 * 所以每次改 schema.prisma，都要在这里补一步**幂等**的 SQL（反复跑不出错）。
 * SQL 照 `prisma db push` 在开发库上生成的原样抄：
 *   SELECT sql FROM sqlite_master WHERE tbl_name = '<表名>'
 *
 * 只会加东西（加列、建表、建索引）。删列改类型这种，SQLite 做不了原地改，
 * 真遇到了要另外设计，别往这里塞。
 */
type Step = { name: string; needed: () => Promise<boolean>; sql: string[] };

async function hasColumn(table: string, column: string) {
  const cols = await db.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info("${table}")`);
  return cols.some((c) => c.name === column);
}

async function hasTable(table: string) {
  const r = await db.$queryRawUnsafe<{ n: bigint | number }[]>(
    `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?`,
    table,
  );
  return Number(r[0]?.n ?? 0) > 0;
}

const STEPS: Step[] = [
  {
    // 2026-09-23 对话上下文管理（lib/chat-context.ts）
    name: 'Message.modelJson',
    needed: async () => !(await hasColumn('Message', 'modelJson')),
    sql: [`ALTER TABLE "Message" ADD COLUMN "modelJson" TEXT`],
  },
  {
    name: 'ChatSummary',
    needed: async () => !(await hasTable('ChatSummary')),
    sql: [
      `CREATE TABLE "ChatSummary" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "summary" TEXT NOT NULL,
    "firstKeptId" TEXT NOT NULL,
    "tokensBefore" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
      `CREATE INDEX IF NOT EXISTS "ChatSummary_createdAt_idx" ON "ChatSummary"("createdAt")`,
    ],
  },
  {
    // 2026-09-24 AI 生成的页面（/pages）
    name: 'Page',
    needed: async () => !(await hasTable('Page')),
    sql: [
      `CREATE TABLE "Page" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "request" TEXT,
    "html" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'snapshot',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
)`,
      `CREATE INDEX IF NOT EXISTS "Page_updatedAt_idx" ON "Page"("updatedAt")`,
    ],
  },
  {
    name: 'PageVersion',
    needed: async () => !(await hasTable('PageVersion')),
    sql: [
      `CREATE TABLE "PageVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pageId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PageVersion_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`,
      `CREATE INDEX IF NOT EXISTS "PageVersion_pageId_createdAt_idx" ON "PageVersion"("pageId", "createdAt")`,
    ],
  },
  {
    // 2026-09-24 多个对话
    name: 'Conversation',
    needed: async () => !(await hasTable('Conversation')),
    sql: [
      `CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
)`,
      `CREATE INDEX IF NOT EXISTS "Conversation_updatedAt_idx" ON "Conversation"("updatedAt")`,
    ],
  },
  {
    name: 'Message.conversationId',
    needed: async () => !(await hasColumn('Message', 'conversationId')),
    // SQLite 允许 ADD COLUMN 带 REFERENCES，只要默认值是 NULL ——
    // prisma db push 是整表重建，老库上没必要那么折腾
    sql: [
      `ALTER TABLE "Message" ADD COLUMN "conversationId" TEXT REFERENCES "Conversation" ("id") ON DELETE SET NULL ON UPDATE CASCADE`,
      `CREATE INDEX IF NOT EXISTS "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt")`,
    ],
  },
  {
    name: 'ChatSummary.conversationId',
    needed: async () => !(await hasColumn('ChatSummary', 'conversationId')),
    sql: [
      `ALTER TABLE "ChatSummary" ADD COLUMN "conversationId" TEXT`,
      `CREATE INDEX IF NOT EXISTS "ChatSummary_conversationId_createdAt_idx" ON "ChatSummary"("conversationId", "createdAt")`,
    ],
  },
  {
    name: 'Page.conversationId',
    needed: async () => !(await hasColumn('Page', 'conversationId')),
    sql: [`ALTER TABLE "Page" ADD COLUMN "conversationId" TEXT`],
  },
  {
    name: 'Page.sample',
    needed: async () => !(await hasColumn('Page', 'sample')),
    sql: [`ALTER TABLE "Page" ADD COLUMN "sample" TEXT`],
  },
  {
    // 数据迁移，只跑一次（靠 Setting 里的标记，不靠「还有没有没归属的消息」——
    // 任务页上的留言本来就永远没有 conversationId，拿它当条件会每次启动都跑）。
    //
    // 之前的所有记录（含任务页留言 —— 以前它们也显示在对话页里）归进一个
    // 「以前的对话」，最早一条的时间当创建时间、最晚一条当更新时间。
    // 一条消息都没有的新库只打标记，不凭空造一个空对话。
    name: 'Conversation.legacy',
    needed: async () => {
      const r = await db.$queryRawUnsafe<{ n: bigint | number }[]>(
        `SELECT COUNT(*) AS n FROM "Setting" WHERE "key" = 'migrated.conversations'`,
      );
      return Number(r[0]?.n ?? 0) === 0;
    },
    sql: [
      `INSERT INTO "Conversation" ("id", "title", "createdAt", "updatedAt")
       SELECT 'legacy', '以前的对话', MIN("createdAt"), MAX("createdAt") FROM "Message"
       WHERE "conversationId" IS NULL HAVING COUNT(*) > 0`,
      `UPDATE "Message" SET "conversationId" = 'legacy'
       WHERE "conversationId" IS NULL AND EXISTS (SELECT 1 FROM "Conversation" WHERE "id" = 'legacy')`,
      `UPDATE "ChatSummary" SET "conversationId" = 'legacy'
       WHERE "conversationId" IS NULL AND EXISTS (SELECT 1 FROM "Conversation" WHERE "id" = 'legacy')`,
      `INSERT INTO "Setting" ("key", "value", "updatedAt")
       VALUES ('migrated.conversations', '1', CAST(strftime('%s','now') AS INTEGER) * 1000)`,
    ],
  },
];

export async function upgradeSchema(): Promise<string[]> {
  const done: string[] = [];
  for (const s of STEPS) {
    if (!(await s.needed())) continue;
    for (const q of s.sql) await db.$executeRawUnsafe(q);
    done.push(s.name);
  }
  return done;
}
