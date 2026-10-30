import { WebSocketServer } from 'ws';

// Live-collaboration relay for Sketchboard. One WebSocket endpoint (/collab,
// alongside vite's own HMR socket) rooms participants by session code:
//   join    via ws://host/collab?room=<code>&name=<display name>
//   welcome -> { id, name, color, hostId, roster, state }  (state = latest board snapshot, for late joiners)
//   roster  -> broadcast on join/leave: { roster, hostId }  (first member hosts)
//   state   -> { elements, camera, ts } relayed to everyone else, last writer wins server-side
//   cursor  -> { wx, wy } relayed to everyone else, ephemeral
// The server never inspects element data; it is a dumb, in-memory relay, so
// boards stay as private as the machine serving the dev server.

const PALETTE = ['#e8590c', '#1971c2', '#2f9e44', '#9c36b5', '#0c8599', '#e64980', '#66a80f', '#f08c00'];

export function attachCollabServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });
  const rooms = new Map();

  httpServer.on('upgrade', (request, socket, head) => {
    // Only claim /collab upgrades; anything else (vite HMR) falls through.
    if (!request.url.startsWith('/collab')) return;
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  });

  const describe = (room) => [...room.members.values()].map((m) => ({
    id: m.meta.id, name: m.meta.name, color: m.meta.color,
  }));

  const broadcast = (room, except, msg) => {
    const data = JSON.stringify(msg);
    for (const member of room.members.values()) {
      if (member !== except && member.readyState === 1) member.send(data);
    }
  };

  wss.on('connection', (ws, request) => {
    const url = new URL(request.url, 'http://localhost');
    const roomId = (url.searchParams.get('room') || 'lobby').slice(0, 64);
    const name = (url.searchParams.get('name') || 'Guest').slice(0, 24);
    let room = rooms.get(roomId);
    if (!room) {
      room = { state: null, members: new Map() };
      rooms.set(roomId, room);
    }
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const usedColors = new Set([...room.members.values()].map((m) => m.meta.color));
    ws.meta = { id, name, color: PALETTE.find((c) => !usedColors.has(c)) || PALETTE[room.members.size % PALETTE.length] };
    room.members.set(id, ws);

    ws.send(JSON.stringify({
      t: 'welcome', id, name: ws.meta.name, color: ws.meta.color,
      hostId: describe(room)[0].id, roster: describe(room), state: room.state,
    }));
    broadcast(room, ws, { t: 'roster', roster: describe(room), hostId: describe(room)[0].id });

    ws.on('message', (data) => {
      if (data.length > 8 * 1024 * 1024) return;
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      if (msg.t === 'state') {
        const ts = Number(msg.ts) || 0;
        if (!room.state || ts >= room.state.ts) {
          room.state = { elements: msg.elements, camera: msg.camera, ts, from: id };
        }
      }
      broadcast(room, ws, { ...msg, from: id });
    });

    ws.on('close', () => {
      room.members.delete(id);
      if (room.members.size === 0) {
        rooms.delete(roomId);
        return;
      }
      const roster = describe(room);
      broadcast(room, null, { t: 'roster', roster, hostId: roster[0].id });
      broadcast(room, null, { t: 'cursor-clear', from: id });
    });
  });

  return wss;
}
