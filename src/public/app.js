/* global io */
const socket = io();

// 东八区时间格式化
const TZ = 'Asia/Shanghai';

// SQLite 的 datetime('now') 生成的字符串不带时区后缀
// 旧数据可能缺少 'Z'，浏览器会当成本地时间解析，导致时间偏移
function fixISO(s) {
  if (!s) return s;
  // 已有时区标记的不动（Z 或 ±HH:MM）
  if (/[Zz]$/.test(s) || /[+-]\d{2}:\d{2}$/.test(s) || /[+-]\d{4}$/.test(s)) return s;
  // 补齐 UTC 标记
  return s + 'Z';
}

function formatTimeUTC8(iso) {
  if (!iso) return '';
  return new Date(fixISO(iso)).toLocaleString('zh-CN', { timeZone: TZ });
}

function formatDateUTC8(iso) {
  if (!iso) return '';
  return new Date(fixISO(iso)).toLocaleDateString('zh-CN', { timeZone: TZ });
}

// DOM refs
const monitorList = document.getElementById('monitorList');
const emptyState = document.getElementById('emptyState');
const statStock = document.getElementById('statStock');
const statOut = document.getElementById('statOut');
const statError = document.getElementById('statError');
const notificationBanner = document.getElementById('notificationBanner');
const intervalInput = document.getElementById('interval');
const saveIntervalBtn = document.getElementById('saveInterval');
const validateBtn = document.getElementById('validateBtn');
const addBtn = document.getElementById('addBtn');
const newName = document.getElementById('newName');
const newUrl = document.getElementById('newUrl');
const addStatus = document.getElementById('addStatus');
const telegramEnabled = document.getElementById('telegramEnabled');
const telegramToken = document.getElementById('telegramToken');
const telegramChatId = document.getElementById('telegramChatId');
const telegramStatus = document.getElementById('telegramStatus');
const saveTelegramBtn = document.getElementById('saveTelegram');
const testTelegramBtn = document.getElementById('testTelegram');

// ---- Notification permission ----
function requestNotificationPermission() {
  if (!('Notification' in window)) {
    showBanner('warning', '此浏览器不支持桌面通知');
    return;
  }
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }
  updateBanner();
}

function updateBanner() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    showBanner('warning', '🔔 浏览器桌面通知未开启，有货时将无法弹窗提醒。请允许通知权限。');
  } else if (Notification.permission === 'granted') {
    showBanner('success', '✅ 桌面通知已开启，有货时会自动弹窗');
  } else {
    showBanner('warning', '🔕 通知已被拒绝，请在浏览器设置中手动开启通知权限');
  }
}

function showBanner(type, msg) {
  notificationBanner.className = `notification-banner ${type}`;
  notificationBanner.textContent = msg;
  notificationBanner.style.display = 'block';
}

let bannerTimer = null;
function showTempBanner(type, msg, duration) {
  showBanner(type, msg);
  if (bannerTimer) clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => {
    notificationBanner.style.display = 'none';
  }, duration || 5000);
}

function hideBanner() {
  notificationBanner.style.display = 'none';
}

// ---- Desktop notification ----
function sendDesktopNotification(monitor) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const body = monitor.status === 'in_stock'
    ? `${monitor.name} 有货了！点击前往`
    : `${monitor.name} 变为缺货`;

  const notif = new Notification('📦 VPS 库存变动', {
    body,
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">📦</text></svg>',
  });

  notif.onclick = () => {
    window.focus();
    if (monitor.url) window.open(monitor.url, '_blank');
    notif.close();
  };
}

// ---- Monitor list rendering ----
async function loadMonitors() {
  const res = await fetch('/api/monitors');
  const monitors = await res.json();
  renderMonitors(monitors);
}

