#!/usr/bin/env node
// Tam çevirinin iş aracı: sıradaki çevrilmemiş metinleri listeler, yazılan partiyi tr dizinine
// işler. Birim benzersiz en metnidir (metin-olc.mjs ile aynı): bir kayda yazılan çeviri, aynı en
// metnini taşıyan ve tr'de henüz boş olan bütün kayıtlara yayılır. Partide adıyla verilen kayıt
// ezilir; yayılım dolu kaydı ezmez (bağlama göre farklı çevrilmiş kayıt korunur).
// Parti biçim kapısından (bicim-kapisi.mjs → denetle) geçmezse hiçbir dosya yazılmaz.
//
// Kullanım:
//   node tools/ceviri-parti.mjs sonraki <pck> <tr-dizini> [--tur <tür>] [--adet N]
//     Çevrilmemiş benzersiz metinler, tür sırasıyla (SIRA), türün içinde anahtara göre.
//     Satır: "<Tablo> <id>  [anahtar]  ×<kayıt sayısı>" + en metni (JSON dizgisi).
//     --kisa: tek satır "<Tablo> <id>	<en metni>" (kısa metinler için).
//   node tools/ceviri-parti.mjs ekle <pck> <tr-dizini> <parti.json>
//     parti.json: {"<Tablo> <id>": "<Türkçe>"}; metin JSON dizgisi (\n satır sonu, \\~ = \~).
//   node tools/ceviri-parti.mjs --sina [--bozuk]   (sahte veriyle, pck gerekmez)
// tr dizini: <Tablo>.json = [{id, metin, en}], en tablosunun sırasıyla yazılır (yama-kur.mjs okur);
// en = kaydın yazıldığı en metninin özeti (bicim-kapisi.mjs → enOzet). Dosyadaki bir özet şimdiki
// en metniyle tutmuyorsa (oyun güncellenmiş) sonraki/ekle durur: önce ceviri-tasi.mjs yaz.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tur, TURLER, trDolu, harfsizMi } from './metin-olc.mjs';
import { enOzet, ozetHatasi } from './bicim-kapisi.mjs';

// Sözlükteki sıra: eşya adı + anahtar kelime + arayüz → etkiler → hikâyeler.
export const SIRA = ['eşya adı', 'anahtar kelime', 'arayüz', 'eğitim', 'eşya etkisi', 'eşya (anahtarsız)', 'karışık', 'konuşma', 'eşya hikâyesi'];
if (SIRA.length !== TURLER.length || !TURLER.every((t) => SIRA.includes(t))) throw new Error('SIRA, metin-olc TURLER ile aynı türleri içermeli');
const DUSUK = new Set(['eşya (anahtarsız)', 'karışık']);

// en: Map(tablo → [{id, metin}]) · anahtar: Map("tablo id" → anahtar | dizi)
export function metinleriKur(en, anahtar) {
  const metinler = new Map(); // en metni → { metin, tur, kayitlar: [[t, id, anahtar]] }
  for (const [t, kayitlar] of en) for (const { id, metin } of kayitlar) {
    if (!metin.trim()) continue;
    const a = anahtar.get(`${t} ${id}`);
    const tekA = Array.isArray(a) ? null : a || null;
    const tr0 = tur(t, tekA);
    const v = metinler.get(metin);
    if (!v) { metinler.set(metin, { metin, tur: tr0, kayitlar: [[t, id, tekA]] }); continue; }
    v.kayitlar.push([t, id, tekA]);
    if (DUSUK.has(v.tur) && !DUSUK.has(tr0)) v.tur = tr0;
  }
  return metinler;
}

// Dolu = karar verilmiş; en ile aynı yazılmış özel ad da dolu (kural metin-olc.mjs → trDolu).
// Bozma 'ayni' eski kuralı (en ile aynı = boş) geri getirir.
const doluMu = (m, en, bozuk = '') => trDolu(m, en, { bozuk });

