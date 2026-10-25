// src/exif.js — lê da foto (JPEG) a lente usada, para não precisar CHUTAR o ângulo da câmera (24/10)
//
// O celular grava no arquivo a distância focal "equivalente a 35 mm" (tag EXIF 0xA405). Com ela sai
// o campo de visão real da foto — hoje o maior chute da medição. Alguns navegadores tiram o EXIF no
// envio; aí volta null e a página usa o valor típico de celular.

// buffer: ArrayBuffer do arquivo → { f35, focalMm, make, model } (campos ausentes = null) ou null
export function lerExif(buffer) {
  const v = new DataView(buffer);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;   // não é JPEG
  let off = 2;
  while (off + 4 <= v.byteLength) {
    if (v.getUint8(off) !== 0xff) return null;
    const marker = v.getUint8(off + 1);
    const len = v.getUint16(off + 2);
    if (marker === 0xe1 && v.getUint32(off + 4) === 0x45786966) {   // "Exif"
      return lerTiff(v, off + 10);
    }
    if (marker === 0xda) return null;                                // começou a imagem: sem EXIF
    off += 2 + len;
  }
  return null;
}

function lerTiff(v, t) {
  const le = v.getUint16(t) === 0x4949;                              // "II" = little-endian
  const u16 = (o) => v.getUint16(t + o, le);
  const u32 = (o) => v.getUint32(t + o, le);
  const txt = (o, n) => {
    let s = '';
    for (let i = 0; i < n - 1; i++) {
      const c = v.getUint8(t + o + i);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s.trim();
  };
  const entradas = (ifd) => {
    const n = u16(ifd);
    const out = {};
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      out[u16(e)] = { tipo: u16(e + 2), qtd: u32(e + 4), e };
    }
    return out;
  };
  const valor = (x) => {
    if (!x) return null;
    const { tipo, qtd, e } = x;
    if (tipo === 3) return u16(e + 8);                               // SHORT
    if (tipo === 4) return u32(e + 8);                               // LONG
    if (tipo === 5) { const o = u32(e + 8); const d = u32(o + 4); return d ? u32(o) / d : null; }   // RATIONAL
    if (tipo === 2) return txt(qtd <= 4 ? e + 8 : u32(e + 8), qtd);  // ASCII
    return null;
  };
  const ifd0 = entradas(u32(4));
  const exif = ifd0[0x8769] ? entradas(valor(ifd0[0x8769])) : {};
  return {
    f35: valor(exif[0xa405]) || null,
    focalMm: valor(exif[0x920a]) || null,
    make: valor(ifd0[0x010f]) || null,
    model: valor(ifd0[0x0110]) || null,
  };
}

// campo de visão no LADO MAIOR da foto a partir da focal equivalente 35 mm.
// A equivalência é pela diagonal (43,27 mm do filme 35 mm); o lado maior depende do formato da foto.
export function hfovFromF35(f35, ladoMaior, ladoMenor) {
  if (!f35 || f35 <= 0) return null;
  const a = ladoMaior / ladoMenor;
  const longo = 43.27 * a / Math.sqrt(1 + a * a);
  return (2 * Math.atan(longo / 2 / f35) * 180) / Math.PI;
}
