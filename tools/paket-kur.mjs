#!/usr/bin/env node
// Türkçe kurulumunun girişi: kurucu exe (tools/kurucu/Kurucu.cs) kendini geçici klasöre açıp
// bunu içindeki node.exe ile çağırır (bilgisayarda Node kurulu olması gerekmez). Oyun klasörünü
// kendisi bulur, sonra tools/override-kur.mjs'yi aynı node ile çalıştırır (kip ayri).
// Exe tools/paket-yap.mjs ile üretilir ve orada uçtan uca sınanır.
//
// Oyun klasörü (ilk bulunan; klasörde BackpackBattles.exe ve BackpackBattles.pck olmalı):
//   1. başlangıç klasörü ve 3 üstü: --baslangic (exe kendi klasörünü verir; exe oyun klasörüne
//      konduysa ilk adımda bulunur), verilmezse tools klasörünün bir üstü (depo oyun klasörüne
//      indirildiyse)
//   2. Steam: kayıt defteri HKCU\Software\Valve\Steam → SteamPath (yoksa HKLM → InstallPath)
//      → <steam>/steamapps/libraryfolders.vdf ("path" değerleri) → her kütüphanede
//      steamapps/appmanifest_2427700.acf → "installdir" → steamapps/common/<installdir>
//   3. varsayılan Steam klasörü (C:\Program Files (x86)\Steam), aynı yolla
// Kayıt defteri `reg export` ile okunur: dosyayı UTF-16 yazar, Türkçe harfli yol konsol kod
// sayfasına takılmaz (`reg query` çıktısı OEM kod sayfasında, ölçüldü 09.11.2026).
//
// Kullanım:
//   node tools/paket-kur.mjs oto [ortak]     Türkçe kurulu değilse kurar; kuruluysa sorar:
//                                            Enter yeniden kurar, K kaldırır (exe argümansız)
//   node tools/paket-kur.mjs kur [ortak]
//   node tools/paket-kur.mjs kaldir [--oyun <dizin>] [--baslangic <dizin>]
//   node tools/paket-kur.mjs bul [--baslangic <dizin>]
//   ortak: [--baslangic <dizin>] [--oyun <dizin> --ayar-kok <dizin> [--hesap <SteamID64|yok>]]
// --oyun yalnızca sınama içindir (kopya oyun klasörü); kur/oto'da --ayar-kok da ister: kopya
// kurulum gerçek dil ayarına dokunmasın. --hesap override-kur'a geçer (sınama).
// Çıkış: 0 tamam · 1 hata · 2 kullanım · 4 oyun bu bilgisayarda hiç açılmamış ve Steam hesabı
// bulunamadı (override-kur hiçbir şey yazmadı) · 5 oyun klasörü bulunamadı.
//
// Kütüphane: import { oyunBul, steamKlasorleri, steamHesaplari, hesapSec, regMetniDeger, vdfDegerleri } from './paket-kur.mjs'

import { existsSync, readFileSync, mkdtempSync, rmSync, readSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BURASI = path.dirname(fileURLToPath(import.meta.url));
const OVERRIDE_KUR = path.join(BURASI, 'override-kur.mjs');
const TR_DIZIN = path.join(BURASI, '..', 'ceviri', 'tr');
export const OYUN_EXE = 'BackpackBattles.exe', OYUN_PCK = 'BackpackBattles.pck', APP_ID = '2427700';
export const DEPO = 'https://github.com/vechiron/BackpackBattles-TR'; // Kurucu.cs'e paket-yap yazar (@DEPO@)
const SISTEM = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const VARSAYILAN_STEAM = 'C:\\Program Files (x86)\\Steam';
const KAYITLAR = [
  ['HKCU\\Software\\Valve\\Steam', 'SteamPath'],
  ['HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'],
  ['HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath'],
];

export const oyunMu = (d) => existsSync(path.join(d, OYUN_EXE)) && existsSync(path.join(d, OYUN_PCK));

// Valve KeyValues metni: "anahtar"<boşluk>"değer" çiftleri; değerde \\ → \ ve \" → ".
export function vdfDegerleri(metin, anahtar) {
  const re = new RegExp(`"${anahtar}"[ \\t]+"((?:[^"\\\\]|\\\\.)*)"`, 'gi');
  return [...metin.matchAll(re)].map((m) => m[1].replace(/\\(.)/g, '$1'));
}

// `reg export` dosyasının metni (BOM'suz): ilk bölüm anahtarın kendisi, alt anahtarlar sonra
// gelir; yalnızca ilk bölümdeki "ad"="değer" okunur. Değerde \\ → \ ve \" → ".
// REG_DWORD ("ad"=dword:0000d303) ondalık metin olarak döner ("54019"; örnek numara uydurma).
export function regMetniDeger(metin, ad, { bozuk = '' } = {}) {
  const bolumler = metin.split(/\r?\n(?=\[)/);
  const ilk = bolumler.find((b) => b.startsWith('['));
  if (!ilk) return null;
  for (const s of ilk.split(/\r?\n/)) {
    const m = s.match(/^"((?:[^"\\]|\\.)*)"="((?:[^"\\]|\\.)*)"$/);
    if (m && m[1].toLowerCase() === ad.toLowerCase()) return m[2].replace(/\\(.)/g, '$1');
    const d = s.match(/^"((?:[^"\\]|\\.)*)"=dword:([0-9a-fA-F]{8})$/);
    if (d && d[1].toLowerCase() === ad.toLowerCase() && bozuk !== 'dword') return String(parseInt(d[2], 16));
  }
  return null;
}

