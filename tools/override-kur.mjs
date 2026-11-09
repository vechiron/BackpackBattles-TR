#!/usr/bin/env node
// Paketsiz Türkçe kurucu: oyunun paketine (BackpackBattles.pck) dokunmadan Türkçe yükler.
//
// Nasıl: Godot 3.6 motoru exe'nin yanındaki override.cfg'yi oyunun kendi ayarlarının
// (pakette res://project.binary) üstüne okur (ProjectSettings::_setup; ölçüm commit af9021f;
// oyunun kendi exe'sinde geçti, 09.11.2026). override.cfg'ye dil listesinin (locale/translations) TAMAMI yazılır
// (değer bütünüyle ezilir), Türkçe dosyalar listeye tam yolla girer; pakette olmayan tam
// yol diskten açılır. Türkçe dosyalar tools/yama-kur.mjs'nin ürettiği Danca iskeletidir
// (tr'de olmayan kayıt İngilizce).
//
// Kipler:
//   ayri   liste + turkce/<Tablo>.tr.translation (locale "tr"); Danca yerinde kalır.
//          Seçim: oyunun dil ayarı language="tr" (kurucu yazar, aşağıda). Oyunda geçti
//          09.11.2026. Kalıcı yol bu (proje sahibi 09.11.2026 "A").
//          Menüdeki dil satırı: turkce/DilAdi.tr.translation (aşağıda dilAdiPlani).
//   da     listedeki Danca yolları yerine turkce/<Tablo>.da.translation (içi Türkçe);
//          menüde "Dansk" seçilince Türkçe. Dil ayarına dokunulmaz.
//   ikisi  ikisi birden: oyunda tek açılışta iki yol da sınanır.
//
// Yazılanlar: <oyun>/override.cfg · <oyun>/turkce/*.translation · <oyun>/turkce/kurulum.json
// (yazılan her dosyanın sha256'sı) · kip ayri/ikisi'de oyunun dil ayarı: her Steam hesabının
// <ayar-kök>/<hesap>/full/backpack.cfg dosyasında [Options] language="tr"; eski değer ve
// dosyanın özgün metni kayda girer. Oyun bu hesapla hiç açılmamışsa (dosya yok) dosyayı oyunun
// ilk açılış biçiminde oluşturur (ILK_AYAR; hesap: paket-kur.mjs → steamHesaplari).
// `geri` yalnızca kayıttaki ve değişmemiş dosyaları siler;
// dil ayarını, dosya kurulumdan beri değişmediyse özgün metne (oluşturduğu dosyayı siler), değer
// hâlâ "tr" ise eski değere (oluşturduğu dosyada "en") döndürür (öteki ayarlar korunur); başka
// dil seçilmişse dokunmaz. Yeniden kurulum
// önce kendi kurulumunu geri alır: dil bir an eski değere döner, kayıttaki eski değer korunur;
// önceki kurulumun oluşturduğu dosya, hesap bu kez bulunamasa da yeniden oluşturulur.
// Oyun dil değerini kendisi değiştirmiyor (09.11.2026 ölçüldü: Seçenekler → Sürdür ve kapanış
// dosyayı yeniden yazıyor, "tr" kalıyor).
// Elle geri alma: override.cfg'yi silmek yeter (turkce/ kalırsa yüklenmez; dil ayarı "tr"
// kalırsa oyun İngilizceye düşer, oyunda denenmedi).
// Yabancı bir override.cfg varsa (kayıtta yok ya da değişmiş) hiçbir şey yazmaz.
// Oyun güncellemesi: Türkçe numarayla değil en özetiyle eşlenir (tools/ceviri-tasi.mjs →
// trHazirla; kur taşıma satırını basar). Kayda oyun izi girer (oyunIzi: tablolar, dil listesi,
// fontlar); durum şimdiki paketle karşılaştırır, değişmişse çıkış 3 ve "yeniden kur" der.
//
// Kullanım:
//   node tools/override-kur.mjs kur <pck> <tr-dizini> [--kip ayri|da|ikisi] [--hedef <dizin>] [--ayar-kok <dizin>] [--hesap <SteamID64|yok>] [--paket]
//   node tools/override-kur.mjs geri <pck> [--hedef <dizin>]
//   node tools/override-kur.mjs durum <pck> [--hedef <dizin>]
//   node tools/override-kur.mjs liste <pck>          (oyunun dil listesi, project.binary'den)
//   node tools/override-kur.mjs --sina [--bozuk] <pck>
// --hedef yoksa pck'nin klasörü; orada BackpackBattles.exe olmalı. --ayar-kok yoksa
// %APPDATA%/Godot/app_userdata/Backpack Battles; --hedef verilip --ayar-kok verilmezse dil
// ayarı yazılmaz (deneme kurulumu gerçek ayara dokunmasın). Oyun açıkken kur/geri çalışmaz:
// oyun kapanırken ayar dosyasını yeniden yazar.
// Oyun hiç açılmamışsa (ayar kökünde backpack.cfg yok) ve Steam hesabı da bulunamazsa kur hiçbir
// şey yazmadan çıkış 4 ile durur: dil ayarı yazılamaz, oyun Türkçe açılmazdı (ilkAcilisMi).
// --hesap: hesabı kayıt defteri yerine verir ("yok" = aranmaz; sınama). --paket: son satır geri
// alma komutu yerine kurucuyla (exe) kaldırmayı anar (tools/paket-kur.mjs verir).
// Çıkış (kur): 0 kuruldu · 1 hata · 4 oyun hiç açılmamış ve hesap yok, hiçbir şey yazılmadı.

import {
  readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, rmdirSync,
  mkdtempSync, closeSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pckAc, rsrcOku, phashCoz, anahtarArayici } from './godot-ceviri.mjs';
import { kapiKur, AYNI_UYARI, enOzet } from './bicim-kapisi.mjs';
import { kur, daYolu } from './yama-kur.mjs';
import { trHazirla, tasimaSatiri } from './ceviri-tasi.mjs';
import { sha256, oyunAcikMi } from './pck-yama.mjs';
import { duzCeviriYaz, duzCeviriOku } from './ceviri-yaz.mjs';
import { steamHesaplari, hesapSec } from './paket-kur.mjs'; // hesapSec: sınama

const CFG = 'override.cfg', KLASOR = 'turkce', KAYIT = 'kurulum.json';
export const DIL_ADI = 'DilAdi.tr.translation';
const AYAR_ADI = 'backpack.cfg', TR_DEGER = '"tr"';
export const AYAR_KOK = process.env.APPDATA ? path.join(process.env.APPDATA, 'Godot', 'app_userdata', 'Backpack Battles') : null;
export const KIPLER = ['ayri', 'da', 'ikisi'];
const ozet256 = (b) => createHash('sha256').update(b).digest('hex');
const ileri = (y) => y.replace(/\\/g, '/');
const DA_RE = /^res:\/\/Sheets\/CSV\/(\w+)\.da\.translation$/;

// ---------------------------------------------------------------- project.binary
// Godot 3 ProjectSettings::_save_settings_binary: "ECFG", u32 adet; her ayar:
// u32 ad uzunluğu + ad (NUL yok), u32 değer uzunluğu + encode_variant baytları.
// Yalnızca istenen ayarlar çözülür, ötekiler uzunlukla atlanır (tuş atamaları gibi).
export function ecfgOku(b, istenen) {
  if (b.toString('latin1', 0, 4) !== 'ECFG') throw new Error('ECFG değil');
  const adet = b.readUInt32LE(4);
  let o = 8;
  const bulunan = new Map();
  for (let i = 0; i < adet; i++) {
    const n = b.readUInt32LE(o); o += 4;
    const ad = b.toString('utf8', o, o + n); o += n;
    const vn = b.readUInt32LE(o); o += 4;
    if (istenen.includes(ad)) bulunan.set(ad, b.subarray(o, o + vn));
    o += vn;
  }
  if (o !== b.length) throw new Error(`ECFG sonu tutmadı (${o} / ${b.length})`);
  return { adet, bulunan };
}

// marshalls.cpp encode_variant, POOL_STRING_ARRAY (tür 23): u32 tür, u32 adet; her öğe
// u32 (utf8 uzunluğu + 1: sondaki NUL dahil), baytlar, değerin başına göre 4'e dolgu.
export function poolStringOku(v, { bozuk = '' } = {}) {
  const tur = v.readUInt32LE(0) & 0xff;
  if (tur !== 23) throw new Error(`PoolStringArray değil (tür ${tur})`);
  const adet = v.readUInt32LE(4);
  let o = 8;
  const dizi = [];
  for (let i = 0; i < adet; i++) {
    const n = v.readUInt32LE(o); o += 4;
    if (n < 1 || o + n > v.length || v[o + n - 1] !== 0) throw new Error(`öğe ${i}: sonda NUL yok`);
    dizi.push(v.toString('utf8', o, o + n - 1)); o += n;
    if (bozuk !== 'dolgu') while (o % 4) o++;
  }
  if (o !== v.length) throw new Error(`PoolStringArray sonu tutmadı (${o} / ${v.length})`);
  return dizi;
}

export function dilListesi(pck, { bozuk = '' } = {}) {
  const v = ecfgOku(pck.oku('res://project.binary'), ['locale/translations']).bulunan.get('locale/translations');
  if (!v) throw new Error("project.binary'de locale/translations yok");
  return poolStringOku(v, { bozuk });
}

