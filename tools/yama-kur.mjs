#!/usr/bin/env node
// Yama kurucu: Türkçe çeviri klasöründen pck'ye yazılacak yama klasörünü üretir.
//
// Akış:
//   <tr-dizini>/<Tablo>.json  ([{id, metin}], id en ile aynı; tools/bicim-kapisi.mjs ile aynı biçim)
//   → biçim kapısı: tek bir hata varsa durur, hiçbir şey yazmaz (uyarılar basılır, durdurmaz)
//   → her tablo Danca iskeletine yazılır (tools/ceviri-yaz.mjs): tr'de olan kayıt Türkçe,
//     olmayan kayıt İngilizce. tr'de dosyası olmayan tablo da yazılır (hepsi İngilizce);
//     böylece "Dansk" seçilince hiç Danca görünmez.
//   → geri okuma: üretilen her dosya çözülür, her kayıt beklenenle birebir mi
//   → <yama-dizini>/Sheets/CSV/<Tablo>.da.translation  (tools/pck-yama.mjs uygula bunu okur)
//
// Kullanım:
//   node tools/yama-kur.mjs kur <pck> <tr-dizini> <yama-dizini>
//   node tools/yama-kur.mjs dene <pck> <tr-dizini>   (geçici kopya pck'ye uygular, kopyadan geri
//                                                     okur, geri alır, siler; gerçek pck'ye yazmaz)
//   node tools/yama-kur.mjs --sina [--bozuk] <pck>
// Kütüphane: import { trOku, kur } from './yama-kur.mjs'

import {
  readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync, statSync,
  mkdtempSync, rmSync, copyFileSync, closeSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pckAc, rsrcOku, phashCoz } from './godot-ceviri.mjs';
import { phashYaz } from './ceviri-yaz.mjs';
import { kapiKur, denetle } from './bicim-kapisi.mjs';
import { uygula, geriAl, sha256, dogrula } from './pck-yama.mjs';

export const daYolu = (t) => `res://Sheets/CSV/${t}.da.translation`;

// <tr-dizini>/*.json → tr: Map<tablo, Map<id, metin>> · ham: Map<tablo, Map<id, {metin, en}>>
// (en: kaydın yazıldığı en metninin özeti, bicim-kapisi.mjs → enOzet; numarayla değil özetle
// eşlemek için: ceviri-tasi.mjs). Biçim bozuksa hata listesine yazar. Bu dosyanın kur/dene
// komutları numarayla eşler (taşımaz); kalıcı yol override-kur.mjs taşır.
export function trOku(dizin, tablolar) {
  const tr = new Map(), ham = new Map(), hata = [];
  const bilinen = new Set(tablolar);
  for (const ad of readdirSync(dizin).sort()) {
    if (!ad.endsWith('.json')) continue;
    const t = ad.slice(0, -5);
    if (!bilinen.has(t)) { hata.push(`${ad}: böyle tablo yok (olanlar: ${tablolar.join(', ')})`); continue; }
    let dizi;
    try { dizi = JSON.parse(readFileSync(path.join(dizin, ad), 'utf8').replace(/^\uFEFF/, '')); }
    catch (e) { hata.push(`${ad}: JSON okunamadı (${e.message})`); continue; }
    if (!Array.isArray(dizi)) { hata.push(`${ad}: [{id, metin}] dizisi değil`); continue; }
    const m = new Map(), h = new Map();
    for (const x of dizi) {
      if (!x || typeof x.id !== 'string' || typeof x.metin !== 'string') { hata.push(`${ad}: {id, metin} değil: ${JSON.stringify(x).slice(0, 80)}`); continue; }
      if (x.en !== undefined && !/^[0-9a-f]{16}$/.test(x.en)) { hata.push(`${t}:${x.id} en özeti 16 haneli onaltılık değil`); continue; }
      if (m.has(x.id)) hata.push(`${t}:${x.id} iki kez var`);
      m.set(x.id, x.metin);
      h.set(x.id, { metin: x.metin, en: x.en });
    }
    tr.set(t, m);
    ham.set(t, h);
  }
  return { tr, ham, hata };
}