export function regDeger(anahtar, ad, { bozuk = '' } = {}) {
  if (bozuk === 'kayit' || process.platform !== 'win32') return null;
  const gecici = mkdtempSync(path.join(os.tmpdir(), 'turkce-reg-'));
  const dosya = path.join(gecici, 'k.reg');
  try {
    const r = spawnSync(path.join(SISTEM, 'reg.exe'), ['export', anahtar, dosya, '/y'], { stdio: 'ignore', windowsHide: true });
    if (r.status !== 0 || !existsSync(dosya)) return null;
    const b = readFileSync(dosya);
    const metin = b[0] === 0xff && b[1] === 0xfe ? b.toString('utf16le', 2) : b.toString('utf8');
    return regMetniDeger(metin, ad, { bozuk });
  } finally {
    rmSync(gecici, { recursive: true, force: true });
  }
}

// Steam klasörleri: kayıt defterindekiler, sonra varsayılan; büyük/küçük harf farkı tekrar sayılmaz.
export function steamKlasorleri({ bozuk = '' } = {}) {
  const hepsi = [];
  for (const [anahtar, ad] of KAYITLAR) { const d = regDeger(anahtar, ad, { bozuk }); if (d) hepsi.push(path.resolve(d)); }
  hepsi.push(VARSAYILAN_STEAM);
  const gorulen = new Set();
  return hepsi.filter((d) => { const k = d.toLowerCase(); if (gorulen.has(k)) return false; gorulen.add(k); return true; });
}

// ---------------------------------------------------------------- Steam hesabı
// Oyunun ayar klasörü <ayar-kök>/<SteamID64>/full; SteamID64 = STEAM_TABAN + hesap no (ölçüldü
// 09.11.2026: ActiveUser ve userdata/<no> ile tuttu; oyun ilk açılışta bu klasörü kendisi açıyor).
// Oyun hiç açılmamışken kurucu dil ayarını oraya yazar (override-kur.mjs → ayarPlani).
export const STEAM_TABAN = 76561197960265728n;
export const ID64 = /^7656119\d{10}$/;

// loginusers.vdf: "users" { "<SteamID64>" { "AccountName" "…" "MostRecent" "1" … } … }
// (bu bilgisayarda MostRecent yok, eski Steam sürümleri yazıyor).
export function loginKullanicilari(metin) {
  const l = [];
  for (const m of metin.matchAll(/"(\d{17})"\s*\{([^{}]*)\}/g)) {
    if (!ID64.test(m[1])) continue;
    l.push({ id: m[1], ad: vdfDegerleri(m[2], 'AccountName')[0] ?? null, enSon: vdfDegerleri(m[2], 'MostRecent')[0] === '1' });
  }
  return l;
}

// Kesin hesap sırası: Steam'de şu an açık hesap (ActiveUser; Steam kapalıyken 0) · otomatik giriş
// hesabı (AutoLoginUser = AccountName) · MostRecent "1" olan tek hesap · tek hesap.
// Dönüş { kesin: { id, nasil } | null, hepsi: [loginusers.vdf'teki bütün SteamID64'ler] }.
export function hesapSec({ aktif, otoGiris, vdf }, { bozuk = '' } = {}) {
  const k = vdf ? loginKullanicilari(vdf) : [];
  const hepsi = k.map((x) => x.id);
  const no = aktif && /^\d+$/.test(aktif) ? BigInt(aktif) : 0n;
  if (no > 0n && bozuk !== 'hesap-aktif') return { kesin: { id: String(STEAM_TABAN + no), nasil: "Steam'de açık hesap" }, hepsi };
  const oto = otoGiris ? k.filter((x) => x.ad && x.ad.toLowerCase() === otoGiris.toLowerCase()) : [];
  if (oto.length === 1) return { kesin: { id: oto[0].id, nasil: 'Steam otomatik giriş hesabı' }, hepsi };
  const son = k.filter((x) => x.enSon);
  if (son.length === 1) return { kesin: { id: son[0].id, nasil: "Steam'e son giren hesap" }, hepsi };
  if (k.length === 1) return { kesin: { id: k[0].id, nasil: "Steam'deki tek hesap" }, hepsi };
  return { kesin: null, hepsi };
}