function renderMonitors(monitors) {
  if (monitors.length === 0) {
    monitorList.innerHTML = '';
    emptyState.style.display = 'block';
    updateStats(monitors);
    return;
  }
  emptyState.style.display = 'none';

  let html = '';
  for (const m of monitors) {
    html += `
      <div class="swipe-row" data-id="${m.id}">
        <div class="swipe-inner">
          <div class="swipe-front">
            <div class="row-status">
              <span class="status-dot ${m.last_status}"></span>
              <span class="status-label">${statusLabel(m.last_status)}</span>
            </div>
            <div class="row-info">
              <div class="monitor-name">${escHtml(m.name)}</div>
              <div class="monitor-url" title="点击复制链接">${escHtml(m.url)}</div>
              ${m.error_message ? `<div class="row-error">${escHtml(m.error_message)}</div>` : ''}
            </div>
            <div class="row-toggle">
              <label class="toggle">
                <input type="checkbox" ${m.is_active ? 'checked' : ''} onchange="toggleMonitor(${m.id})">
                <span class="slider"></span>
              </label>
              ${m.is_active ? '<span class="toggle-label on">启用</span>' : '<span class="toggle-label off">暂停</span>'}
            </div>
            <div class="row-time" data-checked-at="${m.last_checked_at || ''}">${timeAgo(m.last_checked_at)}</div>
            <div class="row-actions">
              <button class="btn btn-sm btn-outline" onclick="openUrl(${m.id})">跳转</button>
              <button class="btn btn-sm btn-outline" onclick="toggleLogs(${m.id})">日志</button>
            </div>
          </div>
          <div class="swipe-back">
            <button class="btn-del" onclick="deleteMonitor(${m.id})">删除</button>
          </div>
        </div>
        <div id="logs-${m.id}" class="logs-panel" style="display:none">
          <div id="logs-content-${m.id}">加载中...</div>
        </div>
      </div>
    `;
  }
  monitorList.innerHTML = html;
  updateStats(monitors);

  // 绑定滑动事件
  document.querySelectorAll('.swipe-row').forEach(initSwipe);
}

// ---- Swipe ----
let activeSwipeRow = null;

