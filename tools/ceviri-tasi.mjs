#!/usr/bin/env node
// Çeviri taşıma: oyun güncellenince Türkçe kayıtları yeni numaralarına taşır.
//
// Neden: kayıt numarası (id "kova.sıra") tablonun karma düzeninden gelir (godot-ceviri.mjs →
// phashCoz); oyun bir tabloya metin ekleyince ardındaki numaralar kayar ve numarayla eşlenen
// Türkçe yanlış kayda yazılır. Her Türkçe kayıt yazıldığı en metninin özetini taşır
// (bicim-kapisi.mjs → enOzet); eşleme tablo içinde bu özetle yapılır (ölçüm, commit a67c43a:
// aynı tabloda aynı en metnini taşıyan kayıtların hiçbirinde farklı Türkçe yok).
//
// Kural (tasi):
//   - Şimdiki her en kaydı: metninin özeti eski bir Türkçe kayıtta varsa o Türkçe, numara ne
//     olursa olsun (aynı en metinli yeni kayda da yayılır); yoksa İngilizce kalır.
//   - Bir özete iki farklı Türkçe: hiçbiri yazılmaz (belirsiz, sayılır).
//   - Özeti şimdiki tabloda olmayan eski kayıt (İngilizcesi değişmiş ya da silinmiş): düşen,
//     listelenir; yeni İngilizcesi ceviri-parti sonraki'de çevrilmemiş olarak çıkar.
//   - Özeti olmayan eski kayıt taşınmaz (özetsiz; override-kur kur durur). --ozet-ekle onu
//     numarayla eşleyip özet ekler: yalnızca dizin şimdiki oyuna göre yazıldıysa doğru (biçim
//     kapısı değişkenli kayıtta yakalar, değişkensiz kayıtta yakalamaz).
//
// Kullanım:
//   node tools/ceviri-tasi.mjs durum <pck> <tr-dizini>   çıkış 0 taşıma gerekmiyor · 3 gerekiyor · 1 hata
//   node tools/ceviri-tasi.mjs yaz <pck> <tr-dizini> [--ozet-ekle]
//     Biçim kapısı hatasında hiçbir şey yazmaz; boşalan tablonun dosyası boş dizi olur
//     (eski numara kalmasın). Değişiklik yoksa dosyalara dokunmaz.
//   node tools/ceviri-tasi.mjs --sina [--bozuk]          (sahte tabloyla, pck gerekmez)
// Kütüphane: import { tasi, trHazirla, tasimaSatiri } from './ceviri-tasi.mjs'
// (override-kur.mjs kur ve motor-dene.mjs Türkçeyi bununla okur: kurulum her zaman taşınmış hâli yazar.)

import { mkdtempSync, rmSync, readFileSync, writeFileSync, closeSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enOzet, kapiKur, denetle } from './bicim-kapisi.mjs';
import { trOku } from './yama-kur.mjs';
import { trYazDizin } from './ceviri-parti.mjs';

