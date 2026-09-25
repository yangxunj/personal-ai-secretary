import PageHeader from '@/components/PageHeader';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth';
import { getAiConfig, maskKey } from '@/lib/ai-config';
import ProviderFields from './ProviderFields';
import {
  changePasswordAction,
  logoutAction,
  saveAiConfigAction,
  testAiConfigAction,
  resetAiConfigAction,
  saveOwnersAction,
} from './actions';
import { getOwners } from '@/lib/owners';

export const dynamic = 'force-dynamic';

/**
 * 设置页 —— 模型配置 + 家里的人 + 改密码 + 退出。
 *
 * 两块内容的存在理由是同一个：**交付给别人用的东西，不能让使用者为了改一个
 * 值去 SSH 上服务器或者改 .env。** 密码是第一个（原来要跑脚本），模型 key
 * 是第二个（桌面端安装包里带的是开发者的 key，他得能换成自己的）。
 *
 * 登录相关的两块在没启用登录时不显示 —— 桌面端只听 127.0.0.1，没有登录。
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string; ok?: string; aiE?: string; aiOk?: string; mE?: string; mOk?: string }>;
}) {
  const { e, ok, aiE, aiOk, mE, mOk } = await searchParams;
  const authOn = process.env.AUTH_ENABLED === 'true';
  const ai = await getAiConfig();
  const owners = await getOwners();

  return (
    <>
      <PageHeader title="设置" back="/" settings={false} />

      <div className="px-4 py-4 space-y-4">
        {/* ---------- 模型 ---------- */}
        <section className="surface border rounded-2xl p-4" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-[15px] font-semibold mb-1">AI 模型</h2>
          <p className="muted text-[12px] leading-relaxed mb-3">
            对话功能用的模型。填自己的 API Key，
            <strong className="font-semibold">保存后立刻生效，不用重启</strong>。
          </p>

          {aiOk && (
            <p className="text-[13px] text-emerald-600 dark:text-emerald-400 mb-3">✓ {aiOk}</p>
          )}
          {aiE && <p className="text-[13px] text-red-500 mb-3 leading-relaxed">{aiE}</p>}

          <form action={saveAiConfigAction} className="space-y-3">
            <ProviderFields
              baseUrl={ai.baseUrl}
              model={ai.model}
              keyPlaceholder={ai.apiKey ? maskKey(ai.apiKey) : '还没填'}
              keySource={
                ai.apiKey
                  ? ai.fromDb
                    ? '当前用的是你自己填的 key。留空不改。'
                    : '当前用的是软件自带的 key。填上你自己的就会换掉。'
                  : null
              }
            />

            <button
              type="submit"
              className="w-full rounded-xl bg-brand-500 text-white py-2.5 text-[15px] active:opacity-80"
            >
              保存并测试
            </button>
          </form>

          <div className="flex gap-2 mt-2">
            <form action={testAiConfigAction} className="flex-1">
              <button
                className="w-full rounded-xl border py-2 text-[13px] active:opacity-60"
                style={{ borderColor: 'var(--border)' }}
              >
                只测试当前配置
              </button>
            </form>
            {ai.fromDb && (
              <form action={resetAiConfigAction} className="flex-1">
                <button
                  className="w-full rounded-xl border py-2 text-[13px] active:opacity-60"
                  style={{ borderColor: 'var(--border)' }}
                >
                  恢复默认
                </button>
              </form>
            )}
          </div>

          <p className="muted text-[11px] leading-relaxed mt-3">
            你发给 AI 的内容会传给这个服务商 —— AI 要读到账单才能帮你录入。
            不想让它看的东西就别发给它。
          </p>
        </section>

        {/* ---------- 家里的人 ---------- */}
        <section id="members" className="surface border rounded-2xl p-4 scroll-mt-4" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-[15px] font-semibold mb-1">家里的人</h2>
          <p className="muted text-[12px] leading-relaxed mb-3">
            任务能派给谁、留言以谁的名义。用逗号或顿号隔开，第一个是你自己。
            AI 建任务时也会按这份名单填负责人。
          </p>

          {mOk && <p className="text-[13px] text-emerald-600 dark:text-emerald-400 mb-3">✓ {mOk}</p>}
          {mE && <p className="text-[13px] text-red-500 mb-3">{mE}</p>}

          <form action={saveOwnersAction} className="space-y-3">
            <input
              name="owners"
              defaultValue={owners.join('，')}
              placeholder="例如：我，老婆，妈妈"
              className="w-full rounded-xl border px-3.5 py-2.5 text-[15px] bg-transparent outline-none focus:border-brand-500 transition"
              style={{ borderColor: 'var(--border)' }}
            />
            <button
              type="submit"
              className="w-full rounded-xl bg-brand-500 text-white py-2.5 text-[15px] active:opacity-80"
            >
              保存
            </button>
          </form>

          <p className="muted text-[11px] leading-relaxed mt-3">
            改名或删掉一个人，已经派给他的任务不会跟着变，还挂在原来的名字下。
          </p>
        </section>

        {/* ---------- 手机访问（只有桌面端有） ---------- */}
        {process.env.DESKTOP_APP === '1' && (
          <section className="surface border rounded-2xl p-4" style={{ borderColor: 'var(--border)' }}>
            <h2 className="text-[15px] font-semibold mb-1">用手机访问</h2>
            <p className="muted text-[12px] leading-relaxed">
              同一个 WiFi 下的手机也能用。在电脑上点窗口顶部菜单
              <strong className="font-semibold">「设置 → 用手机访问…」</strong>，
              打开开关，用手机扫二维码。只有扫过码的手机进得来。
            </p>
          </section>
        )}

        {/* ---------- 密码 ---------- */}
        {authOn && (
          <section className="surface border rounded-2xl p-4" style={{ borderColor: 'var(--border)' }}>
            <h2 className="text-[15px] font-semibold mb-1">改登录密码</h2>
            <p className="muted text-[12px] leading-relaxed mb-3">
              改完之后，其他设备上已经登录的会全部被踢下线，需要用新密码重新登录。
            </p>

            {ok && (
              <p className="text-[13px] text-emerald-600 dark:text-emerald-400 mb-3">
                ✓ 密码已改好，下次登录用新的。
              </p>
            )}
            {e && <p className="text-[13px] text-red-500 mb-3">{e}</p>}

            <form action={changePasswordAction} className="space-y-3">
              <Field name="current" label="当前密码" autoComplete="current-password" />
              <Field
                name="next"
                label="新密码"
                autoComplete="new-password"
                hint={`至少 ${MIN_PASSWORD_LENGTH} 位`}
              />
              <Field name="confirm" label="再输一次新密码" autoComplete="new-password" />
              <button
                type="submit"
                className="w-full rounded-xl bg-brand-500 text-white py-2.5 text-[15px] active:opacity-80"
              >
                确认修改
              </button>
            </form>

            <p className="muted text-[11px] leading-relaxed mt-3">
              忘了密码进不来的话，只能让搭这套系统的人在服务器上重置 —— 密码存的是
              不可逆的哈希，谁也算不回来。
            </p>
          </section>
        )}

        {/* ---------- 退出 ---------- */}
        {authOn && (
          <section className="surface border rounded-2xl p-4" style={{ borderColor: 'var(--border)' }}>
            <h2 className="text-[15px] font-semibold mb-1">退出登录</h2>
            <p className="muted text-[12px] leading-relaxed mb-3">
              只退出这台设备，数据不受影响。
            </p>
            <form action={logoutAction}>
              <button
                className="w-full rounded-xl border py-2.5 text-[15px] active:opacity-60"
                style={{ borderColor: 'var(--border)' }}
              >
                退出
              </button>
            </form>
          </section>
        )}

        {!authOn && (
          <p className="muted text-[11px] leading-relaxed px-1">
            这是本机版，没有登录：在这台电脑上直接用，手机要先扫码配对。
            数据都在这台电脑上，菜单「设置 → 打开数据文件夹」能看到。
          </p>
        )}
      </div>
    </>
  );
}

function Field({
  name,
  label,
  hint,
  autoComplete,
}: {
  name: string;
  label: string;
  hint?: string;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="muted text-[12px]">{label}</span>
      {hint && <span className="muted text-[11px] ml-1.5">（{hint}）</span>}
      <input
        type="password"
        name={name}
        required
        autoComplete={autoComplete}
        className="mt-1 w-full rounded-xl border px-3.5 py-2.5 text-[15px] bg-transparent outline-none focus:border-brand-500 transition"
        style={{ borderColor: 'var(--border)' }}
      />
    </label>
  );
}
