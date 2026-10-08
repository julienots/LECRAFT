/**
 * Hôte d'une partie en réseau : le monde de ce joueur est partagé avec les invités via le relais.
 * L'hôte reste maître du monde : il applique les modifications des invités, simule les créatures
 * (qui peuvent cibler n'importe quel joueur), fournit les chunks modifiés, le temps et la météo.
 */
import type { Session } from '../core/Session';
import { BlockRegistry } from '../blocks/BlockRegistry';
import { ItemRegistry } from '../inventory/ItemRegistry';
import type { ItemStack } from '../inventory/Item';
import { Animal } from '../entities/Animal';
import { Bot } from '../server/Bot';
import type { Mob } from '../entities/Mob';
import { encodeChunk, type MobState, type NetLink, type NetMsg, type PlayerState } from './Protocol';
import { RemotePlayer, targetProxy } from './RemotePlayer';
import type { GameContext } from '../core/GameContext';
import type { Player } from '../player/Player';
import type { Dimension } from '../world/Portals';

interface Peer {
  id: number;
  name: string;
  skin: string;
  avatar: RemotePlayer;
  proxy: Player;
  ctx: GameContext;
  chunkQueue: [number, number][];
  /** Créatures envoyées au dernier instantané (pour signaler celles qui disparaissent). */
  sentMobs: Set<number>;
}

export interface HostOptions {
  pvp: boolean;
  bots: boolean;
}

export class MultiplayerHost {
  readonly kind = 'host' as const;
  readonly peers = new Map<number, Peer>();
  private edits: number[] = [];
  private tEdits = 0;
  private tPlayers = 0;
  private tMobs = 0;
  private tTime = 0;
  private encoding = 0;
  private swingFlag = false;
  private offEdits: () => void;

  constructor(readonly s: Session, readonly link: NetLink, readonly room: string, readonly opts: HostOptions) {
    const handler = (e: { x: number; y: number; z: number; id: number; meta: number }) => this.edits.push(e.x, e.y, e.z, e.id, e.meta);
    this.offEdits = s.world.events.on('blockChanged', handler);
    link.onMessage = (m) => this.onMessage(m);
    link.onClose = () => {
      s.game.chat.add('§cConnexion au relais perdue : la partie n’est plus ouverte.', 'error');
      s.stopMultiplayer(false);
    };
  }

  get playerCount() {
    return this.peers.size + 1;
  }

  /** Coup porté par le joueur local (animation vue par les autres). */
  swing() {
    this.swingFlag = true;
  }

  private stateOf(): PlayerState {
    const p = this.s.player;
    const f = (p.sneaking ? 1 : 0) | (p.swimming || p.crawling ? 2 : 0) | (this.swingFlag || this.s.entities.combat.swing > 0.5 ? 4 : 0) | (p.dead ? 8 : 0) | (p.creative ? 16 : 0);
    this.swingFlag = false;
    return { id: this.link.myId, name: p.name, skin: this.s.game.settings.playerSkin ?? 'steve', x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, f, held: p.inventory.selectedStack?.id ?? '', hp: p.health };
  }

  private send(m: NetMsg | Record<string, unknown>) {
    this.link.send(m);
  }

  /** Message système (rejoint/quitté…) affiché chez tout le monde. */
  sys(text: string) {
    this.s.game.chat.add(text, 'chat');
    this.send({ t: 'sys', text });
  }

  /** Message de chat du joueur local. */
  chat(text: string) {
    this.send({ t: 'chat', text: `<${this.s.player.name}> ${text}` });
  }

  update(dt: number) {
    const s = this.s;
    // positions des joueurs distants : terrain chargé autour d'eux, cibles des créatures
    s.chunks.extraCenters = [...this.peers.values()].map((p) => ({ x: p.avatar.x, z: p.avatar.z }));
    this.tEdits -= dt;
    if (this.tEdits <= 0 && this.edits.length) {
      this.tEdits = 0.05;
      this.send({ t: 'edits', e: this.edits });
      this.edits = [];
    }
    this.tPlayers -= dt;
    if (this.tPlayers <= 0) {
      this.tPlayers = 0.1;
      this.send({ t: 'ps', list: [this.stateOf(), ...[...this.peers.values()].map((p) => p.avatar.state)] });
    }
    this.tMobs -= dt;
    if (this.tMobs <= 0 && this.peers.size) {
      this.tMobs = 0.1;
      for (const p of this.peers.values()) this.sendMobs(p);
    }
    this.tTime -= dt;
    if (this.tTime <= 0) {
      this.tTime = 3;
      this.send({ t: 'time', time: s.dayCycle.time, day: s.dayCycle.day, weather: s.weather.state, rain: s.weather.intensity });
    }
    // chunks demandés (quelques-uns par image)
    for (const p of this.peers.values())
      while (p.chunkQueue.length && this.encoding < 6) {
        const [cx, cz] = p.chunkQueue.shift()!;
        this.encoding++;
        void this.sendChunk(p.id, cx, cz).finally(() => this.encoding--);
      }
  }