// en: Map(tablo → Map(id → en metni)) · ham: Map(tablo → Map(id → {metin, en})) (trOku).
// Dönüş: { tr: Map(tablo → Map(id → metin)) (yalnızca ham'daki tablolar), s: sayaçlar }.
// bozuk (yalnızca sınama): 'numara' numarayla eşler · 'belirsiz' ilk Türkçeyi alır ·
// 'ozetsiz' özetsizi numarayla kabul eder · 'dusen' düşeni saymaz.
export function tasi(en, ham, { ozetEkle = false, bozuk = '' } = {}) {
  const tr = new Map();
  const s = { yerinde: 0, tasinan: 0, belirsiz: [], dusen: [], ozetsiz: [], degisti: false };
  for (const [t, eski] of ham) {
    const enM = en.get(t) || new Map();
    const yeni = new Map();
    tr.set(t, yeni);
    // Eski kaydın özeti: dosyadaki; özetsizse --ozet-ekle ile şimdiki numaradaki en metninden.
    const eskiOzet = new Map();
    for (const [id, x] of eski) {
      if (typeof x.en === 'string') eskiOzet.set(id, x.en);
      else if (ozetEkle || bozuk === 'ozetsiz') { if (enM.has(id)) eskiOzet.set(id, enOzet(enM.get(id))); else s.dusen.push(`${t}:${id} ${JSON.stringify(x.metin)}`); }
      else s.ozetsiz.push(`${t}:${id}`);
    }
    const adaylar = new Map(); // özet → Set(Türkçe)
    for (const [id, o] of eskiOzet) { if (!adaylar.has(o)) adaylar.set(o, new Set()); adaylar.get(o).add(eski.get(id).metin); }
    const simdiki = new Set();
    for (const [id, metin] of enM) {
      if (bozuk === 'numara') { if (eski.has(id)) yeni.set(id, eski.get(id).metin); continue; }
      const o = enOzet(metin);
      simdiki.add(o);
      const a = adaylar.get(o);
      if (!a) continue;
      if (a.size > 1 && bozuk !== 'belirsiz') { s.belirsiz.push(`${t}:${id}`); continue; }
      const m = [...a][0];
      yeni.set(id, m);
      if (eskiOzet.get(id) === o && eski.get(id).metin === m) s.yerinde++; else s.tasinan++;
    }
    if (bozuk !== 'dusen' && bozuk !== 'numara') {
      for (const [id, o] of eskiOzet) if (!simdiki.has(o)) s.dusen.push(`${t}:${id} ${JSON.stringify(eski.get(id).metin)}`);
    }
    if (yeni.size !== eski.size || [...yeni].some(([id, m]) => eski.get(id)?.metin !== m)) s.degisti = true;
  }
  if (s.belirsiz.length || s.dusen.length || s.ozetsiz.length) s.degisti = true;
  return { tr, s };
}

export const tasimaSatiri = (s) => `taşıma: ${s.yerinde} kayıt yerinde · ${s.tasinan} yeni numarasına taşındı · `
  + `${s.belirsiz.length} belirsiz (İngilizce kaldı) · ${s.dusen.length} düşen (İngilizcesi değişmiş ya da silinmiş)`
  + (s.ozetsiz.length ? ` · ${s.ozetsiz.length} özetsiz (taşınamaz)` : '');

// k: { tablolar, en } (kapiKur). trOku + tasi. Özetsiz kayıt hata sayılır: kurulum durur.
export function trHazirla(k, dizin, { ozetEkle = false, bozuk = '' } = {}) {
  const o = trOku(dizin, k.tablolar);
  if (o.hata.length) return { tr: o.tr, ham: o.ham, hata: o.hata, s: null };
  const { tr, s } = tasi(k.en, o.ham, { ozetEkle, bozuk });
  const hata = s.ozetsiz.length
    ? [`${s.ozetsiz.length} kayıtta en özeti yok (ilk: ${s.ozetsiz.slice(0, 3).join(', ')}): numarası kaymış olabilir, taşınamaz. `
      + `Dizin şimdiki oyuna göre yazıldıysa: node tools/ceviri-tasi.mjs yaz <pck> ${dizin} --ozet-ekle`]
    : [];
  return { tr, ham: o.ham, hata, s };
}

