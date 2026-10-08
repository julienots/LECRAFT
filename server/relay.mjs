/**
 * Relais multijoueur LeCraft (Node.js, sans dépendance).
 *
 * Un joueur « héberge » son monde (salle) ; les autres joueurs le rejoignent. Le relais ne fait
 * que transmettre les messages JSON : l'hôte reste maître du monde (blocs, créatures, temps).
 *
 * - WebSocket sur le chemin /lecraft-ws (implémentation RFC 6455 minimale : texte, ping/pong,
 *   fermeture, fragmentation, longueurs 16/64 bits) ;
 * - GET /lecraft-info : description du serveur et salles ouvertes (JSON, CORS ouvert).
 *
 * Messages reconnus par le relais (champ « t ») :
 *   client → relais : host {name, world, mode, max, motd}, join {room, name, skin}, list, ping
 *   relais → client : hosted {room, id}, joined {room, id, host}, rooms {rooms}, error {msg}, pong,
 *                     peerJoin {id, name, skin} (à l'hôte), peerLeft {id} (à tous), closed
 * Tout autre message est relayé : d'un invité vers l'hôte (champ from ajouté) ; de l'hôte vers
 * l'invité « to » ou vers tous les invités (to absent), en excluant « except » si fourni.
 */
import { createHash } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 8 * 1024 * 1024;

let nextId = 1;
/** @type {Map<string, {id: string, host: Peer, name: string, world: string, mode: string, max: number, motd: string, peers: Map<number, Peer>, created: number}>} */
const rooms = new Map();

class Peer {
  constructor(socket, log) {
    this.id = nextId++;
    this.socket = socket;
    this.log = log;
    this.room = null;
    this.isHost = false;
    this.name = 'Joueur';
    this.skin = 'steve';
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.alive = true;
  }

  send(obj) {
    if (!this.alive) return;
    const data = Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj));
    let header;
    if (data.length < 126) header = Buffer.from([0x81, data.length]);
    else if (data.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(data.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(data.length), 2);
    }
    try {
      this.socket.write(Buffer.concat([header, data]));
    } catch {
      this.close();
    }
  }

  control(op, payload = Buffer.alloc(0)) {
    try {
      this.socket.write(Buffer.concat([Buffer.from([0x80 | op, payload.length]), payload]));
    } catch {
      /* fermé */
    }
  }

  close() {
    if (!this.alive) return;
    this.alive = false;
    try {
      this.control(0x8);
      this.socket.end();
    } catch {
      /* déjà fermé */
    }
  }

  /** Décode les trames reçues ; renvoie les messages texte complets. */
  feed(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    const out = [];
    for (;;) {
      const b = this.buf;
      if (b.length < 2) break;
      const fin = (b[0] & 0x80) !== 0, op = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) {
        if (b.length < 4) break;
        len = b.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (b.length < 10) break;
        len = Number(b.readBigUInt64BE(2));
        off = 10;
      }
      if (len > MAX_MESSAGE) {
        this.close();
        return out;
      }
      const need = off + (masked ? 4 : 0) + len;
      if (b.length < need) break;
      let payload = b.subarray(off + (masked ? 4 : 0), need);
      if (masked) {
        const mask = b.subarray(off, off + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      this.buf = b.subarray(need);
      if (op === 0x8) {
        this.close();
        break;
      } else if (op === 0x9) this.control(0xa, payload.subarray(0, 125));
      else if (op === 0xa) {
        /* pong */
      } else if (op === 0x1 || op === 0x2 || op === 0x0) {
        this.frags.push(Buffer.from(payload));
        if (fin) {
          out.push(Buffer.concat(this.frags).toString('utf8'));
          this.frags = [];
        }
      }
    }
    return out;
  }
}

function roomInfo(r) {
  return { id: r.id, name: r.name, world: r.world, mode: r.mode, motd: r.motd, players: r.peers.size + 1, max: r.max, host: r.host.name };
}

function leave(peer) {
  const r = peer.room ? rooms.get(peer.room) : null;
  if (!r) return;
  if (peer.isHost) {
    for (const p of r.peers.values()) {
      p.send({ t: 'closed', msg: `${r.host.name} a fermé la partie.` });
      p.room = null;
      p.close();
    }
    rooms.delete(r.id);
    peer.log?.(`salle « ${r.name} » fermée`);
  } else {
    r.peers.delete(peer.id);
    r.host.send({ t: 'peerLeft', id: peer.id, name: peer.name });
    for (const p of r.peers.values()) p.send({ t: 'peerLeft', id: peer.id, name: peer.name });
    peer.log?.(`${peer.name} a quitté « ${r.name} »`);
  }
  peer.room = null;
}

