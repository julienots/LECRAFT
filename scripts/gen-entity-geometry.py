# Génère src/data/vanillaGeometry.ts : géométries des créatures (os, cubes, UV) extraites des
# échantillons officiels de l'édition Bedrock (https://github.com/Mojang/bedrock-samples,
# resource_pack/models/entity). Seuls les nombres de géométrie sont conservés (aucune texture).
# Usage : python3 scripts/gen-entity-geometry.py <bedrock-samples>/resource_pack/models/entity src/data/vanillaGeometry.ts
import json, os, sys, re
SRC, OUT = sys.argv[1], sys.argv[2]
WANT = {
  'cow.v2.geo.json': 'geometry.cow.v2', 'mooshroom.v2.geo.json': 'geometry.mooshroom.v2', 'pig.v3.geo.json': 'geometry.pig.v3',
  'chicken.geo.json': 'geometry.chicken.v1.12', 'horse_v3.geo.json': 'geometry.horse.v3', 'llama.geo.json': 'geometry.llama.v1.8',
  'camel.geo.json': 'geometry.camel', 'camel_husk.geo.json': 'geometry.camel_husk', 'goat.geo.json': 'geometry.goat',
  'polar_bear.geo.json': 'geometry.polarbear', 'panda.geo.json': 'geometry.panda', 'hoglin.geo.json': 'geometry.hoglin',
  'armadillo.geo.json': 'geometry.armadillo', 'rabbit.v2.geo.json': 'geometry.rabbit.v2', 'frog.geo.json': 'geometry.frog',
  'turtle.geo.json': 'geometry.turtle', 'fox.geo.json': 'geometry.fox', 'ocelot.geo.json': 'geometry.ocelot.v1.8', 'cat.geo.json': 'geometry.cat',
  'parrot.geo.json': 'geometry.parrot', 'bee.geo.json': 'geometry.bee', 'phantom.geo.json': 'geometry.phantom',
  'silverfish.geo.json': 'geometry.silverfish', 'endermite.geo.json': 'geometry.endermite', 'strider.geo.json': 'geometry.strider',
  'cod.geo.json': 'geometry.cod', 'salmon.geo.json': 'geometry.salmon', 'pufferfish.geo.json': 'geometry.pufferfish.large.v1.8',
  'tropical_fish.geo.json': None, 'dolphin.geo.json': 'geometry.dolphin', 'guardian.geo.json': 'geometry.guardian.v1.8',
  'axolotl.geo.json': 'geometry.axolotl', 'tadpole.geo.json': 'geometry.tadpole', 'iron_golem.geo.json': 'geometry.irongolem',
  'zombie_villager.geo.json': 'geometry.zombie.villager.v1.8', 'pillager.geo.json': 'geometry.pillager', 'vindicator.geo.json': 'geometry.vindicator.v1.8',
  'evoker.geo.json': 'geometry.evoker.v1.8', 'bat_v2.geo.json': 'geometry.bat_v2', 'shulker.geo.json': 'geometry.shulker.v1.8',
  'bogged.geo.json': 'geometry.skeleton.bogged', 'parched.geo.json': 'geometry.parched', 'villager.geo.json': None, 'snow_golem.geo.json': 'geometry.snowgolem.v1.8',
}
KEEP_BONE = ('name', 'parent', 'pivot', 'rotation', 'bind_pose_rotation', 'mirror', 'inflate', 'neverRender')
KEEP_CUBE = ('origin', 'size', 'uv', 'inflate', 'mirror', 'pivot', 'rotation')
out = {}
def strip(bones):
    res = []
    for b in bones:
        nb = {k: b[k] for k in KEEP_BONE if k in b}
        nb['cubes'] = [{k: c[k] for k in KEEP_CUBE if k in c} for c in b.get('cubes', [])]
        res.append(nb)
    return res
for f, gid in WANT.items():
    j = json.load(open(os.path.join(SRC, f)))
    geos = []
    for g in j.get('minecraft:geometry', []):
        d = g['description']; geos.append((d['identifier'], int(float(d.get('texture_width', 64))), int(float(d.get('texture_height', 64))), g.get('bones', [])))
    for k, v in j.items():
        if k.startswith('geometry.'): geos.append((k.split(':')[0], int(float(v.get('texturewidth', 64))), int(float(v.get('textureheight', 64))), v.get('bones', [])))
    for i, w, h, bones in geos:
        if gid is None or i == gid:
            out[i] = {'texW': w, 'texH': h, 'bones': strip(bones)}
            if gid is not None: break
    else:
        if gid is not None and gid not in out: print('introuvable', f, gid, [g[0] for g in geos])
print(len(out), list(out))
s = json.dumps(out, separators=(',', ':'))
open(OUT, 'w').write('// Fichier généré par scripts/gen-entity-geometry.py — ne pas modifier à la main.\n// Géométries (nombres seulement) des modèles de créatures du jeu de référence, format .geo.json.\n/* eslint-disable */\nexport const VANILLA_GEO: Record<string, { texW: number; texH: number; bones: any[] }> = ' + s + ';\n')