// ---------------------------------------------------------------- çeviri dosyası
// locale özelliği RSRC'de satır içi dizge: u32 tür (5), u32 uzunluk (NUL dahil), baytlar.
// Aynı uzunlukta yeni kodla yerinde değişir; başka hiçbir ofset kaymaz.
export function localeDegistir(dosya, yeni) {
  const ana = rsrcOku(dosya).kaynaklar.at(-1);
  const p = ana.ozellikler.find((x) => x.ad === 'locale');
  if (!p) throw new Error('locale özelliği yok');
  const n = dosya.readUInt32LE(p.bas + 4);
  if (dosya.readUInt32LE(p.bas) !== 5 || p.son !== p.bas + 8 + n) throw new Error('locale satır içi dizge değil');
  if (n !== Buffer.byteLength(yeni) + 1) throw new Error(`locale uzunluğu farklı (${p.deger} → ${yeni})`);
  const c = Buffer.from(dosya);
  c.write(yeni, p.bas + 8, 'utf8');
  return c;
}

// ---------------------------------------------------------------- override.cfg
// Godot ConfigFile metni (VariantParser), UTF-8 yazılır. Türkçe harfli yol (oyun klasörü
// "D:/Oyunlarım/..." gibi) resmî motorda geçti: motor-dene geçici klasörü "Oyunlarım Çğüşıö İ"
// içindeyken 21/21, karşı test (eski ret) aynı yolda durdu; oyunun kendi exe'si de böyle bir
// klasördeki kopyadan Türkçe açıldı (09.11.2026).
export function cfgMetni(liste) {
  for (const y of liste) {
    if (/[\x00-\x1f\x7f]/.test(y)) throw new Error('kontrol karakteri içeren yol: ' + JSON.stringify(y));
    if (/["\\]/.test(y)) throw new Error('tırnak ya da ters bölü içeren yol: ' + y);
  }
  return '; Turkce dil yamasi (tools/override-kur.mjs). Bu dosya silinirse oyun eski haline doner.\n'
    + '[locale]\n\n'
    + 'translations=PoolStringArray( ' + liste.map((y) => `"${y}"`).join(', ') + ' )\n';
}

// ---------------------------------------------------------------- oyunun dil ayarı
// <ayar-kök>/<hesap>/full/backpack.cfg: Godot ConfigFile metni, [Options] language="en"
// (ölçüm 09.11.2026: tek hesap, LF, ASCII; Steam Cloud'lu). Şifreli betik açılışta bunu
// okuyor: oyunda language="tr" → günlükte "SETTING LOCALE TO tr" (09.11.2026).
export function ayarDosyalari(kok) {
  if (!kok || !existsSync(kok)) return [];
  return readdirSync(kok).map((ad) => path.join(kok, ad, 'full', AYAR_ADI)).filter((y) => existsSync(y)).sort();
}

// Oyun hiç açılmamışken kurucunun oluşturduğu dosya: oyunun ilk açılışta yazdığı metnin "tr"lisi.
// Ölçüm 09.11.2026 (oyun-goz ac --appdata, boş user://, oyunun kendi exe'si): dil sorulmuyor;
// sistem tr-TR iken de oyun [Options], boş satır, language="en" yazıyor (LF, 25 bayt) ve
// İngilizce açılıyor; önceden bu metin yazılınca ilk açılış Türkçe, kapanışta dosya bayt bayt aynı.
export const ILK_AYAR = '[Options]\n\nlanguage="tr"\n';
const ILK_DEGER = '"en"'; // oyunun ilk açılışta yazdığı değer: kurucunun oluşturduğu dosyanın "öncesi"
export const ayarYolu = (kok, id) => path.join(kok, String(id), 'full', AYAR_ADI);

// Dil ayarı yazılacak dosyalar: var olanlar + kesin Steam hesabının henüz olmayan dosyası; kesin
// hesap yoksa ve hiç dosya yoksa bu bilgisayarda Steam'e girmiş bütün hesaplarınki.
// hesap: paket-kur.mjs → steamHesaplari biçimi { kesin: { id, nasil } | null, hepsi } ya da null.
export function ayarPlani(ayarKok, kip, hesap, { bozuk = '' } = {}) {
  if (!ayarKok || kip === 'da') return { varolan: [], yeni: [] };
  const varolan = ayarDosyalari(ayarKok);
  const adaylar = hesap?.kesin ? [hesap.kesin.id] : varolan.length ? [] : (hesap?.hepsi || []);
  const yeni = bozuk === 'olustur' ? [] : [...new Set(adaylar)].map((id) => ayarYolu(ayarKok, id)).filter((y) => !existsSync(y));
  return { varolan, yeni };
}

// Dil ayarı yazılacak hiçbir dosya yok: oyun bu bilgisayarda hiç açılmamış ve Steam hesabı
// bulunamadı. Kurulsa oyun Türkçe açılmazdı; kur hiçbir şey yazmadan durur (çıkış 4).
export function ilkAcilisMi(ayarKok, kip, hesap = null, { bozuk = '' } = {}) {
  if (bozuk === 'ilk-acilis') return false;
  const p = ayarPlani(ayarKok, kip, hesap, { bozuk });
  return !!ayarKok && kip !== 'da' && p.varolan.length + p.yeni.length === 0;
}

// Kurucunun açtığı klasörleri (derinden sığa) boşsa siler; dolu olanda durur.
function bosKlasorleriSil(klasorler = []) {
  for (const d of klasorler) {
    if (!existsSync(d)) continue;
    if (readdirSync(d).length) break;
    rmdirSync(d);
  }
}

// [Options] başlığının ve içindeki language satırının satır numarası (yoksa -1).
// Belirsiz dosyada (iki [Options], iki language) hata: tahminle yazılmaz.
function dilBul(metin) {
  const satirlar = metin.split('\n');
  let bolum = -1, dil = -1, icinde = false;
  satirlar.forEach((s, i) => {
    const t = s.trim();
    if (t.startsWith('[')) {
      icinde = t === '[Options]';
      if (icinde && bolum >= 0) throw new Error('ayar dosyasında iki [Options] bölümü');
      if (icinde) bolum = i;
    } else if (icinde && /^language\s*=/.test(t)) {
      if (dil >= 0) throw new Error('ayar dosyasında iki language satırı');
      dil = i;
    }
  });
  return { satirlar, bolum, dil };
}

// Ham değer ('"en"') ya da satır yoksa null.
export function dilOku(metin) {
  const { satirlar, dil } = dilBul(metin);
  return dil < 0 ? null : satirlar[dil].trim().replace(/^language\s*=\s*/, '');
}

// Değeri yazar; ham null ise satırı siler. Öteki satırlar bayt bayt aynı kalır.
export function dilYaz(metin, ham) {
  const { satirlar, bolum, dil } = dilBul(metin);
  const cr = metin.includes('\r\n') ? '\r' : '';
  if (ham === null) { if (dil >= 0) satirlar.splice(dil, 1); return satirlar.join('\n'); }
  const satir = `language=${ham}`;
  if (dil >= 0) satirlar[dil] = satir + (satirlar[dil].endsWith('\r') ? '\r' : '');
  else if (bolum >= 0) satirlar.splice(bolum + 1, 0, satir + cr);
  else {
    const govde = metin && !metin.endsWith('\n') ? metin + cr + '\n' : metin;
    return govde + (govde ? cr + '\n' : '') + `[Options]${cr}\n${cr}\n${satir}${cr}\n`;
  }
  return satirlar.join('\n');
}

// Dosyayı okur; UTF-8 gidiş-dönüşü baytı değiştirmiyorsa metin, değiştiriyorsa hata.
function ayarMetni(y) {
  const b = readFileSync(y);
  const m = b.toString('utf8');
  if (!Buffer.from(m, 'utf8').equals(b)) throw new Error(`${y}: UTF-8 değil, dokunmadım`);
  return m;
}

// Kurmadan hemen önce dosyalardaki dil değeri: { ileri(yol): ham değer | null }. Okunamayan
// dosya atlanır (kurulumYap onu "dokunmadım" diye durdurur).
export function dilDegerleri(ayarKok, kip) {
  const m = new Map();
  if (!ayarKok || kip === 'da') return m;
  for (const y of ayarDosyalari(ayarKok)) { try { m.set(ileri(y), dilOku(ayarMetni(y))); } catch { /* kurulumYap durdurur */ } }
  return m;
}

// Kurulum çıktısındaki dil satırı. once: kurmadan hemen önce dosyadaki değer; onceki: kayda
// geçen "kurulumdan önceki" değer. Yeniden kurulumda kurucu önceki kurulumu geri alır (dil
// kayıttaki değere döner) ve onceki onu okur: dosya zaten "tr" iken "en → tr" basılıyordu,
// bu oyunun dili "en"e çevirdiği sanısına yol açtı (09.11.2026; oyunda ölçüldü: Seçenekler →
// Sürdür ve kapanış dosyayı yeniden yazıyor, dil "tr" kalıyor).
export function dilSatiri(once, onceki, { bozuk = '' } = {}) {
  const ad = (v) => v ?? '(satır yoktu)';
  if (bozuk === 'dil-cikti') return `${ad(onceki)} → ${TR_DEGER}`;
  if (once === TR_DEGER && onceki !== TR_DEGER) return `zaten ${TR_DEGER} (önceki kurulum), değişmedi · kurulumdan önceki değer ${ad(onceki)}, geri alınca o yazılır`;
  return `${ad(once)} → ${TR_DEGER}`;
}

// ---------------------------------------------------------------- menüdeki dil satırı
// Oyun Seçenekler'deki düğmeye tr("BUTTON_Language") + ": " + dil adı yazıyor (sahne ve karma
// ölçümü, commit e555e30); ayrı Türkçe'de dil adı "English" (tr oyunun listesinde yok, oyunda
// görüldü: "Dil: English"). Button metni bir kez daha tr()'den geçtiği için (resmî Godot 3.6'da
// ölçüldü) yalnızca tr'de yüklü tek satır "<başlık>: English" → "<başlık>: Türkçe" yeter.
// Başlık = Türkçe çevirideki BUTTON_Language kaydı; yoksa ya da boşsa en metni (motor da öyle
// düşer). Oyunda geçti (09.11.2026: Seçenekler'de "Dil: Türkçe").
export function dilAdiPlani(k, tr, { bozuk = '' } = {}) {
  const yer = anahtarArayici(k.pck, k.tablolar).bulHepsi('BUTTON_Language');
  if (yer.length !== 1) throw new Error(`BUTTON_Language anahtarı ${yer.length} kayıtta (1 bekleniyordu): oyun değişmiş olabilir`);
  const [tb, id] = yer[0].split(' ');
  const baslik = (bozuk !== 'dil-adi' && tr.get(tb)?.get(id)) || k.en.get(tb).get(id);
  const cift = [`${baslik}: English`, `${baslik}: Türkçe`];
  return { baslik, cift, dosya: duzCeviriYaz('tr', [cift]) };
}

// Doğrulama için bağımsız yol: anahtar karması yerine en metni "Language" olan tek kayıt.
export function dilAdiBekle(k, tr) {
  const bulunan = [];
  for (const [tb, m] of k.en) for (const [id, metin] of m) if (metin === 'Language') bulunan.push([tb, id]);
  if (bulunan.length !== 1) return null;
  const [tb, id] = bulunan[0];
  const h = tr.get(tb)?.get(id) || 'Language';
  return { tb, id, cift: [`${h}: English`, `${h}: Türkçe`] };
}

// ---------------------------------------------------------------- oyun izi
// Türkçeyi etkileyen paket parçalarının sha256'sı: her tablonun en ve da dosyası (Türkçe dosyalar
// bunlardan üretilir), dil listesi (override.cfg onu ezer) ve fontlar (Türkçe harfler onlarla
// çizilir; değişirse tools/font-cizim.mjs yeniden koşulmalı). Kurulum kaydına girer, durum
// şimdiki paketle karşılaştırır. Fontlar ~66 MB: paket başına bir kez hesaplanır.
const IZ_RE = /^res:\/\/Sheets\/CSV\/\w+\.(en|da)\.translation$|\.(ttf|otf)$/i;
export const IZ_LISTE = 'locale/translations';
const izOnbellek = new WeakMap();
export function oyunIzi(pck) {
  if (izOnbellek.has(pck)) return izOnbellek.get(pck);
  const iz = {};
  for (const y of [...pck.girdiler.keys()].filter((x) => IZ_RE.test(x)).sort()) iz[y] = ozet256(pck.oku(y));
  iz[IZ_LISTE] = ozet256(Buffer.from(dilListesi(pck).join('\n'), 'utf8'));
  izOnbellek.set(pck, iz);
  return iz;
}
// Dönüş: null (kayıtta iz yok: izden önceki kurulum) ya da [{yol, ne}] (boş = değişmedi).
export function izFarki(eski, simdi, { bozuk = '' } = {}) {
  if (!eski) return null;
  if (bozuk === 'iz') return [];
  const f = [];
  for (const y of new Set([...Object.keys(eski), ...Object.keys(simdi)])) {
    if (!(y in simdi)) f.push({ yol: y, ne: 'pakette yok' });
    else if (!(y in eski)) f.push({ yol: y, ne: 'yeni' });
    else if (eski[y] !== simdi[y]) f.push({ yol: y, ne: 'değişti' });
  }
  return f.sort((a, b) => a.yol.localeCompare(b.yol));
}

// ---------------------------------------------------------------- plan, yazma, geri
export function planla(k, tr, kip, hedef, { bozuk = '' } = {}) {
  if (!KIPLER.includes(kip)) throw new Error(`kip "${kip}" yok (olanlar: ${KIPLER.join(', ')})`);
  const r = kur(k, tr);
  if (r.hata.length) return { hata: r.hata, uyari: r.uyari };
  const asil = dilListesi(k.pck, { bozuk });
  const eksik = k.tablolar.filter((t) => !asil.includes(daYolu(t)));
  if (eksik.length) throw new Error('oyunun dil listesinde Danca dosyası olmayan tablo: ' + eksik.join(', '));
  const tam = (ad) => (bozuk === 'goreli' ? `${KLASOR}/${ad}` : ileri(path.resolve(hedef, KLASOR, ad)));
  const dosyalar = new Map();
  let liste = [...asil];
  if (kip !== 'ayri') {
    for (const t of k.tablolar) dosyalar.set(`${t}.da.translation`, r.yamalar.get(daYolu(t)));
    liste = liste.map((y) => { const m = y.match(DA_RE); return m && k.tablolar.includes(m[1]) ? tam(`${m[1]}.da.translation`) : y; });
  }
  let dilAdi = null;
  if (kip !== 'da') {
    for (const t of k.tablolar) {
      const d = r.yamalar.get(daYolu(t));
      dosyalar.set(`${t}.tr.translation`, bozuk === 'locale' ? d : localeDegistir(d, 'tr'));
      liste.push(tam(`${t}.tr.translation`));
    }
    dilAdi = dilAdiPlani(k, tr, { bozuk });
    dosyalar.set(DIL_ADI, dilAdi.dosya);
    if (bozuk !== 'dil-liste') liste.push(tam(DIL_ADI));
  }
  if (bozuk === 'liste') liste = liste.slice(1);
  return { hata: [], uyari: r.uyari, ozet: r.ozet, dosyalar, liste, cfg: cfgMetni(liste), asil, dilAdi, oyun: oyunIzi(k.pck) };
}

export function kayitOku(hedef) {
  const y = path.join(hedef, KLASOR, KAYIT);
  return existsSync(y) ? JSON.parse(readFileSync(y, 'utf8')) : null;
}

// Yazmadan önce: kayıtta olmayan ya da değişmiş override.cfg, turkce/ içinde kaydın bilmediği şey.
export function engelBul(hedef) {
  const bilinen = new Map((kayitOku(hedef)?.dosyalar || []).map((d) => [d.yol, d.sha256]));
  const engel = [];
  const cfgYol = path.join(hedef, CFG);
  if (existsSync(cfgYol) && bilinen.get(CFG) !== ozet256(readFileSync(cfgYol))) engel.push(`${CFG} bu kurucunun yazdığı değil ya da sonradan değişmiş`);
  const kd = path.join(hedef, KLASOR);
  if (existsSync(kd)) for (const ad of readdirSync(kd)) if (ad !== KAYIT && !bilinen.has(`${KLASOR}/${ad}`)) engel.push(`${KLASOR}/${ad} kayıtta yok`);
  return engel;
}

export function geriAl(hedef, { bozuk = '' } = {}) {
  const kayit = kayitOku(hedef);
  if (!kayit) return { yok: true, silinen: [], kalan: existsSync(path.join(hedef, CFG)) ? [`${CFG} (kayıtsız, dokunulmadı)`] : [], ayar: [] };
  const silinen = [], kalan = [], ayar = [];
  // Önce dil ayarı. Dosya kurulumdan beri aynıysa özgün metin; oyun yeniden yazdıysa ve
  // değer hâlâ "tr" ise yalnızca o satır; başka dil seçilmişse dokunulmaz.
  for (const a of kayit.ayarlar || []) {
    if (bozuk === 'ayar-geri') continue;
    if (!existsSync(a.yol)) { ayar.push(`${a.yol}: dosya yok, dokunulmadı`); continue; }
    try {
      const simdi = ayarMetni(a.yol);
      // Kurucunun oluşturduğu dosya: değişmemişse silinir (oyun sonraki açılışta kendisi yazar);
      // oyun yeniden yazdıysa dil, oyunun ilk açılış değerine ("en") döner.
      const eski = a.olusturuldu ? ILK_DEGER : a.onceki;
      if (ozet256(Buffer.from(simdi, 'utf8')) === a.sha256) {
        if (!a.olusturuldu) { writeFileSync(a.yol, a.ozgun); ayar.push(`${a.yol}: özgün metne döndü`); }
        else if (bozuk !== 'olustur-geri') { rmSync(a.yol); bosKlasorleriSil(a.klasorler); ayar.push(`${a.yol}: kurucu oluşturmuştu, silindi`); }
      } else if (dilOku(simdi) === TR_DEGER) { writeFileSync(a.yol, dilYaz(simdi, eski)); ayar.push(`${a.yol}: dil ${eski ?? '(satır yoktu)'} değerine döndü, öteki ayarlar korundu`); }
      else ayar.push(`${a.yol}: dil ${dilOku(simdi)}, kurulumdan sonra seçilmiş, dokunulmadı`);
    } catch (e) { kalan.push(`${a.yol} (dil ayarı geri alınamadı: ${e.message})`); }
  }
  // Önce override.cfg: yarıda kalırsa oyun eksik Türkçe dosya istemesin.
  const sira = [...kayit.dosyalar].sort((a, b) => (a.yol === CFG ? -1 : b.yol === CFG ? 1 : 0));
  for (const d of sira) {
    if (bozuk === 'geri' && d.yol === CFG) continue;
    const y = path.join(hedef, ...d.yol.split('/'));
    if (!existsSync(y)) continue;
    if (ozet256(readFileSync(y)) !== d.sha256) { kalan.push(`${d.yol} (değişmiş, dokunulmadı)`); continue; }
    rmSync(y);
    silinen.push(d.yol);
  }
  if (!kalan.length) {
    rmSync(path.join(hedef, KLASOR, KAYIT), { force: true });
    const kd = path.join(hedef, KLASOR);
    if (existsSync(kd) && readdirSync(kd).length === 0) rmdirSync(kd);
  }
  return { yok: false, silinen, kalan, ayar };
}

// Engel varsa hiçbir şey yazmaz. Önceki kendi kurulumu önce geri alınır (kip değişince
// eski dosya kalmasın). Kayıt override.cfg'den önce, dil ayarı en sonda yazılır.
// ayarKok verilmezse (motor-dene, deneme kurulumu) oyunun dil ayarına dokunulmaz. hesap: ayarPlani.
export function kurulumYap(hedef, plan, kip, { bozuk = '', ayarKok = null, hesap = null } = {}) {
  const engel = bozuk === 'yabanci' ? [] : engelBul(hedef);
  if (engel.length) throw new Error('dokunmadım:\n  ' + engel.join('\n  '));
  for (const y of ayarPlani(ayarKok, kip, hesap).varolan) {
    try { dilBul(ayarMetni(y)); } catch (e) { throw new Error('dokunmadım: ' + e.message); }
  }
  // Önceki kurulumun oluşturduğu dosyalar: geri alma onları siler (değişmemişlerse). Yeniden
  // oluşturulurlar, hesap bu kez bulunamasa da: Steam kapalıyken yapılan yeniden kurulum dil
  // ayarını kaybedip "kuruldu" demesin.
  const kokte = (y) => !!ayarKok && kip !== 'da' && ileri(y).toLowerCase().startsWith(ileri(path.resolve(ayarKok)).toLowerCase() + '/');
  const eskiOlusan = bozuk === 'olustur-yeniden' ? []
    : (kayitOku(hedef)?.ayarlar || []).filter((a) => a.olusturuldu && kokte(a.yol)).map((a) => path.resolve(a.yol));
  if (kayitOku(hedef)) {
    const g = geriAl(hedef);
    if (g.kalan.length) throw new Error('önceki kurulum tam geri alınamadı:\n  ' + g.kalan.join('\n  '));
  }
  // Geri almadan sonra okunur: önceki kurulumun "tr"si eski değer sanılmasın; önceki kurulumun
  // oluşturduğu dosya silindiyse yeniden "yeni" sayılır.
  const ap = ayarPlani(ayarKok, kip, hesap, { bozuk });
  for (const y of eskiOlusan) if (!existsSync(y) && !ap.yeni.some((z) => ileri(z).toLowerCase() === ileri(y).toLowerCase())) ap.yeni.push(y);
  const ayarlar = ap.varolan.map((y) => {
    const ozgun = ayarMetni(y);
    const yeni = dilYaz(ozgun, bozuk === 'ayar' ? '"en"' : TR_DEGER);
    return { yol: ileri(y), onceki: dilOku(ozgun), ozgun, sha256: ozet256(Buffer.from(yeni, 'utf8')), yeni };
  });
  for (const y of ap.yeni) {
    const klasorler = [];
    for (let d = path.dirname(y); !existsSync(d) && path.dirname(d) !== d; d = path.dirname(d)) klasorler.push(ileri(d));
    const yeni = bozuk === 'ilk-ayar' ? ILK_AYAR.replace(/\n/g, '\r\n') : ILK_AYAR;
    ayarlar.push({ yol: ileri(y), onceki: null, ozgun: null, olusturuldu: true, klasorler, sha256: ozet256(Buffer.from(yeni, 'utf8')), yeni });
  }
  const kd = path.join(hedef, KLASOR);
  mkdirSync(kd, { recursive: true });
  const dosyalar = [];
  for (const [ad, b] of plan.dosyalar) { writeFileSync(path.join(kd, ad), b); dosyalar.push({ yol: `${KLASOR}/${ad}`, sha256: ozet256(b) }); }
  const cfgB = Buffer.from(plan.cfg, bozuk === 'cfg-yaz' ? 'latin1' : 'utf8');
  dosyalar.push({ yol: CFG, sha256: ozet256(cfgB) });
  writeFileSync(path.join(kd, KAYIT), JSON.stringify({
    arac: 'tools/override-kur.mjs', kip, tarih: new Date().toISOString(), dosyalar,
    ayarlar: ayarlar.map(({ yeni, ...a }) => a), oyun: plan.oyun,
  }, null, 1));
  writeFileSync(path.join(hedef, CFG), cfgB);
  for (const a of ayarlar) {
    if (a.olusturuldu) mkdirSync(path.dirname(a.yol), { recursive: true });
    writeFileSync(a.yol, a.yeni);
  }
  return dosyalar;
}

// Yazılanı plandan bağımsız okur: override.cfg metni, yolların yeri, her Türkçe dosyanın
// locale'i ve her kaydı (tr'de varsa tr, yoksa en), kayıttaki sha256'lar, dil ayarı.
export function kurulumuDogrula(hedef, k, tr, kip, asil, ayarKok = null, { bozuk = '' } = {}) {
  const s = [];
  const t = (ad, kosul) => s.push([ad, !!kosul]);
  const cfgYol = path.join(hedef, CFG);
  const ham = existsSync(cfgYol) ? readFileSync(cfgYol) : Buffer.alloc(0);
  // Motor UTF-8 okur. latin1 okuma Türkçe harfli yolu bozuyordu: doğrulama dosyaları
  // bulamayıp sağlam kurulumu geri alıyordu (09.11.2026).
  const metin = ham.toString(bozuk === 'cfg-oku' ? 'latin1' : 'utf8');
  t('override.cfg yazıldı, geçerli UTF-8, kontrol karakteri yok', ham.length > 0
    && Buffer.from(ham.toString('utf8'), 'utf8').equals(ham) && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(metin));
  const satir = metin.split('\n').filter((x) => x.trim() && !x.startsWith(';'));
  t('override.cfg: [locale] bölümü ve tek translations satırı', satir[0] === '[locale]' && satir.length === 2 && /^translations=PoolStringArray\( ".*" \)$/.test(satir[1]));
  const yollar = [...(satir[1] || '').matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  const res = yollar.filter((y) => y.startsWith('res://')), disk = yollar.filter((y) => !y.startsWith('res://'));
  const bekSayi = asil.length + (kip !== 'da' ? k.tablolar.length + 1 : 0);
  t(`liste: ${yollar.length} yol (beklenen ${bekSayi})`, yollar.length === bekSayi);
  t('liste: paket yollarının hepsi pakette', res.every((y) => k.pck.girdiler.has(y)));
  const daAsil = asil.filter((y) => DA_RE.test(y));
  const disi = (l) => JSON.stringify(l.filter((y) => !daAsil.includes(y)));
  t('liste: Danca dışındaki oyun yollarının hepsi, aynı sırayla', disi(asil) === disi(res));
  t(kip === 'ayri' ? 'liste: Danca yolları yerinde' : 'liste: Danca yolları pakete değil Türkçe dosyaya',
    daAsil.length > 0 && daAsil.every((y) => (kip === 'ayri') === res.includes(y)));
  t('liste: Türkçe yollar mutlak (X:/...) ve diskte var', disk.length > 0 && disk.every((y) => /^[A-Za-z]:\//.test(y) && existsSync(y)));
  const bekAd = [...(kip !== 'ayri' ? k.tablolar.map((x) => `${x}.da.translation`) : []), ...(kip !== 'da' ? [...k.tablolar.map((x) => `${x}.tr.translation`), DIL_ADI] : [])].sort();
  t('liste: her tablo için beklenen Türkçe dosya adları (+ dil adı)', JSON.stringify(disk.map((y) => path.posix.basename(y)).sort()) === JSON.stringify(bekAd));
  // Menüdeki dil satırı: düz Translation, tek satır; beklenen dilAdiBekle'den (karmasız).
  if (kip !== 'da') {
    const bek = dilAdiBekle(k, tr);
    const y = disk.find((x) => path.posix.basename(x) === DIL_ADI);
    let g = null;
    try { g = y && existsSync(y) ? duzCeviriOku(readFileSync(y)) : null; } catch { g = null; }
    t(`dil adı: locale tr, tek satır ${bek ? JSON.stringify(bek.cift.join(' → ')) : '(en metni "Language" olan tek kayıt yok)'}`,
      bek && g && g.locale === 'tr' && JSON.stringify(g.ciftler) === JSON.stringify([bek.cift]));
  }
  let yanlisLoc = 0, yanlis = 0, uyumsuz = 0, turkce = 0, ilk = '';
  for (const y of disk.filter((x) => existsSync(x) && path.posix.basename(x) !== DIL_ADI)) {
    const [, tb, loc] = path.posix.basename(y).match(/^(\w+)\.(\w+)\.translation$/) || [];
    const c = phashCoz(rsrcOku(readFileSync(y)));
    if (c.locale !== loc) yanlisLoc++;
    uyumsuz += c.uyumsuz;
    const enM = k.en.get(tb), trM = tr.get(tb) || new Map();
    if (!enM || c.kayitlar.length !== enM.size) { yanlis++; ilk ||= tb; }
    for (const x of c.kayitlar) {
      const bek = trM.has(x.id) ? trM.get(x.id) : enM?.get(x.id);
      if (x.metin !== bek) { yanlis++; ilk ||= `${tb}:${x.id}`; } else if (trM.has(x.id)) turkce++;
    }
  }
  t('Türkçe tablo dosyaları: locale dosya adıyla aynı (tr / da)', disk.length > 0 && yanlisLoc === 0);
  t(`Türkçe dosyalar: uyumsuz 0, her kayıt Türkçe ya da en ile aynı${ilk ? ' (ilk yanlış ' + ilk + ')' : ''}`, uyumsuz === 0 && yanlis === 0);
  const trToplam = [...tr.values()].reduce((a, m) => a + m.size, 0) * (kip === 'ikisi' ? 2 : 1);
  t(`Türkçe kayıtların hepsi dosyalarda (${turkce}/${trToplam})`, turkce === trToplam);
  const kayit = kayitOku(hedef);
  t('kayıt: dosya sayısı ve her sha256 tutuyor', kayit && kayit.dosyalar.length === disk.length + 1
    && kayit.dosyalar.every((d) => { const yy = path.join(hedef, ...d.yol.split('/')); return existsSync(yy) && ozet256(readFileSync(yy)) === d.sha256; }));
  t('kayıt: oyun izi şimdiki paketle aynı', kayit && izFarki(kayit.oyun, oyunIzi(k.pck))?.length === 0);
  // Dil ayarı: dilBul'dan bağımsız düz satır okuması.
  const ayarlar = kayit?.ayarlar || [];
  const bekAyar = (ayarKok && kip !== 'da' ? ayarDosyalari(ayarKok) : []).map(ileri).sort();
  t(`oyun ayarı: ${ayarlar.length} dosya kayıtta (beklenen ${bekAyar.length})`, JSON.stringify(ayarlar.map((a) => a.yol).sort()) === JSON.stringify(bekAyar));
  // Ayar kökü varken dil hiçbir dosyaya yazılmadıysa oyun Türkçe açılmaz: kurulum tamam sayılmaz.
  if (ayarKok && kip !== 'da') t('oyun ayarı: en az bir dosyaya yazıldı (yoksa oyun Türkçe açılmaz)', ayarlar.length > 0);
  const dilSatiri = (s) => /^language\s*=/.test(s.trim());
  const dilDisi = (m) => m.split('\n').filter((s) => !dilSatiri(s)).join('\n');
  let ayarYanlis = 0;
  for (const a of ayarlar) {
    const m = existsSync(a.yol) ? readFileSync(a.yol, 'utf8') : '';
    const dil = m.split('\n').filter(dilSatiri).map((s) => s.trim());
    const ozgun = a.ozgun ?? '';
    const o = dilDisi(ozgun), y = dilDisi(m);
    const digerAyni = y === o || (!/^\[Options\]/m.test(ozgun) && y.startsWith(o) && y.slice(o.length).replace(/\s/g, '') === '[Options]');
    // Kurucunun oluşturduğu dosya oyunun ilk açılış biçiminde olmalı (ILK_AYAR, ölçüm yukarıda).
    const ilkBicim = !a.olusturuldu || m === ILK_AYAR;
    if (!(dil.length === 1 && dil[0] === `language=${TR_DEGER}` && digerAyni && ilkBicim && ozet256(Buffer.from(m, 'utf8')) === a.sha256)) ayarYanlis++;
  }
  t('oyun ayarı: her dosyada tek language="tr", öteki satırlar özgünle aynı (oluşturulan: oyunun biçiminde)', ayarYanlis === 0);
  return s;
}

// ---------------------------------------------------------------- sınama
const TR_ORNEK = 'Çığ düştü: İşçi ağır şövalye ÇĞİÖŞÜ âîû ';
function sinaTr(k) {
  const tr = new Map();
  for (const t of k.tablolar) {
    if (t === 'Flavor') continue; // dosyası olmayan tablo da yazılmalı (hepsi en)
    const kay = [...k.en.get(t)];
    tr.set(t, new Map([kay[0], kay[kay.length >> 1]].map(([id, m]) => [id, TR_ORNEK + m])));
  }
  // Dil düğmesinin başlığı Türkçe olmalı: yoksa en'e düşen başlık "doğru" görünür, bozma kaçar.
  const d = dilAdiBekle(k, new Map());
  if (d) tr.get(d.tb)?.set(d.id, 'Dil');
  return tr;
}

function sinaKos(k, bozuk) {
  const sonuc = [];
  const t = (ad, kosul) => sonuc.push([ad, !!kosul]);
  // Kök Türkçe harfli: bütün kurulumlar "D:/Oyunlarım/..." gibi bir oyun klasöründeymiş gibi.
  const kok = mkdtempSync(path.join(os.tmpdir(), 'override-kur-Oyunlarım Çğüşö İ-'));
  try {
    t('sınama klasörü Türkçe harfli', /[^\x00-\x7f]/.test(kok));
    const asil = dilListesi(k.pck, { bozuk });
    t(`dil listesi: ${asil.length} yol, hepsi pakette`, asil.length > 0 && asil.every((y) => k.pck.girdiler.has(y)));
    t('dil listesi: her tablonun Danca dosyası listede', k.tablolar.every((x) => asil.includes(daYolu(x))));
    const tr = sinaTr(k);
    // Dil satırı: Türkçe başlık; çeviride kayıt yoksa ya da boşsa en başlığı (motor gibi).
    const dBek = dilAdiBekle(k, new Map());
    t('dil adı: en metni "Language" olan tek kayıt var, sınama çevirisinde "Dil"', dBek && tr.get(dBek.tb)?.get(dBek.id) === 'Dil');
    const satir = (trX) => JSON.stringify(duzCeviriOku(dilAdiPlani(k, trX, { bozuk }).dosya).ciftler);
    t('dil adı: Türkçe başlık "Dil: English" → "Dil: Türkçe"', satir(tr) === JSON.stringify([['Dil: English', 'Dil: Türkçe']]));
    const bosTr = new Map([[dBek?.tb, new Map([[dBek?.id, '']])]]);
    t('dil adı: çeviri yok ya da boş → "Language: English" → "Language: Türkçe"',
      satir(new Map()) === JSON.stringify([['Language: English', 'Language: Türkçe']]) && satir(bosTr) === satir(new Map()));
    for (const kip of KIPLER) {
      const hedef = path.join(kok, kip);
      mkdirSync(hedef);
      const plan = planla(k, tr, kip, hedef, { bozuk });
      t(`${kip}: plan hatasız`, plan.hata.length === 0);
      kurulumYap(hedef, plan, kip, { bozuk });
      for (const [ad, ok] of kurulumuDogrula(hedef, k, tr, kip, asil, null, { bozuk })) t(`${kip}: ${ad}`, ok);
      const g = geriAl(hedef, { bozuk });
      t(`${kip}: geri: klasör kurulumdan önceki gibi boş`, g.kalan.length === 0 && readdirSync(hedef).length === 0);
    }
    // Oyun güncellemesi: numaraları kaymış Türkçe dizini (her kayıt tablodaki bir sonraki
    // numarada, özeti doğru) taşınıp doğru kayda kurulmalı (ceviri-tasi.mjs → trHazirla).
    const dDogru = path.join(kok, 'tr-dogru'), dKay = path.join(kok, 'tr-kaymis');
    mkdirSync(dDogru); mkdirSync(dKay);
    let kayan = 0;
    for (const [tb, m] of tr) {
      const ids = [...k.en.get(tb).keys()];
      const kay = [...m].map(([id, metin]) => ({ id, metin, en: enOzet(k.en.get(tb).get(id)) }));
      writeFileSync(path.join(dDogru, `${tb}.json`), JSON.stringify(kay));
      const kaymis = kay.map((x) => ({ ...x, id: ids[(ids.indexOf(x.id) + 1) % ids.length] }));
      kayan += kaymis.length;
      writeFileSync(path.join(dKay, `${tb}.json`), JSON.stringify(kaymis));
    }
    const bek = trHazirla(k, dDogru);
    t('güncelleme: numaraları doğru dizin hatasız, sınama çevirisi olduğu gibi',
      bek.hata.length === 0 && bek.s.tasinan === 0 && [...tr].every(([tb, m]) => [...m].every(([id, x]) => bek.tr.get(tb)?.get(id) === x)));
    const hz = trHazirla(k, dKay, { bozuk: bozuk === 'tasima' ? 'numara' : '' });
    const ayniTr = (a, b) => a.size === b.size && [...a].every(([tb, m]) => b.has(tb) && m.size === b.get(tb).size && [...m].every(([id, x]) => b.get(tb).get(id) === x));
    t(`güncelleme: numarası kaymış ${kayan} kayıt özetle eski yerine taşındı`, hz.hata.length === 0 && hz.s.tasinan === kayan && ayniTr(hz.tr, bek.tr));
    const hG = path.join(kok, 'guncelleme');
    mkdirSync(hG);
    const planG = planla(k, hz.tr, 'ayri', hG, { bozuk });
    t('güncelleme: taşınmış Türkçe biçim kapısından geçti', planG.hata.length === 0);
    if (!planG.hata.length) {
      kurulumYap(hG, planG, 'ayri', { bozuk });
      for (const [ad, ok] of kurulumuDogrula(hG, k, bek.tr, 'ayri', asil, null, { bozuk })) t(`güncelleme kurulumu: ${ad}`, ok);
    }
    // Oyun izi: kayda girer; durum değişen, düşen ve yeni parçayı söyler.
    const iz = oyunIzi(k.pck), izY = Object.keys(iz);
    const say = (re) => izY.filter((y) => re.test(y)).length;
    t(`oyun izi: ${izY.length} parça (her tablonun en ve da dosyası, ${say(/\.(ttf|otf)$/i)} font, dil listesi)`,
      say(/\.en\.translation$/) === k.tablolar.length && say(/\.da\.translation$/) === k.tablolar.length && say(/\.(ttf|otf)$/i) > 0 && IZ_LISTE in iz);
    const izD = { ...iz, [izY[0]]: '0'.repeat(64), 'res://yeni.ttf': 'x' };
    delete izD[IZ_LISTE];
    const f = izFarki(iz, izD, { bozuk });
    t('oyun izi: değişen, düşen ve yeni parça bulundu', JSON.stringify(f?.map((x) => x.ne).sort()) === JSON.stringify(['değişti', 'pakette yok', 'yeni']));
    t('oyun izi: aynı paket → fark yok · izsiz eski kayıt → bilinmiyor', izFarki(iz, iz).length === 0 && izFarki(undefined, iz) === null);
    // Kip değiştirerek yeniden kurulum: eski kipin dosyası kalmamalı.
    const h1 = path.join(kok, 'yeniden');
    mkdirSync(h1);
    kurulumYap(h1, planla(k, tr, 'ikisi', h1, { bozuk }), 'ikisi', { bozuk });
    kurulumYap(h1, planla(k, tr, 'ayri', h1, { bozuk }), 'ayri', { bozuk });
    t('yeniden kurulum (ikisi → ayri): Danca kopyası kalmadı', !readdirSync(path.join(h1, KLASOR)).some((a) => /\.da\./.test(a)));
    // Değişmiş dosyaya geri dokunmaz.
    const degisen = path.join(h1, KLASOR, `${k.tablolar[0]}.tr.translation`);
    writeFileSync(degisen, 'elle değişti');
    const g1 = geriAl(h1, { bozuk });
    t('geri: değişmiş dosyaya dokunmadı, söyledi', existsSync(degisen) && g1.kalan.length === 1 && !existsSync(path.join(h1, CFG)));
    // Yabancı override.cfg: hiçbir şey yazılmaz.
    const h2 = path.join(kok, 'yabanci');
    mkdirSync(h2);
    writeFileSync(path.join(h2, CFG), '[display]\nwindow/size/width=640\n');
    let ret = '';
    try { kurulumYap(h2, planla(k, tr, 'ayri', h2, { bozuk }), 'ayri', { bozuk }); } catch (e) { ret = e.message; }
    t('yabancı override.cfg: kur durdu, dosya aynı, turkce/ yok', /dokunmadım/.test(ret)
      && readFileSync(path.join(h2, CFG), 'utf8').startsWith('[display]') && !existsSync(path.join(h2, KLASOR)));
    // cfgMetni sınırları
    const atar = (f) => { try { f(); return false; } catch { return true; } };
    t('cfg: Türkçe harfli yol olduğu gibi yazılır', cfgMetni(['C:/Oyunlarım/Çanta İ/x.translation']).includes('"C:/Oyunlarım/Çanta İ/x.translation"'));
    t('cfg: tırnaklı, ters bölülü ya da kontrol karakterli yol reddedildi',
      atar(() => cfgMetni(['C:/a"b'])) && atar(() => cfgMetni(['C:\\a'])) && atar(() => cfgMetni(['C:/a\nb'])));
    // Oyunun dil ayarı: kopya kökte üç hesap (gerçek AppData'ya dokunulmaz).
    const ak = path.join(kok, 'ayar');
    const OZGUN = {
      111: '\n[Options]\n\nlanguage="en"\ncombat_speed=2.0\n\n[Wardrobe]\n\nPyromancer_Normal_Head=1\n', // oyundaki biçim
      222: '[Options]\r\n\r\ncombat_speed=2.0\r\n', // CRLF, language satırı yok
      333: '[Wardrobe]\n\nPyromancer_Normal_Head=1\n', // [Options] yok
    };
    const ay = (id) => path.join(ak, String(id), 'full', AYAR_ADI);
    const ayarKoy = () => { for (const [id, m] of Object.entries(OZGUN)) { mkdirSync(path.dirname(ay(id)), { recursive: true }); writeFileSync(ay(id), m); } };
    const ozgunMu = (id) => readFileSync(ay(id), 'utf8') === OZGUN[id];
    const hepsiOzgun = () => Object.keys(OZGUN).every(ozgunMu);
    ayarKoy();
    mkdirSync(path.join(ak, 'logs'));
    writeFileSync(path.join(ak, 'runs_steam.cache'), 'x');
    // Oyun hiç açılmamış: hesap klasörü olsa da backpack.cfg yoksa kur durur.
    const bosAk = path.join(kok, 'ayar-bos');
    mkdirSync(path.join(bosAk, '444', 'full'), { recursive: true });
    const ilk = (a, kip) => ilkAcilisMi(a, kip, null, { bozuk });
    t('ilk açılış: ayar dosyası yoksa ayri/ikisi durur; ayar varsa, Danca kipinde ve --hedef denemesinde durmaz',
      ilk(bosAk, 'ayri') && ilk(bosAk, 'ikisi') && ilk(path.join(kok, 'hic-yok'), 'ayri')
      && !ilk(ak, 'ayri') && !ilk(bosAk, 'da') && !ilk(null, 'ayri'));
    const h3 = path.join(kok, 'ayarli');
    mkdirSync(h3);
    const kurA = (kip) => kurulumYap(h3, planla(k, tr, kip, h3, { bozuk }), kip, { bozuk, ayarKok: ak });
    kurA('ayri');
    for (const [ad, ok] of kurulumuDogrula(h3, k, tr, 'ayri', asil, ak, { bozuk })) if (/oyun ayarı/.test(ad)) t(`ayar: ${ad}`, ok);
    t('ayar: üç hesapta dil "tr"', Object.keys(OZGUN).every((id) => dilOku(readFileSync(ay(id), 'utf8')) === TR_DEGER));
    let ga = geriAl(h3, { bozuk });
    t('ayar geri: üç dosya bayt bayt özgün', hepsiOzgun() && ga.kalan.length === 0);
    // Oyun dosyayı yeniden yazdı (111: başka ayar değişti) · kullanıcı menüden başka dil seçti (222).
    kurA('ikisi');
    writeFileSync(ay(111), readFileSync(ay(111), 'utf8').replace('combat_speed=2.0', 'combat_speed=3.0'));
    writeFileSync(ay(222), dilYaz(readFileSync(ay(222), 'utf8'), '"de"'));
    ga = geriAl(h3, { bozuk });
    const m111 = readFileSync(ay(111), 'utf8');
    t('ayar geri: oyun yeniden yazdıysa dil eski değere döndü, öteki ayar korundu', dilOku(m111) === '"en"' && m111.includes('combat_speed=3.0'));
    t('ayar geri: başka dil seçildiyse dokunulmadı, değişmeyen dosya özgün', dilOku(readFileSync(ay(222), 'utf8')) === '"de"' && ozgunMu(333));
    // Yeniden kurulum eski değeri korur; Danca kipi dil ayarına dokunmaz.
    ayarKoy();
    kurA('ikisi');
    const onceDil = dilDegerleri(ak, 'ayri');
    kurA('ayri');
    t('ayar: yeniden kurulumda eski değer özgün ("tr" değil)', kayitOku(h3).ayarlar.find((a) => a.yol === ileri(ay(111)))?.onceki === '"en"');
    const satir111 = dilSatiri(onceDil.get(ileri(ay(111))), kayitOku(h3).ayarlar.find((a) => a.yol === ileri(ay(111)))?.onceki, { bozuk });
    t('ayar çıktısı: yeniden kurulumda dosya zaten "tr" → "en → tr" basılmaz, ilk değer ayrıca söylenir',
      onceDil.get(ileri(ay(111))) === TR_DEGER && !satir111.includes('→') && satir111.includes('"en"')
      && dilSatiri('"en"', '"en"', { bozuk }) === `"en" → ${TR_DEGER}` && dilSatiri(null, null, { bozuk }) === `(satır yoktu) → ${TR_DEGER}`);
    geriAl(h3, { bozuk });
    t('ayar: yeniden kurulumdan sonra geri: bayt bayt özgün', hepsiOzgun());
    kurA('da');
    t('ayar: Danca kipi dil ayarına dokunmadı', hepsiOzgun() && kayitOku(h3).ayarlar.length === 0);
    geriAl(h3, { bozuk });
    // Belirsiz dosya (iki [Options]): hiçbir şey yazılmaz.
    const iki = OZGUN[111] + '\n[Options]\n\nlanguage="fr"\n';
    writeFileSync(ay(111), iki);
    let ret2 = '';
    try { kurA('ayri'); } catch (e) { ret2 = e.message; }
    t('ayar: iki [Options] bölümünde kur durdu, hiçbir şey yazılmadı', /dokunmadım/.test(ret2)
      && readFileSync(ay(111), 'utf8') === iki && ozgunMu(222) && !existsSync(path.join(h3, CFG)));

    // ---- Oyun hiç açılmamış: dil ayarı Steam hesabının klasörüne oluşturulur.
    // Oyunun ilk açılışta yazdığı metin (ölçüm 09.11.2026, oyun-goz ac --appdata): 25 bayt, LF.
    const OLCULEN_ILK = '[Options]\n\nlanguage="en"\n';
    t('ilk ayar: oyunun ilk açılış metninin "tr"lisi (25 bayt, LF; dilYaz ile aynı)',
      Buffer.byteLength(ILK_AYAR) === 25 && !ILK_AYAR.includes('\r') && dilYaz(OLCULEN_ILK, TR_DEGER) === ILK_AYAR);
    // Hesap sırası: Steam'de açık hesap · otomatik giriş hesabı · MostRecent "1" olan tek hesap · tek hesap.
    // Numaralar uydurma (hesap no 1 ve 2); SteamID64 = 76561197960265728 + hesap no.
    const A = '76561197960265729', B = '76561197960265730';
    const kul = (x) => `\t"${x.id}"\n\t{\n\t\t"AccountName"\t\t"${x.ad}"\n${x.son ? `\t\t"MostRecent"\t\t"${x.son}"\n` : ''}\t}\n`;
    const vdf = (...l) => `"users"\n{\n${l.map(kul).join('')}}\n`;
    const v2 = vdf({ id: A, ad: 'birinci', son: '0' }, { id: B, ad: 'İkinci', son: '1' });
    const sec = (aktif, otoGiris, v) => { const r = hesapSec({ aktif, otoGiris, vdf: v }, { bozuk }); return `${r.kesin?.id ?? '-'} ${r.kesin?.nasil ?? '-'} ${r.hepsi.join(',')}`; };
    t('hesap: Steam\'de açık hesap (ActiveUser 2) otomatik giriş hesabından önce gelir, numara SteamID64\'e çevrilir',
      sec('2', 'birinci', v2) === `${B} Steam'de açık hesap ${A},${B}`);
    t('hesap: ActiveUser 0 (Steam kapalı) → otomatik giriş hesabı, adın büyük/küçük harfi önemsiz',
      sec('0', 'BIRINCI', v2) === `${A} Steam otomatik giriş hesabı ${A},${B}`);
    t('hesap: açık ve otomatik giriş yok (ya da tutmuyor) → MostRecent "1" olan tek hesap',
      sec('0', '', v2) === `${B} Steam'e son giren hesap ${A},${B}` && sec(null, 'baskasi', v2) === sec('0', '', v2));
    t('hesap: tek hesap · iki hesap ve ipucu yok → kesin değil, ikisi de listede · vdf yok → boş',
      sec(null, null, vdf({ id: A, ad: 'birinci' })) === `${A} Steam'deki tek hesap ${A}`
      && sec(null, null, vdf({ id: A, ad: 'birinci' }, { id: B, ad: 'İkinci' })) === `- - ${A},${B}` && sec(null, null, null) === '- - ');
    // ayarPlani: hangi dosyalara yazılır.
    const pk = path.join(kok, 'ayar-plan'), pBos = path.join(kok, 'ayar-plan-bos');
    mkdirSync(path.dirname(ayarYolu(pk, A)), { recursive: true });
    writeFileSync(ayarYolu(pk, A), OLCULEN_ILK);
    const pl = (kokX, hesap, kip = 'ayri') => { const p = ayarPlani(kokX, kip, hesap, { bozuk }); return JSON.stringify([p.varolan, p.yeni]); };
    const j = (v, y) => JSON.stringify([v, y]);
    const kesinYok = { kesin: null, hepsi: [A, B] }, kesinB = { kesin: { id: B, nasil: 'sınama' }, hepsi: [A, B] };
    t('ayar planı: dosya yok, kesin hesap yok → Steam\'e girmiş bütün hesaplara yeni dosya',
      pl(pBos, kesinYok) === j([], [ayarYolu(pBos, A), ayarYolu(pBos, B)]));
    t('ayar planı: dosya var, kesin hesap yok → yalnızca var olan · kesin hesap var olanlara eklenir · kesin hesabın dosyası varsa yeni yok',
      pl(pk, kesinYok) === j([ayarYolu(pk, A)], []) && pl(pk, kesinB) === j([ayarYolu(pk, A)], [ayarYolu(pk, B)])
      && pl(pk, { kesin: { id: A, nasil: 'sınama' }, hepsi: [A] }) === j([ayarYolu(pk, A)], []));
    t('ayar planı: Danca kipinde ve ayar kökü yokken (--hedef denemesi) hiçbir dosya',
      pl(pBos, kesinB, 'da') === j([], []) && pl(null, kesinB) === j([], []));
    // ilkAcilisMi: dosya yokken hesap bulunduysa durmaz, bulunamadıysa durur.
    const ilkH = (a, h) => ilkAcilisMi(a, 'ayri', h, { bozuk });
    t('ilk açılış: dosya yok ama hesap var (kesin ya da Steam\'e girmiş) → durmaz · hesap yok → durur',
      !ilkH(bosAk, kesinB) && !ilkH(path.join(kok, 'hic-yok'), kesinYok) && ilkH(bosAk, { kesin: null, hepsi: [] }) && ilkH(bosAk, null));
    // Kurulum: ayar kökü de yok (oyun bu bilgisayarda hiç açılmamış).
    const h4 = path.join(kok, 'ilk-acilis');
    mkdirSync(h4);
    const ust = path.join(kok, 'ayar-hic'), yk = path.join(ust, 'Backpack Battles');
    const yA = ayarYolu(yk, A), yB = ayarYolu(yk, B);
    const kurY = (hesap) => kurulumYap(h4, planla(k, tr, 'ayri', h4, { bozuk }), 'ayri', { bozuk, ayarKok: yk, hesap });
    const ilkMi = (y) => existsSync(y) && readFileSync(y, 'utf8') === ILK_AYAR;
    kurY(kesinB);
    t('ilk açılış kurulumu: kesin hesabın dosyası oyunun biçiminde oluşturuldu, öteki hesaba yazılmadı',
      ilkMi(yB) && !existsSync(path.join(yk, A)));
    for (const [ad, ok] of kurulumuDogrula(h4, k, tr, 'ayri', asil, yk, { bozuk })) if (/oyun ayarı/.test(ad)) t(`ilk açılış kurulumu: ${ad}`, ok);
    const kB = kayitOku(h4).ayarlar;
    t('ilk açılış kurulumu: kayıtta "oluşturuldu", önceki değer yok, açılan klasörler', kB.length === 1 && kB[0].olusturuldu === true
      && kB[0].onceki === null && kB[0].klasorler?.includes(ileri(ust)));
    let gi = geriAl(h4, { bozuk });
    t('ilk açılış geri: oluşturulan dosya ve kurucunun açtığı klasörler silindi', gi.kalan.length === 0 && !existsSync(ust) && readdirSync(h4).length === 0);
    // Oyun açıldı: dosyayı kendi biçiminde yeniden yazdı, başka ayar ekledi, klasöre kayıt koydu.
    kurY(kesinB);
    writeFileSync(yB, '\n[Options]\n\nlanguage="tr"\ncombat_speed=2.0\n');
    writeFileSync(path.join(path.dirname(yB), 'backpack.save'), 'x');
    gi = geriAl(h4, { bozuk });
    const mB = existsSync(yB) ? readFileSync(yB, 'utf8') : '';
    t('ilk açılış geri: oyun dosyayı yeniden yazdıysa dil "en" (oyunun ilk değeri), öteki ayar ve oyunun dosyası kaldı',
      gi.kalan.length === 0 && dilOku(mB) === '"en"' && mB.includes('combat_speed=2.0') && existsSync(path.join(path.dirname(yB), 'backpack.save')));
    // Kesin hesap yok: Steam'e girmiş iki hesap. Yeniden kurulumda hesap bulunamasa da önceki
    // kurulumun oluşturduğu dosyalar yeniden oluşturulur.
    rmSync(ust, { recursive: true, force: true });
    kurY(kesinYok);
    t('ilk açılış, kesin hesap yok: Steam\'e girmiş iki hesabın dosyası da oluşturuldu', ilkMi(yA) && ilkMi(yB));
    kurY({ kesin: null, hepsi: [] });
    const dY = kurulumuDogrula(h4, k, tr, 'ayri', asil, yk, { bozuk });
    t('ilk açılış yeniden kurulum, hesap bulunamadı: önceki kurulumun iki dosyası yine oluşturuldu, doğrulama geçti',
      ilkMi(yA) && ilkMi(yB) && kayitOku(h4).ayarlar.filter((a) => a.olusturuldu).length === 2 && dY.every((x) => x[1]));
    gi = geriAl(h4, { bozuk });
    t('ilk açılış yeniden kurulumdan sonra geri: dosyalar ve klasörler silindi', gi.kalan.length === 0 && !existsSync(ust));
    // Karşı test: dil hiçbir dosyaya yazılmamış kurulumu doğrulama "tamam" saymaz.
    const h5 = path.join(kok, 'ayarsiz');
    mkdirSync(h5);
    kurulumYap(h5, planla(k, tr, 'ayri', h5, { bozuk }), 'ayri', { bozuk, ayarKok: bosAk, hesap: null });
    const dZ = kurulumuDogrula(h5, k, tr, 'ayri', asil, bosAk, { bozuk });
    t('doğrulama: ayar kökü varken hiçbir dosyaya yazılmadıysa düşer', dZ.some(([ad, ok]) => /en az bir dosya/.test(ad) && !ok));
    geriAl(h5, { bozuk });
  } catch (e) {
    t('sınama koştu (' + e.message.split('\n')[0] + ')', false);
  } finally {
    rmSync(kok, { recursive: true, force: true });
  }
  return sonuc;
}

function sina(pckYolu, bozukMu) {
  const once = sha256(pckYolu);
  const k = kapiKur(pckYolu);
  const ozet = (b) => { const s = sinaKos(k, b); return { gecen: s.filter((x) => x[1]).length, toplam: s.length, dusen: s.filter((x) => !x[1]).map((x) => x[0]) }; };
  const s = ozet('');
  for (const ad of s.dusen) console.log('DÜŞTÜ:', ad);
  console.log(`override-kur sınama: ${s.gecen}/${s.toplam}`);
  let yakalanan = 0;
  const BOZMALAR = ['dolgu', 'locale', 'liste', 'goreli', 'yabanci', 'geri', 'ayar', 'ayar-geri', 'dil-adi', 'dil-liste', 'dil-cikti', 'tasima', 'iz', 'cfg-yaz', 'cfg-oku', 'ilk-acilis',
    'olustur', 'olustur-geri', 'ilk-ayar', 'hesap-aktif', 'olustur-yeniden'];
  if (bozukMu) {
    for (const b of BOZMALAR) {
      const r = ozet(b);
      if (r.gecen < r.toplam) { yakalanan++; console.log(`bozma "${b}": yakalandı (${r.toplam - r.gecen} test düştü: ${r.dusen.slice(0, 2).join(' · ')})`); }
      else console.log(`bozma "${b}": YAKALANMADI`);
    }
    console.log(`override-kur sabotaj: ${yakalanan}/${BOZMALAR.length} yakalandı`);
  }
  closeSync(k.pck.fd);
  const ayni = sha256(pckYolu) === once;
  console.log(`gerçek pck sha256 sınamadan önce ve sonra ${ayni ? 'aynı' : 'FARKLI'}`);
  process.exit(s.gecen === s.toplam && ayni && (!bozukMu || yakalanan === BOZMALAR.length) ? 0 : 1);
}

// ---------------------------------------------------------------- komutlar
// Çıkış: 0 kurulu ve oyun kurulumdan beri aynı (ya da kurulu değil) · 3 oyun değişmiş ya da
// kayıtta iz yok (yeniden kurulmalı).
function durumBas(hedef, pckYolu) {
  const kayit = kayitOku(hedef);
  if (!kayit) {
    console.log(existsSync(path.join(hedef, CFG)) ? `${CFG} var ama bu kurucunun kaydı yok (başka bir şey yazmış, dokunulmaz)` : `kurulu değil (${CFG} yok)`);
    return 0;
  }
  console.log(`kurulu: kip ${kayit.kip} · ${kayit.tarih}`);
  for (const d of kayit.dosyalar) {
    const y = path.join(hedef, ...d.yol.split('/'));
    console.log(`  ${(!existsSync(y) ? 'YOK' : ozet256(readFileSync(y)) === d.sha256 ? 'sağlam' : 'DEĞİŞMİŞ').padEnd(8)} ${d.yol}`);
  }
  for (const a of kayit.ayarlar || []) {
    let simdi;
    try { simdi = existsSync(a.yol) ? dilOku(ayarMetni(a.yol)) ?? '(satır yok)' : 'DOSYA YOK'; } catch (e) { simdi = 'OKUNAMADI: ' + e.message; }
    console.log(`  dil ayarı şimdi ${simdi} · kurulumdan önce ${a.olusturuldu ? 'dosya yoktu (kurucu oluşturdu)' : a.onceki ?? '(satır yoktu)'} · ${a.yol}`);
  }
  const p = pckAc(pckYolu);
  let f;
  try { f = izFarki(kayit.oyun, oyunIzi(p)); } finally { closeSync(p.fd); }
  const yeniden = `yeniden kur: TURKCE-KUR.cmd (ya da node tools/override-kur.mjs kur ${pckYolu} ceviri/tr)`;
  if (f === null) { console.log(`oyun: kayıtta oyun izi yok (izden önceki kurulum), değişip değişmediği bilinmiyor → ${yeniden}`); return 3; }
  if (!f.length) { console.log('oyun: kurulumdan beri Türkçeyi etkileyen parça değişmedi'); return 0; }
  for (const x of f) console.log(`  oyunda ${x.ne.padEnd(11)} ${x.yol}`);
  const font = f.filter((x) => /\.(ttf|otf)$/i.test(x.yol)).length;
  if (f.length > font) console.log(`oyun GÜNCELLENMİŞ: ${f.length - font} çeviri parçası değişti → ${yeniden} (Türkçe kendiliğinden yeni numaralara taşınır)`);
  if (font) console.log(`font değişti (${font}): Türkçe harfler yeniden ölçülmeli → node tools/font-cizim.mjs ${pckYolu}`);
  return 3;
}

const SECIM = {
  ayri: 'oyun Türkçe açılır; menüden başka dil seçilirse Türkçeye yeniden kurarak dönülür',
  da: 'menüde "Dansk" seçilince Türkçe',
  ikisi: 'oyun Türkçe açılır; menüde "Dansk" da Türkçe',
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const secenek = (ad) => { const i = args.indexOf(ad); return i >= 0 ? args[i + 1] : undefined; };
  const duz = args.filter((a, i) => !a.startsWith('--') && !['--kip', '--hedef', '--ayar-kok', '--hesap'].includes(args[i - 1]));
  const kullanim = 'kullanım: node tools/override-kur.mjs kur <pck> <tr-dizini> [--kip ayri|da|ikisi] [--hedef <dizin>] [--ayar-kok <dizin>] [--hesap <SteamID64|yok>] [--paket] | geri <pck> | durum <pck> | liste <pck> | --sina [--bozuk] <pck>';
  try {
    if (args.includes('--sina') && duz[0]) sina(duz[0], args.includes('--bozuk'));
    else if (duz[0] === 'liste' && duz[1]) {
      const p = pckAc(duz[1]);
      const l = dilListesi(p);
      closeSync(p.fd);
      for (const y of l) console.log(y);
      console.log(`${l.length} yol (${l.filter((y) => DA_RE.test(y)).length} Danca)`);
    } else if (['kur', 'geri', 'durum'].includes(duz[0]) && duz[1] && (duz[0] !== 'kur' || duz[2])) {
      const hedef = path.resolve(secenek('--hedef') || path.dirname(path.resolve(duz[1])));
      if (!secenek('--hedef') && !existsSync(path.join(hedef, 'BackpackBattles.exe'))) throw new Error(`${hedef} içinde BackpackBattles.exe yok: override.cfg exe'nin yanında olmalı`);
      // Deneme kurulumu (--hedef) gerçek dil ayarına yalnızca --ayar-kok ile dokunur.
      const ayarKok = secenek('--ayar-kok') ? path.resolve(secenek('--ayar-kok')) : secenek('--hedef') ? null : AYAR_KOK;
      const gercek = !secenek('--hedef') || secenek('--ayar-kok');
      if (duz[0] !== 'durum' && gercek && oyunAcikMi()) { console.log('oyun açık: önce kapat (kapanırken dil ayarını yeniden yazar)'); process.exit(1); }
      if (duz[0] === 'durum') process.exit(durumBas(hedef, duz[1]));
      else if (duz[0] === 'geri') {
        const g = geriAl(hedef);
        for (const a of g.ayar) console.log('dil ayarı: ' + a);
        if (g.yok) console.log('kurulum kaydı yok' + (g.kalan.length ? ': ' + g.kalan[0] : ', geri alınacak bir şey yok'));
        else console.log(`silinen ${g.silinen.length} dosya${g.kalan.length ? '\nKALAN:\n  ' + g.kalan.join('\n  ') : ', geri alma tam'}`);
        process.exit(g.kalan.length ? 1 : 0);
      } else {
        const kip = secenek('--kip') || 'ayri';
        // Oyun hiç açılmamışsa dil ayarı Steam hesabının klasörüne oluşturulur (ayarPlani).
        // --hesap: sınama ve elle deneme; "yok" = hesap aranmaz.
        const hs = secenek('--hesap');
        if (hs !== undefined && hs !== 'yok' && !/^7656119\d{10}$/.test(hs)) throw new Error('--hesap 17 haneli SteamID64 ya da "yok" olmalı');
        const hesap = !ayarKok || kip === 'da' ? null
          : hs === 'yok' ? { kesin: null, hepsi: [] }
          : hs ? { kesin: { id: hs, nasil: '--hesap' }, hepsi: [hs] }
          : steamHesaplari();
        if (ilkAcilisMi(ayarKok, kip, hesap)) {
          console.log(`oyun bu bilgisayarda hiç açılmamış (dil ayarı dosyası ${AYAR_ADI} yok: ${ayarKok}) ve Steam hesabı bulunamadı.`);
          console.log('hiçbir şey yazılmadı: Steam\'i açıp hesabına gir (ya da oyunu bir kez açıp kapat), sonra yeniden kur.');
          process.exit(4);
        }
        const k = kapiKur(duz[1]);
        // Türkçe numarayla değil en özetiyle eşlenir: oyun güncellendiyse yeni numaralara taşınır.
        const o = trHazirla(k, duz[2]);
        if (o.s) console.log(tasimaSatiri(o.s));
        const plan = o.hata.length ? { hata: o.hata, uyari: [] } : planla(k, o.tr, kip, hedef);
        // Dosyada en ile aynı yazılmış kayıt bilerek aynıdır (özel ad; kural metin-olc.mjs → trDolu),
        // kapı da öyle sayar: tek satırda toplanır.
        const ayni = plan.uyari.filter((u) => u.endsWith(' ' + AYNI_UYARI));
        for (const u of plan.uyari) if (!ayni.includes(u)) console.log('uyarı: ' + u);
        // Paket penceresinde kayıt numaraları kullanıcıya bir şey söylemez: yalnızca sayı.
        if (ayni.length) console.log(`bilerek aynı (en ile aynı yazılmış): ${ayni.length} kayıt${args.includes('--paket') ? '' : ': ' + ayni.map((u) => u.split(' ')[0]).join(' ')}`);
        for (const h of plan.hata) console.log('HATA: ' + h);
        if (plan.hata.length) { console.log(`\n${plan.hata.length} hata: hiçbir şey yazılmadı.`); closeSync(k.pck.fd); process.exit(1); }
        const onceDil = dilDegerleri(ayarKok, kip);
        kurulumYap(hedef, plan, kip, { ayarKok, hesap });
        const d = kurulumuDogrula(hedef, k, o.tr, kip, plan.asil, ayarKok);
        closeSync(k.pck.fd);
        for (const [ad, ok] of d) console.log(`${ok ? 'tamam' : 'DÜŞTÜ'}  ${ad}`);
        if (!d.every((x) => x[1])) { const g = geriAl(hedef); console.log(`doğrulama düştü: kurulum geri alındı (${g.silinen.length} dosya silindi)`); process.exit(1); }
        for (const z of plan.ozet) console.log(`  ${z.tablo.padEnd(15)} Türkçe ${String(z.turkce).padStart(4)} / ${String(z.toplam).padStart(4)} kayıt`);
        const ay = kayitOku(hedef).ayarlar;
        for (const a of ay) {
          console.log(`  dil ayarı ${path.relative(ayarKok, a.yol)}: ${a.olusturuldu
            ? `dosya yoktu (oyun bu hesapla hiç açılmamış), oyunun biçiminde oluşturuldu: language=${TR_DEGER} · hesap: ${hesap?.kesin?.nasil ?? "kesin değil, Steam'e girmiş bütün hesaplar"}`
            : dilSatiri(onceDil.get(a.yol), a.onceki)}`);
        }
        if (plan.dilAdi) console.log(`  menüdeki dil satırı: "${plan.dilAdi.cift[0]}" → "${plan.dilAdi.cift[1]}" (oyunda görüldü, 09.11.2026)`);
        let secim = SECIM[kip];
        // Ayar kökü varken yazılacak dosya yoksa yukarıda çıkış 4; buraya yalnızca --hedef denemesi düşer.
        if (kip !== 'da' && !ay.length) secim = `dil ayarı YAZILMADI: ${ayarKok ? `ayar dosyası yok (${ayarKok})` : '--hedef verildi, --ayar-kok yok'}`;
        console.log(`kuruldu: kip ${kip} · ${plan.dosyalar.size} Türkçe dosya + ${CFG} · ${secim}`);
        console.log(args.includes('--paket')
          ? `kaldırmak: kurucuya yeniden çift tıklayıp K seçin (ya da oyun klasöründeki ${CFG} dosyasını silin)`
          : `geri almak: node tools/override-kur.mjs geri ${duz[1]}  (ya da ${CFG} dosyasını silmek)`);
      }
    } else { console.log(kullanim); process.exit(2); }
  } catch (e) { console.log('HATA: ' + e.message); process.exit(1); }
}