function onMessage(peer, text) {
  let m;
  try {
    m = JSON.parse(text);
  } catch {
    return;
  }
  if (!m || typeof m.t !== 'string') return;
  switch (m.t) {
    case 'ping':
      return peer.send({ t: 'pong', at: m.at });
    case 'list':
      return peer.send({ t: 'rooms', rooms: [...rooms.values()].map(roomInfo) });
    case 'host': {
      leave(peer);
      const id = Math.random().toString(36).slice(2, 8);
      peer.isHost = true;
      peer.name = String(m.name ?? 'Hôte').slice(0, 24);
      peer.room = id;
      rooms.set(id, { id, host: peer, name: String(m.world ?? 'Monde').slice(0, 40), world: String(m.world ?? ''), mode: String(m.mode ?? 'survival'), max: Math.max(2, Math.min(16, Number(m.max) || 8)), motd: String(m.motd ?? '').slice(0, 80), peers: new Map(), created: Date.now() });
      peer.log?.(`${peer.name} héberge « ${m.world} » (salle ${id})`);
      return peer.send({ t: 'hosted', room: id, id: peer.id });
    }
    case 'join': {
      const r = rooms.get(String(m.room));
      if (!r) return peer.send({ t: 'error', msg: 'Partie introuvable (fermée ?)' });
      if (r.peers.size + 1 >= r.max) return peer.send({ t: 'error', msg: 'La partie est pleine' });
      leave(peer);
      peer.isHost = false;
      peer.name = String(m.name ?? 'Joueur').slice(0, 24);
      peer.skin = String(m.skin ?? 'steve').slice(0, 24);
      // pseudos uniques dans la salle
      const names = new Set([r.host.name, ...[...r.peers.values()].map((p) => p.name)]);
      if (names.has(peer.name)) peer.name = `${peer.name}${peer.id}`;
      peer.room = r.id;
      r.peers.set(peer.id, peer);
      peer.send({ t: 'joined', room: r.id, id: peer.id, host: r.host.id, name: peer.name });
      r.host.send({ t: 'peerJoin', id: peer.id, name: peer.name, skin: peer.skin });
      peer.log?.(`${peer.name} a rejoint « ${r.name} »`);
      return;
    }
    case 'leave':
      return leave(peer);
    default: {
      const r = peer.room ? rooms.get(peer.room) : null;
      if (!r) return;
      if (peer.isHost) {
        const out = JSON.stringify(m);
        if (m.to !== undefined) r.peers.get(Number(m.to))?.send(out);
        else for (const p of r.peers.values()) if (p.id !== m.except) p.send(out);
      } else {
        m.from = peer.id;
        r.host.send(m);
      }
    }
  }
}

/**
 * Branche le relais sur un serveur HTTP Node (serveur autonome ou serveur de développement Vite).
 * @param {import('node:http').Server} server
 * @param {{ name?: string, log?: (s: string) => void }} [opts]
 */
export function attachRelay(server, opts = {}) {
  const log = opts.log ?? ((s) => console.log(`[LeCraft] ${s}`));
  server.on('upgrade', (req, socket) => {
    if (!req.url || !req.url.startsWith('/lecraft-ws')) return;
    const key = req.headers['sec-websocket-key'];
    if (!key) return socket.destroy();
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`, '', ''].join('\r\n'));
    socket.setNoDelay(true);
    const peer = new Peer(socket, log);
    socket.on('data', (d) => {
      for (const msg of peer.feed(d)) onMessage(peer, msg);
    });
    const end = () => {
      peer.alive = false;
      leave(peer);
    };
    socket.on('close', end);
    socket.on('error', end);
  });
  return {
    /** Réponse à GET /lecraft-info (vrai si la requête a été traitée). */
    handle(req, res) {
      if (!req.url || !req.url.startsWith('/lecraft-info')) return false;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ name: opts.name ?? 'Serveur LeCraft', version: 1, rooms: [...rooms.values()].map(roomInfo) }));
      return true;
    },
    rooms,
  };
}
