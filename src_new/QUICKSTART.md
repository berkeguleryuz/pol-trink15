# 🚀 Hızlı Başlangıç - src_new Production Bot

## 📦 Kurulum

```bash
# Dependencies zaten yüklü (mevcut projeden)
npm install
```

## 🎯 Kullanım

### 1. Maçları Güncelle
```bash
npm run update-matches
```
Bu komut:
- Polyfund API'den tüm maçları çeker
- Futbol maçlarını filtreler
- `data/football-matches.json` oluşturur

### 2. Test Et (Data Loading)
```bash
npm run new:test:data
```
Kontrol eder:
- ✅ JSON dosyası yüklenir mi?
- ✅ Durum hesaplamaları doğru mu?
- ✅ Bugünkü maçlar tespit ediliyor mu?

### 3. Botu Başlat (DRY RUN)
```bash
npm run new:bot:dry
```
DRY RUN modunda:
- ✅ Gerçek trade yapılmaz
- ✅ Gol olayları konsola yazdırılır
- ✅ Pozisyonlar simüle edilir
- ✅ Güvenli test ortamı

### 4. Canlı Trade (PROD)
```bash
npm run new:bot:live
```
**⚠️ DİKKAT:** Gerçek para harcar!

---

## 📊 Sistem Mimarisi

```
src_new/
├── core/              # Maç yönetimi, scheduler
│   ├── types.ts       # Tüm tipler
│   ├── match-manager.ts
│   └── match-scheduler.ts
│
├── monitoring/        # Canlı skor takibi
│   └── live-score-tracker.ts
│
├── bot/               # Ana bot
│   └── production-bot.ts
│
├── tests/             # Test suite
│   └── 01-data-loading.ts
│
└── docs/              # Dökümantasyon
    └── match-lifecycle.md
```

---

## 🔄 Çalışma Akışı

### A. Maç Keşif (Her 2 saat)
```
1. Polyfund API → Maç listesi
2. Futbol filtresi → football-matches.json
3. Durum güncelleme → upcoming/soon/live/finished
```

### B. Pre-Match (30 dk öncesi)
```
1. Favori takım analizi
2. Telegram bildirim
3. Onay bekle
4. Onaylanırsa → Favori takımdan alım
```

### C. Live Match (Maç canlı)
```
1. API-Football'dan skor çek (1-2 saniye)
2. Gol tespit → 3 pozisyon aç:
   - Gol atan KAZANIR (YES)
   - Karşı takım KAZANIR (NO)
   - BERABERE (NO)
3. Kademeli satış:
   - 50% kar → 25% sat
   - 100% kar → 35% sat
   - 200% kar → 40% sat
```

### D. Post-Match (Maç bitti)
```
1. Tüm pozisyonları kapat
2. P&L hesapla
3. Telegram rapor
4. 1 saat sonra → JSON'dan çıkar
```

---

## 🎮 Komutlar

| Komut | Açıklama |
|-------|----------|
| `npm run update-matches` | Maç listesini güncelle |
| `npm run monitor-football` | Maçları manuel kontrol et |
| `npm run new:test:data` | Data loading test |
| `npm run new:bot:dry` | Bot DRY RUN (güvenli) |
| `npm run new:bot:live` | Bot LIVE (gerçek trade!) |

---

## 📋 Durum Kontrol

Bot çalışırken her 30 saniyede istatistik yazdırır:

```
📊 BOT İSTATİSTİKLERİ
================================
🟢 Aktif maçlar: 42
🔴 Canlı maçlar: 5
👁️  Takip edilen: 5
📡 API request: 1247
================================
```

---

## ⚠️ Önemli Notlar

1. **İlk Kullanım:**
   - `npm run update-matches` ile başla
   - `npm run new:test:data` ile doğrula
   - `npm run new:bot:dry` ile test et

2. **Canlı Trade:**
   - Önce DRY RUN ile test et
   - Küçük miktarla başla
   - Telegram bildirimlerini aktif et

3. **Güncellemeler:**
   - Bot otomatik günceller (2 saatte bir)
   - Manuel: `npm run update-matches`

4. **Temizlik:**
   - Bot otomatik temizler (1 saatte bir)
   - Bitmiş maçlar 1 saat sonra silinir

---

## 🐛 Sorun Giderme

### Maç bulunamıyor
```bash
# Maçları manuel güncelle
npm run update-matches

# Kontrol et
npm run monitor-football
```

### Bot çalışmıyor
```bash
# Test ile başla
npm run new:test:data

# Log'lara bak
```

### API limiti
Bot otomatik hesaplar:
- Discovery: 288 req/day (5 dk interval)
- Live: ~37,000 req/day (15 maç ortalama)
- **Toplam: ~37,300 / 75,000** ✅

---

## 📚 Daha Fazla Bilgi

- [Match Lifecycle](./docs/match-lifecycle.md) - Maç yaşam döngüsü
- [Core Module](./core/README.md) - Temel bileşenler
- [Monitoring Module](./monitoring/README.md) - Canlı takip

---

## 🤝 Destek

Sorun mu var? `src_new/README.md` dosyasını kontrol et.