export function steamHesaplari({ bozuk = '' } = {}) {
  const vdf = steamKlasorleri({ bozuk }).map((s) => path.join(s, 'config', 'loginusers.vdf')).find((y) => existsSync(y));
  return hesapSec({
    aktif: regDeger('HKCU\\Software\\Valve\\Steam\\ActiveProcess', 'ActiveUser', { bozuk }),
    otoGiris: regDeger('HKCU\\Software\\Valve\\Steam', 'AutoLoginUser', { bozuk }),
    vdf: vdf ? readFileSync(vdf, 'utf8') : null,
  }, { bozuk });
}

// Bir Steam klasörünün kütüphaneleri: klasörün kendisi + libraryfolders.vdf'teki "path"ler.
export function kutuphaneler(steam, { bozuk = '' } = {}) {
  const vdf = path.join(steam, 'steamapps', 'libraryfolders.vdf');
  const yollar = [steam];
  if (existsSync(vdf)) yollar.push(...vdfDegerleri(readFileSync(vdf, 'utf8'), 'path').map((y) => path.resolve(y)));
  const tekil = [...new Map(yollar.map((y) => [y.toLowerCase(), y])).values()];
  return bozuk === 'ilk-kutuphane' ? tekil.slice(0, 1) : tekil;
}

// Kütüphanedeki oyun klasörü: appmanifest'teki installdir; kayıt yoksa ya da tutmazsa adıyla.
export function steamOyunu(kutuphane) {
  const sa = path.join(kutuphane, 'steamapps');
  const acf = path.join(sa, `appmanifest_${APP_ID}.acf`);
  const adaylar = [];
  if (existsSync(acf)) adaylar.push(...vdfDegerleri(readFileSync(acf, 'utf8'), 'installdir'));
  adaylar.push('Backpack Battles');
  for (const a of adaylar) { const d = path.join(sa, 'common', a); if (oyunMu(d)) return d; }
  return null;
}

// Dönüş: { dizin, nasil } ya da null.
export function oyunBul(baslangic, steamlar, { bozuk = '' } = {}) {
  let d = path.resolve(baslangic);
  for (let i = 0; i < (bozuk === 'ust' ? 1 : 4); i++) {
    if (oyunMu(d)) return { dizin: d, nasil: i === 0 ? 'bu klasör' : `bu klasörün ${i} üstü` };
    const u = path.dirname(d);
    if (u === d) break;
    d = u;
  }
  for (const s of steamlar) {
    for (const k of kutuphaneler(s, { bozuk })) {
      const o = steamOyunu(k);
      if (o) return { dizin: o, nasil: `Steam kütüphanesi: ${k}` };
    }
  }
  return null;
}

function bulunamadi() {
  console.log('\nOyun klasörü bulunamadı.');
  console.log('Kurucuyu oyun klasörüne (BackpackBattles.exe dosyasının yanına) taşıyıp yeniden çift tıklayın.');
  console.log('Oyun klasörünü bulmak için Steam\'de: Kütüphane → Backpack Battles → sağ tık → Yönet → Yerel dosyalara göz at.');
}

function calistir(args) {
  const r = spawnSync(process.execPath, [OVERRIDE_KUR, ...args], { stdio: 'inherit', windowsHide: true });
  return r.status ?? 1;
}

// Konsoldan bir satır (Enter'a kadar). Girdi kapalıysa ya da boşsa boş metin.
function satirOku() {
  const b = Buffer.alloc(256);
  let s = '';
  try {
    for (;;) {
      const n = readSync(0, b, 0, b.length, null);
      if (n <= 0) break;
      s += b.toString('latin1', 0, n);
      if (s.includes('\n')) break;
    }
  } catch { /* girdi yok (EOF) */ }
  return s.split(/\r?\n/)[0].trim();
}

