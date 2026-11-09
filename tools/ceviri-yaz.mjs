#!/usr/bin/env node
// Çeviri yazıcı: var olan bir .translation dosyasını (PHashTranslation,
// RSRC ikili) iskelet alır, kayıtların metnini değiştirip yeni dosya üretir.
//
// Değişen yalnızca iki özellik: bucket_table'da her kaydın (ofset, sıkışık
// boyut, açık boyut) üçlüsü ve strings (metin baytları). hash_table, kova
// düzeni, anahtarlar (kaynak metnin karması), locale ve dosyanın geri kalanı
// aynen kalır. Kayıt kimliği okuyucudaki gibi "<kova>.<sıra>"; en ile da'nın
// yapısı aynı (godot-ceviri.mjs ozet ölçtü), bu yüzden en kimliğiyle
// eşlenen metin da iskeletine yazılabilir.
// Metin ham yazılır: sıkışık = açık = UTF-8 bayt + 1 (sondaki NUL). Godot
// iki boyut eşitse metni sıkıştırmadan okur; dosyadaki ham kayıtlar da böyle
// (okuyucu doğruladı).
//
// Kullanım:
//   node tools/ceviri-yaz.mjs --sina <pck>           (yazıcı sınaması, oyunu değiştirmez)
//   node tools/ceviri-yaz.mjs --sina --bozuk <pck>   (yazıcı bilerek bozulur; her bozma yakalanmalı)
// Kütüphane: import { phashYaz, duzCeviriYaz, duzCeviriOku } from './ceviri-yaz.mjs'
// duzCeviriYaz: iskeletsiz küçük düz Translation (ör. menüdeki dil adı, override-kur.mjs).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pckAc, rsrcOku, phashCoz } from './godot-ceviri.mjs';

const BOS = 0xffffffff;

function poolIntYaz(dizi) {
  const b = Buffer.alloc(8 + 4 * dizi.length);
  b.writeUInt32LE(32, 0);
  b.writeUInt32LE(dizi.length, 4);
  for (let i = 0; i < dizi.length; i++) b.writeUInt32LE(dizi[i] >>> 0, 8 + 4 * i);
  return b;
}
function poolByteYaz(bayt, bozuk) {
  const n = bayt.length;
  const dolgu = bozuk === 'dolgu' ? 0 : (4 - (n % 4)) % 4;
  const b = Buffer.alloc(8 + n + dolgu);
  b.writeUInt32LE(31, 0);
  b.writeUInt32LE(n, 4);
  Buffer.from(bayt).copy(b, 8);
  return b;
}

// kayitVer(id, eski) → string (ham yazılır) ya da { bayt, sik, acik } (aynen yazılır).
// eski = { anahtar, bayt, sik, acik }: iskeletteki kaydın kendisi.
export function phashYaz(dosya, kayitVer, { bozuk = '' } = {}) {
  const r = rsrcOku(dosya);
  const ana = r.kaynaklar[r.kaynaklar.length - 1];
  if (ana.tur !== 'PHashTranslation') throw new Error('PHashTranslation değil: ' + ana.tur);
  if (r.kaynaklar.some((k) => k !== ana && k.ofset > ana.ofset)) throw new Error('ana kaynaktan sonra başka kaynak var');
  if (r.importOfs && r.importOfs > ana.ofset) throw new Error('import bilgisi ana kaynaktan sonra');
  const oz = Object.fromEntries(ana.ozellikler.map((p) => [p.ad, p]));
  for (const ad of ['hash_table', 'bucket_table', 'strings']) if (!oz[ad]) throw new Error('özellik yok: ' + ad);
  const ht = oz.hash_table.deger;
  const btEski = oz.bucket_table.deger;
  const stEski = oz.strings.deger;
  const bt = Uint32Array.from(btEski);

  // Metinler iskeletteki yerleşim sırasıyla (eski ofset artan) dizilir: Godot onları
  // kaynak anahtar sırasıyla, boşluksuz ve paylaşımsız art arda koyuyor (08.11.2026
  // ölçümü: Keywords 124/124, Items 303/303 bitişik); kova sırası bu değil.
  const kovalar = [...new Set([...ht].filter((p) => p !== BOS))].sort((a, b) => a - b);
  const kayitlar = [];
  for (const p of kovalar) for (let i = 0; i < btEski[p]; i++) kayitlar.push({ id: `${p}.${i}`, e: p + 2 + i * 4 });
  kayitlar.sort((a, b) => btEski[a.e + 1] - btEski[b.e + 1] || a.e - b.e);
  const parcalar = [];
  let ofs = 0, adet = 0;
  for (const { id, e } of kayitlar) {
    const eski = { anahtar: btEski[e], sik: btEski[e + 2], acik: btEski[e + 3] };
    eski.bayt = stEski.subarray(btEski[e + 1], btEski[e + 1] + eski.sik);
    const v = kayitVer(id, eski);
    let bayt, sik, acik;
    if (typeof v === 'string') {
      if (v.includes('\0')) throw new Error(`metinde NUL var: ${id}`);
      bayt = Buffer.concat([Buffer.from(v, 'utf8'), Buffer.alloc(1)]);
      sik = acik = bayt.length;
    } else if (v && v.bayt) {
      ({ bayt, sik, acik } = v);
    } else throw new Error(`metin verilmedi: ${id}`);
    bt[e + 1] = bozuk === 'ofset' && adet === 3 ? ofs + 1 : ofs;
    bt[e + 2] = sik;
    bt[e + 3] = bozuk === 'boyut' && adet === 3 ? acik + 1 : acik;
    parcalar.push(bayt);
    ofs += bayt.length;
    adet++;
  }
  const yeni = new Map([
    ['bucket_table', poolIntYaz(bt)],
    ['strings', poolByteYaz(Buffer.concat(parcalar), bozuk)],
  ]);
  // Dosyayı yeniden birleştir: değişen iki değerin dışındaki her bayt aynen kopyalanır.
  const cikti = [];
  let imlec = 0;
  for (const p of ana.ozellikler) {
    if (!yeni.has(p.ad)) continue;
    cikti.push(dosya.subarray(imlec, p.bas), yeni.get(p.ad));
    imlec = p.son;
  }
  cikti.push(dosya.subarray(imlec));
  return { dosya: Buffer.concat(cikti), adet };
}

