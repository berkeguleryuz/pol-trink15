# Production Bot - Ana Koordinatör

## 📋 Görev

Bot tüm modülleri koordine eder ve çoklu maç takibi yapar.

## 🎯 Anahtar Özellikler

### 1. **BÜTÜN Maçları Yükle, Sadece Aktif Olanları Takip Et**

```
📁 Data'da: 100-200+ futbol maçı (tüm günlük maçlar)
👁️  Takip: Max 50 maç (LIVE + SOON durumunda olanlar)
```

- **Polyfund API'den çekilen**: Günün tüm futbol maçları
- **Sistemde saklanan**: Tüm maçlar (UPCOMING, SOON, LIVE, FINISHED)
- **Aktif takip edilen**: Sadece SOON (30 dk içinde) ve LIVE maçlar
- **Limit**: Aynı anda maksimum 50 maç takip edilir (API rate limit + performans)

### 2. **Otomatik Güncelleme (2 Saatte Bir)**

```typescript
updateInterval: 2 saat  // Her 2 saatte bir Polyfund API'den yeni maçlar çek
```

Bot her 2 saatte:
1. 📡 Polyfund API'den maçları çeker (`scrape-polyfund-matches.ts`)
2. ⚽ Sadece futbol maçlarını filtreler (`filter-football-matches.ts`)
3. 💾 `data/football-matches.json` dosyasına kaydeder
4. 📊 Bellekteki maçları günceller
5. 🎯 SOON ve LIVE maçları tespit edip takibe alır

**Gün Dönümü**: Otomatik! Bot 2 saatte bir güncelleme yaptığı için yeni günün maçları otomatik gelir.

### 3. **Dinamik Polling (Maç Durumuna Göre)**

```
🟢 UPCOMING (30+ dk): Her 5 saniyede durum kontrolü
🟡 SOON (0-30 dk):    Her 5 saniyede kontrol + ön analiz
🔴 LIVE (oynanıyor):  API-Football ile 1-2 saniyede skor takibi
```

### 4. **Limit Yönetimi**

Bot **50 maç limitini** şöyle yönetir:

```typescript
// Öncelik sırası:
1. LIVE maçlar (devam eden) - ÖNCE BUNLAR
2. SOON maçlar (30 dk içinde başlayacak) - SONRA BUNLAR
3. Limit doluysa: Yeni SOON maçlar beklemeye alınır
4. Maç bitince: Takipten çıkar, yeni maça yer açar
```

## 🔄 İş Akışı

```
[Başlangıç]
   ↓
1. API'den TÜM futbol maçlarını çek (100-200+ maç)
   ↓
2. Bellekte TÜM maçları sakla
   ↓
3. Durum analizi (UPCOMING/SOON/LIVE/FINISHED)
   ↓
4. SOON ve LIVE maçları tespit et (örn: 5 SOON + 10 LIVE = 15 aktif)
   ↓
5. Aktif maçları takibe al (max 50)
   ↓
6. Her 5 saniyede:
   - Tüm maçların durumunu güncelle
   - SOON olanları tespit et → Takibe al (limit varsa)
   - LIVE olanları tespit et → Skor takibi başlat
   - FINISHED olanları çıkar → Yer aç
   ↓
7. Her 2 saatte:
   - API'den yeni maçları çek
   - Listeyi güncelle
   - Döngüye devam
```

## 📊 Çıktı Örneği

```
🤖 POLYSPORT PRODUCTION BOT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Mode: ⚠️  DRY RUN (test modu)
⏱️  Update: Her 2 saatte bir
📈 Max Concurrent: 50 maç
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔄 Maç listesi güncelleniyor...
📡 Polyfund API'den yeni maçlar çekiliyor...
✅ Maç listesi API'den güncellendi

📊 TOPLAM MAÇ İSTATİSTİKLERİ:
   📁 Sistemde: 182 futbol maçı
   📅 Bugün: 42 maç
   🟢 Upcoming: 170 maç
   🟡 Soon (30 dk): 3 maç
   🔴 Live: 5 maç
   ⚫ Finished: 4 maç

👁️  AKTİF TAKİP: 8/50 (SOON + LIVE)

🟡 YAKINDA BAŞLAYACAK MAÇLAR (30 dk içinde):
   ⚽ 15:55 - Al Hazem SC vs. Al Khaleej Saudi Club
   ⚽ 16:00 - Arsenal FC vs. Liverpool FC
   ⚽ 16:15 - Barcelona vs. Real Madrid

🔴 ŞU ANDA CANLI MAÇLAR:
   ⚽ 34' - Manchester City vs. Chelsea FC
   ⚽ 67' - Bayern Munich vs. Borussia Dortmund
   ... ve 3 maç daha

✅ Bot aktif! Maçlar takip ediliyor...
```

## 🚀 Kullanım

### Dry Run (Test Modu)
```bash
npm run new:bot:dry
```
- Gerçek trade yapmaz
- Sadece log'lar
- Test için güvenli

### Live Mode (Gerçek İşlemler)
```bash
npm run new:bot:live
```
- ⚠️ GERÇEK TRADE YAPAR
- Telegram onayı gerekir
- Para harcar!

## ⚙️ Konfigürasyon

```typescript
{
  dryRun: true/false,        // Test modu
  updateInterval: 2,         // Saat (API güncellemesi)
  maxConcurrentMatches: 50,  // Aynı anda max takip
  cleanupInterval: 1         // Bitmiş maçları temizleme (saat)
}
```

## 📝 Notlar

- **Tüm maçlar yüklenir**: Bot Polyfund'dan günün tüm futbol maçlarını çeker
- **Seçici takip**: Sadece SOON ve LIVE maçları aktif takip eder
- **Otomatik limit**: 50 maça ulaşınca yeni maçlar bekler
- **LIVE öncelikli**: Canlı maçlar SOON maçlardan önceliklidir
- **Otomatik temizlik**: Bitmiş maçlar 1 saat sonra sistemden çıkar
- **Gün dönümü**: 2 saatlik güncellemeler sayesinde otomatik

## 🔜 Gelecek Özellikler

- [ ] Trading module entegrasyonu (3 pozisyon açma)
- [ ] Telegram bildirimleri ve onay sistemi
- [ ] Pre-match favori tespiti
- [ ] Kademeli satış stratejisi (50%→25%, 100%→35%, 200%→40%)
