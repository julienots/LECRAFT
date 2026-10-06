import * as THREE from 'three';

/**
 * Modèle 3D d'un objet à partir de son icône, comme le générateur d'objets de l'édition Java :
 * face avant et arrière texturées, plus une face d'un pixel sur chaque bord entre un pixel opaque
 * et un pixel transparent (épaisseur 1/16). Le modèle occupe [-0,5 ; 0,5] en x et y, centré en z.
 */
export function extrudeIcon(canvas: HTMLCanvasElement): THREE.BufferGeometry {
  const w = canvas.width, h = canvas.height;
  const data = canvas.getContext('2d')!.getImageData(0, 0, w, h).data;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] > 25;
  const pos: number[] = [], uv: number[] = [], nrm: number[] = [], idx: number[] = [];
  const t = 0.5 / 16; // demi-épaisseur
  const quad = (p: number[][], u: number[][], n: number[]) => {
    const b = pos.length / 3;
    for (let i = 0; i < 4; i++) {
      pos.push(p[i][0], p[i][1], p[i][2]);
      uv.push(u[i][0], u[i][1]);
      nrm.push(n[0], n[1], n[2]);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  // coordonnées : pixel (x, y) de l'image → X = x/w − 0,5, Y = 0,5 − y/h
  const X = (x: number) => x / w - 0.5, Y = (y: number) => 0.5 - y / h;
  quad([[X(0), Y(h), t], [X(w), Y(h), t], [X(w), Y(0), t], [X(0), Y(0), t]], [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 0, 1]);
  quad([[X(w), Y(h), -t], [X(0), Y(h), -t], [X(0), Y(0), -t], [X(w), Y(0), -t]], [[1, 0], [0, 0], [0, 1], [1, 1]], [0, 0, -1]);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!solid(x, y)) continue;
      // UV au centre du pixel : la face latérale prend la couleur de ce pixel
      const cu = (x + 0.5) / w, cv = 1 - (y + 0.5) / h;
      const U = [[cu, cv], [cu, cv], [cu, cv], [cu, cv]];
      const x0 = X(x), x1 = X(x + 1), y0 = Y(y + 1), y1 = Y(y);
      if (!solid(x, y - 1)) quad([[x0, y1, t], [x1, y1, t], [x1, y1, -t], [x0, y1, -t]], U, [0, 1, 0]);
      if (!solid(x, y + 1)) quad([[x0, y0, -t], [x1, y0, -t], [x1, y0, t], [x0, y0, t]], U, [0, -1, 0]);
      if (!solid(x - 1, y)) quad([[x0, y0, -t], [x0, y0, t], [x0, y1, t], [x0, y1, -t]], U, [-1, 0, 0]);
      if (!solid(x + 1, y)) quad([[x1, y0, t], [x1, y0, -t], [x1, y1, -t], [x1, y1, t]], U, [1, 0, 0]);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}
