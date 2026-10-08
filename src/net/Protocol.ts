/**
 * Protocole du multijoueur en réseau (messages JSON via le relais, voir server/relay.mjs).
 * L'hôte est maître du monde : blocs, créatures, coffres, temps et météo ; chaque invité simule
 * son propre joueur (déplacements, inventaire) et envoie ses actions à l'hôte.
 */
import type { Dimension } from '../world/Portals';
import type { GameMode, Difficulty } from '../core/Config';
import type { ItemStack } from '../inventory/Item';

/** Port par défaut du serveur autonome (npm run server). */
export const DEFAULT_PORT = 25580;

export interface PlayerState {
  id: number;
  name: string;
  skin: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  /** Bits : 1 accroupi, 2 nage, 4 coup, 8 mort, 16 créatif. */
  f: number;
  held: string;
  hp?: number;
}

/** Créature vue par les invités (instantané de l'hôte). */
export interface MobState {
  id: number;
  k: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Bits : 1 blessé, 2 attaque, 4 mort, 8 bébé, 16 tondu. */
  f: number;
  hp: number;
  /** Pseudo (bots joueurs) et couleur de laine (moutons). */
  n?: string;
  w?: string;
  /** Objet tenu (bots). */
  h?: string;
}

export interface Welcome {
  t: 'welcome';
  to: number;
  seed: number;
  world: string;
  dim: Dimension;
  mode: GameMode;
  difficulty: Difficulty;
  time: number;
  day: number;
  weather: string;
  spawn: [number, number, number];
  hostName: string;
  hostId: number;
  players: PlayerState[];
  pvp: boolean;
  bots: boolean;
  smp: boolean;
}

export type NetMsg =
  | Welcome
  | { t: 'peerJoin'; id: number; name: string; skin: string }
  | { t: 'peerLeft'; id: number; name: string }
  | { t: 'closed'; msg?: string }
  | { t: 'error'; msg: string }
  | { t: 'hosted'; room: string; id: number }
  | { t: 'joined'; room: string; id: number; host: number; name: string }
  | { t: 'rooms'; rooms: RoomInfo[] }
  | { t: 'pong'; at: number }
  | { t: 'p'; from?: number; s: PlayerState }
  | { t: 'ps'; list: PlayerState[] }
  | { t: 'chunkReq'; from?: number; cx: number; cz: number }
  | { t: 'chunk'; to?: number; cx: number; cz: number; data: string | null }
  | { t: 'edit'; from?: number; e: number[] }
  | { t: 'edits'; e: number[]; except?: number }
  | { t: 'mobs'; to?: number; list: MobState[] }
  | { t: 'hitMob'; from?: number; id: number; dmg: number; kx: number; kz: number; crit: boolean; item: string }
  | { t: 'hitPlayer'; from?: number; target: number; dmg: number; kx: number; kz: number }
  | { t: 'hurt'; to?: number; dmg: number; kx: number; kz: number; src: string; by?: string }
  | { t: 'give'; to?: number; items: ItemStack[]; xp: number }
  | { t: 'chat'; from?: number; text: string; except?: number }
  | { t: 'sys'; text: string; except?: number }
  | { t: 'time'; time: number; day: number; weather: string; rain: number }
  | { t: 'chestReq'; from?: number; x: number; y: number; z: number }
  | { t: 'chest'; to?: number; x: number; y: number; z: number; slots: (ItemStack | null)[] }
  | { t: 'chestSet'; from?: number; x: number; y: number; z: number; slots: (ItemStack | null)[] }
  | { t: 'interact'; from?: number; id: number; item: string }
  | { t: 'dim'; dim: Dimension }
  | { t: 'hello'; from?: number; name: string; skin: string }
  | { t: 'kick'; to?: number; msg: string };

export interface RoomInfo {
  id: string;
  name: string;
  world: string;
  mode: string;
  motd: string;
  players: number;
  max: number;
  host: string;
}

