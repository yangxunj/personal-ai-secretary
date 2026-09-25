'use client';

import { useState } from 'react';
import { PROVIDERS, modelSeesImages, providerOf, type ProviderId } from '@/lib/ai-providers';

const INPUT =
  'mt-1 w-full rounded-xl border px-3.5 py-2.5 text-[15px] bg-transparent outline-none focus:border-brand-500 transition';

/**
 * 设置页「AI 模型」表单里的字段：服务商 + key + 模型名 + 接口地址。
 *
 * 选服务商 = 一键填好接口地址和模型名。原来只有一个「接口地址（一般不用动）」，
 * 想用 DeepSeek 官方的人得自己知道地址是 https://api.deepseek.com。
 *
 * ⚠ **换了服务商，key 必须重填。** 百炼的 key 拿去打 DeepSeek 官方必然 401；
 * 留空提交的语义是「key 不改」，那样存下来的就是一个注定不通的组合。
 * 所以一旦选的跟现在存的不是同一家，key 框就变成必填。
 */
export default function ProviderFields({
  baseUrl,
  model,
  keyPlaceholder,
  keySource,
}: {
  baseUrl: string;
  model: string;
  keyPlaceholder: string;
  /** 当前 key 从哪来的那句说明；没存过 key 时为 null */
  keySource: string | null;
}) {
  const saved = providerOf(baseUrl);
  const [pid, setPid] = useState<ProviderId>(saved);
  const [url, setUrl] = useState(baseUrl);
  const [mdl, setMdl] = useState(model);

  const preset = PROVIDERS.find((p) => p.id === pid);
  const switched = pid !== saved;

  function pick(id: ProviderId) {
    setPid(id);
    const p = PROVIDERS.find((x) => x.id === id);
    if (p) {
      setUrl(p.baseUrl);
      setMdl(p.model);
    } else if (id !== saved) {
      // 自定义：清空让人自己填，别留着上一家的地址冒充
      setUrl('');
      setMdl('');
    } else {
      setUrl(baseUrl);
      setMdl(model);
    }
  }

  return (
    <>
      <div>
        <span className="muted text-[12px]">服务商</span>
        <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-label="服务商">
          {[...PROVIDERS.map((p) => ({ id: p.id as ProviderId, label: p.label })), { id: 'custom' as ProviderId, label: '其他（自己填地址）' }].map(
            (o) => {
              const on = pid === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => pick(o.id)}
                  className={`rounded-xl border px-3.5 py-2 text-[14px] transition ${
                    on ? 'border-brand-500 bg-brand-500/10 text-brand-600 dark:text-brand-300 font-medium' : 'muted'
                  }`}
                  style={on ? undefined : { borderColor: 'var(--border)' }}
                >
                  {o.label}
                </button>
              );
            },
          )}
        </div>
        {preset && (
          <p className="muted text-[11px] leading-relaxed mt-1.5">
            {preset.search
              ? '对话时会按需联网搜索（天气、新闻、价格这类），回答里附来源。'
              : '这家不能联网搜索，只凭模型自己知道的回答。'}
          </p>
        )}
      </div>

      <label className="block">
        <span className="muted text-[12px]">API Key</span>
        <input
          type="password"
          name="apiKey"
          autoComplete="off"
          required={switched}
          // 显示打码后的值当占位符：留空提交就是「不改」。
          // 不这么做的话，使用者只想换个模型名，一提交就把 key 清了。
          placeholder={switched ? `填 ${preset?.label ?? '这家服务商'} 的 key` : keyPlaceholder}
          className={INPUT}
          style={{ borderColor: 'var(--border)' }}
        />
        <span className="muted text-[11px] leading-relaxed block mt-1">
          {switched
            ? `换了服务商，原来那个 key 在这家用不了，要填新的。${preset ? preset.keyHint + '。' : ''}`
            : (keySource ?? preset?.keyHint ?? '服务商给的密钥，形如 sk-xxxxxxxx')}
        </span>
      </label>

      <label className="block">
        <span className="muted text-[12px]">模型名</span>
        <input
          type="text"
          name="model"
          value={mdl}
          onChange={(e) => setMdl(e.target.value)}
          placeholder={preset?.model ?? '服务商文档里的模型 ID'}
          className={INPUT}
          style={{ borderColor: 'var(--border)' }}
        />
        {pid === 'deepseek' && (
          <span className="muted text-[11px] leading-relaxed block mt-1">
            deepseek-flash 快、便宜、能看图；deepseek-v4-pro 更强，但看不了图。
          </span>
        )}
        {!modelSeesImages({ baseUrl: url, model: mdl }) && (
          <span className="text-[11px] leading-relaxed block mt-1 text-amber-600 dark:text-amber-400">
            这个模型看不了图片：发照片给它会照常存档，但它读不出内容 ——
            体检报告、账单截图这类要靠看图录入的，换成 deepseek-flash。
          </span>
        )}
      </label>

      {/* 预设的地址折起来（一般不用动）；自定义时直接摊开，那是必填的 */}
      <details open={pid === 'custom'}>
        <summary className="muted text-[12px] cursor-pointer select-none">
          接口地址{pid === 'custom' ? '' : '（选了服务商就不用动）'}
        </summary>
        <input
          type="text"
          name="baseUrl"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            // 手改地址后按新地址重新认一次是哪家，服务商那排跟着变
            setPid(providerOf(e.target.value));
          }}
          required={pid === 'custom'}
          placeholder="https://…/v1"
          className="mt-2 w-full rounded-xl border px-3.5 py-2.5 text-[13px] bg-transparent outline-none focus:border-brand-500 transition"
          style={{ borderColor: 'var(--border)' }}
        />
        <span className="muted text-[11px] leading-relaxed block mt-1">
          任何 OpenAI 兼容的接口都行。
        </span>
      </details>
    </>
  );
}