// ---------------------------------------------------------------- düz Translation
// İskeletsiz, sıfırdan: Godot 3.6 ResourceFormatSaverBinary'nin Translation çıktısı (resmî
// motorun ResourceSaver.save ile yazdığı dosyadan çözüldü, 09.11.2026). "messages" düz
// [anahtar, çeviri, anahtar, çeviri, ...] dizisi (PoolStringArray, Variant 34), "locale"
// satır içi dizge. Özellik adları tablosuna motor yazılmayan özellikleri de koyuyor.
// Dizge: u32 (UTF-8 uzunluğu + 1) + baytlar + NUL, dolgu yok. Açılışta yüklenecek dosya
// ikili olmalı: .tres'i motor açılışta açamıyor (metin okuyucu henüz kayıtlı değil,
// "No loader found"; aynı .tres betikten yükleniyor).
// Motor birden çok satırı kendi bellek sırasıyla yazıyor: bayt eşitliği tek satırda ölçülür.
const RSRC_ADLAR = ['resource_local_to_scene', 'resource_name', 'messages', 'locale', 'script'];
export function duzCeviriYaz(locale, ciftler, { bozuk = '' } = {}) {
  const u32 = (...v) => { const b = Buffer.alloc(4 * v.length); v.forEach((x, i) => b.writeUInt32LE(x >>> 0, 4 * i)); return b; };
  const dz = (s) => {
    const b = Buffer.from(s, 'utf8');
    if (b.includes(0)) throw new Error('dizgede NUL var: ' + JSON.stringify(s));
    return Buffer.concat([u32(b.length + 1), b, Buffer.alloc(bozuk === 'duz-nul' ? 0 : 1)]);
  };
  const anahtarlar = ciftler.map((c) => c[0]);
  if (new Set(anahtarlar).size !== anahtarlar.length) throw new Error('aynı anahtar iki kez');
  const bas = Buffer.concat([
    Buffer.from('RSRC', 'latin1'), u32(0, 0, 3, 6, 3), dz('Translation'), Buffer.alloc(8 + 14 * 4),
    u32(RSRC_ADLAR.length), ...RSRC_ADLAR.map(dz), u32(0), u32(1), dz('local://1'),
  ]);
  const ofset = Buffer.alloc(8);
  ofset.writeBigUInt64LE(BigInt(bas.length + 8 + (bozuk === 'duz-ofset' ? 1 : 0)));
  const duz = ciftler.flat();
  const govde = Buffer.concat([
    dz('Translation'), u32(2),
    u32(RSRC_ADLAR.indexOf('messages'), 34, duz.length), ...duz.map(dz),
    u32(RSRC_ADLAR.indexOf('locale'), 5), dz(locale),
  ]);
  return Buffer.concat([bas, ofset, govde, Buffer.from('RSRC', 'latin1')]);
}

