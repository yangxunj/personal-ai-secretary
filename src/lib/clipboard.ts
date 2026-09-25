/**
 * 复制到剪贴板。
 *
 * navigator.clipboard 只在安全上下文（HTTPS / localhost）可用。
 * **自签证书不算安全上下文** —— 没有域名、没备案之前就是这个处境，
 * 那个 API 在手机浏览器里直接不存在。所以要降级到 execCommand ——
 * 它虽然废弃了，但在非安全上下文仍然能用，是这个场景下唯一可行的办法。
 * 等备案下来、换成正式证书，走的就是上面那条正路了。
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 落到下面的降级方案
    }
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    // 不能用 display:none 或 visibility:hidden，那样选不中
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);

    ta.focus();
    ta.select();
    // iOS Safari 只认 setSelectionRange
    ta.setSelectionRange(0, ta.value.length);

    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