// ---------- chunks : compression deflate + base64 ----------
function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const s = new Blob([data as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/** Encode les blocs (16 bits) et métadonnées d'un chunk. */
export async function encodeChunk(blocks: Uint16Array, meta: Uint8Array): Promise<string> {
  const raw = new Uint8Array(blocks.byteLength + meta.byteLength);
  raw.set(new Uint8Array(blocks.buffer, blocks.byteOffset, blocks.byteLength), 0);
  raw.set(meta, blocks.byteLength);
  return toB64(await pipe(raw, new CompressionStream('deflate')));
}

export async function decodeChunk(s: string, volume: number): Promise<{ blocks: Uint16Array; meta: Uint8Array }> {
  const raw = await pipe(fromB64(s), new DecompressionStream('deflate'));
  const blocks = new Uint16Array(volume);
  new Uint8Array(blocks.buffer).set(raw.subarray(0, volume * 2));
  const meta = raw.slice(volume * 2, volume * 3);
  return { blocks, meta };
}

/** Adresse WebSocket du relais à partir de ce que le joueur a saisi (« 192.168.1.20:25580 », URL…). */
export function relayUrl(address: string): string {
  let a = address.trim();
  if (!a) {
    // même origine que la page (jeu servi par « npm run dev » ou « npm run server »)
    const secure = location.protocol === 'https:';
    return `${secure ? 'wss' : 'ws'}://${location.host}/lecraft-ws`;
  }
  if (/^https?:\/\//.test(a)) a = a.replace(/^http/, 'ws');
  if (!/^wss?:\/\//.test(a)) a = `ws://${a}`;
  const u = new URL(a);
  if (!u.port && u.protocol === 'ws:' && !address.includes(':')) u.port = String(DEFAULT_PORT);
  if (!u.pathname || u.pathname === '/') u.pathname = '/lecraft-ws';
  return u.toString();
}

/** La page est-elle servie par un serveur LeCraft (relais à la même adresse) ? */
export function sameOriginRelay(): boolean {
  return location.protocol === 'http:' || (location.protocol === 'https:' && location.hostname !== 'localhost');
}

/** Connexion WebSocket au relais (messages JSON). */
export class NetLink {
  private ws: WebSocket | null = null;
  onMessage: (m: NetMsg) => void = () => {};
  onClose: (reason: string) => void = () => {};
  myId = 0;
  private closedByUs = false;
  /** Octets reçus/envoyés (écran de débogage). */
  stats = { rx: 0, tx: 0 };

  constructor(readonly url: string) {}

  connect(timeoutMs = 6000): Promise<void> {
    return new Promise((res, rej) => {
      let done = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.url);
      } catch (e) {
        rej(new Error(`Adresse invalide : ${(e as Error).message}`));
        return;
      }
      this.ws = ws;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        ws.close();
        rej(new Error('Délai dépassé : serveur injoignable'));
      }, timeoutMs);
      ws.onopen = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        res();
      };
      ws.onerror = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        rej(new Error('Connexion impossible (serveur LeCraft lancé ? même réseau ?)'));
      };
      ws.onmessage = (e) => {
        const text = String(e.data);
        this.stats.rx += text.length;
        try {
          this.onMessage(JSON.parse(text) as NetMsg);
        } catch (err) {
          console.error('[réseau]', err);
        }
      };
      ws.onclose = () => {
        if (!this.closedByUs) this.onClose('Connexion perdue');
        this.ws = null;
      };
    });
  }

  send(m: NetMsg | Record<string, unknown>) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const text = JSON.stringify(m);
    this.stats.tx += text.length;
    this.ws.send(text);
  }

  get open() {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  close() {
    this.closedByUs = true;
    this.ws?.close();
    this.ws = null;
  }

  /** Attend un message d'un type donné (réponse du relais). */
  waitFor<T extends NetMsg['t']>(t: T, timeoutMs = 6000): Promise<Extract<NetMsg, { t: T }>> {
    return new Promise((res, rej) => {
      const prev = this.onMessage;
      const timer = setTimeout(() => {
        this.onMessage = prev;
        rej(new Error('Pas de réponse du serveur'));
      }, timeoutMs);
      this.onMessage = (m) => {
        if (m.t === t) {
          clearTimeout(timer);
          this.onMessage = prev;
          res(m as Extract<NetMsg, { t: T }>);
        } else if (m.t === 'error') {
          clearTimeout(timer);
          this.onMessage = prev;
          rej(new Error(m.msg));
        } else prev(m);
      };
    });
  }
}
