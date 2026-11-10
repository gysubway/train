export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/room\/(.+)$/);
    
    if (match) {
      const roomId = match[1];
      const id = env.ROOMS.idFromName(roomId);
      const stub = env.ROOMS.get(id);
      return stub.fetch(request); 
    }
    return new Response("Not Found", { status: 404 });
  }
};

export class GameRoom {
  constructor(state, env) {
    this.sessions = [];
    this.players = [];
    this.maxPlayers = 2;
    this.hostName = null;
  }

  async fetch(request) {
    // 核心：检查是不是 WebSocket
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 400 });
    }

    // 核心：建立双向通道
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // 核心：必须放行
    server.accept(); 

    // 把用户加进来
    const url = new URL(request.url);
    const username = url.searchParams.get('user') || 'Unknown';
    if (this.sessions.length === 0) this.hostName = username;
    
    if (!this.players.includes(username)) this.players.push(username);
    this.sessions.push({ ws: server, username });

    // 广播最新座位给所有人
    this.broadcast();

    // 监听消息和断开
    server.addEventListener('message', (msg) => {
      // 测试用，收到消息直接广播回去
      const data = JSON.parse(msg.data);
      if (data.type === 'chat') {
        this.broadcast({ type: 'chat', user: username, text: data.text });
      } else if (data.type === 'start_game') {
        const winner = this.players[Math.floor(Math.random() * this.players.length)];
        this.broadcast({ type: 'game_over', winner });
      }
    });

    server.addEventListener('close', () => {
      this.sessions = this.sessions.filter(s => s.ws !== server);
      this.players = this.players.filter(p => p !== username);
      this.broadcast();
    });

    // 核心：必须返回 101 状态码！
    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(msg) {
    if (!msg) {
      msg = { type: 'room_state', players: this.players, maxPlayers: this.maxPlayers };
    }
    const msgStr = JSON.stringify(msg);
    this.sessions.forEach(s => {
      try { s.ws.send(msgStr); } catch (e) {}
    });
  }
}
