const http = require('http');
const express = require('express');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Game, CONFIG } = require('./game');

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const game = new Game();

let idSeq = 1;

function nextPlayerId() {
  return `p_${idSeq++}`;
}

function sendError(id, code, message) {
  game.sendTo(id, { type: 'error', code, message });
}

wss.on('connection', (ws) => {
  const id = nextPlayerId();
  game.addConnection(id, ws);

  game.sendTo(id, {
    type: 'welcome',
    id,
    world: { w: CONFIG.WORLD_W, h: CONFIG.WORLD_H },
    tickHz: CONFIG.TICK_HZ,
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (err) {
      sendError(id, 'BAD_JSON', 'Invalid JSON payload');
      return;
    }

    switch (msg.type) {
      case 'hello': {
        if (typeof msg.name === 'string') game.setPlayerName(id, msg.name);
        break;
      }
      case 'enter_battle': {
        const ret = game.enterBattle(id);
        if (!ret.ok) sendError(id, ret.code, ret.message);
        break;
      }
      case 'input': {
        game.setInput(id, msg);
        break;
      }
      case 'chat': {
        if (typeof msg.msg !== 'string' || !msg.msg.trim()) {
          sendError(id, 'BAD_CHAT', 'Empty chat message');
          return;
        }
        game.broadcastChat(id, msg.msg);
        break;
      }
      case 'respawn': {
        const ret = game.respawn(id);
        if (!ret.ok) sendError(id, ret.code, ret.message);
        break;
      }
      default:
        sendError(id, 'UNKNOWN_TYPE', `Unknown message type: ${msg.type}`);
    }
  });

  ws.on('close', () => {
    game.removeConnection(id);
  });

  ws.on('error', () => {
    game.removeConnection(id);
  });
});

setInterval(() => {
  game.tick();
}, CONFIG.TICK_MS);

server.listen(CONFIG.PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${CONFIG.PORT}`);
});
