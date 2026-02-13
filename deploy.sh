#!/usr/bin/env bash
set -euo pipefail

PORT=52743
APP_DIR=${APP_DIR:-/opt/hfs-2d-flight-sim}
REPO_URL=${REPO_URL:-https://github.com/example/hfs-2d-flight-sim.git}
BRANCH=${BRANCH:-main}

echo "[1/6] 安装 Node.js/npm（Ubuntu）..."
if ! command -v node >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y curl ca-certificates gnupg
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

if ! command -v npm >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y npm
fi

echo "[2/6] 克隆/更新仓库: $REPO_URL"
sudo mkdir -p "$APP_DIR"
sudo chown -R "$USER":"$USER" "$APP_DIR"
if [ ! -d "$APP_DIR/.git" ]; then
  rm -rf "$APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"
git fetch --all
git checkout "$BRANCH"
git pull --ff-only

echo "[3/6] 安装依赖..."
npm install

echo "[4/6] 配置 systemd 服务..."
SERVICE_NAME=hfs-2d-flight-sim.service
SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}"

cat <<SERVICE | sudo tee "$SERVICE_PATH" >/dev/null
[Unit]
Description=HFS 2D Flight Simulator
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/env node server/index.js
Restart=always
RestartSec=2
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SERVICE

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

echo "[5/6] 服务状态"
sudo systemctl --no-pager --full status "$SERVICE_NAME" | head -n 20 || true

echo "[6/6] 部署完成"
IP=$(hostname -I | awk '{print $1}')
echo "访问地址: http://${IP}:${PORT}"
