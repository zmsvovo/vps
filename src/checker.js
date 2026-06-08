const http = require('http');
const https = require('https');

const TIMEOUT_MS = 15000;

/**
 * 检查单个 WHMCS 商品页面库存
 * @param {string} url
 * @returns {Promise<{inStock: boolean, title: string, error?: string}>}
 */
function checkStock(url) {
  return new Promise((resolve) => {
    const isHttps = url.startsWith('https');
    const client = isHttps ? https : http;

    const req = client.get(url, { timeout: TIMEOUT_MS }, (res) => {
      if (res.statusCode !== 200) {
        resolve({ inStock: false, title: '', error: `HTTP ${res.statusCode}` });
        return;
      }

      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve(parsePage(body));
      });
    });

    req.on('error', (err) => {
      resolve({ inStock: false, title: '', error: `请求失败: ${err.message}` });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ inStock: false, title: '', error: '请求超时' });
    });
  });
}

/**
 * 解析页面内容判断库存
 */
function parsePage(html) {
  // 提取 title
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';

  // 检查 errors 数组中是否有 unavailable
  // WHMCS 缺货时: var errors = ["...is currently unavailable"];
  const hasUnavailableError = /errors\s*=\s*\[[^\]]*unavailable/i.test(html);
  if (hasUnavailableError) {
    // 提取具体的错误信息
    const errorMatch = html.match(/errors\s*=\s*\[([^\]]*)\]/i);
    const errorMsg = errorMatch ? errorMatch[1].replace(/["']/g, '').trim() : '缺货';
    return { inStock: false, title, error: errorMsg };
  }

  // 其他缺货关键词
  const outOfStockPatterns = [
    /out\s*of\s*stock/i,
    /currently\s+unavailable/i,
    /sold\s*out/i,
    /no\s+longer\s+available/i,
    /product\s+is\s+disabled/i,
    /this\s+product\s+is\s+not\s+available/i,
  ];

  for (const pattern of outOfStockPatterns) {
    if (pattern.test(html)) {
      return { inStock: false, title, error: '商品缺货' };
    }
  }

  // 无缺货标记 → 有货
  return { inStock: true, title };
}

module.exports = { checkStock };