// tr: Map(tablo → Map(id → metin)). Dönüş: çevrilmemiş metinler, SIRA ve anahtara göre.
export function sonraki(metinler, tr, { turSec = null, bozuk = '' } = {}) {
  const kalan = [];
  for (const v of metinler.values()) {
    if (turSec && v.tur !== turSec) continue;
    if (bozuk !== 'harfsiz' && harfsizMi(v.metin)) continue;
    const bitti = v.kayitlar.some(([t, id]) => doluMu(tr.get(t)?.get(id), v.metin, bozuk));
    if (!bitti || bozuk === 'sonraki') kalan.push(v);
  }
  const anahtarOf = (v) => v.kayitlar.find((k) => k[2])?.[2] || `~${v.kayitlar[0][0]} ${v.kayitlar[0][1]}`;
  return kalan.sort((a, b) => SIRA.indexOf(a.tur) - SIRA.indexOf(b.tur) || anahtarOf(a).localeCompare(anahtarOf(b), 'en'));
}

// parti: {"Tablo id": metin}. Dönüş: { hatalar, uyarilar, yeniTr, yazilan, yayilan }
export function partiIsle({ en, metinler, tr, denetle, bilinenBicim }, parti, { bozuk = '' } = {}) {
  const hatalar = [], uyarilar = [];
  const enMetin = new Map();
  for (const [t, ks] of en) for (const { id, metin } of ks) enMetin.set(`${t} ${id}`, metin);
  const yeniTr = new Map([...en.keys()].map((t) => [t, new Map(tr.get(t) || [])]));
  let yazilan = 0, yayilan = 0;
  const yazildi = new Set();
  for (const [yer, metin] of Object.entries(parti)) {
    const m = yer.match(/^(\w+) (\S+)$/);
    if (!m || !enMetin.has(yer)) { hatalar.push(`${yer}: en'de böyle kayıt yok`); continue; }
    if (typeof metin !== 'string' || !metin.trim()) { hatalar.push(`${yer}: boş çeviri`); continue; }
    const kaynak = enMetin.get(yer);
    const d = bozuk === 'kapi' ? { hata: [], uyari: [] } : denetle(kaynak, metin, bilinenBicim);
    if (d.hata.length) hatalar.push(`${yer}: ${d.hata.join(' · ')}`);
    if (d.uyari.length) uyarilar.push(`${yer}: ${d.uyari.join(' · ')}`);
    yeniTr.get(m[1]).set(m[2], metin); yazilan++; yazildi.add(yer);
  }
  if (bozuk !== 'yayilim') for (const [yer, metin] of Object.entries(parti)) {
    if (!yazildi.has(yer)) continue;
    const v = metinler.get(enMetin.get(yer));
    if (!v) continue;
    for (const [t, id] of v.kayitlar) {
      const mevcut = yeniTr.get(t).get(id);
      if (`${t} ${id}` === yer || yazildi.has(`${t} ${id}`)) continue;
      if (doluMu(mevcut, v.metin, bozuk) && bozuk !== 'ezme') continue;
      yeniTr.get(t).set(id, metin); yayilan++;
    }
  }
  return { hatalar, uyarilar, yeniTr, yazilan, yayilan };
}

// enMetin verilirse ("Tablo id" → en metni) özetler denetlenir: tutmayan ya da eksik özet
// tr.ozetHata'ya girer (çağıran durur; numaralar kaymışsa yanlış kayda yazılırdı).
export function trOkuDizin(dizin, tablolar, enMetin = null) {
  const tr = new Map(), ozetHata = [];
  for (const t of tablolar) {
    const y = path.join(dizin, `${t}.json`);
    const dizi = existsSync(y) ? JSON.parse(readFileSync(y, 'utf8')) : [];
    if (enMetin) for (const x of dizi) { const h = ozetHatasi(x, enMetin.get(`${t} ${x.id}`)); if (h) ozetHata.push(`${t}:${x.id} ${h}`); }
    tr.set(t, new Map(dizi.map((x) => [x.id, x.metin])));
  }
  tr.ozetHata = ozetHata;
  return tr;
}