// Düz Translation okuyucu (sınama ve kurulum doğrulaması): { locale, ciftler }.
export function duzCeviriOku(dosya) {
  const r = rsrcOku(dosya);
  const ana = r.kaynaklar.at(-1);
  if (r.kaynaklar.length !== 1 || ana.tur !== 'Translation') throw new Error('tek kaynaklı düz Translation değil');
  if (dosya.toString('latin1', dosya.length - 4) !== 'RSRC' || ana.son !== dosya.length - 4) throw new Error('dosya sonu tutmadı');
  const oz = Object.fromEntries(ana.ozellikler.map((p) => [p.ad, p.deger]));
  const m = oz.messages || [];
  return { locale: oz.locale, ciftler: Array.from({ length: m.length >> 1 }, (_, i) => [m[2 * i], m[2 * i + 1]]) };
}

// Resmî Godot 3.6'nın yazdığı örnek: locale "tr", tek satır "Dil: English" → "Dil: Türkçe"
// (ResourceSaver.save, 305 bayt, sha256 e5b18482…).
const DUZ_ORNEK = 'UlNSQwAAAAAAAAAAAwAAAAYAAAADAAAADAAAAFRyYW5zbGF0aW9uAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAAAAGAAAAHJlc291cmNlX2xvY2FsX3RvX3NjZW5lAA4AAAByZXNvdXJjZV9uYW1lAAkAAABtZXNzYWdlcwAHAAAAbG9jYWxlAAcAAABzY3JpcHQAAAAAAAEAAAAKAAAAbG9jYWw6Ly8xANsAAAAAAAAADAAAAFRyYW5zbGF0aW9uAAIAAAACAAAAIgAAAAIAAAANAAAARGlsOiBFbmdsaXNoAA4AAABEaWw6IFTDvHJrw6dlAAMAAAAFAAAAAwAAAHRyAFJTUkM=';

function sinaDuz(bozuk) {
  const sonuc = [];
  const t = (ad, kosul) => sonuc.push([ad, !!kosul]);
  const dene = (ad, f) => { try { f(); } catch (e) { t(`${ad} (${e.message})`, false); } };
  dene('düz: motorun örneğiyle bayt bayt aynı', () => {
    t('düz: motorun örneğiyle bayt bayt aynı', duzCeviriYaz('tr', [['Dil: English', 'Dil: Türkçe']], { bozuk }).equals(Buffer.from(DUZ_ORNEK, 'base64')));
  });
  dene('düz: çok satır geri okundu', () => {
    const c = [['Dil: English', 'Dil: Türkçe'], ['abc', ''], ['ÇĞİÖŞÜ çğıöşü', TR_ORNEK]];
    const g = duzCeviriOku(duzCeviriYaz('tr', c, { bozuk }));
    t('düz: çok satır geri okundu', g.locale === 'tr' && JSON.stringify(g.ciftler) === JSON.stringify(c));
  });
  const atar = (f) => { try { f(); return false; } catch { return true; } };
  t('düz: aynı anahtar iki kez reddedildi', atar(() => duzCeviriYaz('tr', [['a', 'b'], ['a', 'c']])));
  return sonuc;
}

// ---------------------------------------------------------------- sınama
const TR_ORNEK = 'Çığ düştü: İşçi ağır şövalye ÇĞİÖŞÜ âîû $t[x] \\n %';

