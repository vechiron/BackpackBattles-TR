#!/usr/bin/env node
// Biçim kodu kapısı: çeviride oyunun biçim kodları korunmuş mu.
//
// Kurallar ölçümden (08.11.2026, en ↔ yayındaki 10 dil, 2407 metin; ayrıntı commit mesajında):
//   HATA (yamaya giremez)
//   - Değişken kökü ($p1, $affected, $effect-damage'in "effect"i): en'deki çoklu
//     küme birebir. İstisna: en'de "s" ile biten kök çeviride "s"siz geçebilir
//     ($cds = $cd + "s" saniye; es "$cd s", ru "$cd сек.", ja "$cd秒").
//     Değişkene bitişik Latin harf kökü değiştirir ($cdsn) → hata; bu kasıtlı.
//   - Biçim açılışı $ad[ : ad, en metinlerinin hepsinde biçim olarak geçen
//     adlardan biri olmalı ($h[ eklemek serbest, $hh[ hata).
//   - Köşeli parantez dengeli; $ad[ olmayan çıplak [ sayısı en ile aynı.
//   - {yer_tutucu} çoklu kümesi birebir. % sayısı aynı. Metinde NUL yok.
//   SERBEST: tire eki ($holy-item → $holy-eşya; de "-Gegenstand", ru "-предмет") ·
//     \~ (en ve da dışındaki diller atmış).
//   HATA ayrıca (denetle): kayıtta en özeti yok ya da şimdiki en metniyle tutmuyor (enOzet, aşağıda).
//   UYARI: satır sonu sayısı · biçim açılışı sayısı · değişkene bitişik
//     ASCII dışı harf ya da kesme işareti ($p1'lik, $affectedı: oyunda denenmedi) ·
//     çevrilmemiş (boş ya da en ile aynı).
//
// Kullanım:
//   node tools/bicim-kapisi.mjs denetle <pck> <tr-dizini>   (<Tablo>.json: [{id, metin, en}])
//   node tools/bicim-kapisi.mjs --kalibre <pck>    (kurallar yayındaki dillerde ne sıklıkla tetikleniyor)
//   node tools/bicim-kapisi.mjs --sina [--bozuk] <pck>
// Kütüphane: import { kapiKur } from './bicim-kapisi.mjs'

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pckAc, rsrcOku, phashCoz } from './godot-ceviri.mjs';

// ---------------------------------------------------------------- en özeti
// Bir Türkçe kaydın hangi İngilizce metne göre yazıldığı: en metninin sha256'sının ilk 16
// hanesi, kayıtta `en` alanı (oyun metni git'e girmez, özeti girer). Kayıt numarası (id
// "kova.sıra") tablonun karma düzeninden gelir ve oyun güncellenince kayar; Türkçe bu özetle
// doğru kayda taşınır (tools/ceviri-tasi.mjs). Yazan: ceviri-parti.mjs → trDiziKur.
export const enOzet = (metin) => createHash('sha256').update(metin, 'utf8').digest('hex').slice(0, 16);
// x: dosyadaki kayıt {id, metin, en}; enMetin: şimdiki en metni. Hata metni ya da null.
export function ozetHatasi(x, enMetin) {
  if (typeof x.en !== 'string') return 'en özeti yok (ceviri-parti ekle yazar; elle eklenen kayıtta eksik kalır)';
  if (enMetin !== undefined && x.en !== enOzet(enMetin)) return 'en özeti tutmuyor: çeviri başka bir İngilizce metne göre yazılmış (oyun güncellendiyse: node tools/ceviri-tasi.mjs yaz <pck> <tr-dizini>)';
  return null;
}