// en sırasıyla, yalnızca dolu kayıtlar (en ile aynı yazılmış özel ad dahil); yama-kur'un okuduğu biçim.
export function trDiziKur(en, yeniTr, bozuk = '') {
  const sonuc = new Map();
  for (const [t, ks] of en) {
    const m = yeniTr.get(t);
    const dizi = ks.filter(({ id, metin }) => doluMu(m.get(id), metin, bozuk))
      .map(({ id, metin }) => (bozuk === 'ozet' ? { id, metin: m.get(id) } : { id, metin: m.get(id), en: enOzet(metin) }));
    if (dizi.length) sonuc.set(t, dizi);
  }
  return sonuc;
}
// hepsi: bu tabloların dosyası boşalmış olsa da yazılır (ceviri-tasi.mjs yaz: eski numaralar kalmasın).
export function trYazDizin(dizin, en, yeniTr, { hepsi = [] } = {}) {
  mkdirSync(dizin, { recursive: true });
  const diziler = trDiziKur(en, yeniTr);
  for (const t of hepsi) if (!diziler.has(t)) diziler.set(t, []);
  for (const [t, dizi] of diziler) {
    writeFileSync(path.join(dizin, `${t}.json`), '[\n' + dizi.map((x) => ' ' + JSON.stringify(x)).join(',\n') + '\n]\n');
  }
}

async function gercekKur(pckYolu) {
  const { kapiKur, denetle } = await import('./bicim-kapisi.mjs');
  const { coz } = await import('./anahtar-coz.mjs');
  const k = kapiKur(pckYolu);
  const en = new Map(k.tablolar.map((t) => [t, [...k.en.get(t)].map(([id, metin]) => ({ id, metin }))]));
  const anahtar = new Map();
  for (const [yer, s] of coz(k.pck).anahtar) anahtar.set(yer, s.size === 1 ? [...s][0] : [...s]);
  const enMetin = new Map();
  for (const [t, m] of k.en) for (const [id, metin] of m) enMetin.set(`${t} ${id}`, metin);
  return { k, en, enMetin, anahtar, metinler: metinleriKur(en, anahtar), denetle };
}

function ozetDur(ozetHata, pckYolu, trDizin) {
  if (!ozetHata.length) return;
  for (const h of ozetHata.slice(0, 10)) console.log('HATA   ' + h);
  console.log(`\n${ozetHata.length} kayıtta en özeti eksik ya da tutmuyor: hiçbir şey yapılmadı.`
    + `\nOyun güncellendiyse önce: node tools/ceviri-tasi.mjs yaz ${pckYolu} ${trDizin}`);
  process.exit(1);
}

