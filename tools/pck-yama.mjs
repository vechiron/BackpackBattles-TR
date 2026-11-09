#!/usr/bin/env node
// Pck yamalayıcı: paketteki var olan dosyaların içeriğini değiştirir, geri alınabilir.
//
// Yöntem (08.11.2026 ölçümü: BackpackBattles.pck, 9370 girdi):
//   - Dizindeki md5 = dosya içeriğinin md5'i (125/125 örnek). Yama md5'i de
//     günceller; Godot denetlese de denetlemese de tutarlı kalır.
//   - Ofsetler 16 bayta hizalı (9370/9370), aradaki boşluk en fazla 15 bayt
//     dolgu, dosya sonu da 16'nın katı. Eklenen veri aynı kuralla dizilir.
//   - Yeni içerik dosyanın SONUNA eklenir; dizinde yalnızca o girdinin
//     ofset(8) + boyut(8) + md5(16) alanı değişir. Eski veri yerinde kalır.
//     Böylece geri alma = dosyayı eski boyuna kesmek + 32 baytı geri yazmak.
//   - İlk yamada tam yedek: <pck>.orijinal (sha256 ile doğrulanmış).
//   - Kayıt: <pck>.yama.json (orijinal boyut/sha256, eski dizin alanları,
//     yamalı hâlin sha256'sı). Yeniden uygulama önce geri alır, dosya büyümez.
//   - Geri alma dosyanın kimliğine bakar: yamalı hâlimizse kayıttan geri alır;
//     yarım kalmış yamaysa yedekten döner; ikisi de değilse (ör. Steam
//     güncelledi) dokunmaz ve söyler.
// Yeni dosya EKLEMEZ: dizin büyür, bütün ofsetler kayar (ayrı iş).
//
// Kullanım:
//   node tools/pck-yama.mjs uygula <pck> <yama-dizini>
//       <yama-dizini>/Sheets/CSV/X.da.translation → res://Sheets/CSV/X.da.translation
//   node tools/pck-yama.mjs geri <pck>
//   node tools/pck-yama.mjs durum <pck>
//   node tools/pck-yama.mjs --sina [--bozuk] <pck>   (kopya üzerinde; gerçek pck'ye yazmaz)

import {
  openSync, readSync, writeSync, fsyncSync, closeSync, ftruncateSync, fstatSync,
  copyFileSync, existsSync, readFileSync, writeFileSync, unlinkSync, renameSync,
  readdirSync, statSync, mkdtempSync, rmSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pckAc, rsrcOku, phashCoz } from './godot-ceviri.mjs';
import { phashYaz } from './ceviri-yaz.mjs';

const HIZA = 16;
export const kayitYolu = (pck) => pck + '.yama.json';
export const yedekYolu = (pck) => pck + '.orijinal';
const md5 = (b) => createHash('md5').update(b).digest('hex');
const hizala = (n) => Math.ceil(n / HIZA) * HIZA;

export function sha256(yol) {
  const fd = openSync(yol, 'r');
  const h = createHash('sha256');
  const b = Buffer.alloc(4 << 20);
  let n, konum = 0;
  while ((n = readSync(fd, b, 0, b.length, konum)) > 0) { h.update(b.subarray(0, n)); konum += n; }
  closeSync(fd);
  return h.digest('hex');
}

function dizinAc(yol) {
  const p = pckAc(yol);
  const boyut = fstatSync(p.fd).size;
  return { ...p, boyut, kapat: () => closeSync(p.fd) };
}

function jsonYaz(yol, veri) {
  writeFileSync(yol + '.yaziliyor', JSON.stringify(veri, null, 1));
  renameSync(yol + '.yaziliyor', yol);
}

function dizinAlani(ofset, boyut, md5hex) {
  const b = Buffer.alloc(32);
  b.writeBigUInt64LE(BigInt(ofset), 0);
  b.writeBigUInt64LE(BigInt(boyut), 8);
  Buffer.from(md5hex, 'hex').copy(b, 16);
  return b;
}

