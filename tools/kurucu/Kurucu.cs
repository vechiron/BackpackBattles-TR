// Backpack Battles Türkçe kurucusu: oyuncunun indirip çift tıkladığı tek exe.
//
// İçinde gömülü kaynak "arac.bin" (tools/paket-yap.mjs → yukYaz): gzip ile sıkıştırılmış dosya
// dizisi; her kayıt [ad uzunluğu: uint16 LE][ad: UTF-8, '/' ayraçlı][boyut: int64 LE][veri],
// ad uzunluğu 0 son kayıttır, ardından kayıt sayısı (uint32 LE; eksik akış yakalansın).
// İçerik: resmî node.exe (nodejs.org, değiştirilmemiş) ve lisansı, tools/*.mjs (kurulum
// betikleri), ceviri/tr/*.json (Türkçe metinler).
//
// Çalışma: %TEMP%\BackpackBattlesTurkce-<rastgele> klasörüne açar, oradaki node.exe ile
// tools/paket-kur.mjs'yi çalıştırır, klasörü siler, tuş bekler (girdi yönlendirilmişse
// beklemez). Argüman yoksa komut "oto" (kurulu değilse kurar, kuruluysa sorar); argümanlar
// varsa olduğu gibi paket-kur'a geçer. Sona her zaman "--baslangic <exe klasörü>" eklenir: oyun
// önce exe'nin klasöründe ve üstlerinde aranır. Bir saatten eski artık klasörler (pencere
// kurulum sırasında kapatılmışsa) açılışta silinir.
// "--ac <dizin>": yalnızca açar, hiçbir şey çalıştırmaz (sınama).
//
// Derleme: tools/paket-yap.mjs (Windows'taki csc.exe, .NET Framework 4, C# 5; @SURUM@ yerine
// sürüm, @DEPO@ yerine GitHub deposunun adresi yazılır: tools/paket-kur.mjs → DEPO). Yönetici
// izni istemez (csc'nin varsayılan manifesti: asInvoker).

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Threading;

[assembly: AssemblyTitle("Backpack Battles TR")]
[assembly: AssemblyProduct("Backpack Battles TR")]
[assembly: AssemblyDescription("Backpack Battles Türkçe çevirisi: kurulum programı")]
[assembly: AssemblyCopyright("MIT lisansı · © 2026 Vechiron · @DEPO@")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyInformationalVersion("@SURUM@")]

static class Kurucu
{
    const string SURUM = "@SURUM@";
    const string DEPO = "@DEPO@";
    const string ONEK = "BackpackBattlesTurkce-";

    static int Main(string[] args)
    {
        Encoding eski = null;
        try { eski = Console.OutputEncoding; Console.OutputEncoding = new UTF8Encoding(false); } catch { }
        try { Console.Title = "Backpack Battles TR " + SURUM; } catch { }
        // Ctrl+C node'u durdurur; kurucu ayakta kalıp geçici klasörü siler.
        Console.CancelKeyPress += delegate(object s, ConsoleCancelEventArgs e) { e.Cancel = true; };
        int cikis = 1;
        try
        {
            if (args.Length == 2 && args[0] == "--ac") { Ac(args[1]); cikis = 0; }
            else cikis = Calistir(args);
        }
        catch (Exception e)
        {
            Console.WriteLine("HATA: " + e.Message);
            Console.WriteLine("Olmazsa bu satırla birlikte bildirin: " + DEPO + "/issues");
        }
        if (args.Length == 0 && !Console.IsInputRedirected)
        {
            Console.WriteLine();
            Console.Write("Kapatmak için bir tuşa basın...");
            try { Console.ReadKey(true); } catch { }
        }
        try { if (eski != null) Console.OutputEncoding = eski; } catch { }
        return cikis;
    }