// Taşınmış hâli dizine yazar. Kapı hatasında hiçbir şey yazmaz. k: { tablolar, en, bilinenBicim }.
// bozuk ek olarak: 'kapi' kapıyı atlar · 'hepsi' boşalan tablonun dosyasını yazmaz.
export function yazDizin(k, dizin, { ozetEkle = false, bozuk = '' } = {}) {
  const h = trHazirla(k, dizin, { ozetEkle, bozuk });
  if (h.hata.length) return { ...h, yazildi: false };
  const kapi = [];
  if (bozuk !== 'kapi') {
    for (const [t, m] of h.tr) for (const [id, metin] of m) {
      for (const x of denetle(k.en.get(t).get(id), metin, k.bilinenBicim).hata) kapi.push(`${t}:${id} ${x}`);
    }
  }
  if (kapi.length) return { ...h, hata: kapi, yazildi: false };
  if (!h.s.degisti && !ozetEkle) return { ...h, yazildi: false };
  const enListe = new Map(k.tablolar.map((t) => [t, [...k.en.get(t)].map(([id, metin]) => ({ id, metin }))]));
  const yeniTr = new Map(k.tablolar.map((t) => [t, h.tr.get(t) || new Map()]));
  trYazDizin(dizin, enListe, yeniTr, { hepsi: bozuk === 'hepsi' ? [] : [...h.ham.keys()] });
  return { ...h, yazildi: true };
}

// ---------------------------------------------------------------- sınama
// Eski: [en metni, Türkçe, (özetsiz)]. Yeni: numaraları kaymış, metin eklenmiş/değişmiş tablolar.
const ESKI = {
  A: { 1: ['Sword', 'Kılıç'], 2: ['Gain $p1 $mana.', '$p1 $mana kazan.'], 3: ['Shield', 'Kalkan'], 4: ['Sword', 'Kılıç'], 5: ['Old text', 'Eski metin'] },
  C: { 1: ['Ring', 'Yüzük'], 2: ['Ring', 'Halka'], 3: ['Cap', 'Şapka'] },
  D: { 1: ['Crown', 'Taç', 'ozetsiz'] },
  E: { 1: ['Bag', 'Çanta'], 2: ['Bag of holding', 'Sınırsız çanta'] },
  G: { 1: ['Gone', 'Gitti'] },
};
const YENI = {
  A: { 1: 'New item', 2: 'Sword', 3: 'Gain $p1 $mana.', 4: 'Shield', 6: 'Sword', 7: 'Changed text' },
  C: { 5: 'Ring', 3: 'Cap' },
  D: { 1: 'Crown' },
  E: { 1: 'Bag', 2: 'Bag of holding' },
  F: { 1: 'Empty' },
  G: { 1: 'Replaced' },
};
const enKur = (o) => new Map(Object.entries(o).map(([t, m]) => [t, new Map(Object.entries(m))]));
const hamKur = (o) => new Map(Object.entries(o).map(([t, m]) => [t, new Map(Object.entries(m).map(([id, [e, metin, oz]]) => [id, oz ? { metin } : { metin, en: enOzet(e) }]))]));
const dosyalaraYaz = (dizin, o) => {
  for (const [t, m] of Object.entries(o)) {
    const dizi = Object.entries(m).map(([id, [e, metin, oz]]) => (oz ? { id, metin } : { id, metin, en: enOzet(e) }));
    writeFileSync(path.join(dizin, `${t}.json`), JSON.stringify(dizi));
  }
};

