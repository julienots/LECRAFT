import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { SaveManager } from '../src/save/SaveManager';
import { rleDecode, rleEncode } from '../src/save/WorldSerializer';
import { CHUNK_VOLUME } from '../src/core/Config';

describe('WorldSerializer', () => {
  it('RLE aller-retour', () => {
    const a = new Uint8Array(CHUNK_VOLUME);
    for (let i = 0; i < a.length; i++) a[i] = i < 9000 ? 2 : i % 7 === 0 ? 5 : 0;
    const e = rleEncode(a);
    expect(e.length).toBeLessThan(a.length);
    expect(Buffer.from(rleDecode(e, a.length)).equals(Buffer.from(a))).toBe(true);
  });
  it('détecte un RLE tronqué', () => {
    const e = rleEncode(new Uint8Array(1000).fill(3));
    expect(() => rleDecode(e.slice(0, e.length - 2), 1000)).toThrow();
  });
});

describe('SaveManager', () => {
  it('crée, sauvegarde, recharge et supprime un monde', async () => {
    const sm = new SaveManager();
    const meta = await sm.createWorld('Test', 1234, 'survival', 'normal');
    const blocks = new Uint8Array(CHUNK_VOLUME).fill(2);
    blocks[5] = 9;
    await sm.save(meta, { player: { x: 1, y: 2, z: 3 }, inv: ['a'] }, [{ cx: 0, cz: -1, blocks, meta: new Uint8Array(CHUNK_VOLUME) }]);
    const st = await sm.load<{ player: { x: number } }>(meta.id);
    expect(st?.player.x).toBe(1);
    const ch = await sm.loadChunk(meta.id, 0, -1);
    expect(ch?.blocks[5]).toBe(9);
    expect((await sm.listWorlds()).some((w) => w.id === meta.id)).toBe(true);
    const copy = await sm.backupSave(meta.id);
    expect((await sm.loadChunk(copy.id, 0, -1))?.blocks[5]).toBe(9);
    await sm.deleteSave(meta.id);
    expect(await sm.loadChunk(meta.id, 0, -1)).toBeNull();
    expect(await sm.load(meta.id)).toBeNull();
    expect((await sm.load<{ player: { x: number } }>(copy.id))?.player.x).toBe(1);
  });

  it('utilise la copie de secours si l’état est corrompu', async () => {
    const sm = new SaveManager();
    const meta = await sm.createWorld('Corrompu', 1, 'survival', 'normal');
    await sm.save(meta, { v: 1 }, []);
    await sm.save(meta, { v: 2 }, []);
    // corruption volontaire de l'enregistrement principal
    const db = await new Promise<IDBDatabase>((r) => { const q = indexedDB.open('lecraft'); q.onsuccess = () => r(q.result); });
    await new Promise<void>((r) => {
      const tx = db.transaction('states', 'readwrite');
      const s = tx.objectStore('states');
      const g = s.get(meta.id);
      g.onsuccess = () => { s.put({ ...g.result, data: '{"v":99' }); };
      tx.oncomplete = () => r();
    });
    const st = await sm.load<{ v: number }>(meta.id);
    expect(st?.v).toBe(1);
    expect(sm.lastLoadUsedBackup).toBe(true);
  });
});

describe('Format des blocs 16 bits', () => {
  it('RLE 16 bits aller-retour et lecture des anciens chunks 8 bits', async () => {
    const { rleEncode16, rleDecode16, rleEncode, rleDecode } = await import('../src/save/WorldSerializer');
    const a = new Uint16Array(4096);
    for (let i = 0; i < a.length; i++) a[i] = i < 1000 ? 300 + (i % 3) : i % 700 === 0 ? 4000 : 2;
    expect([...rleDecode16(rleEncode16(a), a.length)]).toEqual([...a]);
    const old = new Uint8Array([1, 1, 2, 7, 7, 200]);
    expect([...Uint16Array.from(rleDecode(rleEncode(old), old.length))]).toEqual([1, 1, 2, 7, 7, 200]);
  });
});