// k: kapiKur(pck) sonucu. Dönüş: { hata, uyari, yamalar: Map<res yol, Buffer>, ozet }.
// Hata varsa yamalar boştur. yazimiBoz: sınama için bir kaydı bozuk yazar (geri okuma yakalamalı).
export function kur(k, tr, { bozuk = '', yazimiBoz = false } = {}) {
  const hata = [], uyari = [];
  for (const [t, m] of tr) {
    const enM = k.en.get(t);
    for (const [id, metin] of m) {
      const e = enM.get(id);
      if (e === undefined) { hata.push(`${t}:${id} en'de böyle kayıt yok`); continue; }
      if (!metin.trim() && e.trim()) { hata.push(`${t}:${id} boş çeviri (kaydı sil ya da doldur)`); continue; }
      const r = denetle(e, metin, k.bilinenBicim);
      for (const h of r.hata) hata.push(`${t}:${id} ${h}`);
      for (const u of r.uyari) uyari.push(`${t}:${id} ${u}`);
    }
  }
  const yamalar = new Map(), ozet = [];
  if (hata.length && bozuk !== 'kapi') return { hata, uyari, yamalar, ozet };
  const tablolar = bozuk === 'tablo' ? k.tablolar.filter((t) => tr.has(t)) : k.tablolar;
  for (const t of tablolar) {
    const enM = k.en.get(t), trM = tr.get(t) || new Map();
    const da = k.pck.oku(daYolu(t));
    const daM = bozuk === 'dusme' ? new Map(phashCoz(rsrcOku(da)).kayitlar.map((x) => [x.id, x.metin])) : null;
    const bek = new Map();
    let bozulan = yazimiBoz;
    const { dosya } = phashYaz(da, (id) => {
      const v = trM.has(id) ? trM.get(id) : daM ? daM.get(id) : enM.get(id);
      if (v === undefined) throw new Error(`${t}:${id} iskelette var, en'de yok`);
      bek.set(id, v);
      if (bozulan) { bozulan = false; return v + '!'; }
      return v;
    });
    // Geri okuma: yazılan dosya çözülür, her kayıt beklenenle birebir olmalı.
    if (bozuk !== 'gerioku') {
      const c = phashCoz(rsrcOku(dosya));
      const daLocale = phashCoz(rsrcOku(da)).locale;
      const yanlis = c.kayitlar.filter((x) => x.metin !== bek.get(x.id));
      if (c.uyumsuz) hata.push(`${t}: geri okumada ${c.uyumsuz} uyumsuz kayıt`);
      if (c.kayitlar.length !== bek.size) hata.push(`${t}: geri okumada ${c.kayitlar.length} kayıt, beklenen ${bek.size}`);
      if (yanlis.length) hata.push(`${t}: geri okumada ${yanlis.length} kayıt beklenenden farklı (ilki ${yanlis[0].id})`);
      if (c.locale !== daLocale) hata.push(`${t}: locale değişti (${daLocale} → ${c.locale})`);
    }
    yamalar.set(daYolu(t), dosya);
    ozet.push({ tablo: t, turkce: [...bek.keys()].filter((id) => trM.has(id)).length, toplam: bek.size, bayt: dosya.length });
  }
  if (hata.length && bozuk !== 'kapi') return { hata, uyari, yamalar: new Map(), ozet: [] };
  return { hata, uyari, yamalar, ozet };
}

