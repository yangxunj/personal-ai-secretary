import { db } from '@/lib/db';

/**
 * 模型配置 —— 数据库优先，`.env` 兜底。
 *
 * 跟密码是同一个套路（见 `auth.ts` 的 `currentPasswordHash`）：`.env` 里那份
 * 只是**初始值**，使用者在设置页填过之后，库里的值说话。
 *
 * 为什么非得进数据库：桌面端装到别人电脑上，安装包里带的是我的 key。
 * 他要换成自己的，唯一现实的办法是在界面上填 —— 不可能让他去改 `.env`
 * 再重启服务。网页版同理，SSH 上服务器改环境变量对使用者也不现实。
 *
 * ⚠ **key 明文存库。** 这是这个项目一贯的选择（身份证号、银行卡号也是明文），
 * 换成加密的话我自己也查不出来。防护靠的是库文件本身的访问控制。
 */

const KEYS = {
  baseUrl: 'ai.baseUrl',
  apiKey: 'ai.apiKey',
  model: 'ai.model',
} as const;

export type AiConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 这几项是不是来自数据库（使用者自己填的），而不是 .env */
  fromDb: boolean;
};

export async function getAiConfig(): Promise<AiConfig> {
  const rows = await db.setting.findMany({
    where: { key: { in: Object.values(KEYS) } },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));

  const pick = (k: string, envValue: string | undefined) => {
    const v = map.get(k);
    return v && v.trim() ? v.trim() : (envValue ?? '').trim();
  };

  return {
    baseUrl: pick(KEYS.baseUrl, process.env.AI_BASE_URL),
    apiKey: pick(KEYS.apiKey, process.env.AI_API_KEY),
    model: pick(KEYS.model, process.env.AI_MODEL),
    fromDb: Boolean(map.get(KEYS.apiKey)?.trim()),
  };
}

export type SaveResult = { ok: true } | { ok: false; error: string };

/**
 * 保存配置。
 *
 * **空的 apiKey 表示「不改」**，不是「清空」。设置页上那个框显示的是打码后的
 * 值，用户没动它就不该把 key 洗掉 —— 这是密码表单的老规矩，照搬过来。
 * 真要清空走 `clearAiConfig()`。
 */
export async function setAiConfig(input: {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}): Promise<SaveResult> {
  const writes: { key: string; value: string }[] = [];

  const baseUrl = input.baseUrl?.trim();
  if (baseUrl !== undefined && baseUrl !== '') {
    if (!/^https?:\/\//i.test(baseUrl)) {
      return { ok: false, error: '接口地址要以 http:// 或 https:// 开头' };
    }
    writes.push({ key: KEYS.baseUrl, value: baseUrl });
  }

  const model = input.model?.trim();
  if (model) writes.push({ key: KEYS.model, value: model });

  const apiKey = input.apiKey?.trim();
  if (apiKey) {
    // 手机上复制粘贴很容易带上空格或者换行，先清掉再校验，
    // 否则请求头里带个 \n 会报一个跟 key 完全无关的错
    const cleaned = apiKey.replace(/\s+/g, '');
    if (cleaned.length < 8) return { ok: false, error: 'API Key 看起来不完整' };
    writes.push({ key: KEYS.apiKey, value: cleaned });
  }

  if (!writes.length) return { ok: false, error: '没有要改的内容' };

  await db.$transaction(
    writes.map((w) =>
      db.setting.upsert({
        where: { key: w.key },
        create: w,
        update: { value: w.value },
      })
    )
  );
  return { ok: true };
}

/** 清掉库里的配置，退回 `.env` 那份 */
export async function clearAiConfig(): Promise<void> {
  await db.setting.deleteMany({ where: { key: { in: Object.values(KEYS) } } });
}

/**
 * 打码给界面看。`sk-abcd...wxyz` 这样。
 *
 * 留头尾是有用的：使用者手里可能有好几个 key，光看 `****` 分不清填的是哪个。
 */
export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 12) return key.slice(0, 2) + '****';
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

/**
 * 拿当前配置真打一次模型，用来验「这个 key 到底能不能用」。
 *
 * 值得单独做一个：不验的话，填错 key 的唯一症状是聊天时冒一句看不懂的报错，
 * 而使用者根本分不清是 key 错了、网络不通、还是余额没了。
 */
export async function testAiConfig(cfg?: AiConfig): Promise<SaveResult> {
  const c = cfg ?? (await getAiConfig());
  if (!c.apiKey) return { ok: false, error: '还没填 API Key' };
  if (!c.baseUrl) return { ok: false, error: '还没填接口地址' };
  if (!c.model) return { ok: false, error: '还没填模型名' };

  try {
    const res = await fetch(`${c.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${c.apiKey}`,
      },
      body: JSON.stringify({
        model: c.model,
        messages: [{ role: 'user', content: '回答一个字：好' }],
        max_tokens: 16,
        stream: false,
      }),
      // 服务商抽风时别让页面一直转圈
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const body = await res.text();
      // 把服务商的原话带出来。自己编一句「连接失败」的话，
      // 「余额不足」和「key 写错了」就变成同一个提示了。
      const detail = body.slice(0, 300).replace(/\s+/g, ' ');
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: `API Key 被拒绝（${res.status}）。${detail}` };
      }
      if (res.status === 404) {
        return { ok: false, error: `接口地址或模型名不对（404）。${detail}` };
      }
      return { ok: false, error: `服务商返回 ${res.status}。${detail}` };
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const reply = data.choices?.[0]?.message?.content;
    if (typeof reply !== 'string') {
      return { ok: false, error: '接口通了，但返回的格式看不懂 —— 确认这是 OpenAI 兼容接口' };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/timeout|abort/i.test(msg)) return { ok: false, error: '30 秒没响应，检查网络或者接口地址' };
    return { ok: false, error: `连不上：${msg}` };
  }
}
