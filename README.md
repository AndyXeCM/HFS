# 多人联机 2D 飞行模拟器（浏览器即玩）

这是一个可直接运行的多人实时 2D 飞行战斗 MVP，采用**服务器权威**架构：
- Node.js + WebSocket (`ws`) + Express 静态托管
- 服务器 Tick 固定 20Hz（50ms）
- 客户端 `requestAnimationFrame` 渲染 + 120ms 插值缓冲
- 单房间、全地图同步（前端按视野裁剪渲染）

默认监听端口：`52743`

---

## 功能总览（MVP）

- 连接后进入 **LOBBY**，支持聊天
- 点击“进入战场”进入 **ALIVE**，服务器生成飞机
- 2D 飞行：WASD/方向键控制推力与转向
- 武器系统：
  - Space：机炮（10 发/秒）
  - Shift：导弹（1s 冷却）
  - E：拦截弹（0.8s 冷却）
- 服务器裁定命中、扣血、死亡
- 死亡后进入 **DEAD**，显示击毁信息
- 冷却后点击“重生”回到 **ALIVE**
- HUD 显示：坐标、速度、血量、玩家名、状态
- 小地图显示世界边界与玩家点位

---

## 项目结构

```text
server/index.js      # 入口：HTTP + WS + 消息分发
server/game.js       # Tick、实体模型、碰撞、伤害、事件
public/index.html    # 页面与 UI 结构
public/main.js       # 网络、输入、插值、渲染、HUD、聊天
public/style.css     # 样式
package.json         # 依赖与启动脚本
deploy.sh            # Ubuntu 一键部署脚本（固定 52743）
README.md
```

---

## 本地运行

```bash
npm install
node server/index.js
```

浏览器访问：

```text
http://127.0.0.1:52743
```

---

## 玩法流程（状态机）

- `CONNECT -> LOBBY`
- `LOBBY + enter_battle -> ALIVE`
- `ALIVE + hp <= 0 -> DEAD`
- `DEAD + respawn(3s冷却) -> ALIVE`

UI 对应：
- LOBBY：大厅遮罩 + 进入战场按钮
- DEAD：死亡遮罩 + 击毁信息 + 倒计时重生按钮

---

## 控制方式

- `W / ↑`：加速
- `S / ↓`：减速/刹车
- `A / ←`：左转
- `D / →`：右转
- `Space`：机炮
- `Shift`：导弹
- `E`：拦截弹
- 鼠标点击玩家：锁定目标（导弹优先追踪）
- `Enter`：聊天输入
- 聊天框中 `Esc`：取消输入焦点

---

## 网络协议（JSON）

### 客户端 -> 服务器

- `hello`
```json
{"type":"hello","name":"xxx"}
```

- `enter_battle`
```json
{"type":"enter_battle"}
```

- `input`
```json
{
  "type":"input",
  "seq": 123,
  "pressed": {
    "up": true,
    "down": false,
    "left": false,
    "right": true,
    "gun": false,
    "missile": false,
    "interceptor": false
  },
  "lockTargetId": "p_2"
}
```

- `chat`
```json
{"type":"chat","msg":"hello"}
```

- `respawn`
```json
{"type":"respawn"}
```

### 服务器 -> 客户端

- `welcome`
```json
{"type":"welcome","id":"p_1","world":{"w":5000,"h":5000},"tickHz":20}
```

- `snapshot`
```json
{
  "type":"snapshot",
  "t": 1730000000000,
  "players": [...],
  "bullets": [...],
  "missiles": [...],
  "interceptors": [...]
}
```

- `event`（`death` / `explode` / `hit`）
- `chat`
- `error`

---

## 一键部署（Ubuntu）

> 可通过环境变量 `REPO_URL` 覆盖仓库地址。

### 推荐方式（curl | bash）

```bash
curl -fsSL https://raw.githubusercontent.com/<your-org>/<your-repo>/main/deploy.sh | REPO_URL=https://github.com/<your-org>/<your-repo>.git bash
```

### 或本地执行

```bash
chmod +x deploy.sh
REPO_URL=https://github.com/<your-org>/<your-repo>.git ./deploy.sh
```

脚本会执行：
1. 安装 Node.js 与 npm（若不存在）
2. 克隆/更新仓库
3. `npm install`
4. 创建并启动 `systemd` 服务
5. 输出访问地址 `http://<server-ip>:52743`

---

## 常见问题

1. **外网无法访问？**
   - 检查云防火墙/安全组是否放行 TCP `52743`
   - 检查系统防火墙：
   ```bash
   sudo ufw allow 52743/tcp
   ```

2. **Node 版本过低？**
   - 项目建议 Node `>=18`（`deploy.sh` 默认安装 Node 20）

3. **服务未启动？**
   ```bash
   sudo systemctl status hfs-2d-flight-sim.service
   sudo journalctl -u hfs-2d-flight-sim.service -f
   ```

---

## 可扩展方向

- 多房间（rooms）/匹配
- 阵营系统与友伤规则
- 更复杂弹道、爆炸范围伤害
- 排行榜、战绩与持久化
- 客户端预测 + 回滚补偿