  private async sendChunk(to: number, cx: number, cz: number) {
    const c = await this.s.chunks.modifiedChunk(cx, cz);
    const data = c ? await encodeChunk(c.blocks, c.meta) : null;
    this.send({ t: 'chunk', to, cx, cz, data });
  }

  /** Créatures proches d'un invité (sauf son propre avatar). */
  private sendMobs(p: Peer) {
    const list: MobState[] = [];
    const seen = new Set<number>();
    for (const e of this.s.entities.entities) {
      if (e.kind !== 'mob' || e.removed) continue;
      const m = e as Mob;
      if (m === p.avatar) continue;
      if (m instanceof RemotePlayer) continue; // les joueurs passent par « ps »
      if (Math.hypot(m.x - p.avatar.x, m.z - p.avatar.z) > 56) continue;
      seen.add(m.id);
      const f = (m.hurtTimer > 0 ? 1 : 0) | (m.attackAnim > 0.8 ? 2 : 0) | (m.dead ? 4 : 0) | (m.baby ? 8 : 0) | (m instanceof Animal && m.sheared ? 16 : 0);
      const st: MobState = { id: m.id, k: m.def.key, x: +m.x.toFixed(2), y: +m.y.toFixed(2), z: +m.z.toFixed(2), yaw: +m.yaw.toFixed(2), f, hp: Math.ceil(m.health) };
      if (m instanceof Bot) {
        st.n = m.botName;
        st.h = m.weapon;
      }
      if (m instanceof Animal && m.def.key === 'sheep') st.w = m.woolColor;
      list.push(st);
    }
    // créatures disparues (hors de portée, retirées)
    for (const id of p.sentMobs) if (!seen.has(id)) list.push({ id, k: '', x: 0, y: 0, z: 0, yaw: 0, f: 128, hp: 0 });
    p.sentMobs = seen;
    this.send({ t: 'mobs', to: p.id, list });
  }

