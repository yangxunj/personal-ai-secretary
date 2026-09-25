/** @type {import('next').NextConfig} */
const nextConfig = {
  // standalone **只给桌面端打包用**（DESKTOP_BUILD=1）。
  //
  // 服务器那边不用：我们是在服务器上构建的（本机是 Windows，node_modules 里
  // Prisma 引擎和 sharp 都是 win32 二进制，拷到 Linux 直接挂），node_modules
  // 本来就在那儿。留着反而有害 —— systemd 跑的是 `next start`，它跟 standalone
  // 官方明说不兼容（启动时警告 does not work）。
  //
  // 桌面端反过来：装到别人电脑上，产物必须自包含，没有 npm ci 这一步。
  // 它走的是 standalone/server.js，不是 next start，所以不冲突。
  output: process.env.DESKTOP_BUILD === '1' ? 'standalone' : undefined,

  // ⚠⚠ 钉死在仓库根目录上。**删了这行就可能把仓库以外的文件打进安装包。**
  //
  // 仓库要是放在另一个项目的目录底下、父目录也有 package-lock.json，Next 会往上
  // 推断 workspace root，跟踪文件的范围就包到了父目录里的东西（这个项目最初就是
  // 从一个私人仓库的子目录分出来的，差点这样把私人文档打包出去）。
  //
  // 以前不走 standalone 时这只是个泄漏面问题；**现在桌面端走 standalone，
  // 被跟踪到的文件会真的被复制进 .next/standalone/，再被打进发给别人的
  // .exe 里**。这行从"以后别删"升级成了"删了就出事"。
  // desktop/scripts/prepare.mjs 里有一道体检专门防这个。
  outputFileTracingRoot: import.meta.dirname,

  // 带原生二进制的包不让 webpack 打进 bundle，运行时从 node_modules 加载。
  // @napi-rs/canvas 是扫描版 PDF 渲染页面用的（lib/doc-extract.ts），里面是 .node 文件，
  // 打进 bundle 就找不到了。standalone 构建会把它们跟踪进 node_modules。
  serverExternalPackages: ['@napi-rs/canvas', 'unpdf'],

  // dev 模式那个悬浮圆圈正好压在底部导航第一个标签（记录）上，关掉。
  devIndicators: false,
  experimental: {
    serverActions: { bodySizeLimit: '25mb' },
  },
};
export default nextConfig;