// Tutarlılık: her girdinin md5'i içerikle aynı mı, üst üste binen / hizasız
// girdi var mı, dizinin göstermediği >=16 baytlık bölge (yetim) var mı.
// Orijinal pck'de yetim 0; yamalı pck'de eski içeriğin yeri yetim kalır.
export function dogrula(yol) {
  const p = dizinAc(yol);
  const g = [...p.girdiler.values()].sort((a, b) => a.ofset - b.ofset);
  const md5Hata = [];
  let yetim = 0, ust = 0, hizasiz = 0, imlec = p.dizinSonu;
  for (const x of g) {
    const ara = x.ofset - imlec;
    if (ara < 0) ust++; else if (ara >= HIZA) yetim++;
    if (x.ofset % HIZA) hizasiz++;
    if (md5(p.oku(x.yol)) !== x.md5) md5Hata.push(x.yol);
    imlec = Math.max(imlec, x.ofset + x.boyut);
  }
  if (p.boyut - imlec >= HIZA) yetim++;
  p.kapat();
  return { girdi: g.length, boyut: p.boyut, md5Hata, yetim, ust, hizasiz, sonHizali: p.boyut % HIZA === 0 };
}

export function oyunAcikMi() {
  if (process.platform !== 'win32') return false;
  try {
    // Tam yol: PATH'te System32 yoksa 'tasklist' bulunamaz, catch oyunu sessizce "kapalı" sayardı.
    const tasklist = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tasklist.exe');
    const c = execFileSync(tasklist, ['/FI', 'IMAGENAME eq BackpackBattles.exe', '/NH'], { encoding: 'utf8', windowsHide: true });
    return /BackpackBattles\.exe/i.test(c);
  } catch { return false; }
}

// Geri alma. Dönüş: { yontem: 'yamasiz' | 'zaten orijinal' | 'kayıttan' | 'yedekten' }
export function geriAl(yol, { bozuk = '' } = {}) {
  const ky = kayitYolu(yol);
  if (!existsSync(ky)) return { yontem: 'yamasiz' };
  const kayit = JSON.parse(readFileSync(ky, 'utf8'));
  const simdi = sha256(yol);
  let yontem = null;
  if (simdi === kayit.orijinal.sha256) yontem = 'zaten orijinal';
  else if (kayit.durum === 'tamam' && simdi === kayit.yamali.sha256) {
    const fd = openSync(yol, 'r+');
    for (const g of kayit.girdiler) writeSync(fd, dizinAlani(g.ofset, g.boyut, g.md5), 0, 32, g.dizinYeri);
    if (bozuk !== 'kesme') ftruncateSync(fd, kayit.orijinal.boyut);
    fsyncSync(fd);
    closeSync(fd);
    if (sha256(yol) === kayit.orijinal.sha256) yontem = 'kayıttan';
  } else if (kayit.durum !== 'yarim') {
    throw new Error('pck ne orijinal ne bizim yamalı hâlimiz (Steam güncellemiş olabilir). Dokunmadım.\n'
      + `  Yeni sürümse eski kaydı ve yedeği kaldır: ${path.basename(ky)} · ${path.basename(yedekYolu(yol))}`);
  }
  if (!yontem) {
    // Yarım kalmış yama ya da kayıttan geri alma doğrulanamadı: yedekten dön.
    const yedek = yedekYolu(yol);
    if (!existsSync(yedek) || sha256(yedek) !== kayit.orijinal.sha256)
      throw new Error('geri alınamadı: yedek yok ya da orijinal değil. Steam → oyuna sağ tık → Özellikler → Yüklü dosyalar → "Oyun dosyalarının bütünlüğünü doğrula".');
    copyFileSync(yedek, yol + '.yaziliyor');
    renameSync(yol + '.yaziliyor', yol);
    if (sha256(yol) !== kayit.orijinal.sha256) throw new Error('yedekten dönüş doğrulanamadı');
    yontem = 'yedekten';
  }
  unlinkSync(ky);
  return { yontem };
}