function sinaKos(bozuk) {
  const sonuc = [];
  const t = (ad, kosul) => sonuc.push([ad, !!kosul]);
  const en = enKur(YENI);
  const { tr, s } = tasi(en, hamKur(ESKI), { bozuk });
  const g = (tb, id) => tr.get(tb)?.get(String(id));
  t('kaymış kayıtlar özetle doğru numarada (A2 Kılıç, A3 $p1 $mana kazan., A4 Kalkan)', g('A', 2) === 'Kılıç' && g('A', 3) === '$p1 $mana kazan.' && g('A', 4) === 'Kalkan');
  t('aynı en metinli yeni kayda yayıldı (A6 Kılıç)', g('A', 6) === 'Kılıç');
  t('yeni ve İngilizcesi değişmiş kayıt Türkçesiz (A1, A7, G1)', g('A', 1) === undefined && g('A', 7) === undefined && g('G', 1) === undefined);
  t('düşen: A5 ve G1 listede, başka yok', s.dusen.length === 2 && s.dusen.some((x) => x.startsWith('A:5 ')) && s.dusen.some((x) => x.startsWith('G:1 ')));
  t('belirsiz: iki farklı Türkçe → hiçbiri (C5), C3 yerinde', g('C', 5) === undefined && s.belirsiz.join() === 'C:5' && g('C', 3) === 'Şapka');
  t('özetsiz taşınmaz, sayılır (D1)', g('D', 1) === undefined && s.ozetsiz.join() === 'D:1');
  t('sayaçlar: yerinde 3 (C3, E1, E2), taşınan 4 (A2, A3, A4, A6), değişti', s.yerinde === 3 && s.tasinan === 4 && s.degisti);
  const e2 = tasi(en, hamKur(ESKI), { ozetEkle: true, bozuk });
  t('--ozet-ekle: özetsiz numarayla eşlendi (D1 Taç), özetsiz 0', e2.tr.get('D').get('1') === 'Taç' && e2.s.ozetsiz.length === 0);
  const yalnizE = tasi(en, hamKur({ E: ESKI.E }), { bozuk });
  t('değişmeyen tablo: hepsi yerinde, değişiklik yok', yalnizE.s.yerinde === 2 && yalnizE.s.tasinan === 0 && !yalnizE.s.degisti);

  // Uçtan uca: dosyadan oku, yaz, geri oku.
  const kok = mkdtempSync(path.join(os.tmpdir(), 'ceviri-tasi-'));
  try {
    const k = { tablolar: Object.keys(YENI).sort(), en, bilinenBicim: new Set() };
    const dizin = mkdtempSync(path.join(kok, 'tr-'));
    dosyalaraYaz(dizin, ESKI);
    const once = Object.keys(ESKI).map((x) => readFileSync(path.join(dizin, `${x}.json`), 'utf8')).join('|');
    const r1 = yazDizin(k, dizin, { bozuk });
    const sonra1 = Object.keys(ESKI).map((x) => readFileSync(path.join(dizin, `${x}.json`), 'utf8')).join('|');
    t('yaz: özetsiz kayıt varken durdu, dosyalar aynı', r1.hata.length === 1 && /özeti yok/.test(r1.hata[0]) && !r1.yazildi && once === sonra1);
    const r2 = yazDizin(k, dizin, { ozetEkle: true, bozuk });
    const oku = (tb) => JSON.parse(readFileSync(path.join(dizin, `${tb}.json`), 'utf8'));
    const a = oku('A');
    t('yaz --ozet-ekle: A yeni numaralarla, özet şimdiki en metninin',
      r2.yazildi && a.map((x) => x.id).join() === '2,3,4,6' && a.every((x) => x.en === enOzet(YENI.A[x.id])));
    t('yaz: boşalan tablonun (G) dosyası boş dizi', JSON.stringify(oku('G')) === '[]');
    const h = trHazirla(k, dizin);
    t('yazdıktan sonra: hata yok, taşıma gerekmiyor', h.hata.length === 0 && !h.s.degisti);
    // Kapı: özetsiz kayıt numarası kaymışken --ozet-ekle değişkenli Türkçeyi değişkensiz kayda koyar.
    const kH = { tablolar: ['H'], en: enKur({ H: { 1: 'Shield' } }), bilinenBicim: new Set() };
    const dH = mkdtempSync(path.join(kok, 'trH-'));
    dosyalaraYaz(dH, { H: { 1: ['Gain $p1.', '$p1 kazan.', 'ozetsiz'] } });
    const onceH = readFileSync(path.join(dH, 'H.json'), 'utf8');
    const rH = yazDizin(kH, dH, { ozetEkle: true, bozuk });
    t('yaz: kapı hatasında hiçbir şey yazılmadı', !rH.yazildi && rH.hata.some((x) => /değişken/.test(x)) && readFileSync(path.join(dH, 'H.json'), 'utf8') === onceH);
  } catch (e) {
    t('sınama koştu (' + e.message.split('\n')[0] + ')', false);
  } finally {
    rmSync(kok, { recursive: true, force: true });
  }
  return sonuc;
}