const DEG = /\$([A-Za-z_][A-Za-z0-9_]*)(-[^\s\[\].,:;!?()$%]+)?(\[)?/g;

export function parcala(m) {
  const degisken = [], bicim = [], bitisik = [];
  for (const x of m.matchAll(DEG)) {
    (x[3] ? bicim : degisken).push(x[1]);
    const sonra = m[x.index + x[0].length];
    if (!x[2] && !x[3] && sonra && (/[^\x00-\x7f]/.test(sonra) && /\p{L}/u.test(sonra) || sonra === "'" || sonra === '’')) bitisik.push(x[0] + sonra);
  }
  let derinlik = 0, dengeli = true;
  for (const c of m) { if (c === '[') derinlik++; else if (c === ']' && --derinlik < 0) dengeli = false; }
  if (derinlik !== 0) dengeli = false;
  const ciplak = (m.match(/\[/g) || []).length - bicim.length;
  return {
    degisken, bicim, bitisik, dengeli, ciplak,
    yer: (m.match(/\{[^}]*\}/g) || []).sort(),
    yuzde: (m.match(/%/g) || []).length,
    satir: (m.match(/\n/g) || []).length,
  };
}

// en kökleri E, çeviri kökleri T: önce birebir, sonra "s" istisnası.
function kokFarki(E, T, bozuk) {
  const kalan = new Map();
  for (const x of E) kalan.set(x, (kalan.get(x) || 0) + 1);
  const al = (x) => { const n = kalan.get(x) || 0; if (!n) return false; kalan.set(x, n - 1); return true; };
  const bekleyen = T.filter((t) => !al(t));
  const fazla = bekleyen.filter((t) => !(bozuk !== 's' && al(t + 's')));
  const eksik = [...kalan].flatMap(([x, n]) => Array(n).fill(x));
  return { eksik, fazla };
}

export const AYNI_UYARI = 'çevrilmemiş (en ile aynı)';
// bilinenBicim: Set — en metinlerinin hepsinde $ad[ olarak geçen adlar.
export function denetle(en, tr, bilinenBicim, { bozuk = '' } = {}) {
  const hata = [], uyari = [];
  if (!tr.trim()) { if (en.trim()) uyari.push('çevrilmemiş (boş)'); return { hata, uyari }; }
  if (tr === en) uyari.push(AYNI_UYARI);
  if (tr.includes('\0')) hata.push('metinde NUL');
  const a = parcala(en), b = parcala(tr);
  if (bozuk !== 'kok') {
    const { eksik, fazla } = kokFarki(a.degisken, b.degisken, bozuk);
    if (eksik.length) hata.push('eksik değişken: ' + eksik.map((x) => '$' + x).join(' '));
    if (fazla.length) hata.push('fazla/yanlış değişken: ' + fazla.map((x) => '$' + x).join(' '));
  }
  const yabanci = b.bicim.filter((x) => !bilinenBicim.has(x));
  if (yabanci.length && bozuk !== 'bicim') hata.push('bilinmeyen biçim: ' + yabanci.map((x) => '$' + x + '[').join(' '));
  if (!b.dengeli && bozuk !== 'denge') hata.push('köşeli parantez dengesiz');
  if (b.ciplak !== a.ciplak) hata.push(`çıplak [ sayısı ${a.ciplak} → ${b.ciplak}`);
  if (a.yer.join('|') !== b.yer.join('|') && bozuk !== 'yer') hata.push(`yer tutucu: ${a.yer.join(' ') || '-'} → ${b.yer.join(' ') || '-'}`);
  if (a.yuzde !== b.yuzde && bozuk !== 'yuzde') hata.push(`% sayısı ${a.yuzde} → ${b.yuzde}`);
  if (a.satir !== b.satir) uyari.push(`satır sonu ${a.satir} → ${b.satir}`);
  if (a.bicim.length !== b.bicim.length) uyari.push(`biçim sayısı ${a.bicim.length} → ${b.bicim.length}`);
  if (b.bitisik.length) uyari.push('değişkene bitişik ek (oyunda denenmedi): ' + b.bitisik.join(' '));
  return { hata, uyari };
}

// pck'den en tablolarını ve bilinen biçim adlarını kurar.
export function kapiKur(pckYolu) {
  const pck = pckAc(pckYolu);
  const yollar = [...pck.girdiler.keys()].map((y) => y.match(/^res:\/\/Sheets\/CSV\/(\w+)\.(\w+)\.translation$/)).filter(Boolean);
  const tablolar = [...new Set(yollar.filter((m) => m[2] === 'en').map((m) => m[1]))].sort();
  const diller = [...new Set(yollar.map((m) => m[2]))].filter((d) => d !== 'en').sort();
  const cozuk = (t, d) => phashCoz(rsrcOku(pck.oku(`res://Sheets/CSV/${t}.${d}.translation`))).kayitlar;
  const en = new Map(tablolar.map((t) => [t, new Map(cozuk(t, 'en').map((k) => [k.id, k.metin]))]));
  const bilinenBicim = new Set();
  for (const m of en.values()) for (const metin of m.values()) parcala(metin).bicim.forEach((x) => bilinenBicim.add(x));
  return { pck, tablolar, diller, en, bilinenBicim, cozuk, var: (t, d) => pck.girdiler.has(`res://Sheets/CSV/${t}.${d}.translation`) };
}

// ---------------------------------------------------------------- komutlar
function denetleDizin(pckYolu, dizin) {
  const k = kapiKur(pckYolu);
  let hataliKayit = 0, uyariliKayit = 0, toplam = 0, eksikKayit = 0, ozetHatali = 0;
  // Dosyaya en ile aynı yazılmış kayıt bilerek aynı bırakılmıştır (özel ad; kural metin-olc.mjs →
  // trDolu): uyarı sayılmaz, ayrı sayılır. Parti eklerken (ceviri-parti ekle) uyarı yine basılır.
  const ayniOrnek = [];
  for (const t of k.tablolar) {
    const dosya = path.join(dizin, t + '.json');
    if (!existsSync(dosya)) continue;
    const enM = k.en.get(t);
    const dizi = JSON.parse(readFileSync(dosya, 'utf8'));
    const tr = new Map(dizi.map((x) => [x.id, x.metin]));
    for (const id of tr.keys()) if (!enM.has(id)) { console.log(`${t}:${id}  HATA: en'de böyle kayıt yok`); hataliKayit++; }
    for (const x of dizi) {
      const h = enM.has(x.id) && ozetHatasi(x, enM.get(x.id));
      if (h) { console.log(`${t}:${x.id}  HATA: ${h}`); hataliKayit++; ozetHatali++; }
    }
    for (const [id, enMetin] of enM) {
      if (!tr.has(id)) { eksikKayit++; continue; }
      toplam++;
      const d = denetle(enMetin, tr.get(id), k.bilinenBicim);
      const hata = d.hata, uyari = d.uyari.filter((u) => u !== AYNI_UYARI);
      if (uyari.length < d.uyari.length) ayniOrnek.push(enMetin);
      if (hata.length) { hataliKayit++; console.log(`${t}:${id}  HATA: ${hata.join(' · ')}`); }
      if (uyari.length) { uyariliKayit++; console.log(`${t}:${id}  uyarı: ${uyari.join(' · ')}`); }
    }
  }
  if (ayniOrnek.length) console.log(`bilerek aynı (en ile aynı yazılmış): ${[...new Set(ayniOrnek)].map((x) => JSON.stringify(x)).join(' ')}`);
  console.log(`\nbiçim kapısı: ${toplam} kayıt denetlendi · hatalı ${hataliKayit} · uyarılı ${uyariliKayit} · bilerek aynı ${ayniOrnek.length} · dosyada olmayan ${eksikKayit} · en özeti hatalı ${ozetHatali}`);
  process.exit(hataliKayit ? 1 : 0);
}

function kalibre(pckYolu, sessiz = false) {
  const k = kapiKur(pckYolu);
  const sonuc = {};
  for (const d of ['en', ...k.diller]) {
    const s = { kayit: 0, hatali: 0, kural: {}, bitisik: 0, ornek: [] };
    for (const t of k.tablolar) {
      if (!k.var(t, d)) continue;
      const enM = k.en.get(t);
      for (const x of k.cozuk(t, d)) {
        const e = enM.get(x.id);
        if (!e || !x.metin.trim() || (d !== 'en' && x.metin === e)) continue;
        s.kayit++;
        const r = denetle(e, x.metin, k.bilinenBicim);
        if (r.hata.length) { s.hatali++; if (s.ornek.length < 2) s.ornek.push(`${t}:${x.id} ${r.hata[0]}`); }
        for (const h of r.hata) { const ad = h.split(/[:\d]/)[0].trim(); s.kural[ad] = (s.kural[ad] || 0) + 1; }
        if (r.uyari.some((u) => u.startsWith('değişkene bitişik'))) s.bitisik++;
      }
    }
    sonuc[d] = s;
  }
  if (!sessiz) {
    console.log('dil         kayıt  hatalı   oran   bitişik-ek  hata türleri');
    for (const [d, s] of Object.entries(sonuc)) {
      if (!s.kayit) continue;
      console.log(`${d.padEnd(11)} ${String(s.kayit).padStart(5)} ${String(s.hatali).padStart(7)} ${(100 * s.hatali / s.kayit).toFixed(1).padStart(5)}%  ${String(s.bitisik).padStart(10)}  ${Object.entries(s.kural).map(([a, n]) => `${a}×${n}`).join(' · ')}`);
      for (const o of s.ornek) console.log('              ' + o);
    }
  }
  return sonuc;
}

// ---------------------------------------------------------------- sınama
// Gerçek bir en metni alınır, bilerek bozulur ya da izinli biçimde değiştirilir.
function sinaKos(k, bozuk) {
  const sonuc = [];
  const t = (ad, kosul) => sonuc.push([ad, !!kosul]);
  const tum = [...k.en.values()].flatMap((m) => [...m.values()]);
  const bul = (re) => tum.find((m) => re.test(m));
  const d = (en, tr) => denetle(en, tr, k.bilinenBicim, { bozuk });
  const temiz = (en, tr) => d(en, tr).hata.length === 0;
  const kirli = (en, tr) => d(en, tr).hata.length > 0;

  t('en kendisiyle: bütün metinlerde hata 0', tum.every((m) => temiz(m, m)));
  const cds = bul(/\$t\[Every \$cds:\]/);
  const holy = bul(/\$holy-item\b/);
  const yer = bul(/\{amount\}/);
  const yuz = bul(/\$chance%/);
  const tilde = bul(/\\~\$affected/);
  t('örnek metinler bulundu', cds && holy && yer && yuz && tilde);
  // izinli değişiklikler
  t('izinli: $cds → $cd sn', temiz(cds, cds.replace('$cds', '$cd sn')));
  t('izinli: tire eki çevrildi', temiz(holy, holy.replace('$holy-item', '$holy-eşya')));
  t('izinli: \\~ atıldı', temiz(tilde, tilde.replaceAll('\\~', '')));
  t('izinli: $h[…] eklendi', temiz(cds, cds + ' $h[vurgu]'));
  // Çeviri benzetimi: kod olmayan her İngilizce kelime Türkçe kelimeyle değişir, ilk iki
  // değişkenin yeri değişir (Türkçe söz dizimi). Bütün en metinlerinde hata çıkmamalı.
  const ceviri = (m) => m.replace(/(?<![$\w{-])[A-Za-z]+/g, 'şöyle');
  const yerDegis = (m) => {
    const x = [...m.matchAll(/\$[a-z_]+\d*(?![\w[-])/g)];
    if (x.length < 2) return m;
    const [a, b] = x;
    return m.slice(0, a.index) + b[0] + m.slice(a.index + a[0].length, b.index) + a[0] + m.slice(b.index + b[0].length);
  };
  t('izinli: bütün metinler Türkçe kelime + yer değişimi', tum.every((m) => temiz(m, yerDegis(ceviri(m)))));
  t('izinli: benzetim gerçekten değiştirdi', tum.filter((m) => yerDegis(ceviri(m)) !== ceviri(m)).length > 100);
  t('uyarı: bitişik Türkçe ek', d(yuz, yuz.replace('$chance%', "%$chance'lik")).uyari.some((u) => u.startsWith('değişkene bitişik')));
  // yasak değişiklikler
  t('yasak: değişken silindi', kirli(yuz, yuz.replace('$chance', '50')));
  t('yasak: değişken yanlış yazıldı', kirli(yuz, yuz.replace('$chance', '$chanse')));
  t('yasak: bitişik Latin ek ($cdsn)', kirli(cds, cds.replace('$cds', '$cdsn')));
  t('yasak: fazladan değişken', kirli(yuz, yuz + ' $p9'));
  t('yasak: bilinmeyen biçim $hh[', kirli(cds, cds + ' $hh[x]'));
  t('yasak: ] silindi', kirli(cds, cds.replace(']', '')));
  t('yasak: fazladan ]', kirli(cds, cds + ']'));
  t('yasak: yer tutucu çevrildi', kirli(yer, yer.replace('{amount}', '{miktar}')));
  t('yasak: % silindi', kirli(yuz, yuz.replace('%', '')));
  t('yasak: NUL', kirli(yuz, yuz + '\0'));
  t('uyarı: çevrilmemiş', d(yuz, yuz).uyari.some((u) => u.startsWith('çevrilmemiş')));
  return sonuc;
}

function sina(pckYolu, bozukMu) {
  const k = kapiKur(pckYolu);
  const ozet = (b) => { const s = sinaKos(k, b); return { gecen: s.filter((x) => x[1]).length, toplam: s.length, dusen: s.filter((x) => !x[1]).map((x) => x[0]) }; };
  const s = ozet('');
  for (const ad of s.dusen) console.log('DÜŞTÜ:', ad);
  console.log(`biçim kapısı sınama: ${s.gecen}/${s.toplam} (bilinen biçim adı ${k.bilinenBicim.size})`);
  if (!bozukMu) process.exit(s.gecen === s.toplam ? 0 : 1);
  const BOZMALAR = ['kok', 's', 'bicim', 'denge', 'yer', 'yuzde'];
  let yakalanan = 0;
  for (const b of BOZMALAR) {
    const r = ozet(b);
    if (r.gecen < r.toplam) { yakalanan++; console.log(`bozma "${b}": yakalandı (${r.toplam - r.gecen} test düştü: ${r.dusen.slice(0, 3).join(' · ')})`); }
    else console.log(`bozma "${b}": YAKALANMADI`);
  }
  console.log(`biçim kapısı sabotaj: ${yakalanan}/${BOZMALAR.length} yakalandı`);
  process.exit(s.gecen === s.toplam && yakalanan === BOZMALAR.length ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const duz = args.filter((a) => !a.startsWith('--'));
  if (args.includes('--sina') && duz[0]) sina(duz[0], args.includes('--bozuk'));
  else if (args.includes('--kalibre') && duz[0]) kalibre(duz[0]);
  else if (duz[0] === 'denetle' && duz[1] && duz[2]) denetleDizin(duz[1], duz[2]);
  else { console.log('kullanım: node tools/bicim-kapisi.mjs denetle <pck> <tr-dizini> | --kalibre <pck> | --sina [--bozuk] <pck>'); process.exit(2); }
}
