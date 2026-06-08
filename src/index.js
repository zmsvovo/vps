const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const db = require('./db');
const { validateUrl } = require('./validator');
const Scheduler = require('./scheduler');

const PORT = 9911;
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Socket.IO
const scheduler = new Scheduler(io);

io.on('connection', (socket) => {
  socket.emit('settings:update', {
    interval_minutes: db.getIntervalMinutes(),
  });
});

io.on('connection', (socket) => {
  socket.emit('settings:update', {
    interval_minutes: db.getIntervalMinutes(),
  });
});

// API
app.get('/api/monitors', (req, res) => {
  res.json(db.getAllMonitors());
});

app.post('/api/monitors', async (req, res) => {
  const { name, url } = req.body;
  if (!name || !url) return res.status(400).json({ error: '名称和 URL 不能为空' });

  // 先验证
  const validation = await validateUrl(url);
  if (!validation.valid) return res.status(400).json({ error: validation.error });

  try {
    const id = db.addMonitor(name.trim(), url.trim());
    const monitor = db.getMonitor(id);
    io.emit('monitor:update', { action: 'add', monitor });
    res.json(monitor);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: '该链接已存在' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/monitors/validate', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL 不能为空' });
  // 同步验证，Promise 很快
  validateUrl(url).then(result => res.json(result));
});

app.delete('/api/monitors/:id', (req, res) => {
  db.deleteMonitor(Number(req.params.id));
  io.emit('monitor:update', { action: 'delete', id: Number(req.params.id) });
  res.json({ ok: true });
});

app.put('/api/monitors/:id/toggle', (req, res) => {
  const result = db.toggleMonitor(Number(req.params.id));
  if (!result) return res.status(404).json({ error: '未找到' });
  io.emit('monitor:update', { action: 'toggle', monitor: result });
  res.json(result);
});

app.get('/api/monitors/:id/logs', (req, res) => {
  const logs = db.getCheckLogs(Number(req.params.id));
  res.json(logs);
});

app.get('/api/settings', (req, res) => {
  res.json({ interval_minutes: db.getIntervalMinutes() });
});

app.put('/api/settings', (req, res) => {
  const { interval_minutes } = req.body;
  const val = parseInt(interval_minutes, 10);
  if (!val || val < 1 || val > 1440) return res.status(400).json({ error: '间隔必须为 1-1440 分钟' });

  db.setSetting('interval_minutes', val);
  scheduler.restart();
  io.emit('settings:update', { interval_minutes: val });
  res.json({ interval_minutes: val });
});

server.listen(PORT, () => {
  console.log(`VPS 库存监控已启动: http://localhost:${PORT}`);
});

// 异步初始化数据库后启动调度器
db.initDb().then(() => {
  scheduler.start();
}).catch(err => {
  console.error('数据库初始化失败:', err);
  process.exit(1);
});
