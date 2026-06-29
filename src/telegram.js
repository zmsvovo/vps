const db = require('./db');

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const REQUEST_TIMEOUT_MS = 10000;
const TZ = 'Asia/Shanghai';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isValidBotToken(token) {
  return /^\d+:[A-Za-z0-9_-]+$/.test(token);
}

function getTelegramSettings() {
  const settings = db.getTelegramSettings();
  const token = normalizeString(settings.bot_token);
  const chatId = normalizeString(settings.chat_id);
  return {
    enabled: settings.enabled,
    bot_token: token,
    chat_id: chatId,
    configured: Boolean(token && chatId),
  };
}

function getPublicTelegramSettings() {
  const settings = getTelegramSettings();
  return {
    enabled: settings.enabled,
    chat_id: settings.chat_id,
    bot_token_configured: Boolean(settings.bot_token),
    configured: settings.configured,
  };
}

function saveTelegramSettings(input = {}) {
  const changes = {};

  if (Object.prototype.hasOwnProperty.call(input, 'bot_token')) {
    const token = normalizeString(input.bot_token);
    if (token) {
      if (!isValidBotToken(token)) {
        throw new Error('机器人 token 格式不正确');
      }
      changes.bot_token = token;
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, 'chat_id')) {
    changes.chat_id = normalizeString(input.chat_id);
  }

  if (Object.prototype.hasOwnProperty.call(input, 'enabled')) {
    changes.enabled = input.enabled === true || input.enabled === 'true' || input.enabled === 1 || input.enabled === '1';
  }

  db.setTelegramSettings(changes);
  return getPublicTelegramSettings();
}

function formatTime() {
  return new Date().toLocaleString('zh-CN', { timeZone: TZ });
}

function statusLabel(status) {
  const map = {
    in_stock: '有货',
    out_of_stock: '缺货',
    error: '异常',
  };
  return map[status] || status;
}

function formatStockChangeMessage({ monitor, status, title }) {
  const heading = status === 'in_stock' ? '✅ VPS 库存有货' : '📦 VPS 库存状态变化';
  const lines = [
    heading,
    `名称: ${monitor.name}`,
    `状态: ${statusLabel(status)}`,
  ];

  if (title) {
    lines.push(`标题: ${title}`);
  }

  lines.push(`链接: ${monitor.url}`);
  lines.push(`时间: ${formatTime()}`);
  return lines.join('\n');
}

async function sendTelegramMessage(text, options = {}) {
  const settings = getTelegramSettings();

  if (!settings.enabled && !options.ignoreEnabled) {
    return { ok: true, skipped: true, reason: 'Telegram 通知未启用' };
  }

  if (!settings.bot_token) {
    if (options.optional) {
      return { ok: true, skipped: true, reason: 'Telegram token 未配置' };
    }
    throw new Error('请先配置 Telegram 机器人 token');
  }

  if (!isValidBotToken(settings.bot_token)) {
    throw new Error('Telegram 机器人 token 格式不正确');
  }

  if (!settings.chat_id) {
    if (options.optional) {
      return { ok: true, skipped: true, reason: 'Telegram Chat ID 未配置' };
    }
    throw new Error('请先配置 Telegram Chat ID');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${settings.bot_token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: settings.chat_id,
        text,
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);

    if (!response.ok || data?.ok === false) {
      throw new Error(data?.description || `Telegram 请求失败: HTTP ${response.status}`);
    }

    return { ok: true, result: data?.result || null };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Telegram 请求超时');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function sendStockChangeNotification({ monitor, status, title }) {
  const message = formatStockChangeMessage({ monitor, status, title });
  return sendTelegramMessage(message, { optional: true });
}

function sendTelegramTestMessage() {
  return sendTelegramMessage(`✅ VPS 库存监控测试消息\n时间: ${formatTime()}`, { ignoreEnabled: true });
}

module.exports = {
  getPublicTelegramSettings,
  saveTelegramSettings,
  sendStockChangeNotification,
  sendTelegramTestMessage,
};
