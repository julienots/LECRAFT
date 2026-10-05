/**
 * Lecture JSON tolérante, comme le jeu de référence pour ses add-ons : commentaires « // » et « /\* … \*\/ »,
 * virgules finales et BOM acceptés.
 */
export function parseLenientJson(text: string): unknown {
  let out = '';
  let i = 0;
  const n = text.length;
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
    } else {
      out += c;
      i++;
    }
  }
  // virgules finales
  out = out.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(out);
}
