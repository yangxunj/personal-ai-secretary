#!/usr/bin/env node
/**
 * 把仓库根目录那个 Next 应用打包成桌面端能直接跑的自包含产物 → desktop/runtime/
 *
 *   node scripts/prepare.mjs --no-key   （npm run dist 就是这么调的）
 *
 * 干五件事：
 *   1. 用 DESKTOP_BUILD=1 构建（这个开关才会产出 standalone）
 *   2. **体检**：standalone 里有没有混进仓库以外的文件
 *   3. 搬运 standalone + static + Prisma 引擎
 *   4. 生成一个空的模板数据库（装到别人电脑上第一次启动时复制过去）
 *   5. 抽出模型配置
 *
 * 第 2 步是这个脚本存在的主要理由，别删。
 */
import { execFileSync } from 'node:child_process';
import { cpSync, rmSync, mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HERE = path.resolve(import.meta.dirname, '..');   // desktop/
const CLOUD = path.resolve(HERE, '..');                 // 仓库根目录（Next 应用）
// 不能叫 app/ —— electron-builder 有个约定：根目录下存在 app/ 就把它当成
// 应用根目录去找 index.js，直接报「Application entry file does not exist」。
const OUT = path.join(HERE, 'runtime');

const say = (s) => console.log(`\n=== ${s} ===`);

// 直接用当前这个 node 去跑本地 bin，不经过 npm/npx。
// Windows 上 Node 从 20 起不让 spawn .cmd 了（EINVAL），而 npm.cmd 恰好是
// .cmd —— 绕开它比给每处加 shell:true 干净，也少一层 shell 转义的坑。
const NEXT_BIN = path.join(CLOUD, 'node_modules', 'next', 'dist', 'bin', 'next');
const PRISMA_BIN = path.join(CLOUD, 'node_modules', 'prisma', 'build', 'index.js');
const node = (script, args, extraEnv = {}) =>
  execFileSync(process.execPath, [script, ...args], {
    cwd: CLOUD,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });

// ---------- 1. 构建 ----------
say('构建（DESKTOP_BUILD=1 → standalone）');
node(PRISMA_BIN, ['generate']);
node(NEXT_BIN, ['build'], { DESKTOP_BUILD: '1', NODE_OPTIONS: '--max-old-space-size=2048' });

const STANDALONE = path.join(CLOUD, '.next', 'standalone');
if (!existsSync(STANDALONE)) {
  throw new Error('没产出 .next/standalone —— next.config.mjs 里的 output 开关没生效？');
}

// ---------- 2. 搬运 ----------
say('搬运产物 → desktop/app/');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(STANDALONE, OUT, { recursive: true });

// **.env 必须剥掉。**
//
// Next 的文件跟踪会把根目录的 .env 一起复制进 standalone —— 里面有
// AI_API_KEY、APP_PASSWORD_HASH、SESSION_SECRET、BACKUP_PASSPHRASE。
// 这份产物是要打进 .exe 发给别人的，等于把全套密钥附赠出去。
//
// 桌面端根本不需要它：环境变量由 main.js 在启动子进程时现给
// （数据库路径要指到 %APPDATA%，本来也不能用 .env 里那个）。
for (const name of readdirSync(OUT)) {
  if (name === '.env' || name.startsWith('.env.')) {
    rmSync(path.join(OUT, name), { force: true });
    console.log(`  剥掉 ${name}（里面是密钥，不能进安装包）`);
  }
}

// ---------- 3. 体检：有没有把仓库以外的文件跟踪进来 ----------
//
// Next 的文件跟踪从 outputFileTracingRoot 开始算。那行要是被删了或改了，
// 仓库又放在别的项目目录底下，根就会上推到父目录 —— 父目录里的私人文档
// 就会被复制进来，而这个产物要**发给别人**。
//
// 查的是 desktop/app/（真正会被打包的那份），不是中间产物。
say('体检：产物里有没有不该有的文件');
const ALLOWED_TOP = new Set([
  'node_modules', '.next', 'package.json', 'server.js', 'prisma', 'scripts', 'public', 'resources',
]);
const strays = readdirSync(OUT).filter((n) => !ALLOWED_TOP.has(n));
if (strays.length) {
  console.error('\n!! 产物顶层出现了意外的东西：', strays.join(', '));
  console.error('   多半是 next.config.mjs 里的 outputFileTracingRoot 没了或者被改了。');
  console.error('   **在查清楚之前不要打包。**');
  process.exit(1);
}
// 再查一遍有没有中文名文件混进来 —— 个人文档多半是中文名，产物里本不该有
const suspicious = [];
const walk = (dir, depth = 0) => {
  if (depth > 4) return;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue;
    const full = path.join(dir, name);
    if (/[一-龥]/.test(name)) suspicious.push(path.relative(OUT, full));
    if (statSync(full).isDirectory()) walk(full, depth + 1);
  }
};
walk(OUT);
if (suspicious.length) {
  console.error('\n!! 产物里有中文名文件，多半是跟踪到了仓库以外的个人文档：');
  suspicious.forEach((s) => console.error('   ' + s));
  process.exit(1);
}
console.log('干净。');

