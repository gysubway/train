export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/room\/(.+)$/);
    if (match) {
      const roomId = match[1];
      const id = env.ROOMS.idFromName(roomId);
      return env.ROOMS.get(id).fetch(request);
    }
    return new Response("Not Found", { status: 404 });
  }
};

export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.sessions = []; // 存玩家连接
    this.players = [];  // 存玩家名字
    this.maxPlayers = 4; 
    this.hostName = null;
    this.gameActive = false;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const username = url.searchParams.get('user');

    // 检查是不是 WebSocket 请求
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 400 });
    }

    // 检查房间满没满
    if (this.players.length >= this.maxPlayers && !this.players.includes(username)) {
      return new Response('Room is full', { status: 403 });
    }

    // 建立 WebSocket 连接
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // 核心：必须调用 accept()
    server.accept();

    this.handleSession(server, username);
    
    // 核心：必须返回 101 状态码
    return new Response(null, { status: 101, webSocket: client });
  }

  handleSession(webSocket, username) {
    const isFirstPlayer = this.sessions.length === 0;
    if (isFirstPlayer) this.hostName = username;

    this.sessions.push({ ws: webSocket, username });
    if (!this.players.includes(username)) {
      this.players.push(username);
    }

    // 接收消息
    webSocket.addEventListener('message', (msg) => {
      try {
        const data = JSON.parse(msg.data);
        this.handleMessage(data, username);
      } catch (e) {
        console.error("消息解析失败", e);
      }
    });

    // 连接断开
    webSocket.addEventListener('close', () => {
      this.sessions = this.sessions.filter(s => s.ws !== webSocket);
      if (!this.gameActive) {
        this.players = this.players.filter(p => p !== username);
        this.broadcastState();
      }
    });

    // 广播最新状态（让所有人的白框里显示座位）
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
        if (['🚂', '😡', '💰', '😭'].includes(data.text)) {
          this.broadcast({ type: 'chat', user: sender, text: data.text });
        }
        break;
      case 'start_game':
        if (sender === this.hostName && this.players.length === this.maxPlayers && !this.gameActive) {
          this.gameActive = true;
          const randomIndex = Math.floor(Math.random() * this.players.length);
          const winner = this.players[randomIndex];
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