function sina(bozukMu) {
  const s = sinaKos('');
  for (const [ad, ok] of s) console.log(`${ok ? 'tamam' : 'DÜŞTÜ'}  ${ad}`);
  const gecen = s.filter((x) => x[1]).length;
  console.log(`ceviri-tasi sınama: ${gecen}/${s.length}`);
  const BOZMALAR = ['numara', 'belirsiz', 'ozetsiz', 'dusen', 'kapi', 'hepsi'];
  let yakalanan = 0;
  if (bozukMu) {
    for (const b of BOZMALAR) {
      const r = sinaKos(b);
      const dusen = r.filter((x) => !x[1]).map((x) => x[0]);
      if (dusen.length) { yakalanan++; console.log(`bozma "${b}": yakalandı (${dusen.length} test düştü: ${dusen.slice(0, 2).join(' · ')})`); }
      else console.log(`bozma "${b}": YAKALANMADI`);
    }
    console.log(`ceviri-tasi sabotaj: ${yakalanan}/${BOZMALAR.length} yakalandı`);
  }
  process.exit(gecen === s.length && (!bozukMu || yakalanan === BOZMALAR.length) ? 0 : 1);
}

// ---------------------------------------------------------------- komutlar
function liste(ad, l, n) {
  if (!l.length) return;
  console.log(`${ad} (${l.length}):`);
  for (const x of l.slice(0, n)) console.log('  ' + x);
  if (l.length > n) console.log(`  … ${l.length - n} tane daha`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const duz = args.filter((a) => !a.startsWith('--'));
  const kullanim = 'kullanım: node tools/ceviri-tasi.mjs durum <pck> <tr-dizini> | yaz <pck> <tr-dizini> [--ozet-ekle] | --sina [--bozuk]';
  try {
    if (args.includes('--sina')) sina(args.includes('--bozuk'));
    else if (['durum', 'yaz'].includes(duz[0]) && duz[1] && duz[2]) {
      const k = kapiKur(duz[1]);
      closeSync(k.pck.fd); // en tabloları okundu, paket gerekmiyor
      const r = duz[0] === 'durum' ? trHazirla(k, duz[2]) : yazDizin(k, duz[2], { ozetEkle: args.includes('--ozet-ekle') });
      if (r.s) console.log(tasimaSatiri(r.s));
      if (r.s) { liste('belirsiz (aynı İngilizceye iki farklı Türkçe)', r.s.belirsiz, 10); liste('düşen (Türkçesi vardı, İngilizcesi değişmiş ya da silinmiş)', r.s.dusen, 20); }
      for (const h of r.hata.slice(0, 20)) console.log('HATA: ' + h);
      if (r.hata.length) { console.log(`\n${r.hata.length} hata: ${duz[0] === 'yaz' ? 'hiçbir şey yazılmadı' : 'taşınamaz'}.`); process.exit(1); }
      const yenidenCevir = r.s.dusen.length || r.s.belirsiz.length
        ? `\nTürkçesi kalkan kayıtların İngilizcesi çevrilmeli: node tools/ceviri-parti.mjs sonraki ${duz[1]} ${duz[2]}` : '';
      if (duz[0] === 'durum') {
        if (r.s.degisti) { console.log(`taşıma gerekiyor: node tools/ceviri-tasi.mjs yaz ${duz[1]} ${duz[2]}${yenidenCevir}`); process.exit(3); }
        console.log('taşıma gerekmiyor: numaralar şimdiki oyunla aynı');
      } else console.log(r.yazildi ? `yazıldı: ${duz[2]}${yenidenCevir}` : 'taşıma gerekmiyor: dosyalara dokunulmadı');
    } else { console.log(kullanim); process.exit(2); }
  } catch (e) { console.log('HATA: ' + e.message); process.exit(1); }
}
