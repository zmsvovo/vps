const { checkStock } = require('./checker');

// WHMCS 商品页常见链接格式:
//   ?cmd=cart&action=add&id=xxx
//   cart.php?a=add&pid=xxx
//   cart.php?a=confproduct&i=xxx
const WHMCS_URL_PATTERN = /(?:cmd=cart&action=add|cart\.php\?(?:a=add&pid|a=confproduct&i)=)/i;

/**
 * 验证 URL 是否有效
 * @param {string} url
 * @returns {Promise<{valid: boolean, error?: string, title?: string, inStock?: boolean}>}
 */
async function validateUrl(url) {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: '请输入 URL' };
  }

  url = url.trim();

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return { valid: false, error: 'URL 必须以 http:// 或 https:// 开头' };
  }

  if (!WHMCS_URL_PATTERN.test(url)) {
    return { valid: false, error: '链接不是有效的 WHMCS 商品页面（缺少 ?cmd=cart&action=add）' };
  }

  try {
    const result = await checkStock(url);

    // 区分网络错误和缺货
    // 网络错误：超时、404、DNS 失败等
    // 缺货：页面正常返回，只是商品 unavailable
    if (result.error) {
      // 如果有 title 但 error 是缺货信息 → 页面可达，只是缺货
      if (result.title) {
        return { valid: true, title: result.title, inStock: false };
      }
      // 无 title → 可能是网络问题
      return { valid: false, error: `无法访问该链接: ${result.error}` };
    }

    return { valid: true, title: result.title, inStock: true };
  } catch (err) {
    return { valid: false, error: `验证失败: ${err.message}` };
  }
}

module.exports = { validateUrl };