// yamalar: Map<res://yol, Buffer>. dur: sınama için yarıda kesme noktası.
export function uygula(yol, yamalar, { bozuk = '', dur = '' } = {}) {
  if (!yamalar.size) throw new Error('yama boş');
  const onceki = geriAl(yol, { bozuk });
  const p = dizinAc(yol);
  p.kapat();
  for (const y of yamalar.keys()) if (!p.girdiler.has(y)) throw new Error('pck içinde yok (yeni dosya ekleme desteklenmiyor): ' + y);
  const d = dogrula(yol);
  if (d.md5Hata.length || d.ust || d.yetim)
    throw new Error(`pck temiz görünmüyor (md5 hatası ${d.md5Hata.length}, üst üste ${d.ust}, yetim bölge ${d.yetim}); başka bir araçla değiştirilmiş olabilir. Dokunmadım.`);
  const orijinal = { boyut: d.boyut, sha256: sha256(yol) };

  const yedek = yedekYolu(yol);
  if (bozuk !== 'yedek') {
    if (existsSync(yedek)) {
      if (sha256(yedek) !== orijinal.sha256)
        throw new Error(`${path.basename(yedek)} bu pck'nin orijinali değil (Steam güncellemiş olabilir). Eski yedeği kaldır ya da adını değiştir. Dokunmadım.`);
    } else {
      copyFileSync(yol, yedek + '.yaziliyor');
      if (sha256(yedek + '.yaziliyor') !== orijinal.sha256) { unlinkSync(yedek + '.yaziliyor'); throw new Error('yedek doğrulanamadı'); }
      renameSync(yedek + '.yaziliyor', yedek);
    }
  }

  const kayit = {
    surum: 1, durum: 'yarim', tarih: new Date().toISOString(), orijinal,
    girdiler: [...yamalar.keys()].map((y) => {
      const g = p.girdiler.get(y);
      return { yol: y, dizinYeri: g.dizinYeri, ofset: g.ofset, boyut: g.boyut, md5: g.md5 };
    }),
  };
  jsonYaz(kayitYolu(yol), kayit);

  // 1) Veri sona (dizin hâlâ eski içeriği gösterir; burada kesilirse oyun etkilenmez).
  const fd = openSync(yol, 'r+');
  let son = orijinal.boyut;
  const yeni = [];
  for (const [y, veri] of yamalar) {
    const ofset = bozuk === 'hiza' ? son : hizala(son);
    if (ofset > son) writeSync(fd, Buffer.alloc(ofset - son), 0, ofset - son, son);
    writeSync(fd, veri, 0, veri.length, ofset);
    son = ofset + veri.length;
    yeni.push({ yol: y, ofset, boyut: veri.length, md5: md5(veri) });
  }
  const bitis = bozuk === 'hiza' ? son : hizala(son);
  if (bitis > son) writeSync(fd, Buffer.alloc(bitis - son), 0, bitis - son, son);
  fsyncSync(fd);
  if (dur === 'veri') { closeSync(fd); throw new Error('sınama: veri yazıldı, dizin yazılmadan durdu'); }

  // 2) Dizin alanları.
  for (const n of yeni) {
    const g = p.girdiler.get(n.yol);
    const alan = dizinAlani(n.ofset, bozuk === 'dizin' ? n.boyut + 1 : n.boyut, bozuk === 'md5' ? g.md5 : n.md5);
    writeSync(fd, alan, 0, 32, g.dizinYeri);
  }
  fsyncSync(fd);
  closeSync(fd);

  kayit.durum = 'tamam';
  kayit.yeni = yeni;
  kayit.yamali = { boyut: bitis, sha256: sha256(yol) };
  jsonYaz(kayitYolu(yol), kayit);
  return { onceki: onceki.yontem, yeni, orijinal, yamali: kayit.yamali };
}

