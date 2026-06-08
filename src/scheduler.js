const db = require('./db');
const { checkStock } = require('./checker');

class Scheduler {
  constructor(io) {
    this.io = io;
    this.timer = null;
  }

  start() {
    this.runOnce(); // 立即跑一次
    const intervalMs = db.getIntervalMinutes() * 60 * 1000;
    this.timer = setInterval(() => this.runOnce(), intervalMs);
  }

  restart() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.start();
  }

  async runOnce() {
    const monitors = db.getAllMonitors().filter(m => m.is_active);
    if (monitors.length === 0) return;

    for (const monitor of monitors) {
      try {
        const result = await checkStock(monitor.url);
        const newStatus = result.inStock ? 'in_stock' : 'out_of_stock';
        const oldStatus = monitor.last_status;

        // 记录日志
        db.addCheckLog(monitor.id, newStatus, result.error || (result.inStock ? '有货' : '缺货'));
        db.updateMonitorStatus(monitor.id, newStatus, result.error || null);

        // 推送检测结果
        this.io.emit('check:result', {
          id: monitor.id,
          status: newStatus,
          title: result.title,
          error: result.error,
          checkedAt: new Date().toISOString(),
          lastInStockAt: newStatus === 'in_stock' ? new Date().toISOString() : monitor.last_in_stock_at,
        });

        // 库存状态变化 → 推变更通知
        if (oldStatus !== newStatus) {
          this.io.emit('stock:change', {
            id: monitor.id,
            name: monitor.name,
            url: monitor.url,
            status: newStatus,
            title: result.title,
          });
        }
      } catch (err) {
        db.addCheckLog(monitor.id, 'error', `检测异常: ${err.message}`);
        db.updateMonitorStatus(monitor.id, 'error', err.message);

        this.io.emit('check:result', {
          id: monitor.id,
          status: 'error',
          error: err.message,
          checkedAt: new Date().toISOString(),
        });
      }
    }
  }
}

module.exports = Scheduler;
