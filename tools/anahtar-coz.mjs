#!/usr/bin/env node
// Çeviri tablolarının anahtarlarını çözer. Tablolarda anahtarın kendisi yok, yalnızca karması
// var; bu araç paketteki dosya adlarından ve en metinlerinden kök üretir, ON_EKLER × SON_EKLER
// ile birleştirip Godot 3 PHash karmasıyla arar (godot-ceviri.mjs → anahtarArayici).
// Bulunan kalıplar (08.11.2026, bu sürüm): eşya <ad>_NAME · <ad>_DESCR · <ad>_FLAVOR (ad =
// İngilizce eşya adı ya da sahne dosyasının adı, "ArtifactStoneHeat" → "Artifact Stone Heat") ·
// anahtar kelime <kod>_NAME / <kod>_DESCR (heat, lucky) · arayüz UI_<Ad> · TUTORIAL_<Ad> ·
// LABEL_<Ad>. Denenip hiçbir şey bulmayan ön/son ekler commit mesajında.
// Kullanım: node tools/anahtar-coz.mjs <pck> [--yaz <json>] [--ayrinti]
//           node tools/anahtar-coz.mjs --sina [--bozuk] <pck>
// --yaz çıktısı: {Tablo: {id: anahtar}} (id calisma/en/<Tablo>.json ile aynı; bir kayda iki
// anahtar çıkarsa dizi yazılır = sahte eşleşme şüphesi).
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pckAc, rsrcOku, phashCoz, anahtarArayici, KARMA_CARPAN } from './godot-ceviri.mjs';

export const TABLOLAR = ['Full', 'Items', 'ExclusiveItems', 'Interface', 'Dialog', 'Flavor', 'Keywords'];
export const ON_EKLER = ['', 'UI_', 'TUTORIAL_', 'LABEL_'];
export const SON_EKLER = ['', '_NAME', '_DESCR', '_FLAVOR'];

function kokler(pck, kayit, { bolme = true } = {}) {
  const K = new Set();
  const ekle = (s) => { if (s && s.length <= 80) K.add(s); };
  const camelBol = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  // 1) sahne ve betik dosyalarının adları (eşyalar: Items/Exclusive/ShellTotem.tscn)
  for (const y of pck.girdiler.keys()) {
    const m = y.match(/\/([^/]+?)\.(tscn|gde)$/);
    if (!m) continue;
    ekle(m[1]);
    if (bolme) ekle(camelBol(m[1]));
  }
  for (const kayitlar of kayit.values()) for (const { metin } of kayitlar) {
    // 2) metindeki oyun kodları ($heat → heat_NAME)
    for (const x of metin.matchAll(/\$([a-z_][a-z0-9_]*)/gi)) ekle(x[1]);
    // 3) kısa metnin kendisi ve sadeleştirilmiş biçimleri
    if (metin.length > 60 || metin.includes('\n')) continue;
    ekle(metin.trim());
    const kel = metin.replace(/[^A-Za-z0-9 ]/g, '').trim().split(/\s+/).filter(Boolean);
    if (!kel.length) continue;
    const pascal = kel.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
    for (const k of [kel.join('_'), kel.join(''), kel.join(' '), kel.slice(0, 2).join('_'), kel.slice(0, 3).join('_'), kel[0], pascal]) {
      ekle(k); ekle(k.toUpperCase()); ekle(k.toLowerCase());
    }
  }
  return K;
}

