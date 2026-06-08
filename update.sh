#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "=== VPS 库存监控 - 更新脚本 ==="

# 检查 git
if ! command -v git &>/dev/null; then
    echo "错误: 未安装 git"
    exit 1
fi

# 检查 docker compose
if ! command -v docker &>/dev/null; then
    echo "错误: 未安装 docker"
    exit 1
fi

# 拉取最新代码
echo ">>> 拉取最新代码..."
git pull

# 检测是否正在运行
RUNNING=$(docker compose ps -q 2>/dev/null)
if [ -n "$RUNNING" ]; then
    echo ">>> 检测到服务运行中，先停止..."
    docker compose down
fi

# 构建并启动
echo ">>> 构建并启动..."
docker compose up -d --build

echo ""
echo "=== 更新完成 ==="
echo "服务已启动: http://localhost:9911"
echo "查看日志: docker compose logs -f"