export function yamaDiziniOku(dizin) {
  const yamalar = new Map();
  const gez = (d) => {
    for (const ad of readdirSync(d).sort()) {
      const tam = path.join(d, ad);
      if (statSync(tam).isDirectory()) gez(tam);
      else yamalar.set('res://' + path.relative(dizin, tam).split(path.sep).join('/'), readFileSync(tam));
    }
  };
  gez(dizin);
  return yamalar;
}

// ---------------------------------------------------------------- sınama
// Kopya üzerinde: uygula → oku → yeniden uygula → geri al; yarım yama; yabancı değişiklik.
function baytFarki(a, b, boyut) {
  // a ve b dosyalarının ilk `boyut` baytında farklı olan konumların aralıkları
  const fa = openSync(a, 'r'), fb = openSync(b, 'r');
  const ba = Buffer.alloc(4 << 20), bb = Buffer.alloc(4 << 20);
  const fark = [];
  for (let k = 0; k < boyut; k += ba.length) {
    const n = Math.min(ba.length, boyut - k);
    readSync(fa, ba, 0, n, k); readSync(fb, bb, 0, n, k);
    if (ba.subarray(0, n).equals(bb.subarray(0, n))) continue;
    for (let i = 0; i < n; i++) if (ba[i] !== bb[i]) fark.push(k + i);
  }
  closeSync(fa); closeSync(fb);
  return fark;
}

