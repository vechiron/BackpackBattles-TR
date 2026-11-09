#!/usr/bin/env node
// Çeviri hacmi: kaç metin, kaç çevrilecek kelime, hangi türde; bir tr dizini verilirse kalan iş.
//
// Sayım birimi benzersiz en metnidir (aynı metin birden çok kayıtta geçse de bir kez çevrilir).
// Tür, anahtardan (tools/anahtar-coz.mjs → coz) çıkar; anahtarı çözülmemiş kayıtta tablonun
// adından. Aynı metin birden çok türde geçerse belirli tür "karışık"tan önce gelir.
// "Çevrilecek kelime": biçim kodları düşülünce kalan harfli parçalar (değişken kökü, $ad[ ve ],
// \~, {yer_tutucu} düşer; $holy-item'in tire eki "item" çevrildiği için kalır).
// "Hiçbir dil çevirmemiş": pakette o tablonun bulunduğu her dilde boş ya da en ile aynı
// (özel ad, kod adı ya da unutulmuş metin olabilir; Türkçede ne olacağı karar işi).
// tr dizini: <Tablo>.json = [{id, metin}]. Bir metin "çevrilmiş" = en az bir kaydında tr dolu
// (trDolu). Dosyaya yazılmış kayıt karar verilmiş sayılır: en ile aynıysa "bilerek aynı" (özel ad:
// Cthulhu, Goobert, Katana…) ve ayrıca sayılır. Kural tek yerde (trDolu); ceviri-parti buradan alır.
// "Kopyalanmamış tekrar" = çevrilmiş ama aynı metnin başka bir kaydında tr yok.
//
// Kullanım: node tools/metin-olc.mjs <pck> [tr-dizini]
//           node tools/metin-olc.mjs --sina [--bozuk]      (sahte veriyle, pck gerekmez)
// Kütüphane: import { olc, duzMetin } from './metin-olc.mjs'

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TURLER = ['eşya adı', 'eşya etkisi', 'eşya hikâyesi', 'anahtar kelime', 'arayüz', 'eğitim', 'konuşma', 'eşya (anahtarsız)', 'karışık'];
const TABLO_TURU = { Interface: 'arayüz', Dialog: 'konuşma', Keywords: 'anahtar kelime', Flavor: 'eşya hikâyesi', Items: 'eşya (anahtarsız)', ExclusiveItems: 'eşya (anahtarsız)', Full: 'karışık' };
const DUSUK = new Set(['eşya (anahtarsız)', 'karışık']);

export function tur(tablo, anahtar) {
  if (anahtar) {
    if (/^TUTORIAL_/.test(anahtar)) return 'eğitim';
    if (/^(UI|LABEL)_/.test(anahtar)) return 'arayüz';
    if (tablo === 'Keywords' || /^[a-z]/.test(anahtar)) return 'anahtar kelime';
    if (/_NAME$/.test(anahtar)) return 'eşya adı';
    if (/_DESCR$/.test(anahtar)) return 'eşya etkisi';
    if (/_FLAVOR$/.test(anahtar)) return 'eşya hikâyesi';
  }
  return TABLO_TURU[tablo] || 'karışık';
}