// Yama klasörüne yazar. Klasörde bu kurun yazmayacağı bir dosya varsa durur
// (pck-yama.mjs klasördeki her dosyayı uygular; unutulmuş bir dosya pakete girmesin).
export function yamaYaz(yamalar, dizin) {
  const hedef = new Map([...yamalar].map(([y, v]) => [path.join(dizin, ...y.replace(/^res:\/\//, '').split('/')), v]));
  if (existsSync(dizin)) {
    const fazla = [];
    const gez = (d) => { for (const ad of readdirSync(d)) { const tam = path.join(d, ad); if (statSync(tam).isDirectory()) gez(tam); else if (!hedef.has(tam)) fazla.push(tam); } };
    gez(dizin);
    if (fazla.length) throw new Error(`yama klasöründe bu kurun yazmayacağı dosya var, dokunmadım:\n  ${fazla.slice(0, 5).join('\n  ')}`);
  }
  for (const [tam, v] of hedef) { mkdirSync(path.dirname(tam), { recursive: true }); writeFileSync(tam, v); }
  return [...hedef.keys()];
}

// Geçici kopya pck'ye uygular, kopyadan okur, geri alır. Beklenen metin kurdan bağımsız
// hesaplanır: tr'de varsa tr, yoksa en.
export function kopyadaDene(pckYolu, k, tr, yamalar) {
  const sonuc = [];
  const t = (ad, kosul) => sonuc.push([ad, !!kosul]);
  const kok = mkdtempSync(path.join(os.tmpdir(), 'yama-kur-'));
  const kopya = path.join(kok, 'BackpackBattles.pck');
  if (path.resolve(kopya) === path.resolve(pckYolu)) throw new Error('kopya gerçek pck ile aynı yol');
  try {
    copyFileSync(pckYolu, kopya);
    const once = sha256(kopya);
    uygula(kopya, yamalar);
    const d = dogrula(kopya);
    t('kopya: md5 tutarlı, hizasız/üst üste yok', d.md5Hata.length === 0 && d.ust === 0 && d.hizasiz === 0);
    const p = pckAc(kopya);
    try {
      t('kopya: bütün tablolar yamalı', k.tablolar.every((tb) => yamalar.has(daYolu(tb))));
      let uyumsuz = 0, yanlis = 0, turkce = 0, ilkYanlis = '';
      for (const tb of k.tablolar) {
        const enM = k.en.get(tb), trM = tr.get(tb) || new Map();
        const c = phashCoz(rsrcOku(p.oku(daYolu(tb))));
        uyumsuz += c.uyumsuz;
        for (const x of c.kayitlar) {
          const bek = trM.has(x.id) ? trM.get(x.id) : enM.get(x.id);
          if (x.metin !== bek) { yanlis++; ilkYanlis ||= `${tb}:${x.id}`; }
          else if (trM.has(x.id)) turkce++;
        }
        if (c.kayitlar.length !== enM.size) yanlis++;
      }
      const trToplam = [...tr.values()].reduce((s, m) => s + m.size, 0);
      t('kopya: uyumsuz kayıt 0', uyumsuz === 0);
      t(`kopya: her kayıt Türkçe ya da en ile aynı${ilkYanlis ? ' (ilk yanlış ' + ilkYanlis + ')' : ''}`, yanlis === 0);
      t(`kopya: Türkçe kayıtların hepsi geri okundu (${turkce}/${trToplam})`, turkce === trToplam);
    } finally { closeSync(p.fd); }
    const g = geriAl(kopya);
    t('kopya: geri alındı, sha256 orijinal', g.yontem === 'kayıttan' && sha256(kopya) === once);
  } finally {
    rmSync(kok, { recursive: true, force: true });
  }
  return sonuc;
}

// ---------------------------------------------------------------- sınama
const TR_ORNEK = 'Çığ düştü: İşçi ağır şövalye ÇĞİÖŞÜ âîû ';

function sinaTr(k) {
  // Her tablodan ilk, ortadaki ve biçim kodlu ilk kayıt Türkçe; Flavor tablosunun dosyası yok
  // (dosyası olmayan tablo da yamaya girmeli, hepsi en).
  const tr = new Map();
  for (const t of k.tablolar) {
    if (t === 'Flavor') continue;
    const kay = [...k.en.get(t)];
    const sec = [kay[0], kay[kay.length >> 1], kay.find(([, m]) => /\$[a-z]/.test(m))].filter(Boolean);
    tr.set(t, new Map(sec.map(([id, m]) => [id, TR_ORNEK + m])));
  }
  return tr;
}

function sinaKos(pckYolu, k, bozuk) {
  const sonuc = [];
  const t = (ad, kosul) => sonuc.push([ad, !!kosul]);
  try {
    const tr = sinaTr(k);
    t('sınama verisi: Flavor dışarıda, öteki tablolar var', !tr.has('Flavor') && tr.size === k.tablolar.length - 1);
    const r = kur(k, tr, { bozuk });
    t('kur: hata yok', r.hata.length === 0);
    t('kur: bütün tablolar yamada (dosyası olmayan dahil)', r.yamalar.size === k.tablolar.length);
    // Kurdan bağımsız beklenti: tr'de varsa tr, yoksa en.
    let dogru = true;
    for (const [y, dosya] of r.yamalar) {
      const tb = y.match(/CSV\/(\w+)\.da/)[1];
      const trM = tr.get(tb) || new Map(), enM = k.en.get(tb);
      for (const x of phashCoz(rsrcOku(dosya)).kayitlar) if (x.metin !== (trM.has(x.id) ? trM.get(x.id) : enM.get(x.id))) dogru = false;
    }
    t('kur: tr kaydı Türkçe, öteki kayıt en', dogru && r.yamalar.size > 0);

    // Kapı: yasak çeviriler yamaya giremez.
    const ilk = (re) => { for (const [tb, m] of k.en) for (const [id, e] of m) if (re.test(e)) return [tb, id, e]; };
    const [tb1, id1, e1] = ilk(/\$p1\b/);
    const reddet = (tb, id, metin) => { const x = kur(k, new Map([[tb, new Map([[id, metin]])]]), { bozuk }); return x.hata.length > 0 && x.yamalar.size === 0; };
    t('kapı: değişkeni silinmiş çeviri reddedildi', reddet(tb1, id1, e1.replace('$p1', '5')));
    t('kapı: en\'de olmayan kimlik reddedildi', reddet(tb1, '99999.9', 'deneme'));
    t('kapı: boş çeviri reddedildi', reddet(tb1, id1, '  '));
    // Geri okuma: bir kaydı bozuk yazılan kur hata vermeli.
    const rb = kur(k, tr, { bozuk, yazimiBoz: true });
    t('geri okuma: bozuk yazılan kayıt yakalandı', rb.hata.some((h) => /geri okumada/.test(h)) && rb.yamalar.size === 0);

    // trOku: biçim hataları
    const gd = mkdtempSync(path.join(os.tmpdir(), 'yama-kur-tr-'));
    try {
      writeFileSync(path.join(gd, 'Items.json'), '\uFEFF' + JSON.stringify([{ id: '1.0', metin: 'a' }, { id: '1.0', metin: 'b' }]));
      writeFileSync(path.join(gd, 'Yok.json'), '[]');
      writeFileSync(path.join(gd, 'Dialog.json'), '{bozuk');
      const o = trOku(gd, k.tablolar);
      t('trOku: BOM\'lu dosya okundu', o.tr.has('Items'));
      t('trOku: aynı kimlik iki kez → hata', o.hata.some((h) => /iki kez/.test(h)));
      t('trOku: bilinmeyen tablo → hata', o.hata.some((h) => /Yok\.json/.test(h)));
      t('trOku: bozuk JSON → hata', o.hata.some((h) => /Dialog\.json: JSON/.test(h)));
      // yamaYaz: klasörde yabancı dosya varsa durur
      let ret = '';
      try { yamaYaz(new Map([['res://Sheets/CSV/X.da.translation', Buffer.from('x')]]), gd); } catch (e) { ret = e.message; }
      t('yamaYaz: yabancı dosyalı klasöre yazmadı', /dokunmadım/.test(ret) && !existsSync(path.join(gd, 'Sheets')));
    } finally { rmSync(gd, { recursive: true, force: true }); }

    // Uçtan uca: geçici kopya pck
    if (r.yamalar.size) for (const x of kopyadaDene(pckYolu, k, tr, r.yamalar)) sonuc.push(x);
    else t('kopya: denenecek yama var', false);
  } catch (e) {
    t('sınama koştu (' + e.message.split('\n')[0] + ')', false);
  }
  return sonuc;
}

function sina(pckYolu, bozukMu) {
  const once = sha256(pckYolu);
  const k = kapiKur(pckYolu);
  const ozet = (b) => { const s = sinaKos(pckYolu, k, b); return { gecen: s.filter((x) => x[1]).length, toplam: s.length, dusen: s.filter((x) => !x[1]).map((x) => x[0]) }; };
  const s = ozet('');
  for (const ad of s.dusen) console.log('DÜŞTÜ:', ad);
  console.log(`yama-kur sınama: ${s.gecen}/${s.toplam}`);
  let yakalanan = 0;
  const BOZMALAR = ['kapi', 'dusme', 'tablo', 'gerioku'];
  if (bozukMu) {
    for (const b of BOZMALAR) {
      const r = ozet(b);
      if (r.gecen < r.toplam) { yakalanan++; console.log(`bozma "${b}": yakalandı (${r.toplam - r.gecen} test düştü: ${r.dusen.slice(0, 3).join(' · ')})`); }
      else console.log(`bozma "${b}": YAKALANMADI`);
    }
    console.log(`yama-kur sabotaj: ${yakalanan}/${BOZMALAR.length} yakalandı`);
  }
  closeSync(k.pck.fd);
  const ayni = sha256(pckYolu) === once;
  console.log(`gerçek pck sha256 sınamadan önce ve sonra ${ayni ? 'aynı' : 'FARKLI'}`);
  process.exit(s.gecen === s.toplam && ayni && (!bozukMu || yakalanan === BOZMALAR.length) ? 0 : 1);
}

// ---------------------------------------------------------------- komutlar
function hazirla(pckYolu, trDizin) {
  const k = kapiKur(pckYolu);
  const o = trOku(trDizin, k.tablolar);
  const r = o.hata.length ? { hata: o.hata, uyari: [], yamalar: new Map(), ozet: [] } : kur(k, o.tr);
  for (const u of r.uyari) console.log('uyarı: ' + u);
  for (const h of r.hata) console.log('HATA: ' + h);
  if (r.hata.length) { console.log(`\n${r.hata.length} hata: yama üretilmedi.`); closeSync(k.pck.fd); process.exit(1); }
  for (const z of r.ozet) console.log(`  ${z.tablo.padEnd(15)} Türkçe ${String(z.turkce).padStart(4)} / ${String(z.toplam).padStart(4)} kayıt · ${z.bayt} bayt`);
  return { k, tr: o.tr, r };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const duz = args.filter((a) => !a.startsWith('--'));
  try {
    if (args.includes('--sina') && duz[0]) sina(duz[0], args.includes('--bozuk'));
    else if (duz[0] === 'kur' && duz[1] && duz[2] && duz[3]) {
      const { k, r } = hazirla(duz[1], duz[2]);
      const yazilan = yamaYaz(r.yamalar, duz[3]);
      closeSync(k.pck.fd);
      console.log(`yama klasörü: ${duz[3]} (${yazilan.length} dosya, ${r.uyari.length} uyarı)`);
    } else if (duz[0] === 'dene' && duz[1] && duz[2]) {
      const once = sha256(duz[1]);
      const { k, tr, r } = hazirla(duz[1], duz[2]);
      const s = kopyadaDene(duz[1], k, tr, r.yamalar);
      closeSync(k.pck.fd);
      for (const [ad, ok] of s) console.log(`${ok ? 'tamam' : 'DÜŞTÜ'}  ${ad}`);
      const ayni = sha256(duz[1]) === once;
      console.log(`gerçek pck sha256 önce ve sonra ${ayni ? 'aynı' : 'FARKLI'}`);
      process.exit(s.every((x) => x[1]) && ayni ? 0 : 1);
    } else {
      console.log('kullanım: node tools/yama-kur.mjs kur <pck> <tr-dizini> <yama-dizini> | dene <pck> <tr-dizini> | --sina [--bozuk] <pck>');
      process.exit(2);
    }
  } catch (e) { console.log('HATA: ' + e.message); process.exit(1); }
}