// oto: kurulum kaydı varsa sorar (Enter yeniden kurar, K kaldırır), yoksa kurar.
// Kayıt override-kur'un (kayitOku); dinamik import: iki modül birbirini import ediyor.
async function otoSec(oyunDizin) {
  const { kayitOku } = await import('./override-kur.mjs');
  if (!kayitOku(oyunDizin)) return 'kur';
  console.log('Türkçe bu oyunda zaten kurulu.');
  console.log('  Enter       : yeniden kur (oyun güncellendiyse ya da menüden başka bir dil seçtiyseniz)');
  console.log('  K ve Enter  : Türkçeyi kaldır (oyun eski diline döner)');
  process.stdout.write('Seçiminiz: ');
  const s = satirOku();
  console.log('');
  return /^k/i.test(s) ? 'kaldir' : 'kur';
}

// Ana blok async fonksiyonda, üst seviyede await yok: override-kur bu modülü statik
// import ediyor; ana modül üst seviyede beklerken override-kur'u dinamik import ederse
// override-kur bu modülün bitmesini bekler, bu modül onu: Node "unsettled top-level
// await" deyip sessizce çıkar (oto hiç çalışmıyordu; paket-yap --sina, 09.11.2026).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) (async () => {
  const args = process.argv.slice(2);
  const secenek = (ad) => { const i = args.indexOf(ad); return i >= 0 ? args[i + 1] : undefined; };
  const komut = args[0];
  let cikis = 2;
  try {
    if (!['oto', 'kur', 'kaldir', 'bul'].includes(komut)) {
      console.log('kullanım: node tools/paket-kur.mjs oto|kur [--baslangic <dizin>] [--oyun <dizin> --ayar-kok <dizin> [--hesap <SteamID64|yok>]] | kaldir [--oyun <dizin>] | bul [--baslangic <dizin>]');
    } else if (['kur', 'oto'].includes(komut) && secenek('--oyun') && !secenek('--ayar-kok')) {
      console.log('--oyun yalnızca sınama içindir ve --ayar-kok ister (kopya kurulum gerçek dil ayarına dokunmasın).');
    } else {
      const o = secenek('--oyun')
        ? (oyunMu(path.resolve(secenek('--oyun'))) ? { dizin: path.resolve(secenek('--oyun')), nasil: '--oyun' } : null)
        : oyunBul(secenek('--baslangic') ? path.resolve(secenek('--baslangic')) : path.join(BURASI, '..'), steamKlasorleri());
      if (!o) { bulunamadi(); cikis = 5; } else {
        console.log(`Oyun klasörü: ${o.dizin}  (${o.nasil})`);
        const eylem = komut === 'oto' ? await otoSec(o.dizin) : komut;
        if (eylem === 'bul') cikis = 0;
        else if (eylem === 'kur') {
          console.log('Türkçe kuruluyor...\n');
          const ek = [
            ...(secenek('--ayar-kok') ? ['--ayar-kok', path.resolve(secenek('--ayar-kok'))] : []),
            ...(secenek('--hesap') ? ['--hesap', secenek('--hesap')] : []),
          ];
          cikis = calistir(['kur', path.join(o.dizin, OYUN_PCK), TR_DIZIN, '--kip', 'ayri', '--paket', ...ek]);
          if (cikis === 0) {
            console.log('\nTamam: Türkçe kuruldu. Oyunu açabilirsiniz.');
            console.log('Oyun güncellenince ya da menüden başka bir dil seçince kurucuya yeniden çift tıklayın.');
          } else if (cikis === 4) {
            console.log('\nOyun bu bilgisayarda henüz hiç açılmamış ve Steam hesabınız bulunamadı.');
            console.log('Steam\'i açıp hesabınıza girin, sonra kurucuya yeniden çift tıklayın (ya da oyunu bir kez açıp kapatın).');
          } else {
            console.log('\nHATA: Türkçe kurulamadı. Oyun açıksa kapatıp yeniden deneyin.');
            console.log(`Olmazsa yukarıdaki satırlarla birlikte bildirin: ${DEPO}/issues`);
          }
        } else {
          console.log('Türkçe kaldırılıyor...\n');
          cikis = calistir(['geri', path.join(o.dizin, OYUN_PCK)]);
          if (cikis === 0) console.log('\nTamam: Türkçe kaldırıldı. Oyun eski dilinde açılır.');
          else console.log(`\nHATA: Türkçe tam kaldırılamadı. Oyun açıksa kapatıp yeniden deneyin. Olmazsa: ${DEPO}/issues`);
        }
      }
    }
  } catch (e) { console.log('HATA: ' + e.message); cikis = 1; }
  process.exit(cikis);
})();
