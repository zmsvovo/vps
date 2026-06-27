const { checkStock } = require('./checker');

// WHMCS 商品页常见链接格式:
//   ?cmd=cart&action=add&id=xxx
//   cart.php?a=add&pid=xxx
//   cart.php?a=confproduct&i=xxx
//   /store/group/product
const STORE_PRODUCT_PATH_PATTERN = /^\/store\/[^/?#]+\/[^/?#]+\/?$/i;

function isSupportedProductUrl(rawUrl) {
  let parsedUrl;

  try {
    parsedUrl = new URL(rawUrl);
  } catch (err) {
    return false;
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return false;
  }

  if (isWhmcsCartUrl(parsedUrl) || STORE_PRODUCT_PATH_PATTERN.test(parsedUrl.pathname)) {
    return true;
  }

  return false;
}

function isWhmcsCartUrl(parsedUrl) {
  const params = parsedUrl.searchParams;
  const cmd = (params.get('cmd') || '').toLowerCase();
  const action = (params.get('action') || '').toLowerCase();

  if (cmd === 'cart' && action === 'add') {
    return true;
  }

  if (!/\/cart\.php$/i.test(parsedUrl.pathname)) {
    return false;
  }

  const cartAction = (params.get('a') || '').toLowerCase();
  return (cartAction === 'add' && params.has('pid')) || (cartAction === 'confproduct' && params.has('i'));
}

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

  if (!isSupportedProductUrl(url)) {
    return { valid: false, error: '链接不是有效的 WHMCS 商品页面（支持购物车参数链接或 /store/分类/商品 链接）' };
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

module.exports = { validateUrl, isSupportedProductUrl };