function sinaKos(pckYolu, bozuk) {
  const sonuc = [];
  const t = (ad, kosul) => sonuc.push([ad, !!kosul]);
  const kok = mkdtempSync(path.join(os.tmpdir(), 'pck-yama-sina-'));
  const kopya = path.join(kok, 'BackpackBattles.pck');
  if (path.resolve(kopya) === path.resolve(pckYolu)) throw new Error('kopya gerçek pck ile aynı yol');
  try {
    copyFileSync(pckYolu, kopya);
    const orijinalSha = sha256(kopya);
    const asil = dizinAc(pckYolu);
    const tablo = (ad, dil) => `res://Sheets/CSV/${ad}.${dil}.translation`;
    const en = (ad) => new Map(phashCoz(rsrcOku(asil.oku(tablo(ad, 'en')))).kayitlar.map((k) => [k.id, k.metin]));
    const TR = 'Çığ düştü: İşçi ağır şövalye ÇĞİÖŞÜ âîû ';
    const yap = (ad, onEk) => { const m = en(ad); return phashYaz(asil.oku(tablo(ad, 'da')), (id) => onEk + m.get(id)).dosya; };
    const yama1 = new Map([[tablo('Keywords', 'da'), yap('Keywords', TR)], [tablo('Items', 'da'), yap('Items', TR)]]);
    const yama2 = new Map([[tablo('Keywords', 'da'), yap('Keywords', 'ikinci ')]]);
    const itemsMd5 = asil.girdiler.get(tablo('Items', 'da')).md5;
    asil.kapat();

    // 1) Uygula
    const r1 = uygula(kopya, yama1, { bozuk });
    const p1 = dizinAc(kopya);
    const p0 = dizinAc(pckYolu);
    t('uygula: yamalanan içerik okunuyor', [...yama1].every(([y, v]) => p1.oku(y).equals(v)));
    t('uygula: yamalanan çeviri çözülüyor (uyumsuz 0)', [...yama1.keys()].every((y) => phashCoz(rsrcOku(p1.oku(y))).uyumsuz === 0));
    t('uygula: Türkçe metin geri okundu', phashCoz(rsrcOku(p1.oku(tablo('Keywords', 'da')))).kayitlar.every((k) => k.metin.startsWith(TR)));
    t('uygula: öteki girdilerin dizini aynı', [...p0.girdiler.values()].filter((g) => !yama1.has(g.yol))
      .every((g) => { const h = p1.girdiler.get(g.yol); return h && h.ofset === g.ofset && h.boyut === g.boyut && h.md5 === g.md5; }));
    t('uygula: yeni veri orijinal sonun ötesinde', r1.yeni.every((n) => n.ofset >= r1.orijinal.boyut));
    t('uygula: yeni ofsetler 16 hizalı', r1.yeni.every((n) => n.ofset % HIZA === 0));
    const fark = baytFarki(kopya, pckYolu, r1.orijinal.boyut);
    const alanlar = [...yama1.keys()].map((y) => p0.girdiler.get(y).dizinYeri);
    t('uygula: orijinal bölgede yalnızca dizin alanları değişti', fark.length > 0 && fark.every((k) => alanlar.some((a) => k >= a && k < a + 32)));
    p0.kapat(); p1.kapat();
    const d1 = dogrula(kopya);
    t('uygula: bütün md5 tutarlı', d1.md5Hata.length === 0);
    t('uygula: hizasız/üst üste yok, son hizalı', d1.hizasiz === 0 && d1.ust === 0 && d1.sonHizali);
    t('uygula: yedek orijinalle aynı', existsSync(yedekYolu(kopya)) && sha256(yedekYolu(kopya)) === orijinalSha);

    // 2) Yeniden uygula: önce kayıttan geri alır, dosya birikerek büyümez
    const r2 = uygula(kopya, yama2, { bozuk });
    t('yeniden: önce kayıttan geri alındı', r2.onceki === 'kayıttan');
    t('yeniden: boyut = orijinal + yeni yama', r2.yamali.boyut === hizala(r1.orijinal.boyut + yama2.values().next().value.length));
    const p2 = dizinAc(kopya);
    t('yeniden: yeni içerik, eski yama gitti', p2.oku(tablo('Keywords', 'da')).equals(yama2.get(tablo('Keywords', 'da')))
      && p2.girdiler.get(tablo('Items', 'da')).md5 === itemsMd5);
    p2.kapat();

    // 3) Geri al
    const g3 = geriAl(kopya, { bozuk });
    t('geri: kayıttan', g3.yontem === 'kayıttan');
    t('geri: sha256 orijinalle aynı', sha256(kopya) === orijinalSha);
    t('geri: kayıt silindi', !existsSync(kayitYolu(kopya)));
    t('geri: ikinci geri alma zararsız', geriAl(kopya).yontem === 'yamasiz' && sha256(kopya) === orijinalSha);

    // 4) Yarım yama (veri yazıldı, dizin yazılmadı) → yedekten dönülür
    try { uygula(kopya, yama1, { bozuk, dur: 'veri' }); } catch { /* beklenen */ }
    let g4;
    try { g4 = geriAl(kopya, { bozuk }); } catch (e) { g4 = { yontem: 'hata: ' + e.message.split('\n')[0] }; }
    t('yarım: yedekten dönüldü', g4.yontem === 'yedekten');
    t('yarım: sha256 orijinalle aynı', sha256(kopya) === orijinalSha);

    // 5) Yabancı değişiklik (ör. Steam güncellemesi): yamalı dosyada bir bayt → dokunmamalı
    uygula(kopya, yama2, { bozuk });
    const fd = openSync(kopya, 'r+'); const b = Buffer.alloc(1); readSync(fd, b, 0, 1, 1000000); b[0] ^= 1; writeSync(fd, b, 0, 1, 1000000); closeSync(fd);
    const onceSha = sha256(kopya);
    let hata = '';
    try { geriAl(kopya, { bozuk }); } catch (e) { hata = e.message; }
    t('yabancı: geri alma reddetti', /Dokunmadım/.test(hata));
    t('yabancı: dosyaya dokunulmadı', sha256(kopya) === onceSha);

    // 6) Pck'de olmayan yol → hata, dosya değişmez
    rmSync(kayitYolu(kopya)); copyFileSync(yedekYolu(kopya), kopya);
    let hata6 = '';
    try { uygula(kopya, new Map([['res://yok/boyle.bir.dosya', Buffer.from('x')]]), { bozuk }); } catch (e) { hata6 = e.message; }
    t('yabancı yol: reddedildi, dosya aynı', /pck içinde yok/.test(hata6) && sha256(kopya) === orijinalSha);
  } catch (e) {
    t('sınama koştu (' + e.message.split('\n')[0] + ')', false);
  } finally {
    rmSync(kok, { recursive: true, force: true });
  }
  return sonuc;
}