    static int Calistir(string[] args)
    {
        Console.WriteLine("Backpack Battles TR · Türkçe çeviri · sürüm " + SURUM);
        Console.WriteLine("Hazırlanıyor...");
        string temp = Path.GetTempPath();
        EskileriSil(temp);
        string gecici = Path.Combine(temp, ONEK + Guid.NewGuid().ToString("N").Substring(0, 12));
        try
        {
            Ac(gecici);
            string exeDizin = Path.GetDirectoryName(Path.GetFullPath(Assembly.GetExecutingAssembly().Location));
            List<string> liste = new List<string>();
            liste.Add(Path.Combine(Path.Combine(gecici, "tools"), "paket-kur.mjs"));
            if (args.Length == 0) liste.Add("oto"); else liste.AddRange(args);
            liste.Add("--baslangic");
            liste.Add(exeDizin);
            StringBuilder satir = new StringBuilder();
            foreach (string a in liste) { if (satir.Length > 0) satir.Append(' '); satir.Append(Tirnak(a)); }
            ProcessStartInfo psi = new ProcessStartInfo(Path.Combine(gecici, "node.exe"), satir.ToString());
            psi.UseShellExecute = false;
            psi.WorkingDirectory = gecici;
            using (Process p = Process.Start(psi))
            {
                p.WaitForExit();
                return p.ExitCode;
            }
        }
        finally
        {
            Sil(gecici);
        }
    }

    // Gömülü dosyaları hedef klasöre açar; hedefte aynı adlı dosya varsa durur.
    static void Ac(string hedef)
    {
        string kok = Path.GetFullPath(hedef).TrimEnd('\\') + "\\";
        Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("arac.bin");
        if (s == null) throw new Exception("kurucunun içindeki dosyalar bulunamadı (arac.bin)");
        uint sayi = 0;
        using (s)
        using (GZipStream gz = new GZipStream(s, CompressionMode.Decompress))
        using (BinaryReader r = new BinaryReader(gz, Encoding.UTF8))
        {
            while (true)
            {
                int n = r.ReadUInt16();
                if (n == 0) break;
                string ad = Encoding.UTF8.GetString(r.ReadBytes(n));
                long boyut = r.ReadInt64();
                string yol = Path.GetFullPath(Path.Combine(kok, ad.Replace('/', '\\')));
                if (ad.Contains(":") || !yol.StartsWith(kok, StringComparison.OrdinalIgnoreCase))
                    throw new Exception("kurucunun içinde geçersiz dosya adı: " + ad);
                Directory.CreateDirectory(Path.GetDirectoryName(yol));
                using (FileStream f = new FileStream(yol, FileMode.CreateNew))
                {
                    long kalan = boyut;
                    while (kalan > 0)
                    {
                        int k = (int)Math.Min(kalan, 1 << 20);
                        byte[] b = r.ReadBytes(k);
                        if (b.Length != k) throw new EndOfStreamException("kurucunun içindeki dosyalar eksik (" + ad + ")");
                        f.Write(b, 0, k);
                        kalan -= k;
                    }
                }
                sayi++;
            }
            if (r.ReadUInt32() != sayi) throw new Exception("kurucunun içindeki dosya sayısı tutmuyor; dosyayı yeniden indirin");
        }
    }

    static void Sil(string d)
    {
        for (int i = 0; i < 10 && Directory.Exists(d); i++)
        {
            try { Directory.Delete(d, true); }
            catch { Thread.Sleep(300); }
        }
    }

    // Önceki çalışmalardan kalan klasörler: yalnızca bu kurucunun düzenindekiler ve bir saatten eskiler.
    static void EskileriSil(string temp)
    {
        try
        {
            foreach (string d in Directory.GetDirectories(temp, ONEK + "*"))
            {
                if (!File.Exists(Path.Combine(d, "node.exe")) || !Directory.Exists(Path.Combine(d, "tools"))) continue;
                if (Directory.GetCreationTimeUtc(d) > DateTime.UtcNow.AddHours(-1)) continue;
                try { Directory.Delete(d, true); } catch { }
            }
        }
        catch { }
    }

    // Windows komut satırı tırnaklaması (CommandLineToArgvW kuralları; node aynı kuralla ayırır).
    static string Tirnak(string a)
    {
        if (a.Length > 0 && a.IndexOfAny(new char[] { ' ', '\t', '"' }) < 0) return a;
        StringBuilder sb = new StringBuilder("\"");
        int bolu = 0;
        foreach (char c in a)
        {
            if (c == '\\') { bolu++; continue; }
            if (c == '"') { sb.Append('\\', bolu * 2 + 1); sb.Append('"'); }
            else { sb.Append('\\', bolu); sb.Append(c); }
            bolu = 0;
        }
        sb.Append('\\', bolu * 2);
        sb.Append('"');
        return sb.ToString();
    }
}