function initSwipe(row) {
  const inner = row.querySelector('.swipe-inner');
  const threshold = 60;
  let startX = 0;
  let currentX = 0;
  let isDragging = false;

  function onStart(x) {
    // 收起其他展开的
    if (activeSwipeRow && activeSwipeRow !== row) {
      activeSwipeRow.querySelector('.swipe-inner').style.transform = '';
      activeSwipeRow.classList.remove('swiping');
    }
    startX = x;
    isDragging = true;
    row.classList.add('swiping');
    inner.style.transition = 'none';
  }

  function onMove(x) {
    if (!isDragging) return;
    currentX = x - startX;
    if (currentX > 0) currentX = 0; // 只往左滑
    if (currentX < -120) currentX = -120;
    inner.style.transform = `translateX(${currentX}px)`;
  }

  function onEnd() {
    if (!isDragging) return;
    isDragging = false;
    inner.style.transition = 'transform 0.2s ease';

    if (currentX < -threshold) {
      inner.style.transform = 'translateX(-80px)';
      activeSwipeRow = row;
      row.classList.add('revealed');
    } else {
      inner.style.transform = '';
      row.classList.remove('revealed');
      activeSwipeRow = null;
    }
    row.classList.remove('swiping');
  }

  // Touch events
  row.addEventListener('touchstart', (e) => {
    onStart(e.touches[0].clientX);
  }, { passive: true });
  row.addEventListener('touchmove', (e) => {
    onMove(e.touches[0].clientX);
  }, { passive: true });
  row.addEventListener('touchend', onEnd, { passive: true });

  // Mouse events (桌面拖拽)
  row.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    onStart(e.clientX);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  function onMouseMove(e) { onMove(e.clientX); }
  function onMouseUp() {
    onEnd();
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }

  // URL 点击复制
  const urlEl = row.querySelector('.monitor-url');
  urlEl.addEventListener('click', () => {
    navigator.clipboard.writeText(urlEl.textContent).then(() => {
      const orig = urlEl.textContent;
      urlEl.textContent = '✅ 已复制';
      urlEl.classList.add('copied');
      setTimeout(() => {
        urlEl.textContent = orig;
        urlEl.classList.remove('copied');
      }, 1200);
    }).catch(() => {
      // fallback: 选中文本
      const range = document.createRange();
      range.selectNodeContents(urlEl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
  });
}

// 收起滑动
function collapseSwipe() {
  if (activeSwipeRow) {
    const inner = activeSwipeRow.querySelector('.swipe-inner');
    inner.style.transition = 'transform 0.2s ease';
    inner.style.transform = '';
    activeSwipeRow.classList.remove('revealed');
    activeSwipeRow = null;
  }
}

function updateStats(monitors) {
  let stock = 0, out = 0, err = 0;
  for (const m of monitors) {
    if (m.last_status === 'in_stock') stock++;
    else if (m.last_status === 'out_of_stock') out++;
    else if (m.last_status === 'error') err++;
  }
  statStock.textContent = stock;
  statOut.textContent = out;
  statError.textContent = err;
}

function statusLabel(s) {
  const map = { in_stock: '有货', out_of_stock: '缺货', error: '异常', unknown: '未知' };
  return map[s] || s;
}

function timeAgo(iso) {
  if (!iso) return '从未';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  return formatDateUTC8(iso);
}

function escHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// ---- Monitor actions ----
function openUrl(id) {
  // 从数据中找 URL
  fetch('/api/monitors').then(r => r.json()).then(monitors => {
    const m = monitors.find(x => x.id === id);
    if (m) window.open(m.url, '_blank');
  });
}

async function toggleMonitor(id) {
  await fetch(`/api/monitors/${id}/toggle`, { method: 'PUT' });
  loadMonitors();
}

async function deleteMonitor(id) {
  if (!confirm('确定删除此监控？')) return;
  await fetch(`/api/monitors/${id}`, { method: 'DELETE' });
  loadMonitors();
}

async function toggleLogs(id) {
  const row = document.getElementById(`logs-${id}`);
  const isHidden = row.style.display === 'none';
  row.style.display = isHidden ? 'table-row' : 'none';
  if (isHidden) {
    const res = await fetch(`/api/monitors/${id}/logs`);
    const logs = await res.json();
    const content = document.getElementById(`logs-content-${id}`);
    const inStockLogs = logs.filter(l => l.status === 'in_stock');
    if (inStockLogs.length === 0) {
      content.textContent = '暂无有货记录';
    } else {
      content.innerHTML = inStockLogs.map(l => {
        return `<div class="log-entry">
          <span class="log-time">${formatTimeUTC8(l.checked_at)}</span>
        </div>`;
      }).join('');
    }
  }
}

// ---- Add / Validate ----
let validatedUrl = null;

validateBtn.addEventListener('click', async () => {
  const url = newUrl.value.trim();
  if (!url) {
    showAddError('请输入 URL');
    return;
  }

  validateBtn.disabled = true;
  validateBtn.innerHTML = '<span class="form-spinner"></span> 验证中...';
  addStatus.style.display = 'none';

  try {
    const res = await fetch('/api/monitors/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();

    if (data.valid) {
      validatedUrl = url;
      showAddSuccess('链接有效' + (data.title ? ` - ${data.title}` : ''), '#22c55e');
    } else {
      validatedUrl = null;
      showAddError(data.error || '链接无效');
    }
  } catch (err) {
    validatedUrl = null;
    showAddError('验证请求失败');
  } finally {
    validateBtn.disabled = false;
    validateBtn.textContent = '验证链接';
  }
});

addBtn.addEventListener('click', async () => {
  const name = newName.value.trim();
  const url = newUrl.value.trim();
  if (!name || !url) {
    showAddError('名称和 URL 不能为空');
    return;
  }

  addBtn.disabled = true;
  addBtn.textContent = '添加中...';
  addStatus.style.display = 'none';

  try {
    const res = await fetch('/api/monitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, url }),
    });
    const data = await res.json();
    if (res.ok) {
      validatedUrl = null;
      newName.value = '';
      newUrl.value = '';
      showAddError('');
      loadMonitors();
      showTempBanner('success', `✅ 已添加监控: ${data.name}`, 3000);
    } else {
      // 如果因为 URL 不可达等验证失败
      if (data.error) {
        // 显示可读错误，如果包含"WHMCS"、"cart"等关键词，用户知道怎么改
      }
      showAddError(data.error || '添加失败');
    }
  } catch (err) {
    showAddError('请求失败');
  } finally {
    addBtn.disabled = false;
    addBtn.textContent = '添加';
  }
});

function showAddError(msg) {
  if (!msg) { addStatus.style.display = 'none'; return; }
  addStatus.textContent = '❌ ' + msg;
  addStatus.className = 'form-error';
  addStatus.style.display = 'block';
}

function showAddSuccess(msg) {
  addStatus.textContent = '✅ ' + msg;
  addStatus.className = 'form-success';
  addStatus.style.display = 'block';
}

// ---- Interval ----
saveIntervalBtn.addEventListener('click', async () => {
  const val = parseInt(intervalInput.value, 10);
  if (isNaN(val) || val < 1 || val > 1440) {
    showTempBanner('warning', '间隔必须为 1-1440 分钟', 3000);
    return;
  }

  saveIntervalBtn.disabled = true;
  saveIntervalBtn.textContent = '保存中...';

  try {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interval_minutes: val }),
    });
    if (res.ok) {
      showTempBanner('success', `✅ 检测间隔已改为 ${val} 分钟`, 3000);
    }
  } catch (err) {
    showTempBanner('warning', '保存失败', 3000);
  } finally {
    saveIntervalBtn.disabled = false;
    saveIntervalBtn.textContent = '保存';
  }
});

