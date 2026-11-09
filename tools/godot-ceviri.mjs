// Godot 3 çeviri araçları: .pck dizini, RSRC ikili kaynak ve PHashTranslation.
//
// Kaynak (bellekten okunan Godot 3.x kodu; doğrulaması aşağıda):
//   core/io/file_access_pack.cpp      → .pck biçim 1 dizini
//   core/io/resource_format_binary.cpp → RSRC ikili kaynak
//   core/compressed_translation.cpp    → PHashTranslation (hash_table, bucket_table, strings)
//   thirdparty/misc/smaz.c             → sıkıştırma tablosu (254 girdi)
// Doğrulama: dosya her metnin açık uzunluğunu (uncomp_size, sondaki NUL dahil)
// saklıyor; açılan her metin buna eşit olmalı. Eşit değilse `uyumsuz` artar.
// Tablo ya da biçim yanlışsa sayaç sıfırdan büyük çıkar.
//
// Kullanım:
//   node tools/godot-ceviri.mjs ozet <pck> [cikti-dizini]
//     Her tabloyu (en + da + birkaç dil) okur, sayar, en metinlerini
//     <cikti-dizini>/en/<Tablo>.json'a yazar (varsayılan: calisma/).
import { openSync, readSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------- .pck
export function pckAc(yol) {
  const fd = openSync(yol, 'r');
  const bas = Buffer.alloc(88);
  readSync(fd, bas, 0, 88, 0);
  if (bas.toString('latin1', 0, 4) !== 'GDPC') throw new Error('GDPC değil: ' + yol);
  const bicim = bas.readUInt32LE(4);
  if (bicim !== 1) throw new Error(`pck biçimi ${bicim} desteklenmiyor (yalnızca 1)`);
  const surum = [bas.readUInt32LE(8), bas.readUInt32LE(12), bas.readUInt32LE(16)].join('.');
  const adet = bas.readUInt32LE(84);
  let tampon = Buffer.alloc(8 * 1024 * 1024);
  const okunan = readSync(fd, tampon, 0, tampon.length, 88);
  tampon = tampon.subarray(0, okunan);
  const girdiler = new Map();
  let o = 0;
  for (let i = 0; i < adet; i++) {
    const n = tampon.readUInt32LE(o); o += 4;
    const yolAdi = tampon.toString('utf8', o, o + n).replace(/\0+$/, ''); o += n;
    const dizinYeri = 88 + o; // ofset alanının dosyadaki yeri (yama için)
    const ofset = Number(tampon.readBigUInt64LE(o)); o += 8;
    const boyut = Number(tampon.readBigUInt64LE(o)); o += 8;
    const md5 = tampon.subarray(o, o + 16).toString('hex'); o += 16;
    girdiler.set(yolAdi, { yol: yolAdi, ofset, boyut, md5, dizinYeri });
  }
  const oku = (yolAdi) => {
    const g = girdiler.get(yolAdi);
    if (!g) throw new Error('pck içinde yok: ' + yolAdi);
    const b = Buffer.alloc(g.boyut);
    readSync(fd, b, 0, g.boyut, g.ofset);
    return b;
  };
  return { fd, surum, girdiler, oku, dizinSonu: 88 + o };
}

// ---------------------------------------------------------------- RSRC
export function rsrcOku(b) {
  let o = 0;
  const u32 = () => { const v = b.readUInt32LE(o); o += 4; return v; };
  const u64 = () => { const v = Number(b.readBigUInt64LE(o)); o += 8; return v; };
  const dizge = () => {
    const n = u32();
    const s = n ? b.toString('utf8', o, o + n - 1) : '';
    o += n;
    return s;
  };
  if (b.toString('latin1', 0, 4) !== 'RSRC') throw new Error('RSRC değil');
  o = 4;
  if (u32() !== 0) throw new Error('büyük sonlu dosya desteklenmiyor');
  const real64 = u32();
  const surum = [u32(), u32(), u32()];
  const tur = dizge();
  const importOfs = u64();
  o += 14 * 4;
  const dizgeler = Array.from({ length: u32() }, dizge);
  const dis = Array.from({ length: u32() }, () => ({ tur: dizge(), yol: dizge() }));
  const ic = Array.from({ length: u32() }, () => ({ yol: dizge(), ofset: u64() }));

  const degerOku = () => {
    const t = u32();
    switch (t) {
      case 1: return null;
      case 2: return !!u32();
      case 3: o += 4; return b.readInt32LE(o - 4);
      case 4: if (real64) { o += 8; return b.readDoubleLE(o - 8); } o += 4; return b.readFloatLE(o - 4);
      case 5: return dizge();
      case 24: {
        const ot = u32();
        if (ot === 0) return null;
        if (ot === 1) return { disTur: dizge(), disYol: dizge() };
        if (ot === 2 || ot === 3) return { nesneTuru: ot, no: u32() };
        throw new Error('bilinmeyen nesne türü ' + ot);
      }
      case 31: { const n = u32(); const v = b.subarray(o, o + n); o += n + ((4 - (n % 4)) % 4); return v; }
      case 32: { const n = u32(); const v = new Uint32Array(n); for (let i = 0; i < n; i++) v[i] = b.readUInt32LE(o + i * 4); o += 4 * n; return v; }
      case 34: return Array.from({ length: u32() }, dizge);
      default: throw new Error(`desteklenmeyen Variant türü ${t} @${o - 4}`);
    }
  };

  const kaynaklar = ic.map((k) => {
    o = k.ofset;
    const ktur = dizge();
    const ozellikler = Array.from({ length: u32() }, () => {
      const adNo = u32();
      if (adNo & 0x80000000) throw new Error('satır içi özellik adı desteklenmiyor');
      const bas = o;
      const deger = degerOku();
      return { ad: dizgeler[adNo], adNo, bas, son: o, deger };
    });
    return { ...k, tur: ktur, ozellikler, son: o };
  });
  return { real64, surum, tur, importOfs, dizgeler, dis, ic, kaynaklar, boyut: b.length };
}

// ---------------------------------------------------------------- smaz
// prettier-ignore
export const RCB = [
" ", "the", "e", "t", "a", "of", "o", "and", "i", "n", "s", "e ", "r", " th",
" t", "in", "he", "th", "h", "he ", "to", "\r\n", "l", "s ", "d", " a", "an",
"er", "c", " o", "d ", "on", " of", "re", "of ", "t ", ", ", "is", "u", "at",
"   ", "n ", "or", "which", "f", "m", "as", "it", "that", "\n", "was", "en",
"  ", " w", "es", " an", " i", "\r", "f ", "g", "p", "nd", " s", "nd ", "ed ",
"w", "ed", "http://", "for", "te", "ing", "y ", "The", " c", "ti", "r ", "his",
"st", " in", "ar", "nt", ",", " to", "y", "ng", " h", "with", "le", "al", "to ",
"b", "ou", "be", "were", " b", "se", "o ", "ent", "ha", "ng ", "their", "\"",
"hi", "from", " f", "in ", "de", "ion", "me", "v", ".", "ve", "all", "re ",
"ri", "ro", "is ", "co", "f t", "are", "ea", ". ", "her", " m", "er ", " p",
"es ", "by", "they", "di", "ra", "ic", "not", "s, ", "d t", "at ", "ce", "la",
"h ", "ne", "as ", "tio", "on ", "n t", "io", "we", " a ", "om", ", a", "s o",
"ur", "li", "ll", "ch", "had", "this", "e t", "g ", "e\r\n", " wh", "ere",
" co", "e o", "a ", "us", " d", "ss", "\n\r\n", "\r\n\r", "=\"", " be", " e",
"s a", "ma", "one", "t t", "or ", "but", "el", "so", "l ", "e s", "s,", "no",
"ter", " wa", "iv", "ho", "e a", " r", "hat", "s t", "ns", "ch ", "wh", "tr",
"ut", "/", "have", "ly ", "ta", " ha", " on", "tha", "-", " l", "ati", "en ",
"pe", " re", "there", "ass", "si", " fo", "wa", "ec", "our", "who", "its", "z",
"fo", "rs", ">", "ot", "un", "<", "im", "th ", "nc", "ate", "><", "ver", "ad",
" we", "ly", "ee", " n", "id", " cl", "ac", "il", "</", "rt", " wi", "div",
"e, ", " it", "whi", " ma", "ge", "x", "e c", "men", ".com",
];
if (RCB.length !== 254) throw new Error('smaz tablosu 254 değil: ' + RCB.length);

export function smazCoz(g) {
  const c = [];
  for (let i = 0; i < g.length;) {
    const k = g[i];
    if (k === 254) { c.push(g[i + 1]); i += 2; }
    else if (k === 255) { const n = g[i + 1] + 1; for (let j = 0; j < n; j++) c.push(g[i + 2 + j]); i += 2 + n; }
    else { const s = RCB[k]; for (let j = 0; j < s.length; j++) c.push(s.charCodeAt(j)); i++; }
  }
  return Uint8Array.from(c);
}

// ---------------------------------------------------------------- PHash
export function phashCoz(rsrc) {
  const ana = rsrc.kaynaklar[rsrc.kaynaklar.length - 1];
  if (ana.tur !== 'PHashTranslation') throw new Error('PHashTranslation değil: ' + ana.tur);
  const oz = Object.fromEntries(ana.ozellikler.map((p) => [p.ad, p.deger]));
  const ht = oz.hash_table, bt = oz.bucket_table, st = oz.strings;
  const kovalar = [...new Set([...ht].filter((p) => p !== 0xffffffff))].sort((a, b) => a - b);
  const kayitlar = [];
  let uyumsuz = 0;
  for (const p of kovalar) {
    const n = bt[p];
    for (let i = 0; i < n; i++) {
      const e = p + 2 + i * 4;
      const [anahtar, ofs, sik, acik] = [bt[e], bt[e + 1], bt[e + 2], bt[e + 3]];
      const bayt = sik === acik ? st.subarray(ofs, ofs + acik) : smazCoz(st.subarray(ofs, ofs + sik));
      if (bayt.length !== acik || bayt[acik - 1] !== 0) uyumsuz++;
      let son = bayt.length;
      while (son > 0 && bayt[son - 1] === 0) son--;
      kayitlar.push({ id: `${p}.${i}`, anahtar, metin: Buffer.from(bayt.subarray(0, son)).toString('utf8'), sikistirilmis: sik !== acik });
    }
  }
  return { locale: oz.locale, kayitlar, uyumsuz, htBoyut: ht.length, ozellikAdlari: Object.keys(oz) };
}

// ---------------------------------------------------------------- anahtar karması
// Godot 3.6-stable core/compressed_translation.h ile satır satır aynı (08.11.2026):
// d==0 ise 0x1000193; her baytta d = (d*0x1000193) ^ c. Birincil karma hash(0, s) kovayı
// seçer, kovanın işlev değeriyle hash(func, s) kovadaki anahtarla karşılaştırılır.
// isaretli: char'ın işaretli derlendiği durum (yalnızca ASCII dışı baytta fark eder).
// carpan yalnızca karşı test (--bozuk) için değişir.
export const KARMA_CARPAN = 0x1000193;
export function phashKarma(d, bayt, isaretli = false, carpan = KARMA_CARPAN) {
  if (d === 0) d = carpan;
  for (const c of bayt) d = (Math.imul(d, carpan) ^ (isaretli && c > 127 ? (c | 0xffffff00) : c)) >>> 0;
  return d >>> 0;
}

// Verilen tabloların en dosyalarında bir dizgiyi anahtar olarak arar.
// bul(s) → "Tablo kova.sıra" | null (Godot gibi ilk bulunan); bulHepsi(s) → bütün tablolardaki
// eşleşmeler (aynı anahtar iki tabloda olabilir). T yapı denetimi için ham tablolar.
// funcYok yalnızca karşı test için: kovanın işlev değeri yerine 0 kullanılır.
export function anahtarArayici(pck, tablolar, { carpan = KARMA_CARPAN, funcYok = false } = {}) {
  const T = tablolar.map((t) => {
    const ana = rsrcOku(pck.oku(`res://Sheets/CSV/${t}.en.translation`)).kaynaklar.at(-1);
    const oz = Object.fromEntries(ana.ozellikler.map((p) => [p.ad, p.deger]));
    return { t, ht: oz.hash_table, bt: oz.bucket_table };
  });
  const bulHepsi = (s) => {
    const b = Buffer.from(s, 'utf8');
    const isaretSecenek = b.some((c) => c > 127) ? [false, true] : [false];
    const sonuc = [];
    for (const isaretli of isaretSecenek) for (const { t, ht, bt } of T) {
      const p = ht[phashKarma(0, b, isaretli, carpan) % ht.length];
      if (p === 0xffffffff) continue;
      const k = phashKarma(funcYok ? 0 : bt[p + 1], b, isaretli, carpan);
      for (let i = 0; i < bt[p]; i++) if (bt[p + 2 + i * 4] === k) sonuc.push(`${t} ${p}.${i}`);
    }
    return [...new Set(sonuc)];
  };
  const bul = (s) => bulHepsi(s)[0] ?? null;
  return { bul, bulHepsi, T };
}

// ---------------------------------------------------------------- ozet
function ozet(pckYolu, cikti) {
  const pck = pckAc(pckYolu);
  console.log(`pck: Godot ${pck.surum}, ${pck.girdiler.size} dosya`);
  const tablolar = [...new Set([...pck.girdiler.keys()]
    .map((y) => y.match(/^res:\/\/Sheets\/CSV\/(\w+)\.en\.translation$/)).filter(Boolean).map((m) => m[1]))];
  const DILLER = ['en', 'da', 'de', 'ru', 'ja'];
  mkdirSync(path.join(cikti, 'en'), { recursive: true });
  const tumEn = new Map(); // tablo → kayitlar
  let toplamUyumsuz = 0;
  for (const t of tablolar) {
    const satir = [t.padEnd(15)];
    let en = null;
    for (const d of DILLER) {
      const y = `res://Sheets/CSV/${t}.${d}.translation`;
      if (!pck.girdiler.has(y)) { satir.push(`${d}:yok`); continue; }
      const c = phashCoz(rsrcOku(pck.oku(y)));
      toplamUyumsuz += c.uyumsuz;
      if (d === 'en') { en = c; satir.push(`en:${c.kayitlar.length} kayıt, uyumsuz ${c.uyumsuz}, locale=${c.locale}`); continue; }
      // Yapı aynı mı: aynı id'de aynı anahtar
      const enHar = new Map(en.kayitlar.map((k) => [k.id, k.anahtar]));
      const ayni = c.kayitlar.length === en.kayitlar.length && c.kayitlar.every((k) => enHar.get(k.id) === k.anahtar);
      satir.push(`${d}:${c.kayitlar.length}${ayni ? ' yapı=en' : ' YAPI FARKLI'} u${c.uyumsuz}`);
    }
    console.log(satir.join(' | '));
    tumEn.set(t, en.kayitlar);
    writeFileSync(path.join(cikti, 'en', `${t}.json`), JSON.stringify(en.kayitlar.map(({ id, metin }) => ({ id, metin })), null, 1));
  }
  console.log(`\ntoplam uyumsuz (tüm dillerde): ${toplamUyumsuz}`);

  // Hacim: Full öteki tabloların birleşimi mi?
  const digerMetin = new Set();
  for (const [t, k] of tumEn) if (t !== 'Full') k.forEach((x) => digerMetin.add(x.metin));
  const full = tumEn.get('Full') || [];
  const fullOrtak = full.filter((x) => digerMetin.has(x.metin)).length;
  console.log(`Full: ${full.length} kayıt, ${fullOrtak} tanesinin metni öteki tablolarda da var`);

  console.log('\ntablo           kayıt  boş  benzersiz  karakter  kelime');
  const hepsi = new Set();
  let tk = 0, tc = 0, tw = 0;
  for (const [t, k] of tumEn) {
    const dolu = k.filter((x) => x.metin.trim());
    const benz = new Set(dolu.map((x) => x.metin));
    benz.forEach((m) => hepsi.add(m));
    const kar = [...benz].reduce((s, m) => s + m.length, 0);
    const kel = [...benz].reduce((s, m) => s + (m.match(/\S+/g) || []).length, 0);
    tk += k.length; tc += kar; tw += kel;
    console.log(`${t.padEnd(15)} ${String(k.length).padStart(5)} ${String(k.length - dolu.length).padStart(4)} ${String(benz.size).padStart(10)} ${String(kar).padStart(9)} ${String(kel).padStart(7)}`);
  }
  const hk = [...hepsi].reduce((s, m) => s + m.length, 0);
  const hw = [...hepsi].reduce((s, m) => s + (m.match(/\S+/g) || []).length, 0);
  console.log(`tüm tablolarda benzersiz metin: ${hepsi.size}, ${hk} karakter, ${hw} kelime`);
  console.log(`(tablo toplamı: ${tk} kayıt; tablolar arası yineleme düşülünce yukarıdaki sayı)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [komut, ...arg] = process.argv.slice(2);
  if (komut === 'ozet') ozet(arg[0], arg[1] || 'calisma');
  else { console.log('kullanım: node tools/godot-ceviri.mjs ozet <pck> [cikti-dizini]'); process.exit(2); }
}