// ---------------------------------------------------------------- sınama
function sina(bozukMu) {
  const enDizi = {
    A: [{ id: '1', metin: 'Sword' }, { id: '2', metin: 'Gain $p1 $mana.' }, { id: '3', metin: 'Shield' }],
    B: [{ id: '9', metin: 'Sword' }, { id: '8', metin: 'Gain $p1 $mana.' }, { id: '7', metin: 'Old story' }, { id: '6', metin: ' ($num)' }],
  };
  const en = new Map(Object.entries(enDizi));
  const anahtar = new Map([['A 1', 'Sword_NAME'], ['A 2', 'Sword_DESCR'], ['A 3', 'Shield_NAME'], ['B 7', 'Sword_FLAVOR']]);
  const sahteDenetle = (e, t) => {
    const ad = (s) => (s.match(/\$\w+/g) || []).sort().join(' ');
    return { hata: ad(e) === ad(t) ? [] : ['değişken farkı'], uyari: [] };
  };
  const durumlar = bozukMu ? ['yayilim', 'kapi', 'ezme', 'sonraki', 'ayni', 'harfsiz', 'ozet'] : [''];
  let gecen = 0, toplam = 0, yakalanan = 0;
  for (const bozuk of durumlar) {
    const sonuc = [];
    const kontrol = (ad, kosul) => { sonuc.push([ad, !!kosul]); };
    const metinler = metinleriKur(en, anahtar);
    kontrol('benzersiz metin 5 (Sword ve Gain iki tabloda; harfsiz " ($num)" de sayılır)', metinler.size === 5);
    kontrol('B 9 Sword türü eşya adı (anahtarsız kayıt düşük türü almaz)', metinler.get('Sword').tur === 'eşya adı');
    const bos = new Map([['A', new Map()], ['B', new Map()]]);
    const s0 = sonraki(metinler, bos, { bozuk });
    kontrol('boş tr: 4 metin (harfsiz yok), sıra eşya adı (Shield, Sword) → etki → hikâye',
      s0.map((v) => v.metin).join('|') === 'Shield|Sword|Gain $p1 $mana.|Old story');
    const ctx = { en, metinler, tr: bos, denetle: sahteDenetle, bilinenBicim: new Set() };
    const p1 = partiIsle(ctx, { 'A 1': 'Kılıç', 'A 2': '$p1 $mana kazan.' }, { bozuk });
    kontrol('parti hatasız, 2 yazılan, 2 yayılan', !p1.hatalar.length && p1.yazilan === 2 && p1.yayilan === 2);
    kontrol('yayılım: B 9 = Kılıç, B 8 = $p1 $mana kazan.', p1.yeniTr.get('B').get('9') === 'Kılıç' && p1.yeniTr.get('B').get('8') === '$p1 $mana kazan.');
    const s1 = sonraki(metinler, p1.yeniTr, { bozuk });
    kontrol('sonra kalan 2: Shield, Old story', s1.map((v) => v.metin).join('|') === 'Shield|Old story');
    const p2 = partiIsle(ctx, { 'A 2': '$p2 $mana kazan.' }, { bozuk });
    kontrol('kapı: yanlış değişken reddedildi', p2.hatalar.length === 1);
    const p3 = partiIsle(ctx, { 'Z 1': 'x', 'A 9': 'y' }, { bozuk });
    kontrol('olmayan tablo ve kayıt reddedildi', p3.hatalar.length === 2);
    const ctx2 = { ...ctx, tr: p1.yeniTr };
    const p4 = partiIsle(ctx2, { 'B 9': 'Kılıç (dükkân)' }, { bozuk });
    kontrol('adıyla verilen ezilir, yayılım dolu A 1\'i ezmez',
      p4.yeniTr.get('B').get('9') === 'Kılıç (dükkân)' && p4.yeniTr.get('A').get('1') === 'Kılıç');
    // Özel ad en ile aynı bırakılır: dosyaya yazılır, kalandan düşer, yayılım onu ezmez.
    const p5 = partiIsle(ctx2, { 'A 3': 'Shield' }, { bozuk });
    kontrol('en ile aynı özel ad: kalandan düşer (yalnızca Old story kalır)',
      sonraki(metinler, p5.yeniTr, { bozuk }).map((v) => v.metin).join('|') === 'Old story');
    kontrol('en ile aynı özel ad dosyaya yazılır (A: Sword, Gain, Shield)',
      (trDiziKur(en, p5.yeniTr, bozuk).get('A') || []).map((x) => x.id).join(',') === '1,2,3');
    const yazilan = trDiziKur(en, p5.yeniTr, bozuk).get('A') || [];
    kontrol('dosyaya yazılan her kayıt kendi en metninin özetini taşır',
      yazilan.length === 3 && yazilan.every((x) => x.en === enOzet(enDizi.A.find((e) => e.id === x.id).metin)) && yazilan[1].en !== yazilan[0].en);
    kontrol('özet kapısı: özeti tutmayan ya da eksik kayıt yakalanır, doğrusu geçer',
      ozetHatasi({ en: enOzet('Sword') }, 'Sword') === null && !!ozetHatasi({ en: enOzet('Sword') }, 'Shield') && !!ozetHatasi({}, 'Sword'));
    // Aynı en metni iki kayıtta: A 1 en ile aynı bırakılmış, sonra B 9 çevrilirse yayılım A 1'i ezmez.
    const p6a = partiIsle(ctx, { 'A 1': 'Sword' }, { bozuk });
    const p6 = partiIsle({ ...ctx, tr: p6a.yeniTr }, { 'B 9': 'Kılıç (dükkân)' }, { bozuk });
    kontrol('yayılım en ile aynı yazılmış kaydı ezmez (A 1 = Sword kalır)', p6.yeniTr.get('A').get('1') === 'Sword');
    for (const [ad, ok] of sonuc) { toplam++; if (ok) gecen++; else console.log(`  ${bozuk ? `[${bozuk}] ` : ''}KALDI: ${ad}`); }
    if (bozuk) { const yak = sonuc.some(([, ok]) => !ok); if (yak) yakalanan++; console.log(`bozma ${bozuk}: ${yak ? 'yakalandı' : 'YAKALANMADI'}`); }
  }
  if (bozukMu) { console.log(`bozma: ${yakalanan}/${durumlar.length} yakalandı`); process.exit(yakalanan === durumlar.length ? 0 : 1); }
  console.log(`sınama: ${gecen}/${toplam}`);
  process.exit(gecen === toplam ? 0 : 1);
}

