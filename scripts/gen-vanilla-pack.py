# Génère src/data/vanillaPack.ts à partir du pack de ressources (noms de textures + couleurs moyennes,
# aucun pixel). Usage : python3 scripts/gen-vanilla-pack.py public/default-pack.zip src/data/vanillaPack.ts
# Entrée : /tmp/lists.json (tuiles, blocs et objets du jeu SANS le contenu du pack, produit par un test vitest).
import zipfile, json, re, sys, io
from PIL import Image

ZIP, OUT = sys.argv[1], sys.argv[2]
z = zipfile.ZipFile(ZIP)
ROOT = 'Default-Java-1.21.11/assets/minecraft/textures/'
def listdir(sub):
    pre = ROOT + sub + '/'
    return sorted(n[len(pre):-4] for n in z.namelist() if n.startswith(pre) and n.endswith('.png') and '/' not in n[len(pre):])
PB = set(listdir('block'))
PI = set(listdir('item'))
L = json.load(open(sys.argv[3] if len(sys.argv) > 3 else '/tmp/lists.json'))
MODELS = json.load(open(sys.argv[4])) if len(sys.argv) > 4 else {'keys': [], 'tiles': []}
src = open('src/render/TextureManager.ts').read()
ren_src = src[src.index('const PACK_RENAME'):src.index('};', src.index('const PACK_RENAME'))]
RENAME = dict(re.findall(r"(\w+): '(\w+)'", ren_src))
eff = lambda t: RENAME.get(t, t)

