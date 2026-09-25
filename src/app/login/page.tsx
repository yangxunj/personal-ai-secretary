import { login } from './actions';
import { IS_TEST } from '@/lib/instance';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string; s?: string; from?: string }>;
}) {
  const { e, s, from } = await searchParams;
  const lockedMin = e === 'locked' ? Math.ceil(Number(s ?? 0) / 60) || 1 : 0;
  return (
    <main className="min-h-dvh flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 h-16 w-16 rounded-2xl bg-brand-500 flex items-center justify-center">
            <svg viewBox="0 0 64 64" className="h-9 w-9" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 42V26l12-8 12 8v16" />
              <path d="M28 42v-9h8v9" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            家庭管家{IS_TEST && ' · 测试'}
          </h1>
          {/* 两个实例的登录页除了这一行完全一样。不标的话，密码输错了都
              不知道是记错了还是走错了站 —— 而它们只差一个端口号。 */}
          <p className="muted text-sm mt-1">
            {IS_TEST ? '测试环境，数据开发者可见' : '私人生活秘书'}
          </p>
        </div>

        <form action={login} className="surface border rounded-2xl p-5 space-y-4">
          <input type="hidden" name="from" value={from ?? '/'} />
          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-2">
              访问密码
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoFocus
              autoComplete="current-password"
              className="w-full rounded-xl border px-4 py-3 bg-transparent outline-none focus:border-brand-500 transition"
              style={{ borderColor: 'var(--border)' }}
              placeholder="请输入密码"
            />
          </div>
          {lockedMin > 0 ? (
            <p className="text-sm text-red-500">
              失败次数过多，已暂时锁定，请在 {lockedMin} 分钟后再试。
            </p>
          ) : (
            e && <p className="text-sm text-red-500">密码不正确，请重试。</p>
          )}
          <button
            type="submit"
            disabled={lockedMin > 0}
            className="w-full rounded-xl bg-brand-500 hover:bg-brand-600 active:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-3 transition"
          >
            进入
          </button>
        </form>

        <p className="muted text-xs text-center mt-6 leading-relaxed">
          本站为个人私有平台，包含隐私资料
          <br />
          请勿在公共设备上保持登录
        </p>
      </div>
    </main>
  );
}
