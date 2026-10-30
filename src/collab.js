// Client side of Sketchboard live collaboration. The dev server hosts a small
// WebSocket relay at /collab (see server/collab.mjs); this module speaks to it.
// The standalone HTML build compiles __SKETCHBOARD_COLLAB__ to false and never
// touches the network.

export const collabAvailable = typeof __SKETCHBOARD_COLLAB__ !== 'undefined' && __SKETCHBOARD_COLLAB__ === true;

const ADJECTIVES = ['Curious', 'Bold', 'Sleepy', 'Merry', 'Quiet', 'Bright', 'Swift', 'Cosmic', 'Feisty', 'Gentle'];
const ANIMALS = ['Fox', 'Otter', 'Badger', 'Heron', 'Lynx', 'Panda', 'Wolf', 'Crane', 'Mole', 'Hawk'];

export function generateName(random = Math.random) {
  return `${ADJECTIVES[Math.floor(random() * ADJECTIVES.length)]} ${ANIMALS[Math.floor(random() * ANIMALS.length)]}`;
}

export function generateRoomCode(random = Math.random) {
  const pick = (list) => list[Math.floor(random() * list.length)];
  return `${pick(ADJECTIVES)}-${pick(ANIMALS)}-${Math.floor(10 + random() * 90)}`.toLowerCase();
}

export function liveRoomFromUrl(search = window.location.search) {
  if (!collabAvailable) return null;
  return new URLSearchParams(search).get('live');
}

export function liveJoinUrl(room) {
  return `${window.location.origin}${window.location.pathname}?live=${encodeURIComponent(room)}`;
}

export function connectCollab({ room, name, onMessage, onOpen, onClose }) {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${scheme}://${window.location.host}/collab?room=${encodeURIComponent(room)}&name=${encodeURIComponent(name)}`;
  const ws = new WebSocket(url);
  let closedByUs = false;

  ws.onopen = () => onOpen?.();
  ws.onerror = () => { /* followed by onclose, which reports the failure */ };
  ws.onclose = () => { if (!closedByUs) onClose?.(); };
  ws.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    onMessage?.(msg);
  };

  return {
    send(message) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    },
    close() {
      closedByUs = true;
      ws.close();
    },
  };
}
