const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(__dirname, '..', 'data', 'monitor.db');

let db;

function ensureDataDir() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function getDb() {
  if (db) return db;

  ensureDataDir();
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA foreign_keys=ON');
  initSchema();
  saveDb();
  return db;
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function initSchema() {
  // 用 strftime 显式加 Z 后缀，否则 JS 解析时会当成本地时间
  db.run(`
    CREATE TABLE IF NOT EXISTS monitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_status TEXT NOT NULL DEFAULT 'unknown',
      last_checked_at TEXT,
      last_in_stock_at TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS check_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monitor_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      checked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  const row = db.exec("SELECT value FROM settings WHERE key = 'interval_minutes'");
  if (row.length === 0) {
    db.run("INSERT INTO settings (key, value) VALUES ('interval_minutes', '10')");
  }
  saveDb();
}

// ---- monitors ----
function getAllMonitors() {
  return db.exec('SELECT * FROM monitors ORDER BY created_at DESC')[0]?.values.map(rowToMonitor) || [];
}

function getMonitor(id) {
  const result = db.exec('SELECT * FROM monitors WHERE id = ?', [id]);
  if (!result[0]?.values.length) return null;
  return rowToMonitor(result[0].values[0]);
}

function addMonitor(name, url) {
  db.run('INSERT INTO monitors (name, url, created_at) VALUES (?, ?, ?)', [name, url, new Date().toISOString()]);
  saveDb();
  const result = db.exec('SELECT last_insert_rowid()');
  return result[0].values[0][0];
}

function deleteMonitor(id) {
  // cascade delete check_logs
  db.run('DELETE FROM check_logs WHERE monitor_id = ?', [id]);
  db.run('DELETE FROM monitors WHERE id = ?', [id]);
  saveDb();
}

function toggleMonitor(id) {
  const monitor = getMonitor(id);
  if (!monitor) return null;
  const newActive = monitor.is_active ? 0 : 1;
  db.run('UPDATE monitors SET is_active = ? WHERE id = ?', [newActive, id]);
  saveDb();
  return { ...monitor, is_active: newActive };
}

function updateMonitorStatus(id, status, errorMessage) {
  const now = new Date().toISOString();

  if (status === 'in_stock') {
    db.run(
      'UPDATE monitors SET last_status = ?, last_checked_at = ?, error_message = ?, last_in_stock_at = ? WHERE id = ?',
      [status, now, errorMessage || null, now, id]
    );
  } else {
    db.run(
      'UPDATE monitors SET last_status = ?, last_checked_at = ?, error_message = ? WHERE id = ?',
      [status, now, errorMessage || null, id]
    );
  }
  saveDb();
}

// ---- check_logs ----
function addCheckLog(monitorId, status, message) {
  db.run(
    'INSERT INTO check_logs (monitor_id, status, message, checked_at) VALUES (?, ?, ?, ?)',
    [monitorId, status, message || null, new Date().toISOString()]
  );
  saveDb();
}

function getCheckLogs(monitorId, limit = 50) {
  const result = db.exec(
    'SELECT * FROM check_logs WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT ?',
    [monitorId, limit]
  );
  if (!result[0]) return [];
  const columns = result[0].columns;
  return result[0].values.map(row => {
    const obj = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}

// ---- settings ----
function getSetting(key) {
  const result = db.exec('SELECT value FROM settings WHERE key = ?', [key]);
  if (!result[0]?.values.length) return null;
  return result[0].values[0][0];
}

function setSetting(key, value) {
  db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value)]);
  saveDb();
}

function getIntervalMinutes() {
  const val = getSetting('interval_minutes');
  return parseInt(val, 10) || 10;
}

function getTelegramSettings() {
  const enabled = getSetting('telegram_enabled');
  return {
    enabled: enabled === null ? true : enabled === '1',
    bot_token: getSetting('telegram_bot_token') || '',
    chat_id: getSetting('telegram_chat_id') || '',
  };
}

function setTelegramSettings(settings) {
  if (Object.prototype.hasOwnProperty.call(settings, 'enabled')) {
    setSetting('telegram_enabled', settings.enabled ? '1' : '0');
  }
  if (Object.prototype.hasOwnProperty.call(settings, 'bot_token')) {
    setSetting('telegram_bot_token', settings.bot_token);
  }
  if (Object.prototype.hasOwnProperty.call(settings, 'chat_id')) {
    setSetting('telegram_chat_id', settings.chat_id);
  }
}

// ---- helpers ----
const MONITOR_COLUMNS = ['id', 'name', 'url', 'is_active', 'last_status', 'last_checked_at', 'last_in_stock_at', 'error_message', 'created_at'];

function rowToMonitor(row) {
  const obj = {};
  MONITOR_COLUMNS.forEach((col, i) => {
    obj[col] = row[i];
  });
  obj.is_active = !!obj.is_active;
  return obj;
}

// expose saveDb for periodic flush if needed
module.exports = {
  initDb: getDb,
  saveDb,
  getAllMonitors,
  getMonitor,
  addMonitor,
  deleteMonitor,
  toggleMonitor,
  updateMonitorStatus,
  addCheckLog,
  getCheckLogs,
  getSetting,
  setSetting,
  getIntervalMinutes,
  getTelegramSettings,
  setTelegramSettings,
};