function sinaTablo(pck, tablo, bozuk) {
  const sonuc = [];
  const t = (ad, kosul) => sonuc.push([ad, !!kosul]);
  const daYol = `res://Sheets/CSV/${tablo}.da.translation`;
  const da = pck.oku(daYol);
  const en = phashCoz(rsrcOku(pck.oku(`res://Sheets/CSV/${tablo}.en.translation`)));
  const daCoz = phashCoz(rsrcOku(da));
  const enMetin = new Map(en.kayitlar.map((k) => [k.id, k.metin]));
  const opt = { bozuk };

  // 1) Kimlik: iskeletin kendi baytlarıyla yeniden yazım = orijinal dosyanın bayt bayt aynısı.
  //    Serileştirmenin (dolgu, birleştirme, sıra, ofset düzeni) Godot'un çıktısıyla aynı olduğunu gösterir.
  const kimlik = phashYaz(da, (id, e) => ({ bayt: e.bayt, sik: e.sik, acik: e.acik }), opt);
  t('kimlik: bayt bayt aynı', kimlik.dosya.equals(da));

  // 2) en metinleri da iskeletine, ham.
  let enYazili;
  try {
    enYazili = phashCoz(rsrcOku(phashYaz(da, (id) => enMetin.get(id), opt).dosya));
    t('en→da: uyumsuz 0', enYazili.uyumsuz === 0);
    t('en→da: kayıt sayısı', enYazili.kayitlar.length === daCoz.kayitlar.length);
    t('en→da: anahtarlar ve sıra aynı', enYazili.kayitlar.every((k, i) => k.id === daCoz.kayitlar[i].id && k.anahtar === daCoz.kayitlar[i].anahtar));
    t('en→da: her metin en ile aynı', enYazili.kayitlar.every((k) => k.metin === enMetin.get(k.id)));
    t('en→da: locale korundu', enYazili.locale === daCoz.locale);
    t('en→da: hiçbiri sıkıştırılmış değil', enYazili.kayitlar.every((k) => !k.sikistirilmis));
  } catch (e) { t('en→da: okunabildi (' + e.message + ')', false); }

  // 3) Türkçe harfler ve biçim kodları: her metnin başına örnek eklenir.
  try {
    const tr = phashCoz(rsrcOku(phashYaz(da, (id) => TR_ORNEK + enMetin.get(id), opt).dosya));
    t('tr: uyumsuz 0', tr.uyumsuz === 0);
    t('tr: her metin geri okundu', tr.kayitlar.every((k) => k.metin === TR_ORNEK + enMetin.get(k.id)));
  } catch (e) { t('tr: okunabildi (' + e.message + ')', false); }

  // 4) Dosyanın değişmemesi gereken kısmı: dizgeler, dış/iç kaynak listeleri, ana kaynak öncesi baytlar.
  try {
    const r0 = rsrcOku(da);
    const r1 = rsrcOku(phashYaz(da, (id) => enMetin.get(id), opt).dosya);
    const ilk = r0.kaynaklar.at(-1).ozellikler.find((p) => p.ad === 'bucket_table' || p.ad === 'strings').bas;
    t('başlık ve ana kaynak öncesi aynı', phashYaz(da, (id) => enMetin.get(id), opt).dosya.subarray(0, ilk).equals(da.subarray(0, ilk)));
    t('dizgeler aynı', JSON.stringify(r0.dizgeler) === JSON.stringify(r1.dizgeler));
    t('iç kaynak listesi aynı', JSON.stringify(r0.ic) === JSON.stringify(r1.ic));
    t('özellik adları aynı', JSON.stringify(r0.kaynaklar.at(-1).ozellikler.map((p) => p.ad)) === JSON.stringify(r1.kaynaklar.at(-1).ozellikler.map((p) => p.ad)));
  } catch (e) { t('yapı: okunabildi (' + e.message + ')', false); }
  return sonuc;
}

function sina(pckYolu, bozukMu) {
  const pck = pckAc(pckYolu);
  const tablolar = [...pck.girdiler.keys()]
    .map((y) => y.match(/^res:\/\/Sheets\/CSV\/(\w+)\.da\.translation$/)).filter(Boolean).map((m) => m[1]).sort();
  if (!tablolar.length) { console.log('pck içinde .da.translation yok'); process.exit(2); }
  const kos = (bozuk) => {
    let gecen = 0, toplam = 0;
    const dusen = new Set();
    for (const tb of tablolar) for (const [ad, ok] of sinaTablo(pck, tb, bozuk)) { toplam++; if (ok) gecen++; else dusen.add(ad); }
    for (const [ad, ok] of sinaDuz(bozuk)) { toplam++; if (ok) gecen++; else dusen.add(ad); }
    return { gecen, toplam, dusen };
  };
  const s = kos('');
  for (const ad of s.dusen) console.log('DÜŞTÜ:', ad);
  console.log(`ceviri-yaz sınama: ${s.gecen}/${s.toplam} (${tablolar.length} tablo: ${tablolar.join(', ')})`);
  if (!bozukMu) process.exit(s.gecen === s.toplam ? 0 : 1);
  // Karşı test: yazıcı bilerek bozulur; her bozmada en az bir test düşmeli.
  const BOZMALAR = ['ofset', 'boyut', 'dolgu', 'duz-nul', 'duz-ofset'];
  let yakalanan = 0;
  for (const b of BOZMALAR) {
    const r = kos(b);
    if (r.gecen < r.toplam) { yakalanan++; console.log(`bozma "${b}": yakalandı (${r.toplam - r.gecen} test düştü: ${[...r.dusen].slice(0, 3).join(' · ')})`); }
    else console.log(`bozma "${b}": YAKALANMADI`);
  }
  console.log(`ceviri-yaz sabotaj: ${yakalanan}/${BOZMALAR.length} yakalandı`);
  process.exit(s.gecen === s.toplam && yakalanan === BOZMALAR.length ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const pckYolu = args.find((a) => !a.startsWith('--'));
  if (args.includes('--sina') && pckYolu) sina(pckYolu, args.includes('--bozuk'));
  else { console.log('kullanım: node tools/ceviri-yaz.mjs --sina [--bozuk] <pck>'); process.exit(2); }
}