export function coz(pck, { carpan = KARMA_CARPAN, funcYok = false, sonEkler = SON_EKLER, bolme = true } = {}) {
  const { bulHepsi, T } = anahtarArayici(pck, TABLOLAR, { carpan, funcYok });
  const kayit = new Map(TABLOLAR.map((t) => [t, phashCoz(rsrcOku(pck.oku(`res://Sheets/CSV/${t}.en.translation`))).kayitlar]));
  const K = kokler(pck, kayit, { bolme });
  const anahtar = new Map(); // "Tablo id" → Set(anahtar dizgisi)
  let aday = 0;
  for (const k of K) for (const o of ON_EKLER) for (const s of sonEkler) {
    const x = o + k + s;
    aday++;
    for (const yer of bulHepsi(x)) {
      if (!anahtar.has(yer)) anahtar.set(yer, new Set());
      anahtar.get(yer).add(x);
    }
  }
  // Sahte eşleşme beklentisi: aday başına Σ_tablo (kovadaki girdi / hash_table boyu) / 2^32
  let p = 0;
  for (const { ht, bt } of T) p += [...ht].filter((x) => x !== 0xffffffff).reduce((s, x) => s + bt[x], 0) / ht.length / 2 ** 32;
  // Tablolar arası ortak anahtar: ikincil karma (kova işlevi hepsinde 1 ise karşılaştırılabilir)
  const funcHep1 = T.every(({ ht, bt }) => [...new Set(ht)].every((x) => x === 0xffffffff || bt[x + 1] === 1));
  const ortak = [];
  if (funcHep1) {
    const ilk = new Map();
    for (const [t, kayitlar] of kayit) for (const k of kayitlar) {
      if (ilk.has(k.anahtar)) ortak.push({ a: ilk.get(k.anahtar), b: { t, ...k } });
      else ilk.set(k.anahtar, { t, ...k });
    }
  }
  return { kayit, anahtar, aday, kokSayisi: K.size, beklenenSahte: aday * p, ortak, funcHep1 };
}

function rapor(pckYolu, { yaz, ayrinti }) {
  const pck = pckAc(pckYolu);
  const r = coz(pck);
  console.log(`kök ${r.kokSayisi} × ${ON_EKLER.length * SON_EKLER.length} kalıp = ${r.aday} aday · sahte eşleşme beklentisi ${r.beklenenSahte.toExponential(1)}`);
  console.log('tablo            çözülen / kayıt');
  let top = 0, cozTop = 0;
  const cikti = {};
  const celiski = [];
  for (const [t, kayitlar] of r.kayit) {
    cikti[t] = {};
    let n = 0;
    for (const k of kayitlar) {
      const a = r.anahtar.get(`${t} ${k.id}`);
      if (!a) continue;
      n++;
      cikti[t][k.id] = a.size === 1 ? [...a][0] : [...a];
      if (a.size > 1) celiski.push(`${t} ${k.id}: ${[...a].join(' | ')}`);
    }
    top += kayitlar.length; cozTop += n;
    console.log(`${t.padEnd(15)} ${String(n).padStart(5)} / ${kayitlar.length}`);
    if (ayrinti) for (const k of kayitlar.filter((k) => !r.anahtar.has(`${t} ${k.id}`)).slice(0, 10)) console.log(`     çözülmedi ${k.id} ${JSON.stringify(k.metin.slice(0, 70))}`);
  }
  console.log(`toplam           ${String(cozTop).padStart(5)} / ${top} (%${Math.round((100 * cozTop) / top)})`);
  console.log(`bir kayda iki anahtar (sahte eşleşme şüphesi): ${celiski.length}`);
  for (const c of celiski) console.log('   ' + c);
  if (!r.funcHep1) console.log('tablolar arası ortak anahtar: ÖLÇÜLEMEDİ (kova işlevi 1 olmayan kova var)');
  else {
    console.log(`tablolar arası ortak anahtar: ${r.ortak.length} (Godot ikisinden birini gösterir; boş metin atlanır)`);
    for (const { a, b } of r.ortak) {
      const ad = [...(r.anahtar.get(`${a.t} ${a.id}`) || r.anahtar.get(`${b.t} ${b.id}`) || ['?'])][0];
      console.log(`   ${a.t} ${a.id} ∩ ${b.t} ${b.id} [${ad}] ${JSON.stringify(a.metin.slice(0, 40))} · ${JSON.stringify(b.metin.slice(0, 40))}`);
    }
  }
  if (yaz) { writeFileSync(yaz, JSON.stringify(cikti, null, 1)); console.log(`yazıldı: ${yaz}`); }
}