STATS = {}
def stats(name):
    if name in STATS: return STATS[name]
    im = Image.open(io.BytesIO(z.read(ROOT + 'block/' + name + '.png'))).convert('RGBA')
    w = im.width
    im = im.crop((0, 0, w, w))
    px = list(im.get_flattened_data())
    op = [p for p in px if p[3] > 128]
    tr = 1 - len(op) / len(px)
    if op:
        c = tuple(sum(p[i] for p in op) // len(op) for i in range(3))
    else:
        c = (128, 128, 128)
    STATS[name] = ('#%02x%02x%02x' % c, tr)
    return STATS[name]

blocks = {b['key']: b for b in L['blocks']}
tiles = set(L['tiles'])
used = set(eff(t) for t in tiles) | {'grass_block_side_overlay'}

SKIP = re.compile(r'^(debug2?|fire_1|soul_fire_1|destroy_stage_\d|.*_flow|.*_overlay|.*_emissive|.*_particle)$')

# ---------------------------------------------------------------- 1. faces des blocs existants
BOTTOM_OVERRIDE = {'mycelium': 'dirt', 'crimson_nylium': 'netherrack', 'warped_nylium': 'netherrack'}
FACES = {}       # key -> textures complètes
ORIENT = []      # blocs rendus orientables (face avant)
FALLBACK = {}    # tuile -> tuile existante (peintre de repli)
NOFACE_SHAPES = {'door', 'bed', 'chest', 'torch', 'lantern', 'end_frame', 'end_portal', 'fence', 'fence_gate', 'ladder', 'lever', 'button', 'plate', 'trapdoor', 'cactus', 'snow_layer', 'farmland', 'lily_pad', 'custom', 'carpet'}
for k, b in blocks.items():
    t = b.get('t') or {}
    if set(t) != {'all'}: continue
    if b.get('render') in ('cross', 'liquid', 'none'): continue
    shape = b.get('shape')
    if shape in NOFACE_SHAPES: continue
    T = t['all']
    cands = []
    if re.search(r'_(wood|hyphae)$', k): continue
    for c in (k, T, re.sub(r'_(side|front)$', '', eff(T))):
        if c not in cands: cands.append(c)
    def find(*suffixes):
        for c in cands:
            for s in suffixes:
                n = f'{c}_{s}'
                if n in PB and not SKIP.match(n): return n
        return None
    if shape == 'pane':
        top = find('top')
        if top: FACES[k] = {'side': T, 'top': top, 'bottom': top}; FALLBACK[top] = T; used.add(top)
        continue
    side, top, bottom = find('side', 'east'), find('top', 'end'), find('bottom', 'end')
    front = back = None
    if not shape and b.get('render') in (None, 'cube'):
        front, back = find('front', 'north'), find('back', 'south')
    if eff(T) == side: side = None
    f = {'side': side or T}
    if top: f['top'] = top
    if bottom: f['bottom'] = bottom
    elif top: f['bottom'] = BOTTOM_OVERRIDE.get(k, top)
    if front and front != eff(T): f['front'] = front
    elif front and front == eff(T) and side: f['front'] = T
    if back: f['back'] = back
    if side and not shape and 'front' not in f and re.search(r'_(front|occupied|north)$', eff(T)): f['front'] = T
    if k == 'sticky_piston': top = 'piston_top_sticky'; f['top'] = top
    if len(f) == 1 and not side: continue
    if 'top' not in f and 'bottom' not in f and 'front' not in f and 'back' not in f and f['side'] == T: continue
    if 'front' in f and 'top' not in f: f['top'] = T; f['bottom'] = f.get('bottom', T)
    f.setdefault('top', T); f.setdefault('bottom', f['top'])
    FACES[k] = f
    if 'front' in f and not b.get('orientable'): ORIENT.append(k)
    for n in f.values():
        if n != T and n not in tiles: FALLBACK[n] = T
    used |= set(f.values())

# 1b. blocs à faces explicites : faces avant / dessous du pack
for k, b in blocks.items():
    t = b.get('t') or {}
    if 'all' in t or 'byMeta' in t or not t or b.get('shape') or b.get('render') not in (None, 'cube'): continue
    f = dict(t)
    ch = False
    for suf, face in (('front', 'front'), ('bottom', 'bottom'), ('base', 'bottom')):
        n = f'{k}_{suf}'
        if n in PB and n not in used and f.get(face) != n and not (face == 'bottom' and f.get('bottom') not in (None, f.get('top'))):
            f[face] = n; ch = True; used.add(n)
            if n not in tiles: FALLBACK[n] = t.get('side') or t.get('top')
    if ch:
        FACES[k] = f
        if 'front' in f and not b.get('orientable'): ORIENT.append(k)
for k in ('dispenser', 'dropper'):
    if k in blocks and 'all' in (blocks[k].get('t') or {}):
        FACES[k] = {'side': 'furnace_side', 'top': 'furnace_top', 'bottom': 'furnace_top', 'front': blocks[k]['t']['all']}
        if k not in ORIENT: ORIENT.append(k)

# ---------------------------------------------------------------- 2. textures restantes -> nouveaux blocs
# textures utilisées par les modèles 3D (src/data/blockModels.ts) ; blocs à modèle manquants
used |= set(MODELS['tiles'])
U = sorted(n for n in PB if n not in used and not SKIP.match(n))
NEW = []  # dicts
taken = set(blocks)
for k in MODELS['keys']:
    if k in blocks: continue
    first = k if k in PB else next((t for t in MODELS['tiles'] if t.startswith(k.split('_')[0]) and t in PB), MODELS['tiles'][0])
    taken.add(k)
    NEW.append({'key': k, 'src': k, 'kind': 'model', 'textures': {'all': first}})
def newkey(k):
    base = k
    i = 2
    while k in taken: k = f'{base}_{i}' if i > 2 else f'{base}_decor'; i += 1
    taken.add(k)
    return k

remaining = set(U)
# portes
for n in U:
    m = re.match(r'^(.*_door)_top$', n)
    if m and f'{m[1]}_bottom' in remaining:
        k = m[1]
        NEW.append({'key': newkey(k), 'src': k, 'kind': 'door', 'textures': {'byMeta': [f'{k}_bottom', n]}})
        remaining -= {n, f'{k}_bottom'}
# plantes doubles (haut/bas transparents)
for n in sorted(remaining):
    m = re.match(r'^(.*)_top$', n)
    if m and f'{m[1]}_bottom' in remaining and re.search(r'seagrass|pitcher_crop|dripleaf_stem|sunflower|tall_|large_', n):
        NEW.append({'key': newkey(m[1]), 'src': m[1], 'kind': 'double', 'textures': {'byMeta': [f'{m[1]}_bottom', n]}})
        remaining -= {n, f'{m[1]}_bottom'}

FACE_TOK = {'top': 'top', 'bottom': 'bottom', 'side': 'side', 'front': 'front', 'back': 'back', 'north': 'front', 'south': 'back', 'east': 'east', 'west': 'west', 'end': 'top'}
def parse(n):
    toks = n.split('_')
    for i in range(1, len(toks)):
        tk = toks[i]
        m = re.match(r'^(side)(\d)$', tk)
        if m: return '_'.join(toks[:i] + toks[i + 1:] + [m[2]]), 'side'
        if tk in FACE_TOK: return '_'.join(toks[:i] + toks[i + 1:]), FACE_TOK[tk]
    return None, None

groups = {}
for n in sorted(remaining):
    if stats(n)[1] > 0.6: continue  # transparents : blocs individuels
    base, face = parse(n)
    if not base: continue
    g = groups.setdefault(base, {})
    if face in g:  # deux textures pour la même face (ex. top + end) : la seconde reste seule
        continue
    g[face] = n
# parents : blocs existants (faces finales) et autres groupes
def faces_of_existing(k):
    b = blocks[k]
    t = FACES.get(k) or b.get('t') or {}
    if 'byMeta' in t: return None
    a = t.get('all')
    return {f: t.get(f, t.get('side', a)) for f in ('side', 'top', 'bottom', 'front', 'back') if t.get(f, t.get('side', a))}
def parents(base):
    toks = set(base.split('_'))
    out = []
    for k in list(groups) + list(blocks):
        if k == base: continue
        kt = set(k.split('_'))
        if kt < toks: out.append(k)
    out.sort(key=lambda k: -len(k.split('_')))
    return out
for n in sorted(remaining):
    if n in groups and 'side' not in groups[n] and stats(n)[1] <= 0.6 and not parse(n)[0]: groups[n]['side'] = n
for base in sorted(groups, key=lambda b: len(b.split('_'))):
    g = groups[base]
    if len(g) == 1 and not parents(base):
        continue  # pas de vrai groupe : bloc simple
    full = dict(g)
    for p in parents(base):
        pf = groups.get(p) if p in groups else faces_of_existing(p)
        if not pf: continue
        for f in ('side', 'top', 'bottom', 'front', 'back'):
            if f not in full and f in pf and f in ('side', 'top', 'bottom'): full[f] = pf[f]
    if 'side' not in full:
        for f in ('east', 'west', 'front', 'back', 'top'):
            if f in full: full['side'] = full[f]; break
    full.setdefault('top', full['side']); full.setdefault('bottom', full['top'])
    if 'east' in full and 'west' not in full: full['west'] = full['east']
    if 'west' in full and 'east' not in full: full['east'] = full['west']
    tr = max(stats(v)[1] for v in full.values() if v in PB)
    NEW.append({'key': newkey(base), 'src': base, 'kind': 'faces' if tr <= 0.02 else 'faces_cutout', 'textures': full})
    remaining -= set(g.values())
    groups[base] = full

for n in sorted(remaining):
    c, tr = stats(n)
    kind = 'cube'
    if re.search(r'_trapdoor$', n): kind = 'trapdoor'
    elif re.search(r'lantern$', n): kind = 'lantern'
    elif re.search(r'_bars$', n): kind = 'pane'
    elif re.search(r'torch', n): kind = 'torch'
    elif re.search(r'(^|_)rail|redstone_dust|leaf_litter|frogspawn|sculk_vein|moss_carpet$|^wildflowers$|^tripwire$|pink_petals', n): kind = 'carpet'
    elif re.search(r'grate', n): kind = 'cutout'
    elif tr > 0.35: kind = 'cross'
    elif tr > 0.02: kind = 'cutout'
    NEW.append({'key': newkey(n), 'src': n, 'kind': kind, 'textures': {'all': n}})

newtiles = set(t for t in MODELS['tiles'] if t not in tiles)
for b in NEW:
    for v in b['textures'].values():
        for n in (v if isinstance(v, list) else [v]):
            if n not in tiles: newtiles.add(n)
for n in newtiles:
    if n in FALLBACK: continue
    c, tr = stats(n) if n in PB else ('#808080', 0)
    FALLBACK[n] = ('~' if tr > 0.35 else '#') + c[1:]
for n, v in list(FALLBACK.items()):
    if n in PB and not v.startswith(('~', '#')):
        pass

# ---------------------------------------------------------------- 3. noms français
W = {}
def w(s):
    for part in s.strip().split('\n'):
        if not part.strip(): continue
        k, v = part.split('=', 1)
        W[k.strip()] = v.strip()
w('''
black=noir|noire
white=blanc|blanche
red=rouge|rouge
blue=bleu|bleue
light_blue=bleu clair|bleu clair
green=vert|verte
lime=vert clair|vert clair
yellow=jaune|jaune
orange=orange|orange
pink=rose|rose
purple=violet|violette
magenta=magenta|magenta
cyan=cyan|cyan
gray=gris|grise
light_gray=gris clair|gris clair
brown=marron|marron
lit=allumé|allumée
on=activé|activée
off=éteint|éteinte
powered=alimenté|alimentée
open=ouvert|ouverte
dead=mort|morte
cracked=craquelé|craquelée
chiseled=sculpté|sculptée
polished=poli|polie
stripped=écorcé|écorcée
ominous=sinistre|sinistre
active=actif|active
inactive=inactif|inactive
awake=éveillé|éveillée
dormant=endormi|endormie
triggered=déclenché|déclenchée
crafting=en fabrication|en fabrication
ejecting=qui éjecte|qui éjecte
reward=(récompense)|(récompense)
conditional=conditionnel|conditionnelle
inverted=inversé|inversée
honey=au miel|au miel
bloom=en fleur|en fleur
small=petit|petite
medium=moyen|moyenne
large=grand|grande
big=grand|grande
tall=haut|haute
short=court|courte
dry=sec|sèche
hanging=suspendu|suspendue
exposed=exposé|exposée
weathered=érodé|érodée
oxidized=oxydé|oxydée
waxed=ciré|cirée
ominous=sinistre|sinistre
not=non|non
slightly=légèrement|légèrement
very=très|très
empty=vide|vide
broken=cassé|cassée
lingering=persistant|persistante
splash=jetable|jetable
enchanted=enchanté|enchantée
written=écrit|écrite
writable=inscriptible|inscriptible
filled=rempli|remplie
popped=éclaté|éclatée
fermented=fermenté|fermentée
suspicious=suspect|suspecte
glow=lumineux|lumineuse
blue_egg=Œuf bleu|m
brown_egg=Œuf marron|m
''')
MAT = {  # compléments invariables
 'copper': 'en cuivre', 'iron': 'en fer', 'golden': 'en or', 'gold': 'en or', 'diamond': 'en diamant', 'netherite': 'en netherite', 'wooden': 'en bois', 'stone': 'en pierre',
 'leather': 'en cuir', 'oak': 'en chêne', 'spruce': 'en sapin', 'birch': 'en bouleau', 'jungle': 'en acajou', 'acacia': 'en acacia', 'dark_oak': 'en chêne noir',
 'mangrove': 'en palétuvier', 'cherry': 'en cerisier', 'pale_oak': 'en chêne pâle', 'bamboo': 'en bambou', 'crimson': 'carmin', 'warped': 'biscornu', 'resin': 'de résine',
 'tuff': 'de tuf', 'deepslate': "d'ardoise des abîmes", 'blackstone': 'de pierre noire', 'quartz': 'de quartz', 'basalt': 'de basalte', 'sandstone': 'de grès', 'red_sandstone': 'de grès rouge',
 'prismarine': 'de prismarine', 'purpur': 'de purpur', 'sculk': 'de sculk', 'amethyst': "d'améthyste", 'dripstone': 'de spéléothème', 'chorus': 'de chorus', 'mushroom': 'de champignon',
 'brain': 'cerveau', 'bubble': 'bulle', 'fire': 'de feu', 'horn': 'corne', 'tube': 'tube', 'soul': 'des âmes', 'redstone': 'de redstone', 'sniffer': 'de renifleur', 'turtle': 'de tortue',
 'nether': 'du Nether', 'end': "de l'End", 'trial': "d'épreuve", 'ochre': 'ocre', 'verdant': 'verdoyant', 'pearlescent': 'nacré', 'pale': 'pâle', 'azalea': "d'azalée", 'flowering': 'fleurie',
 'chain': 'à chaîne', 'repeating': 'à répétition', 'command': 'de commande', 'structure': 'de structure', 'jigsaw': 'puzzle', 'test': 'de test', 'calibrated': 'calibré',
 'creeper': 'creeper', 'skull': 'crâne', 'flower': 'fleur', 'mojang': 'Mojang', 'globe': 'globe', 'piglin': 'piglin', 'flow': 'flux', 'guster': 'rafaleur', 'field_masoned': 'maçonné', 'bordure_indented': 'bordure dentelée',
 'tipped': 'à effet', 'spectral': 'spectrale', 'model': '(modèle)', 'heavy': 'lourd', 'muddy': 'boueuses', 'firefly': 'à lucioles', 'eyeblossom': '', 'cave': 'des cavernes', 'twisting': 'grimpantes', 'weeping': 'pleureuses',
 'hydration': 'hydratation', 'tentacles': '(tentacules)', 'plant': '(tige)', 'stem': '(tige)', 'base': '(base)', 'tip': '(pointe)', 'merge': '(jonction)', 'frustum': '(tronc)', 'middle': '(milieu)', 'down': 'vers le bas', 'up': 'vers le haut',
 'inner': '(intérieur)', 'inside': '(intérieur)', 'outside': '(extérieur)', 'pivot': '(pivot)', 'round': '(meule)', 'saw': '(scie)', 'compost': '(compost)', 'ready': '(prêt)', 'pot': 'en pot', 'potted': 'en pot', 'bush': '(buisson)',
 'corner': '(angle)', 'data': '(données)', 'load': '(chargement)', 'save': '(sauvegarde)', 'accept': '(accepter)', 'fail': '(échec)', 'log': '(journal)', 'start': '(départ)', 'instance': '(instance)', 'lock': '(verrou)',
 'amethyst_input': '', 'input': '(entrée)', 'tendril': '(vrille)', 'can_summon': '(invocation)', 'summon': '', 'can': '', 'dot': '(point)', 'line0': '(ligne)', 'line1': '(ligne 2)', 'hydration_0': '', 'singleleaf': '(feuille)',
 'leaves': '(feuilles)', 'crop': '(culture)', 'stage': 'stade', 'occupied': '', 'east': '(est)', 'west': '(ouest)', 'north': '(nord)', 'south': '(sud)', 'top': '(dessus)', 'bottom': '(dessous)', 'side': '(côté)', 'front': '(face)', 'back': '(dos)',
 'sticky': 'collant', 'vertical': 'vertical', 'cake': '', 'raft': '', 'chest': 'avec coffre', 'in_hand': '', 'husk': 'momifié', 'zombie': 'zombie', 'skeleton': 'squelette', 'trader': 'de marchand', 'wandering': 'ambulant', 'elder': 'ancien', 'happy': 'joyeux',
}
NOUN = {  # nom : (français, genre)
 'candle': ('Bougie', 'f'), 'door': ('Porte', 'f'), 'trapdoor': ('Trappe', 'f'), 'lantern': ('Lanterne', 'f'), 'bars': ('Barreaux', 'mp'), 'chain': ('Chaîne', 'f'), 'bulb': ('Ampoule', 'f'), 'grate': ('Grille', 'f'),
 'lightning_rod': ('Paratonnerre', 'm'), 'shelf': ('Étagère', 'f'), 'rail': ('Rail', 'm'), 'activator_rail': ('Rail déclencheur', 'm'), 'detector_rail': ('Rail détecteur', 'm'), 'powered_rail': ('Rail de propulsion', 'm'),
 'anvil': ('Enclume', 'f'), 'chipped_anvil': ('Enclume ébréchée', 'f'), 'damaged_anvil': ('Enclume endommagée', 'f'), 'cauldron': ('Chaudron', 'm'), 'hopper': ('Entonnoir', 'm'), 'beacon': ('Balise', 'f'), 'conduit': ('Conduit', 'm'),
 'brewing_stand': ("Alambic", 'm'), 'cake': ('Gâteau', 'm'), 'flower_pot': ('Pot de fleurs', 'm'), 'bell': ('Cloche', 'f'), 'campfire': ('Feu de camp', 'm'), 'campfire_fire': ('Flammes de feu de camp', 'fp'), 'campfire_log': ('Bûche de feu de camp', 'f'),
 'command_block': ('Bloc de commande', 'm'), 'structure_block': ('Bloc de structure', 'm'), 'jigsaw': ('Bloc puzzle', 'm'), 'test_block': ('Bloc de test', 'm'), 'test_instance_block': ("Bloc d'instance de test", 'm'),
 'crafter': ('Fabricateur', 'm'), 'sniffer_egg': ('Œuf de renifleur', 'm'), 'turtle_egg': ('Œuf de tortue', 'm'), 'dried_ghast': ('Ghast desséché', 'm'), 'vault': ('Coffre-fort', 'm'), 'trial_spawner': ("Générateur d'épreuve", 'm'),
 'suspicious_sand': ('Sable suspect', 'm'), 'suspicious_gravel': ('Gravier suspect', 'm'), 'frosted_ice': ('Glace givrée', 'f'), 'respawn_anchor': ('Ancre de réapparition', 'f'), 'piston': ('Piston', 'm'), 'observer': ('Observateur', 'm'),
 'comparator': ('Comparateur', 'm'), 'repeater': ('Répéteur', 'm'), 'redstone_torch': ('Torche de redstone', 'f'), 'redstone_lamp': ('Lampe de redstone', 'f'), 'redstone_dust': ('Poudre de redstone', 'f'), 'lever': ('Levier', 'm'),
 'daylight_detector': ('Capteur de lumière', 'm'), 'tripwire': ('Fil de déclenchement', 'm'), 'tripwire_hook': ('Crochet', 'm'), 'scaffolding': ('Échafaudage', 'm'), 'stonecutter': ('Tailleur de pierre', 'm'), 'grindstone': ('Meule', 'f'),
 'lectern': ('Pupitre', 'm'), 'loom': ('Métier à tisser', 'm'), 'smithing_table': ('Table de forge', 'f'), 'fletching_table': ("Table d'archerie", 'f'), 'cartography_table': ('Table de cartographie', 'f'), 'enchanting_table': ("Table d'enchantement", 'f'),
 'composter': ('Composteur', 'm'), 'barrel': ('Tonneau', 'm'), 'blast_furnace': ('Haut fourneau', 'm'), 'smoker': ('Fumoir', 'm'), 'dispenser': ('Distributeur', 'm'), 'dropper': ('Dropper', 'm'), 'furnace': ('Fourneau', 'm'),
 'bee_nest': ("Nid d'abeilles", 'm'), 'beehive': ('Ruche', 'f'), 'creaking_heart': ('Cœur de grinceur', 'm'), 'sculk_sensor': ('Capteur de sculk', 'm'), 'sculk_shrieker': ('Hurleur de sculk', 'm'), 'sculk_catalyst': ('Catalyseur de sculk', 'm'),
 'sculk_vein': ('Veine de sculk', 'f'), 'calibrated_sculk_sensor': ('Capteur de sculk calibré', 'm'), 'chiseled_bookshelf': ('Bibliothèque sculptée', 'f'), 'heavy_core': ('Noyau lourd', 'm'), 'resin_block': ('Bloc de résine', 'm'),
 'resin_bricks': ('Briques de résine', 'fp'), 'resin_clump': ('Amas de résine', 'm'), 'pale_moss_block': ('Bloc de mousse pâle', 'm'), 'pale_moss_carpet': ('Tapis de mousse pâle', 'm'), 'pale_hanging_moss': ('Mousse pâle suspendue', 'f'),
 'moss_carpet': ('Tapis de mousse', 'm'), 'leaf_litter': ('Litière de feuilles', 'f'), 'frogspawn': ('Œufs de grenouille', 'mp'), 'sea_pickle': ('Cornichon de mer', 'm'), 'kelp': ('Varech', 'm'), 'seagrass': ('Herbe marine', 'f'),
 'vine': ('Lianes', 'fp'), 'vines': ('Lianes', 'fp'), 'cave_vines': ('Lianes des cavernes', 'fp'), 'weeping_vines': ('Lianes pleureuses', 'fp'), 'twisting_vines': ('Lianes grimpantes', 'fp'), 'chorus_flower': ('Fleur de chorus', 'f'),
 'chorus_plant': ('Plante de chorus', 'f'), 'cactus_flower': ('Fleur de cactus', 'f'), 'bush': ('Buisson', 'm'), 'firefly_bush': ('Buisson à lucioles', 'm'), 'dry_grass': ('Herbe sèche', 'f'), 'eyeblossom': ('Fleur-œil', 'f'),
 'closed_eyeblossom': ('Fleur-œil fermée', 'f'), 'open_eyeblossom': ('Fleur-œil ouverte', 'f'), 'wildflowers': ('Fleurs sauvages', 'fp'), 'pink_petals': ('Pétales roses', 'mp'), 'spore_blossom': ('Fleur sporifère', 'f'),
 'big_dripleaf': ('Grande foliogoutte', 'f'), 'small_dripleaf': ('Petite foliogoutte', 'f'), 'pointed_dripstone': ('Spéléothème pointu', 'm'), 'amethyst_bud': ("Bourgeon d'améthyste", 'm'), 'azalea': ('Azalée', 'f'),
 'mangrove_propagule': ('Propagule de palétuvier', 'f'), 'mangrove_roots': ('Racines de palétuvier', 'fp'), 'sapling': ('Pousse', 'f'), 'coral_fan': ('Gorgone', 'f'), 'coral': ('Corail', 'm'), 'melon_stem': ('Tige de pastèque', 'f'),
 'pumpkin_stem': ('Tige de citrouille', 'f'), 'attached_melon_stem': ('Tige de pastèque attachée', 'f'), 'attached_pumpkin_stem': ('Tige de citrouille attachée', 'f'), 'beetroots': ('Betteraves', 'fp'), 'cocoa': ('Cacao', 'm'),
 'nether_wart': ('Verrues du Nether', 'fp'), 'sweet_berry_bush': ('Buisson de baies sucrées', 'm'), 'torchflower_crop': ('Culture de torchiflore', 'f'), 'pitcher_crop': ('Culture de plante carnivore', 'f'), 'bamboo': ('Bambou', 'm'),
 'roots': ('Racines', 'fp'), 'fire': ('Feu', 'm'), 'powder_snow': ('Neige poudreuse', 'f'), 'mushroom_block': ('Bloc de champignon', 'm'), 'mycelium': ('Mycélium', 'm'), 'froglight': ('Grenouillampe', 'f'), 'shulker_box': ('Boîte de shulker', 'f'),
 'glass_pane': ('Vitre', 'f'), 'bamboo_mosaic': ('Mosaïque de bambou', 'f'), 'bamboo_block': ('Bloc de bambou', 'm'), 'fence': ('Barrière', 'f'), 'fence_gate': ('Portillon', 'm'), 'prismarine_bricks': ('Briques de prismarine', 'fp'),
 'deepslate_tiles': ("Carreaux d'ardoise des abîmes", 'mp'), 'polished_blackstone_bricks': ('Briques de pierre noire polie', 'fp'), 'tuff_bricks': ('Briques de tuf', 'fp'), 'red_sandstone': ('Grès rouge', 'm'), 'item_frame': ('Cadre', 'm'),
 'glow_item_frame': ('Cadre lumineux', 'm'), 'iron_chain': ('Chaîne en fer', 'f'), 'smooth_stone_slab': ('Dalle de pierre lisse', 'f'), 'stripped_bamboo_block': ('Bloc de bambou écorcé', 'm'), 'honey_block': ('Bloc de miel', 'm'),
 'dried_kelp': ("Algues séchées", 'fp'), 'target': ('Cible', 'f'), 'lodestone': ('Magnétite', 'f'), 'bone_block': ("Bloc d'os", 'm'), 'quartz_block': ('Bloc de quartz', 'm'), 'quartz_pillar': ('Pilier de quartz', 'm'),
 'purpur_pillar': ('Pilier de purpur', 'm'), 'basalt': ('Basalte', 'm'), 'blackstone': ('Pierre noire', 'f'), 'deepslate': ('Ardoise des abîmes', 'f'), 'reinforced_deepslate': ('Ardoise des abîmes renforcée', 'f'), 'block': ('Bloc', 'm'),
 'structure_void': ('Vide de structure', 'm'), 'sunflower': ('Tournesol', 'm'), 'stained_glass_pane': ('Vitre teintée', 'f'), 'barrier': ('Barrière invisible', 'f'), 'light': ('Lumière', 'f'),
 # objets
 'boat': ('Bateau', 'm'), 'chest_boat': ('Bateau avec coffre', 'm'), 'chest_raft': ('Radeau avec coffre', 'm'), 'raft': ('Radeau', 'm'), 'sign': ('Pancarte', 'f'), 'hanging_sign': ('Pancarte suspendue', 'f'),
 'bundle': ('Sac', 'm'), 'harness': ('Harnais', 'm'), 'pottery_sherd': ('Tesson de poterie', 'm'), 'armor_trim_smithing_template': ("Modèle de forge d'ornement", 'm'), 'upgrade_smithing_template': ("Modèle d'amélioration", 'm'),
 'banner_pattern': ('Motif de bannière', 'm'), 'spawn_egg': ("Œuf d'apparition", 'm'), 'music_disc': ('Disque', 'm'), 'horse_armor': ('Armure pour cheval', 'f'), 'nautilus_armor': ('Armure pour nautile', 'f'), 'spear': ('Lance', 'f'),
 'minecart': ('Wagonnet', 'm'), 'bucket': ('Seau', 'm'), 'potion': ('Potion', 'f'), 'bottle': ('Fiole', 'f'), 'ominous_bottle': ('Fiole sinistre', 'f'), 'helmet': ('Casque', 'm'), 'chestplate': ('Plastron', 'm'), 'leggings': ('Jambières', 'fp'),
 'boots': ('Bottes', 'fp'), 'armor_stand': ("Support d'armure", 'm'), 'brush': ('Pinceau', 'm'), 'elytra': ('Élytres', 'mp'), 'enchanted_book': ('Livre enchanté', 'm'), 'end_crystal': ("Cristal de l'End", 'm'),
 'firework_rocket': ("Fusée d'artifice", 'f'), 'firework_star': ("Étoile d'artifice", 'f'), 'map': ('Carte', 'f'), 'filled_map': ('Carte remplie', 'f'), 'painting': ('Tableau', 'm'), 'fishing_rod': ('Canne à pêche', 'f'),
 'carrot_on_a_stick': ('Carotte sur un bâton', 'f'), 'warped_fungus_on_a_stick': ('Champignon biscornu sur un bâton', 'm'), 'knowledge_book': ('Livre de connaissances', 'm'), 'writable_book': ('Livre et plume', 'm'), 'written_book': ('Livre écrit', 'm'),
 'spider_eye': ("Œil d'araignée", 'm'), 'chorus_fruit': ('Fruit de chorus', 'm'), 'stew': ('Ragoût', 'm'), 'suspicious_stew': ('Ragoût suspect', 'm'), 'trial_key': ("Clé d'épreuve", 'f'), 'disc_fragment': ('Fragment de disque', 'm'),
 'mace': ('Masse', 'f'), 'resin_brick': ('Brique de résine', 'f'), 'torchflower_seeds': ('Graines de torchiflore', 'fp'), 'pitcher_pod': ('Gousse de plante carnivore', 'f'), 'pitcher_plant': ('Plante carnivore', 'f'),
 'nether_sprouts': ('Pousses du Nether', 'fp'), 'arrow': ('Flèche', 'f'), 'egg': ('Œuf', 'm'), 'blue_egg': ('Œuf bleu', 'm'), 'brown_egg': ('Œuf marron', 'm'), 'soul_lantern': ('Lanterne des âmes', 'f'), 'soul_campfire': ('Feu de camp des âmes', 'm'),
}
MOBS = dict(re.findall(r"key: '([a-z_]+)', name: '((?:[^'\\]|\\.)*)'", open('src/data/mobs.ts').read()))
MOBS.update({'allay': 'Allay', 'bogged': 'Embourbé', 'breeze': 'Breeze', 'camel_husk': 'Dromadaire momifié', 'cat': 'Chat', 'copper_golem': 'Golem de cuivre', 'creaking': 'Grinceur', 'elder_guardian': 'Gardien ancien',
  'ender_dragon': "Dragon de l'End", 'evoker': 'Évocateur', 'happy_ghast': 'Ghast joyeux', 'mule': 'Mule', 'nautilus': 'Nautile', 'parched': 'Desséché', 'piglin_brute': 'Piglin barbare', 'pufferfish': 'Poisson-globe',
  'ravager': 'Ravageur', 'skeleton_horse': 'Cheval squelette', 'sniffer': 'Renifleur', 'tadpole': 'Têtard', 'trader_llama': 'Lama de marchand', 'vex': 'Vex', 'wandering_trader': 'Marchand ambulant', 'warden': 'Warden',
  'wither': 'Wither', 'zoglin': 'Zoglin', 'zombie_horse': 'Cheval zombie', 'zombie_nautilus': 'Nautile zombie', 'axolotl': 'Axolotl', 'cod': 'Morue', 'salmon': 'Saumon', 'tropical_fish': 'Poisson tropical'})
SHERD = {'angler': 'pêcheur', 'archer': 'archer', 'arms_up': 'bras levés', 'blade': 'lame', 'brewer': 'alchimiste', 'burn': 'brûlure', 'danger': 'danger', 'explorer': 'explorateur', 'flow': 'flux', 'friend': 'ami', 'guster': 'rafale',
  'heart': 'cœur', 'heartbreak': 'cœur brisé', 'howl': 'hurlement', 'miner': 'mineur', 'mourner': 'deuil', 'plenty': 'abondance', 'prize': 'trésor', 'scrape': 'grattoir', 'sheaf': 'gerbe', 'shelter': 'abri', 'skull': 'crâne', 'snort': 'reniflement'}

def french(name):
    toks = name.split('_')
    if name in NOUN: return NOUN[name][0]
    # mots composés : nom le plus long contenu
    best = None
    for i in range(len(toks)):
        for j in range(len(toks), i, -1):
            ph = '_'.join(toks[i:j])
            if ph in NOUN and (best is None or j - i >= best[1] - best[0]): best = (i, j)
    if name.endswith('_spawn_egg'):
        mob = name[:-10]
        return f"Œuf d'apparition de {MOBS.get(mob, mob.replace('_', ' '))}"
    if name.endswith('_pottery_sherd'):
        s = name[:-14]
        return f'Tesson de poterie « {SHERD.get(s, s.replace("_", " "))} »'
    if name.startswith('music_disc_'):
        return f"Disque « {name[11:].replace('_', ' ')} »"
    if name.endswith('_armor_trim_smithing_template'):
        return f"Modèle d'ornement « {name[:-29].replace('_', ' ')} »"
    if name.endswith('_bucket') and name[:-7] in MOBS:
        return f'Seau de {MOBS[name[:-7]].lower()}'
    if not best:
        return name.replace('_', ' ').capitalize()
    i, j = best
    noun, g = NOUN['_'.join(toks[i:j])]
    fem = g.startswith('f')
    plural = g.endswith('p')
    out = [noun]
    rest = toks[:i] + toks[j:]
    k = 0
    tail = []
    while k < len(rest):
        # paires (light_blue, light_gray, dark_oak, pale_oak…)
        pair = '_'.join(rest[k:k + 2])
        if k + 1 < len(rest) and (pair in W or pair in MAT):
            tok, k = pair, k + 2
        else:
            tok, k = rest[k], k + 1
        if tok in W:
            m, f = W[tok].split('|')
            a = f if fem else m
            if plural and not a.endswith(('s', 'x', ')')) and ' ' not in a: a += 's'
            out.append(a)
        elif tok in MAT:
            if MAT[tok]: tail.append(MAT[tok])
        elif re.fullmatch(r'\d+', tok):
            tail.append(f'({tok})')
        elif tok.startswith('stage') and tok[5:].isdigit():
            tail.append(f'(stade {tok[5:]})')
        else:
            tail.append(tok)
    s = ' '.join(out + tail)
    s = re.sub(r'\s+', ' ', s).strip()
    s = s.replace('stade (', '(stade ').replace('(stade )', '')
    return s[0].upper() + s[1:]

# ---------------------------------------------------------------- 4. objets
blockkeys = set(blocks) | {b['key'] for b in NEW}
items = {i['key']: i for i in L['items']}
itused = set((i.get('pt') or i['key']) for i in L['items']) | blockkeys
ITEM_SKIP = re.compile(r'^(clock_\d+|compass_\d+|recovery_compass_\d+|light_\d+|.*_overlay|.*_open_(back|front)|.*_pulling_\d|crossbow_(arrow|firework|standby)|.*_in_hand|fishing_rod_cast|elytra_broken|filled_map_markings|spyglass_model|tipped_arrow_(base|head))$')
NEWI = []
SPEAR = {'wooden': (0, 4, 59, '#a07a48'), 'stone': (1, 5, 131, '#8a8a8a'), 'copper': (1, 5, 190, '#c06c50'), 'iron': (2, 6, 250, '#d8d8d8'), 'golden': (0, 4, 32, '#f0d040'), 'diamond': (3, 7, 1561, '#4ae0d0'), 'netherite': (4, 8, 2031, '#4a4246')}
COPPER_ARMOR = {'helmet': ('head', 2, 121), 'chestplate': ('chest', 4, 176), 'leggings': ('legs', 3, 165), 'boots': ('feet', 1, 143)}
for n in sorted(PI):
    if n in itused or ITEM_SKIP.match(n): continue
    nm = french(n)
    o = {'key': n, 'name': nm}
    c = '#a0a0a0'
    sprite = 'relic'
    tab = 'ingredients'
    if n.endswith('_spawn_egg'):
        mob = n[:-10]
        sprite = 'egg'; c = '#7a6a5a'
        if mob in MOBS and re.search(r"key: '%s'" % mob, open('src/data/mobs.ts').read()):
            o.update(use='spawn_egg', target=mob)
    elif n.endswith('_pottery_sherd'): sprite = 'relic'; c = '#a0583a'; o['rare'] = True
    elif n.endswith('_smithing_template'): sprite = 'relic'; c = '#4a6a7a'; o['rare'] = True
    elif n.endswith('_banner_pattern'): sprite = 'paper'; c = '#e8dcc0'; o['maxStack'] = 1
    elif n.startswith('music_disc_') or n.startswith('disc_fragment'): sprite = 'ball'; c = '#202020'; o['maxStack'] = 1 if n.startswith('music') else 64; o['rare'] = True
    elif re.search(r'(boat|raft)$', n): sprite = 'bowl_food'; c = '#9c7a4a'; o['maxStack'] = 1; tab = 'tools'
    elif n.endswith('minecart'): sprite = 'bucket'; c = '#6a6a70'; o['maxStack'] = 1; tab = 'tools'
    elif n.endswith('_sign'): sprite = 'paper'; c = '#9c7a4a'; o['maxStack'] = 16; tab = 'functional'
    elif n.endswith('bundle'): sprite = 'leather'; c = '#a06540'; o['maxStack'] = 1; tab = 'tools'
    elif n.endswith('_harness'): sprite = 'leather'; c = '#6a4a30'; o['maxStack'] = 1; tab = 'tools'
    elif n.endswith(('_horse_armor', '_nautilus_armor')): sprite = 'chestplate'; c = '#c8c8c8'; o['maxStack'] = 1; tab = 'combat'
    elif n.endswith('_spear'):
        mat = n[:-6]; tier, dmg, dur, c = SPEAR[mat]
        sprite = 'sword'; tab = 'combat'; o['maxStack'] = 1
        o['tool'] = {'type': 'sword', 'tier': tier, 'speed': 1, 'durability': dur, 'material': mat}
        o['damage'] = dmg; o['attackCooldown'] = 1.1
    elif n.startswith('copper_') and n[7:] in COPPER_ARMOR:
        slot, d, dur = COPPER_ARMOR[n[7:]]
        sprite = n[7:]; c = '#c06c50'; tab = 'combat'; o['maxStack'] = 1
        o['armor'] = {'slot': slot, 'defense': d, 'durability': dur, 'material': 'copper'}
    elif n.endswith('_bucket'):
        sprite = 'bucket'; c = '#c8c8c8'; o['maxStack'] = 1; tab = 'tools'
        if n != 'powder_snow_bucket': o['use'] = 'water_bucket'
    elif n in ('potion', 'splash_potion', 'lingering_potion', 'ominous_bottle'): sprite = 'bottle'; c = '#c040c0'; o['maxStack'] = 1 if 'potion' in n else 64; tab = 'food' if n == 'potion' else 'combat'
    elif n in ('blue_egg', 'brown_egg'): sprite = 'egg'; c = '#80b0e0' if n == 'blue_egg' else '#a07040'; o['maxStack'] = 16
    elif n == 'chorus_fruit': sprite = 'apple'; c = '#8a5a8a'; o['food'] = {'hunger': 4, 'saturation': 2.4}; tab = 'food'
    elif n == 'suspicious_stew': sprite = 'bowl_food'; c = '#a06030'; o['food'] = {'hunger': 6, 'saturation': 7.2}; o['maxStack'] = 1; tab = 'food'
    elif n in ('fishing_rod', 'carrot_on_a_stick', 'warped_fungus_on_a_stick', 'brush'): sprite = 'stick'; c = '#a07a48'; o['maxStack'] = 1; tab = 'tools'
    elif n == 'mace':
        sprite = 'mace'; c = '#8a8a90'; tab = 'combat'; o['maxStack'] = 1
        o['tool'] = {'type': 'sword', 'tier': 3, 'speed': 1, 'durability': 500, 'material': 'mace'}; o['damage'] = 7; o['attackCooldown'] = 1.5
    elif n == 'elytra': sprite = 'chestplate'; c = '#8a8aa0'; o['maxStack'] = 1; tab = 'combat'; o['armor'] = {'slot': 'chest', 'defense': 0, 'durability': 432, 'material': 'elytra'}
    elif n.endswith('_book') or n == 'enchanted_book': sprite = 'book'; c = '#8a4a2a'; o['maxStack'] = 1 if n != 'enchanted_book' else 1
    elif n in ('map', 'filled_map', 'painting', 'item_frame', 'glow_item_frame', 'armor_stand'): sprite = 'paper'; c = '#e8dcc0'; tab = 'functional'
    elif n in ('spectral_arrow',): sprite = 'arrow'; c = '#f0d040'; tab = 'combat'
    elif n in ('torchflower_seeds', 'pitcher_pod'): sprite = 'seeds'; c = '#7a9a3a'
    elif n in ('firework_rocket', 'firework_star', 'end_crystal', 'trial_key', 'ominous_trial_key', 'knowledge_book'): sprite = 'core'; c = '#c8a0e0'
    elif n in ('fermented_spider_eye',): sprite = 'eye'; c = '#a03a4a'
    elif n in ('resin_brick', 'resin_clump'): sprite = 'ingot' if n == 'resin_brick' else 'lump'; c = '#e07a20'
    elif n == 'popped_chorus_fruit': sprite = 'apple'; c = '#c0a0c0'
    elif n in ('barrier', 'light', 'structure_void'): sprite = 'core'; c = '#e04040'; tab = 'functional'
    else:
        # objets qui posent un bloc : bloc existant ou nouveau du même nom de base
        place = None
        for k in (n, n + '_block', n.replace('_item', '')):
            if k in blockkeys: place = k; break
        if place: o['place'] = place; sprite = 'leaf'; c = '#6a9a3a'; tab = 'building'
    o['icon'] = {'sprite': sprite, 'colors': [c]}
    o['tab'] = tab
    NEWI.append(o)

# ---------------------------------------------------------------- 5. sortie TS
def bname(b):
    s = b['src']
    return french(s)

lines = []
lines.append('// Fichier généré par scripts/gen-vanilla-pack.py — ne pas modifier à la main.')
lines.append('// Uniquement des NOMS de textures du pack de ressources et des couleurs moyennes')
lines.append('// (aucun pixel du jeu de référence n’est inclus).')
lines.append('/* eslint-disable */')
lines.append('import type { BlockTextures } from "../blocks/Block";')
lines.append('')
lines.append('/** Faces multiples (dessus, dessous, côté, avant, dos) des blocs existants. */')
lines.append('export const PACK_FACES: Record<string, BlockTextures> = ' + json.dumps(FACES, ensure_ascii=False, separators=(',', ':')) + ';')
lines.append('/** Blocs existants devenus orientables (face avant du pack). */')
lines.append('export const PACK_ORIENT: string[] = ' + json.dumps(sorted(ORIENT)) + ';')
lines.append('/** Peintre de repli (sans pack) : tuile existante, « #rrggbb » (bloc) ou « ~rrggbb » (plante). */')
lines.append('export const PACK_TILE_FALLBACK: Record<string, string> = ' + json.dumps(dict(sorted(FALLBACK.items())), separators=(',', ':')) + ';')
NB = []
for b in NEW:
    t = b['textures']
    first = t.get('all') or t.get('side') or (t.get('byMeta') or [None])[-1]
    c, tr = stats(first) if first in PB else ('#808080', 0)
    NB.append([b['key'], bname(b), b['kind'], c, t])
lines.append('/** Nouveaux blocs : [clé, nom, genre, couleur, textures]. */')
lines.append('export const PACK_BLOCKS: [string, string, string, string, BlockTextures][] = ' + json.dumps(NB, ensure_ascii=False, separators=(',', ':')).replace('],[', '],\n[') + ';')
lines.append('/** Nouveaux objets (icône = texture du pack du même nom). */')
lines.append('export const PACK_ITEMS: any[] = ' + json.dumps(NEWI, ensure_ascii=False, separators=(',', ':')).replace('},{"key"', '},\n{"key"') + ';')
open(OUT, 'w').write('\n'.join(lines) + '\n')
print('faces', len(FACES), 'orient', len(ORIENT), 'new blocks', len(NEW), 'new tiles', len(newtiles), 'fallbacks', len(FALLBACK), 'items', len(NEWI))
from collections import Counter
print(Counter(b['kind'] for b in NEW))