// ---- Telegram ----
function applyTelegramSettings(data) {
  telegramEnabled.checked = data.enabled !== false;
  telegramChatId.value = data.chat_id || '';
  telegramToken.value = '';
  telegramToken.placeholder = data.bot_token_configured ? '已保存，留空保持不变' : '请输入 Bot Token';
}

async function loadTelegramSettings() {
  try {
    const res = await fetch('/api/telegram/settings');
    const data = await res.json();
    if (res.ok) {
      applyTelegramSettings(data);
    }
  } catch (err) {
    showTelegramStatus('error', 'Telegram 配置加载失败');
  }
}

function showTelegramStatus(type, msg) {
  telegramStatus.textContent = (type === 'success' ? '✅ ' : '❌ ') + msg;
  telegramStatus.className = type === 'success' ? 'form-success' : 'form-error';
  telegramStatus.style.display = 'block';
}

function buildTelegramSettingsBody() {
  const token = telegramToken.value.trim();
  const body = {
    enabled: telegramEnabled.checked,
    chat_id: telegramChatId.value.trim(),
  };
  if (token) {
    body.bot_token = token;
  }
  return body;
}

async function persistTelegramSettings(showSuccess) {
  const res = await fetch('/api/telegram/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildTelegramSettingsBody()),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Telegram 配置保存失败');
  }
  applyTelegramSettings(data);
  if (showSuccess) {
    showTelegramStatus('success', 'Telegram 配置已保存');
  }
  return data;
}

saveTelegramBtn.addEventListener('click', async () => {
  saveTelegramBtn.disabled = true;
  saveTelegramBtn.textContent = '保存中...';
  telegramStatus.style.display = 'none';

  try {
    await persistTelegramSettings(true);
  } catch (err) {
    showTelegramStatus('error', err.message || 'Telegram 配置保存失败');
  } finally {
    saveTelegramBtn.disabled = false;
    saveTelegramBtn.textContent = '保存 Telegram';
  }
});

testTelegramBtn.addEventListener('click', async () => {
  testTelegramBtn.disabled = true;
  saveTelegramBtn.disabled = true;
  testTelegramBtn.textContent = '发送中...';
  telegramStatus.style.display = 'none';

  try {
    await persistTelegramSettings(false);
    const res = await fetch('/api/telegram/test', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      showTelegramStatus('success', data.message || '测试消息已发送');
    } else {
      showTelegramStatus('error', data.error || '测试消息发送失败');
    }
  } catch (err) {
    showTelegramStatus('error', err.message || '测试消息发送失败');
  } finally {
    testTelegramBtn.disabled = false;
    saveTelegramBtn.disabled = false;
    testTelegramBtn.textContent = '发送测试消息';
  }
});

// ---- Socket.IO events ----
socket.on('check:result', (data) => {
  const row = monitorList.querySelector(`.swipe-row[data-id="${data.id}"]`);
  if (row) {
    const dot = row.querySelector('.status-dot');
    const label = row.querySelector('.status-label');
    if (dot) dot.className = `status-dot ${data.status}`;
    if (label) label.textContent = statusLabel(data.status);

    const timeEl = row.querySelector('.row-time');
    if (timeEl) {
      timeEl.textContent = timeAgo(data.checkedAt);
      timeEl.setAttribute('data-checked-at', data.checkedAt || '');
    }

    // 更新错误信息
    const infoEl = row.querySelector('.row-info');
    if (infoEl) {
      const existing = infoEl.querySelector('.row-error');
      if (existing) existing.remove();
      if (data.error) {
        const errDiv = document.createElement('div');
        errDiv.className = 'row-error';
        errDiv.textContent = data.error;
        infoEl.appendChild(errDiv);
      }
    }
  }
  loadMonitors(); // 刷新统计数据
});

socket.on('stock:change', (data) => {
  // 桌面通知
  if (data.status === 'in_stock') {
    sendDesktopNotification(data);
  }
});

socket.on('monitor:update', () => {
  loadMonitors();
});

socket.on('settings:update', (data) => {
  intervalInput.value = data.interval_minutes;
});

socket.on('telegram:update', (data) => {
  applyTelegramSettings(data);
});

// ---- Init ----
requestNotificationPermission();
loadMonitors();
loadTelegramSettings();

// 每 30 秒刷新相对时间显示
setInterval(() => {
  document.querySelectorAll('.row-time[data-checked-at]').forEach(el => {
    const iso = el.getAttribute('data-checked-at');
    if (iso) el.textContent = timeAgo(iso);
  });
}, 30000);

// 点击其他地方收起滑动
document.addEventListener('click', (e) => {
  if (activeSwipeRow && !activeSwipeRow.contains(e.target)) {
    collapseSwipe();
  }
});
