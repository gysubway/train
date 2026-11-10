export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // 路由格式: /room/:roomId
    const match = url.pathname.match(/^\/room\/(.+)$/);
    
    if (match) {
      const roomId = match[1];
      // 获取或创建对应的 DO 实例
      const id = env.ROOMS.idFromName(roomId);
      const stub = env.ROOMS.get(id);
      return stub.fetch(request);
    }
    
    return new Response("Not Found", { status: 404 });
  }
};

export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.sessions = []; // 存储 WebSocket 连接
    this.players = [];  // 存储玩家名字
    this.maxPlayers = 4; // 默认4人
    this.hostName = null;
    this.gameActive = false;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const username = url.searchParams.get('user');

    // 处理 WebSocket 升级
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 400 });
    }

    // 满员判断
    if (this.players.length >= this.maxPlayers && !this.players.includes(username)) {
      return new Response('Room is full', { status: 403 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // 接受连接并保存
    this.handleSession(server, username);
    return new Response(null, { status: 101, webSocket: client });
  }

  handleSession(webSocket, username) {
    webSocket.accept();
    
    const isFirstPlayer = this.sessions.length === 0;
    if (isFirstPlayer) this.hostName = username;

    // 将连接加入数组
    this.sessions.push({ ws: webSocket, username });
    if (!this.players.includes(username)) {
      this.players.push(username);
    }

    // 监听消息
    webSocket.addEventListener('message', (msg) => {
      try {
        const data = JSON.parse(msg.data);
        this.handleMessage(data, username);
      } catch (e) {}
    });

    // 监听断开
    webSocket.addEventListener('close', () => {
      this.sessions = this.sessions.filter(s => s.ws !== webSocket);
      // 如果是游戏等待阶段离开，则移除玩家
      if (!this.gameActive) {
        this.players = this.players.filter(p => p !== username);
        this.broadcastState();
      }
    });

    // 广播最新状态
    this.broadcastState();
  }

  handleMessage(data, sender) {
    switch (data.type) {
      case 'set_max_players':
        if (sender === this.hostName && !this.gameActive) {
          this.maxPlayers = Math.max(2, Math.min(8, data.max));
          this.broadcastState();
        }
        break;
      case 'chat':
        // 后端验证表情包，防止注入（MVP直接转发，但实际可以做白名单）
        if (['🚂', '😡', '💰', '😭'].includes(data.text)) {
          this.broadcast({ type: 'chat', user: sender, text: data.text });
        }
        break;
      case 'start_game':
        if (sender === this.hostName && this.players.length === this.maxPlayers && !this.gameActive) {
          this.gameActive = true;
          // 核心逻辑：DO 内部通过随机数得出唯一赢家
          const randomIndex = Math.floor(Math.random() * this.players.length);
          const winner = this.players[randomIndex];
          
          // 通知所有人
          this.broadcast({ type: 'game_over', winner });
        }
        break;
    }
  }

  broadcastState() {
    this.broadcast({
      type: 'room_state',
      players: this.players,
      maxPlayers: this.maxPlayers,
      host: this.hostName
    });
  }

  broadcast(msg) {
    const msgStr = JSON.stringify(msg);
    this.sessions.forEach(session => {
      try {
        session.ws.send(msgStr);
      } catch (e) {
        // 忽略已断开的连接
      }
    });
  }
}