// standalone 那份 package.json 是 Next 生成的，只有 name/version。
// electron-builder 会对着它抱怨缺 description/author —— 补上，免得每次打包
// 都刷两行警告，真出问题的时候反而看不见。
const appPkgPath = path.join(OUT, 'package.json');
const appPkg = JSON.parse(readFileSync(appPkgPath, 'utf8'));
writeFileSync(
  appPkgPath,
  JSON.stringify(
    { ...appPkg, description: '家庭管家 —— 内嵌服务', author: '私人使用', private: true },
    null,
    2
  )
);

// ---------- 4. 静态资源 ----------
// standalone 不含它们，要自己补。少了这步页面出来是没有样式的白板。
say('补静态资源');
cpSync(path.join(CLOUD, '.next', 'static'), path.join(OUT, '.next', 'static'), { recursive: true });
if (existsSync(path.join(CLOUD, 'public'))) {
  cpSync(path.join(CLOUD, 'public'), path.join(OUT, 'public'), { recursive: true });
}

// Prisma 的查询引擎是原生二进制，文件跟踪经常漏。漏了的表现是运行时
// "Query engine library not found"，而那时候已经装到人家电脑上了。
say('确认 Prisma 引擎在位');
const engines = [];
const findEngines = (dir) => {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) findEngines(full);
    else if (/query_engine|query-engine|libquery/.test(name)) engines.push(full);
  }
};
findEngines(path.join(OUT, 'node_modules', '.prisma'));
findEngines(path.join(OUT, 'node_modules', '@prisma'));
if (!engines.length) {
  console.log('跟踪时漏了，从源 node_modules 里补进去');
  const src = path.join(CLOUD, 'node_modules', '.prisma');
  if (!existsSync(src)) throw new Error('源 node_modules/.prisma 也没有，先在仓库根目录跑一次 npx prisma generate');
  cpSync(src, path.join(OUT, 'node_modules', '.prisma'), { recursive: true });
  findEngines(path.join(OUT, 'node_modules', '.prisma'));
}
engines.forEach((e) => console.log('  ' + path.relative(OUT, e)));
if (!engines.length) throw new Error('补完还是没有查询引擎，停下来查');

// ---------- 4. 模板数据库 ----------
//
// 装到别人电脑上没有 prisma CLI 可用（那一整套装进安装包太重），
// 所以在这儿先生成一个建好表的空库，第一次启动时复制到用户数据目录。
say('生成模板数据库');
const tmpDb = path.join(os.tmpdir(), `secretary-template-${Date.now()}.db`);
node(PRISMA_BIN, ['db', 'push', '--skip-generate'], {
  DATABASE_URL: `file:${tmpDb.replace(/\\/g, '/')}`,
});
mkdirSync(path.join(OUT, 'resources'), { recursive: true });
cpSync(tmpDb, path.join(OUT, 'resources', 'template.db'));
rmSync(tmpDb, { force: true });
// schema 也带上：以后要做版本升级（加字段）时用得着
cpSync(path.join(CLOUD, 'prisma', 'schema.prisma'), path.join(OUT, 'resources', 'schema.prisma'));

// ---------- 5. 模型配置 ----------
//
// 打进产物的这份只是**初始值**。使用者在设置页填了自己的 key 之后，
// 库里那份说话（见 src/lib/ai-config.ts），跟密码是同一个套路。
//
// ⚠ 不带 --no-key 会把 AI_API_KEY 写进产物，也就是写进将来那个 .exe，
//    拿到安装包的人能把它抠出来。
//
//    --no-key（npm run dist 用的）  只带接口地址和模型名，使用者第一次打开
//                                   去设置页填自己的 key。公开发布一律用这个。
//    不带                           装完就能对话，但花的是你的 key、还可能被抠走。
//                                   只在打给自己家里人用时考虑，且 key 要单独申请。
say('抽取模型配置');
const noKey = process.argv.includes('--no-key');
// 没有 .env（刚 clone 下来）就用 .env.example 里的默认接口和模型名
const envPath = [path.join(CLOUD, '.env'), path.join(CLOUD, '.env.example')].find(existsSync);
if (!envPath) throw new Error('根目录没有 .env 也没有 .env.example，没法取模型配置');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);
const cfg = {
  AI_BASE_URL: env.AI_BASE_URL ?? '',
  AI_API_KEY: noKey ? '' : (env.AI_API_KEY ?? ''),
  AI_MODEL: env.AI_MODEL ?? '',
};
if (noKey) {
  console.log('  --no-key：不带 key。使用者要自己在设置页填。');
} else if (!cfg.AI_API_KEY) {
  console.warn('  ⚠ .env 里没有 AI_API_KEY —— 装出来之后要在设置页填才能对话');
} else {
  console.log(`  带上了 key（${cfg.AI_API_KEY.slice(0, 6)}…）。别把安装包发到公开地方。`);
}
writeFileSync(path.join(OUT, 'resources', 'ai.json'), JSON.stringify(cfg, null, 2));

say('好了');
console.log(`产物在 ${OUT}`);
console.log('本地试跑:  npm run dev');
console.log('打安装包:  npm run dist');