function sina(pckYolu, bozukMu) {
  const ozet = (bozuk) => {
    const s = sinaKos(pckYolu, bozuk);
    return { gecen: s.filter((x) => x[1]).length, toplam: s.length, dusen: s.filter((x) => !x[1]).map((x) => x[0]) };
  };
  const s = ozet('');
  for (const ad of s.dusen) console.log('DÜŞTÜ:', ad);
  console.log(`pck-yama sınama: ${s.gecen}/${s.toplam}`);
  if (!bozukMu) process.exit(s.gecen === s.toplam ? 0 : 1);
  const BOZMALAR = ['md5', 'hiza', 'dizin', 'kesme', 'yedek'];
  let yakalanan = 0;
  for (const b of BOZMALAR) {
    const r = ozet(b);
    if (r.gecen < r.toplam) { yakalanan++; console.log(`bozma "${b}": yakalandı (${r.toplam - r.gecen} test düştü: ${r.dusen.slice(0, 3).join(' · ')})`); }
    else console.log(`bozma "${b}": YAKALANMADI`);
  }
  console.log(`pck-yama sabotaj: ${yakalanan}/${BOZMALAR.length} yakalandı`);
  process.exit(s.gecen === s.toplam && yakalanan === BOZMALAR.length ? 0 : 1);
}

function durum(yol) {
  const ky = kayitYolu(yol), yedek = yedekYolu(yol);
  const simdi = sha256(yol);
  console.log(`pck: ${yol}\n  sha256 ${simdi}`);
  console.log(`  yedek: ${existsSync(yedek) ? (sha256(yedek) === simdi ? 'var (pck ile aynı)' : 'var') : 'yok'}`);
  if (!existsSync(ky)) { console.log('  kayıt: yok → yamasız'); }
  else {
    const k = JSON.parse(readFileSync(ky, 'utf8'));
    const hal = simdi === k.orijinal.sha256 ? 'orijinal' : k.yamali && simdi === k.yamali.sha256 ? 'yamalı (kayıtla aynı)' : 'kayıtla uyuşmuyor';
    console.log(`  kayıt: ${k.durum}, ${k.tarih} · pck şu an: ${hal}`);
    for (const g of k.yeni || k.girdiler) console.log(`    ${g.yol}`);
  }
  const d = dogrula(yol);
  console.log(`  tutarlılık: ${d.girdi} girdi, md5 hatası ${d.md5Hata.length}, üst üste ${d.ust}, hizasız ${d.hizasiz}, yetim bölge ${d.yetim}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const [komut, pck, dizin] = args.filter((a) => !a.startsWith('--'));
  try {
    if (args.includes('--sina') && komut) sina(komut, args.includes('--bozuk'));
    else if ((komut === 'uygula' || komut === 'geri') && oyunAcikMi()) { console.log('oyun açık: önce kapat'); process.exit(1); }
    else if (komut === 'uygula' && pck && dizin) {
      const r = uygula(pck, yamaDiziniOku(dizin));
      console.log(`önceki yama: ${r.onceki} · yamalanan ${r.yeni.length} dosya`);
      for (const n of r.yeni) console.log(`  ${n.yol}  ${n.boyut} bayt @${n.ofset}`);
      console.log(`boyut ${r.orijinal.boyut} → ${r.yamali.boyut} · yedek: ${path.basename(yedekYolu(pck))}`);
    } else if (komut === 'geri' && pck) console.log('geri alma: ' + geriAl(pck).yontem);
    else if (komut === 'durum' && pck) durum(pck);
    else {
      console.log('kullanım: node tools/pck-yama.mjs uygula <pck> <yama-dizini> | geri <pck> | durum <pck> | --sina [--bozuk] <pck>');
      process.exit(2);
    }
  } catch (e) { console.log('HATA: ' + e.message); process.exit(1); }
}
