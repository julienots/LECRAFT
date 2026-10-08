/**
 * Invité d'une partie en réseau : le monde vient de l'hôte (graine + chunks modifiés + blocs en
 * direct), les créatures et les autres joueurs sont affichés d'après ses instantanés ; ce joueur
 * se déplace localement et envoie ses actions (blocs, coups, chat, coffres) à l'hôte.
 */
import type { Session } from '../core/Session';
import { CHUNK_VOLUME } from '../core/Config';
import { MOB_BY_KEY } from '../data/mobs';
import { ItemRegistry } from '../inventory/ItemRegistry';
import { makeStack } from '../inventory/Inventory';
import { Animal } from '../entities/Animal';
import type { Mob } from '../entities/Mob';
import { Bot } from '../server/Bot';
import { decodeChunk, type MobState, type NetLink, type NetMsg, type PlayerState, type Welcome } from './Protocol';
import { RemotePlayer } from './RemotePlayer';
import type { WeatherState } from '../world/Weather';

export class MultiplayerClient {
  readonly kind = 'client' as const;
  /** Joueurs distants (hôte compris) par identifiant réseau. */
  readonly players = new Map<number, RemotePlayer>();
  /** Créatures de l'hôte par identifiant (côté hôte). */
  private mobs = new Map<number, Mob>();
  private chunkWait = new Map<string, (d: { blocks: Uint16Array; meta: Uint8Array } | null) => void>();
  private chestWait = new Map<string, () => void>();
  private edits: number[] = [];
  private applying = false;
  private tEdits = 0;
  private tState = 0;
  private swingFlag = false;
  private offEdits: () => void;
  readonly hostId: number;
  /** Partie interrompue par l'hôte ou la connexion (message à afficher). */
  ended: string | null = null;

  constructor(readonly s: Session, readonly link: NetLink, readonly welcome: Welcome) {
    this.hostId = welcome.hostId;
    s.entities.netClient = true;
    s.chunks.remote = (cx, cz) =>
      new Promise((res) => {
        const k = `${cx},${cz}`;
        this.chunkWait.set(k, res);
        this.link.send({ t: 'chunkReq', cx, cz });
        // l'hôte ne répond pas : terrain généré localement
        setTimeout(() => {
          if (this.chunkWait.get(k) === res) {
            this.chunkWait.delete(k);
            res(null);
          }
        }, 15000);
      });
    this.offEdits = s.world.events.on('blockChanged', (e) => {
      if (!this.applying) this.edits.push(e.x, e.y, e.z, e.id, e.meta);
    });
    link.onMessage = (m) => this.onMessage(m);
    link.onClose = (r) => this.end(`${r} avec l'hôte.`);
    for (const p of welcome.players) this.upsertPlayer(p);
  }

  get playerCount() {
    return this.players.size + 1;
  }

  swing() {
    this.swingFlag = true;
  }

  chat(text: string) {
    this.link.send({ t: 'chat', text });
  }

  /** Contenu d'un coffre demandé à l'hôte avant ouverture. */
  requestChest(x: number, y: number, z: number): Promise<void> {
    return new Promise((res) => {
      const k = `${x},${y},${z}`;
      this.chestWait.set(k, res);
      this.link.send({ t: 'chestReq', x, y, z });
      setTimeout(() => {
        if (this.chestWait.get(k) === res) {
          this.chestWait.delete(k);
          res();
        }
      }, 4000);
    });
  }

  /** Coffre refermé : son contenu repart chez l'hôte. */
  sendChest(x: number, y: number, z: number) {
    const inv = this.s.world.getChest(x, y, z, false);
    if (inv) this.link.send({ t: 'chestSet', x, y, z, slots: inv.serialize().slots });
  }

  private end(msg: string) {
    if (this.ended) return;
    this.ended = msg;
    this.s.game.disconnected(msg);
  }