// Biçim kodlarını düşer. Desen bicim-kapisi.mjs → DEG ile aynı ek tanımını kullanır.
export function duzMetin(m, { bozuk = '' } = {}) {
  if (bozuk === 'kod') return m;
  return m
    .replace(/\{[^{}]*\}/g, ' ')
    .replace(/\$[A-Za-z_][A-Za-z0-9_]*(?:-([^\s\[\].,:;!?()$%]+))?\[?/g, (_, ek) => (ek ? ` ${ek} ` : ' '))
    .replace(/\\~/g, ' ')
    .replace(/[\[\]]/g, ' ');
}
const kelimeler = (s) => s.match(/\p{L}[\p{L}\p{N}'’-]*/gu) || [];
// Harfsiz metin ("???", "_", " ($num)") çevrilmez, kalan sayılmaz; ceviri-parti de buradan alır.
export const harfsizMi = (m) => !kelimeler(duzMetin(m)).length;

// tr kaydı dolu mu (= karar verilmiş). en ile aynı metin de doludur: bilerek aynı bırakılmıştır.
// bozuk 'ayni': eski kural (en ile aynı çevrilmemiş sayılır); sınama bunu yakalamalı.
export const trDolu = (m, en = null, { bozuk = '' } = {}) => typeof m === 'string' && m.trim() !== '' && !(bozuk === 'ayni' && m === en);

// en: Map(tablo → [{id, metin}]) · anahtar: Map("tablo id" → anahtar dizgisi)
// diller: Map(dil → Map(tablo → Map(id → metin))) (yalnızca pakette bulunan tablolar)
// tr: null | Map(tablo → Map(id → metin))
export function olc({ en, anahtar, diller, tr = null }, { bozuk = '' } = {}) {
  const metinler = new Map(); // metin → { tur, kayitlar: [[tablo, id]] }
  let kayitSayisi = 0;
  for (const [t, kayitlar] of en) for (const { id, metin } of kayitlar) {
    kayitSayisi++;
    if (!metin.trim()) continue;
    const a = anahtar.get(`${t} ${id}`);
    const tr0 = tur(t, Array.isArray(a) ? null : a);
    const anah = bozuk === 'tekil' ? `${t} ${id}` : metin;
    const v = metinler.get(anah);
    if (!v) { metinler.set(anah, { metin, tur: tr0, kayitlar: [[t, id]] }); continue; }
    v.kayitlar.push([t, id]);
    if (bozuk !== 'oncelik' && DUSUK.has(v.tur) && !DUSUK.has(tr0)) v.tur = tr0;
  }
  const satir = () => ({ metin: 0, kelime: 0, hamKelime: 0, karakter: 0, harfsiz: 0, cevrilmemis: 0, bitti: 0, ayni: 0, kalan: 0, kalanKelime: 0, kalanCevrilmemis: 0 });
  const tablo = new Map(TURLER.map((x) => [x, satir()]));
  let kopyasiz = 0;
  const kopyasizOrnek = [];
  for (const v of metinler.values()) {
    const s = tablo.get(v.tur);
    const duz = duzMetin(v.metin, { bozuk });
    const k = kelimeler(duz);
    s.metin++;
    s.hamKelime += (v.metin.match(/\S+/g) || []).length;
    s.kelime += k.length;
    s.karakter += k.join(' ').length;
    if (!k.length) { s.harfsiz++; continue; }
    const hicbiri = [...diller.values()].every((dt) => v.kayitlar.every(([t, id]) => {
      const m = dt.get(t)?.get(id);
      return m === undefined || !m.trim() || m === v.metin;
    })) && [...diller.values()].some((dt) => v.kayitlar.some(([t]) => dt.has(t)));
    if (hicbiri) s.cevrilmemis++;
    if (!tr) continue;
    const trler = v.kayitlar.map(([t, id]) => tr.get(t)?.get(id));
    const durum = trler.map((m) => trDolu(m, v.metin, { bozuk }));
    const bakilan = bozuk === 'kopya' ? durum.slice(0, 1) : durum;
    if (bakilan.some(Boolean)) {
      s.bitti++;
      if (trler.filter((_, i) => durum[i]).every((m) => m === v.metin)) s.ayni++;
      if (!bakilan.every(Boolean)) { kopyasiz++; if (kopyasizOrnek.length < 5) kopyasizOrnek.push(v.kayitlar.filter((_, i) => !durum[i]).map((x) => x.join(' ')).join(', ')); }
    } else { s.kalan++; s.kalanKelime += k.length; if (hicbiri) s.kalanCevrilmemis++; }
  }
  const toplam = satir();
  for (const s of tablo.values()) for (const a in toplam) toplam[a] += s[a];
  return { tablo, toplam, kayitSayisi, kopyasiz, kopyasizOrnek, trVar: !!tr };
}

function bas(r) {
  const tr = r.trVar;
  const bas1 = ['tür'.padEnd(18), 'metin', 'kelime', 'ham kel.', 'harfsiz', 'hiç çevrilmemiş'];
  if (tr) bas1.push('çevrildi', 'b.aynı', 'kalan', 'kalan kel.');
  console.log(bas1.map((x, i) => (i ? x.padStart(Math.max(8, x.length)) : x)).join(' '));
  const yaz = (ad, s) => {
    const h = [ad.padEnd(18), s.metin, s.kelime, s.hamKelime, s.harfsiz, s.cevrilmemis];
    if (tr) h.push(s.bitti, s.ayni, s.kalan, s.kalanKelime);
    console.log(h.map((x, i) => (i ? String(x).padStart(Math.max(8, bas1[i].length)) : x)).join(' '));
  };
  for (const [ad, s] of r.tablo) if (s.metin) yaz(ad, s);
  yaz('toplam', r.toplam);
  console.log(`kayıt ${r.kayitSayisi} · benzersiz dolu metin ${r.toplam.metin} · çevrilecek karakter ${r.toplam.karakter}`);
  if (tr) {
    console.log(`çevrildi içinde bilerek aynı (b.aynı: tr dosyasında en ile aynı yazılmış): ${r.toplam.ayni}`);
    console.log(`kalan içinde hiçbir dilin çevirmediği: ${r.toplam.kalanCevrilmemis}`);
    console.log(`kopyalanmamış tekrar (çevrilmiş metnin tr'si eksik kaydı var): ${r.kopyasiz}`);
    for (const o of r.kopyasizOrnek) console.log(`   eksik: ${o}`);
  }
}

async function gercek(pckYolu, trDizin) {
  const { kapiKur } = await import('./bicim-kapisi.mjs');
  const { coz } = await import('./anahtar-coz.mjs');
  const k = kapiKur(pckYolu);
  const en = new Map(k.tablolar.map((t) => [t, [...k.en.get(t)].map(([id, metin]) => ({ id, metin }))]));
  const anahtar = new Map();
  for (const [yer, s] of coz(k.pck).anahtar) anahtar.set(yer, s.size === 1 ? [...s][0] : [...s]);
  const diller = new Map(k.diller.map((d) => [d, new Map(k.tablolar.filter((t) => k.var(t, d)).map((t) => [t, new Map(k.cozuk(t, d).map((x) => [x.id, x.metin]))]))]));
  let tr = null;
  if (trDizin) {
    if (!existsSync(trDizin)) { console.log(`tr dizini yok: ${trDizin}`); process.exit(2); }
    tr = new Map();
    for (const t of k.tablolar) {
      const y = path.join(trDizin, `${t}.json`);
      if (existsSync(y)) tr.set(t, new Map(JSON.parse(readFileSync(y, 'utf8')).map((x) => [x.id, x.metin])));
    }
  }
  console.log(`diller (karşılaştırılan): ${k.diller.join(' ')}${tr ? ` · tr: ${trDizin} (${tr.size} tablo)` : ''}`);
  bas(olc({ en, anahtar, diller, tr }));
}

// ---------------------------------------------------------------- sınama
// Beklenen sayılar elle hesaplandı (her satırın gerekçesi yanında).
function sinaVerisi() {
  const en = new Map([
    ['Full', [{ id: '9', metin: 'Banana' }, { id: '10', metin: 'Hello {name}' }, { id: '11', metin: '' }]],
    ['Items', [{ id: '1', metin: 'Banana' }, { id: '2', metin: '$t[Every $cds:] Heal for $p1 $holy-item.' }, { id: '3', metin: '123 %' }]],
    ['Keywords', [{ id: '5', metin: 'Heat' }]],
  ]);
  const anahtar = new Map([['Items 1', 'Banana_NAME'], ['Items 2', 'Banana_DESCR'], ['Keywords 5', 'heat_NAME']]);
  const diller = new Map([
    ['da', new Map([['Full', new Map([['9', 'Banan'], ['10', 'Hej {name}']])], ['Items', new Map([['1', 'Banan'], ['2', 'x'], ['3', '123 %']])], ['Keywords', new Map([['5', 'Heat']])]])],
    ['de', new Map([['Items', new Map([['1', 'Banane']])], ['Keywords', new Map([['5', '']])]])],
  ]);
  // Items 2 en ile aynı = bilerek aynı (çevrilmiş sayılır) · Keywords 5 yalnızca boşluk = boş.
  const tr = new Map([['Items', new Map([['1', 'Muz'], ['2', '$t[Every $cds:] Heal for $p1 $holy-item.']])], ['Keywords', new Map([['5', '  ']])]]);
  return { en, anahtar, diller, tr };
}
function sina(bozuk) {
  const v = sinaVerisi();
  const r = olc(v, { bozuk });
  const s = (t) => r.tablo.get(t);
  const d = [
    ['kayıt sayısı 7 (boş dahil)', r.kayitSayisi === 7],
    ['benzersiz dolu metin 5 (Banana iki kez, boş metin sayılmaz)', r.toplam.metin === 5],
    ['Banana eşya adı (Full "karışık"tan önce)', s('eşya adı').metin === 1 && s('karışık').metin === 1],
    ['eşya etkisi kelimesi 4: Every Heal for item (kodlar düşer, tire eki kalır)', s('eşya etkisi').kelime === 4],
    ['eşya etkisi ham kelime 6 (boşlukla bölünmüş parça)', s('eşya etkisi').hamKelime === 6],
    ['"123 %" harfsiz, eşya (anahtarsız)', s('eşya (anahtarsız)').harfsiz === 1],
    ['"Hello {name}" 1 kelime (yer tutucu düşer)', s('karışık').kelime === 1],
    ['Heat hiçbir dilde çevrilmemiş (da aynı, de boş); Banana çevrilmiş', s('anahtar kelime').cevrilmemis === 1 && s('eşya adı').cevrilmemis === 0],
    ['çevrildi 2 (Banana; etki en ile aynı yazılmış = bilerek aynı, çevrilmiş sayılır)', r.toplam.bitti === 2],
    ['bilerek aynı 1 (etki; Banana sayılmaz)', r.toplam.ayni === 1 && s('eşya etkisi').ayni === 1],
    ['kalan 2 (Hello, Heat; yalnızca boşluk boş sayılır; harfsiz kalan sayılmaz)', r.toplam.kalan === 2],
    ['kalan kelime 1+1=2', r.toplam.kalanKelime === 2],
    ['kalan içinde hiç çevrilmemiş 1 (Heat)', r.toplam.kalanCevrilmemis === 1],
    ['kopyalanmamış tekrar 1 (Banana: Full 9 eksik)', r.kopyasiz === 1 && r.kopyasizOrnek[0] === 'Full 9'],
    ['tr olmadan kalan sütunları 0', (() => { const q = olc({ ...v, tr: null }); return !q.trVar && q.toplam.kalan === 0 && q.toplam.metin === 5; })()],
  ];
  let ok = 0;
  for (const [ad, sonuc] of d) { if (sonuc) ok++; if (!bozuk) console.log(`${sonuc ? 'TAMAM' : 'HATA '} ${ad}`); }
  return { ok, n: d.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv.slice(2);
  if (arg[0] === '--sina') {
    if (arg.includes('--bozuk')) {
      // Her bozma en az bir denetimi düşürmeli; düşürmezse sınama o hatayı görmüyor demektir.
      // Ölçüt temiz sınamaya göre: temiz sınama düşerken bozma "yakalandı" görünmesin.
      const BOZUK = ['tekil', 'kod', 'oncelik', 'kopya', 'ayni'];
      const temiz = sina('').ok;
      let yakalanan = 0;
      for (const b of BOZUK) { const { ok, n } = sina(b); const y = ok < temiz; if (y) yakalanan++; console.log(`${y ? 'yakalandı' : 'KAÇTI    '} ${b} (${ok}/${n} geçti, temiz ${temiz})`); }
      console.log(`karşı test: ${yakalanan}/${BOZUK.length}`);
      process.exit(yakalanan === BOZUK.length ? 0 : 1);
    }
    const { ok, n } = sina('');
    console.log(`sınama: ${ok}/${n}`);
    process.exit(ok === n ? 0 : 1);
  }
  if (!arg[0]) { console.log('kullanım: node tools/metin-olc.mjs <pck> [tr-dizini] · --sina [--bozuk]'); process.exit(2); }
  await gercek(arg[0], arg[1]);
}