// ---------------------------------------------------------------- sınama
// Bilinen anahtarlar tablo + metin başıyla denetlenir (id değil: oyun güncellenince kova yeri değişir).
const BILINEN = [
  ['Banana_NAME', 'Items', 'Banana'],
  ['Banana_DESCR', 'Items', '$t[Every $cds:] Heal for'],
  ['Banana_FLAVOR', 'Flavor', "It's sweet, it's yellow"],
  ['heat_NAME', 'Keywords', 'Heat'],
  ['heat_DESCR', 'Keywords', 'All items trigger'],
  ['UI_Gold', 'Interface', 'Gold'],
  ['TUTORIAL_BUY', 'Dialog', 'Buy $h[items]'],
  // anahtar dosya adından gelir (Items/EvilCap.tscn → "Evil Cap"), görünen ad farklıdır;
  // metinden türetilemez, yalnızca CamelCase bölmesiyle bulunur
  ['Evil Cap_NAME', 'Items', 'Cap of Discomfort'],
];
function sinaKos(pck, bozuk) {
  const r = coz(pck, {
    carpan: bozuk === 'carpan' ? KARMA_CARPAN ^ 4 : KARMA_CARPAN,
    funcYok: bozuk === 'func',
    sonEkler: bozuk === 'descr' ? SON_EKLER.filter((s) => s !== '_DESCR') : SON_EKLER,
    bolme: bozuk !== 'bolme',
  });
  if (bozuk === 'cifte') { const [ilk] = r.anahtar.values(); ilk.add('SAHTE_ANAHTAR'); }
  const ters = new Map(); // anahtar dizgisi → [yer]
  for (const [yer, s] of r.anahtar) for (const a of s) { if (!ters.has(a)) ters.set(a, []); ters.get(a).push(yer); }
  const metin = (yer) => { const [t, id] = yer.split(' '); return r.kayit.get(t).find((k) => k.id === id).metin; };
  const sonuc = [];
  for (const [a, t, bas] of BILINEN) sonuc.push([`${a} → ${t} "${bas}…"`, (ters.get(a) || []).some((y) => y.startsWith(t + ' ') && metin(y).startsWith(bas))]);
  sonuc.push(['bir kayda iki anahtar yok', [...r.anahtar.values()].every((s) => s.size === 1)]);
  sonuc.push(['sahte eşleşme beklentisi < 0,01', r.beklenenSahte < 0.01]);
  for (const t of ['Items', 'ExclusiveItems']) {
    const k = r.kayit.get(t), n = k.filter((x) => r.anahtar.has(`${t} ${x.id}`)).length;
    sonuc.push([`${t} kayıtlarının en az %90'ı çözülür`, n >= 0.9 * k.length]);
  }
  return sonuc;
}
function sina(pckYolu, bozukMu) {
  const pck = pckAc(pckYolu);
  const ozet = (b) => { const s = sinaKos(pck, b); return { gecen: s.filter((x) => x[1]).length, toplam: s.length, dusen: s.filter((x) => !x[1]).map((x) => x[0]) }; };
  const s = ozet('');
  for (const ad of s.dusen) console.log('DÜŞTÜ:', ad);
  console.log(`anahtar çözücü sınama: ${s.gecen}/${s.toplam}`);
  if (!bozukMu) process.exit(s.gecen === s.toplam ? 0 : 1);
  const BOZMALAR = ['carpan', 'func', 'descr', 'bolme', 'cifte'];
  let yakalanan = 0;
  for (const b of BOZMALAR) {
    const r = ozet(b);
    if (r.gecen < r.toplam) { yakalanan++; console.log(`bozma "${b}": yakalandı (${r.toplam - r.gecen} test düştü: ${r.dusen.slice(0, 3).join(' · ')})`); }
    else console.log(`bozma "${b}": YAKALANMADI`);
  }
  console.log(`anahtar çözücü sabotaj: ${yakalanan}/${BOZMALAR.length} yakalandı`);
  process.exit(s.gecen === s.toplam && yakalanan === BOZMALAR.length ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const yazI = args.indexOf('--yaz');
  const yaz = yazI >= 0 ? args[yazI + 1] : null;
  const duz = args.filter((a, i) => !a.startsWith('--') && !(yazI >= 0 && i === yazI + 1));
  if (args.includes('--sina') && duz[0]) sina(duz[0], args.includes('--bozuk'));
  else if (duz[0] && !(yazI >= 0 && !yaz)) rapor(duz[0], { yaz, ayrinti: args.includes('--ayrinti') });
  else { console.log('kullanım: node tools/anahtar-coz.mjs <pck> [--yaz <json>] [--ayrinti] | --sina [--bozuk] <pck>'); process.exit(2); }
}