  private onMessage(m: NetMsg) {
    const s = this.s;
    switch (m.t) {
      case 'hello':
      case 'peerJoin': {
        const j = m.t === 'hello' ? { id: m.from ?? -1, name: m.name, skin: m.skin } : m;
        if (this.peers.has(j.id)) return;
        const [sx, sy, sz] = s.player.spawn;
        const st: PlayerState = { id: j.id, name: j.name, skin: j.skin, x: sx, y: sy, z: sz, yaw: 0, pitch: 0, f: 0, held: '' };
        const avatar = s.entities.addMob(new RemotePlayer(st, s.entities));
        const peer: Peer = { id: j.id, name: j.name, skin: j.skin, avatar, chunkQueue: [], sentMobs: new Set(), proxy: null as unknown as Player, ctx: s };
        peer.proxy = targetProxy(avatar, s.player, (dmg, kx, kz, src) => {
          this.send({ t: 'hurt', to: j.id, dmg, kx, kz, src });
          avatar.hurtTimer = 0.3;
          return dmg;
        });
        const ctx = Object.create(s) as GameContext;
        Object.defineProperty(ctx, 'player', { value: peer.proxy });
        peer.ctx = ctx;
        // coups du joueur local sur l'avatar : JcJ
        avatar.onNetHit = (dmg, info) => {
          if (!this.opts.pvp) return;
          this.send({ t: 'hurt', to: j.id, dmg, kx: info.kx, kz: info.kz, src: 'player', by: s.player.name });
        };
        this.peers.set(j.id, peer);
        s.entities.remotes = [...this.peers.values()].map((p) => ({ proxy: p.proxy, ctx: p.ctx }));
        this.send({
          t: 'welcome', to: j.id, seed: s.world.seed, world: s.meta.name, dim: s.dimension, mode: s.player.creative ? 'creative' : s.meta.gameMode,
          difficulty: s.player.difficulty, time: s.dayCycle.time, day: s.dayCycle.day, weather: s.weather.state, spawn: [sx, sy, sz],
          hostName: s.player.name, hostId: this.link.myId, players: [this.stateOf(), ...[...this.peers.values()].filter((p) => p.id !== j.id).map((p) => p.avatar.state)],
          pvp: this.opts.pvp, bots: this.opts.bots, smp: !!s.meta.smp,
        });
        if (m.t === 'peerJoin') this.sys(`§e${j.name} a rejoint la partie`);
        s.audio.play('pop', { volume: 0.6 });
        return;
      }
      case 'peerLeft': {
        const p = this.peers.get(m.id);
        if (!p) return;
        p.avatar.removed = true;
        this.peers.delete(m.id);
        s.entities.remotes = [...this.peers.values()].map((q) => ({ proxy: q.proxy, ctx: q.ctx }));
        this.sys(`§e${p.name} a quitté la partie`);
        return;
      }
      case 'p': {
        const p = this.peers.get(m.from ?? -1);
        if (p) p.avatar.apply({ ...m.s, id: p.id, name: p.name, skin: p.skin });
        return;
      }
      case 'chunkReq': {
        const p = this.peers.get(m.from ?? -1);
        if (p && p.chunkQueue.length < 600) p.chunkQueue.push([m.cx, m.cz]);
        return;
      }
      case 'edit': {
        const p = this.peers.get(m.from ?? -1);
        if (!p) return;
        const e = m.e;
        for (let i = 0; i + 4 < e.length; i += 5) {
          const [x, y, z, id, meta] = [e[i], e[i + 1], e[i + 2], e[i + 3], e[i + 4]];
          if (!(id >= 0) || (!BlockRegistry.blocks[id] && id !== 0)) continue;
          if (s.server || (s.smp && !s.smp.canEdit(x, y, z))) continue;
          if (!s.world.isLoaded(x, z)) continue;
          s.world.setBlock(x, y, z, id, meta);
        }
        return;
      }
      case 'hitMob': {
        const p = this.peers.get(m.from ?? -1);
        const mob = s.entities.entities.find((e) => e.id === m.id && e.kind === 'mob') as Mob | undefined;
        if (!p || !mob || mob.dead) return;
        const loot: ItemStack[] = [];
        s.entities.dropRedirect = (id, count, durability) => loot.push({ id, count, ...(durability !== undefined ? { durability } : {}) });
        try {
          s.combat.damageMob(mob, m.dmg, { kind: 'bot', knockX: m.kx, knockZ: m.kz, crit: m.crit, attacker: p.avatar as never });
        } finally {
          s.entities.dropRedirect = null;
        }
        // les neutres et monstres se retournent contre l'attaquant
        if (!mob.dead && mob.def.category !== 'passive') {
          mob.anger = 30;
          mob.ai.lastSeenX = p.avatar.x;
          mob.ai.lastSeenZ = p.avatar.z;
        } else if (!mob.dead) mob.fleeTimer = 5;
        if (mob.dead || loot.length) this.send({ t: 'give', to: p.id, items: loot, xp: mob.dead ? mob.def.xp : 0 });
        return;
      }
      case 'hitPlayer': {
        if (!this.opts.pvp) return;
        const from = this.peers.get(m.from ?? -1);
        if (!from) return;
        if (m.target === this.link.myId) {
          s.player.damage(m.dmg, 'player', m.kx, m.kz);
          s.audio.play('hurt');
        } else this.send({ t: 'hurt', to: m.target, dmg: m.dmg, kx: m.kx, kz: m.kz, src: 'player', by: from.name });
        return;
      }
      case 'chat': {
        const p = this.peers.get(m.from ?? -1);
        if (!p) return;
        const line = `<${p.name}> ${m.text}`;
        s.game.chat.add(line, 'chat');
        this.send({ t: 'chat', text: line, except: p.id });
        // les bots répondent aussi aux invités
        s.smp?.playerChat(m.text);
        return;
      }
      case 'chestReq': {
        const inv = s.world.getChest(m.x, m.y, m.z, true);
        s.interaction.ensureChestLoot(m.x, m.y, m.z);
        this.send({ t: 'chest', to: m.from, x: m.x, y: m.y, z: m.z, slots: inv ? inv.serialize().slots : [] });
        return;
      }
      case 'chestSet': {
        const inv = s.world.getChest(m.x, m.y, m.z, true);
        if (inv) inv.load({ slots: m.slots.map((x) => (x && ItemRegistry.has(x.id) ? x : null)) });
        return;
      }
      default:
    }
  }

  /** Changement de dimension de l'hôte : la connexion est conservée, les invités rechargent. */
  detach(dim: Dimension): { link: NetLink; room: string; opts: HostOptions } {
    this.send({ t: 'dim', dim });
    this.offEdits();
    for (const p of this.peers.values()) p.avatar.removed = true;
    this.peers.clear();
    this.s.entities.remotes = [];
    this.s.chunks.extraCenters = [];
    this.link.onMessage = () => {};
    this.link.onClose = () => {};
    this.s.mp = null;
    return { link: this.link, room: this.room, opts: this.opts };
  }

  dispose() {
    this.offEdits();
    for (const p of this.peers.values()) p.avatar.removed = true;
    this.peers.clear();
    this.s.entities.remotes = [];
    this.s.chunks.extraCenters = [];
    this.send({ t: 'leave' });
    this.link.close();
  }
}
