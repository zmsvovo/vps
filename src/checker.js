const http = require('http');
const https = require('https');

const TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 5;

/**
 * 检查单个 WHMCS 商品页面库存
 * @param {string} url
 * @returns {Promise<{inStock: boolean, title: string, error?: string}>}
 */
function checkStock(url) {
  return requestStockPage(url, 0);
}

function requestStockPage(url, redirectCount) {
  return new Promise((resolve) => {
    let parsedUrl;

    try {
      parsedUrl = new URL(url);
    } catch (err) {
      resolve({ inStock: false, title: '', error: 'URL 格式无效' });
      return;
    }

    const client = parsedUrl.protocol === 'https:' ? https : http;

    const req = client.get(parsedUrl, { timeout: TIMEOUT_MS }, (res) => {
      if (isRedirect(res.statusCode) && res.headers.location) {
        res.resume();

        if (redirectCount >= MAX_REDIRECTS) {
          resolve({ inStock: false, title: '', error: '重定向次数过多' });
          return;
        }

        const nextUrl = new URL(res.headers.location, parsedUrl).toString();
        resolve(requestStockPage(nextUrl, redirectCount + 1));
        return;
      }

      if (res.statusCode !== 200) {
        readResponseBody(res, (body) => {
          resolve({ inStock: false, title: '', error: describeHttpError(res.statusCode, body) });
        });
        return;
      }

      readResponseBody(res, (body) => {
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

function isRedirect(statusCode) {
  return [301, 302, 303, 307, 308].includes(statusCode);
}

function readResponseBody(res, onEnd) {
  let body = '';
  res.on('data', (chunk) => { body += chunk; });
  res.on('end', () => onEnd(body));
}

function describeHttpError(statusCode, body) {
  if (statusCode === 403 && /cloudflare|just a moment|challenge-platform|cf-browser-verification/i.test(body)) {
    return 'HTTP 403（Cloudflare 访问验证阻止了检测）';
  }

  return `HTTP ${statusCode}`;
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