// ---------------------------------------------------------------- komut satırı
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [kmt, ...arg] = process.argv.slice(2);
  const bayrak = (ad) => { const i = arg.indexOf(ad); return i >= 0 ? arg.splice(i, 2)[1] : null; };
  if (kmt === '--sina') sina(arg.includes('--bozuk'));
  else if (kmt === 'sonraki') {
    const turSec = bayrak('--tur'), adet = Number(bayrak('--adet') || 40);
    const kisa = arg.includes('--kisa'); if (kisa) arg.splice(arg.indexOf('--kisa'), 1);
    const [pckYolu, trDizin] = arg;
    if (turSec && !SIRA.includes(turSec)) { console.log(`tür yok: ${turSec} · türler: ${SIRA.join(' · ')}`); process.exit(2); }
    const g = await gercekKur(pckYolu);
    const tr = trOkuDizin(trDizin, g.k.tablolar, g.enMetin);
    ozetDur(tr.ozetHata, pckYolu, trDizin);
    const kalan = sonraki(g.metinler, tr, { turSec });
    const sayac = new Map();
    for (const v of kalan) sayac.set(v.tur, (sayac.get(v.tur) || 0) + 1);
    console.log(`kalan ${kalan.length} metin · ${[...sayac].map(([t, n]) => `${t} ${n}`).join(' · ')}`);
    for (const v of kalan.slice(0, adet)) {
      const [t, id] = v.kayitlar[0];
      const a = v.kayitlar.find((x) => x[2])?.[2] || '-';
      console.log(kisa ? `${t} ${id}\t${JSON.stringify(v.metin)}` : `${t} ${id}  [${a}]  ×${v.kayitlar.length}\n  ${JSON.stringify(v.metin)}`);
    }
  } else if (kmt === 'ekle') {
    const [pckYolu, trDizin, partiYolu] = arg;
    const g = await gercekKur(pckYolu);
    const tr = trOkuDizin(trDizin, g.k.tablolar, g.enMetin);
    ozetDur(tr.ozetHata, pckYolu, trDizin);
    const parti = JSON.parse(readFileSync(partiYolu, 'utf8'));
    const r = partiIsle({ en: g.en, metinler: g.metinler, tr, denetle: g.denetle, bilinenBicim: g.k.bilinenBicim }, parti);
    for (const u of r.uyarilar) console.log('uyarı  ' + u);
    for (const h of r.hatalar) console.log('HATA   ' + h);
    if (r.hatalar.length) { console.log(`\n${r.hatalar.length} hata: hiçbir şey yazılmadı`); process.exit(1); }
    trYazDizin(trDizin, g.en, r.yeniTr);
    const kalan = sonraki(g.metinler, r.yeniTr).length;
    const harfli = [...g.metinler.values()].filter((v) => !harfsizMi(v.metin)).length;
    console.log(`\nyazılan ${r.yazilan} · yayılan ${r.yayilan} · kalan benzersiz metin ${kalan}/${harfli} (harfsiz metin sayılmaz)`);
  } else {
    console.log('kullanım: sonraki <pck> <tr-dizini> [--tur <tür>] [--adet N] [--kisa] · ekle <pck> <tr-dizini> <parti.json> · --sina [--bozuk]');
    process.exit(2);
  }
}