  private stateOf(): PlayerState {
    const p = this.s.player;
    const f = (p.sneaking ? 1 : 0) | (p.swimming || p.crawling ? 2 : 0) | (this.swingFlag || this.s.entities.combat.swing > 0.5 ? 4 : 0) | (p.dead ? 8 : 0) | (p.creative ? 16 : 0);
    this.swingFlag = false;
    return { id: this.link.myId, name: p.name, skin: this.s.game.settings.playerSkin ?? 'steve', x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3), yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3), f, held: p.inventory.selectedStack?.id ?? '', hp: p.health };
  }

  update(dt: number) {
    this.tState -= dt;
    if (this.tState <= 0) {
      this.tState = 0.1;
      this.link.send({ t: 'p', s: this.stateOf() });
    }
    this.tEdits -= dt;
    if (this.tEdits <= 0 && this.edits.length) {
      this.tEdits = 0.05;
      this.link.send({ t: 'edit', e: this.edits });
      this.edits = [];
    }
  }

  private upsertPlayer(st: PlayerState) {
    if (st.id === this.link.myId) return;
    let rp = this.players.get(st.id);
    if (!rp || rp.removed) {
      rp = this.s.entities.addMob(new RemotePlayer(st, this.s.entities));
      // JcJ : le coup est envoyé à l'hôte, qui le transmet
      const target = st.id;
      rp.onNetHit = (dmg, info) => {
        if (this.welcome.pvp) this.link.send({ t: 'hitPlayer', target, dmg, kx: info.kx, kz: info.kz });
      };
      this.players.set(st.id, rp);
    }
    rp.apply(st);
  }

  private applyMobs(list: MobState[]) {
    const s = this.s;
    for (const st of list) {
      let m = this.mobs.get(st.id);
      if (st.f & 128) {
        if (m) m.removed = true;
        this.mobs.delete(st.id);
        continue;
      }
      if (!m || m.removed) {
        if (st.k.startsWith('bot:')) {
          const b = new Bot(st.n ?? 'Bot', st.k.slice(4), 0.5, st.x, st.y, st.z, s.entities);
          m = s.entities.addMob(b);
        } else {
          if (!MOB_BY_KEY.has(st.k)) continue;
          m = s.entities.spawnMob(st.k, st.x, st.y, st.z, { baby: !!(st.f & 8), persistent: true }) ?? undefined;
          if (!m) continue;
        }
        const id = st.id;
        m.onNetHit = (dmg, info) => this.link.send({ t: 'hitMob', id, dmg, kx: info.kx, kz: info.kz, crit: info.crit, item: info.item });
        m.yaw = st.yaw;
        m.netId = st.id;
        this.mobs.set(st.id, m);
      }
      m.net = { x: st.x, y: st.y, z: st.z, yaw: st.yaw, f: st.f };
      m.health = st.hp;
      if (m instanceof Bot && st.h !== undefined) m.weapon = st.h;
      if (m instanceof Animal && st.w && (m.woolColor !== st.w || m.sheared !== !!(st.f & 16))) m.setWool(st.w, !!(st.f & 16));
    }
  }

  private onMessage(m: NetMsg) {
    const s = this.s;
    switch (m.t) {
      case 'ps':
        for (const st of m.list) this.upsertPlayer(st);
        return;
      case 'peerLeft': {
        const rp = this.players.get(m.id);
        if (rp) rp.removed = true;
        this.players.delete(m.id);
        return;
      }
      case 'chunk': {
        const k = `${m.cx},${m.cz}`;
        const res = this.chunkWait.get(k);
        if (!res) return;
        this.chunkWait.delete(k);
        if (!m.data) res(null);
        else decodeChunk(m.data, CHUNK_VOLUME).then(res, () => res(null));
        return;
      }
      case 'edits': {
        const e = m.e;
        this.applying = true;
        try {
          for (let i = 0; i + 4 < e.length; i += 5) if (s.world.isLoaded(e[i], e[i + 2])) s.world.setBlock(e[i], e[i + 1], e[i + 2], e[i + 3], e[i + 4]);
        } finally {
          this.applying = false;
        }
        return;
      }
      case 'mobs':
        this.applyMobs(m.list);
        return;
      case 'hurt': {
        const p = s.player;
        const dealt = p.damage(m.dmg, m.src === 'player' ? 'player' : m.src === 'projectile' ? 'projectile' : 'mob', m.kx, m.kz);
        if (dealt > 0) {
          s.audio.play('hurt', { volume: 0.9 });
          s.haptic('medium');
        }
        return;
      }
      case 'give': {
        for (const it of m.items) if (ItemRegistry.has(it.id)) {
          const st = makeStack(it.id, it.count);
          if (it.durability !== undefined) st.durability = it.durability;
          const rest = s.player.inventory.add(st);
          if (rest > 0) s.entities.spawnItem(it.id, rest, s.player.x, s.player.y + 0.5, s.player.z, it.durability);
        }
        if (m.items.length) s.audio.play('pop', { volume: 0.5 });
        if (m.xp) s.player.addXp(m.xp);
        return;
      }
      case 'chat':
      case 'sys':
        s.game.chat.add(m.text, 'chat');
        return;
      case 'time':
        s.dayCycle.time = m.time;
        s.dayCycle.day = m.day;
        if (s.weather.state !== m.weather) s.weather.load({ state: m.weather as WeatherState, timer: 600 });
        return;
      case 'chest': {
        const inv = s.world.getChest(m.x, m.y, m.z, true);
        if (inv) inv.load({ slots: m.slots });
        const k = `${m.x},${m.y},${m.z}`;
        this.chestWait.get(k)?.();
        this.chestWait.delete(k);
        return;
      }
      case 'dim': {
        // l'hôte change de dimension : on le suit (même connexion)
        this.offEdits();
        this.s.chunks.remote = null;
        this.s.mp = null;
        const name = this.s.player.name;
        this.link.onClose = (r) => this.s.game.disconnected(`${r} avec l'hôte.`);
        void this.s.game.enterRemote(this.link, name, '', true).catch((e) => this.s.game.disconnected(`Changement de dimension impossible : ${(e as Error).message}`));
        return;
      }
      case 'closed':
      case 'kick':
        this.end(m.msg ?? "L'hôte a fermé la partie.");
        return;
      default:
    }
  }

  dispose() {
    this.offEdits();
    this.s.chunks.remote = null;
    this.link.send({ t: 'leave' });
    this.link.close();
  }
}
