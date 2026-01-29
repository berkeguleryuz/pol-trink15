# 🤖 Polymarket Football Trading Bot - Production System

## 📋 Sistem Mimarisi

Bu sistem **Polymarket'teki futbol maçlarını** otomatik takip eder ve gol olaylarında **anında trade** yapar.

### 🏗️ Modül Yapısı

```
src_new/
├── core/           # Temel sistem bileşenleri
├── data/           # Veri yönetimi (match loading, caching)
├── monitoring/     # Maç takip sistemi (live score tracking)
├── trading/        # Trade execution ve strategy
├── notifications/  # Telegram bildirimleri
└── utils/          # Yardımcı fonksiyonlar
```

### 🎯 Temel İş Akışı

1. **Veri Yükleme** (`data/`)
   - `football-matches.json` dosyasından maçları yükle
   - Berlin saati (UTC+1) ile endDate'e göre sırala
   - Bugün ve yarın başlayacak maçları filtrele

2. **Maç Durumu Takibi** (`monitoring/`)
   - 🟢 **Upcoming** (30+ dk): 5 dakikada bir kontrol
   - 🟡 **Soon** (0-30 dk): 1 dakikada bir kontrol
   - 🔴 **Live**: 1-2 saniyede bir skor takibi
   - ⚫ **Finished**: JSON'dan kaldır (1 saat sonra)

3. **Pre-Match Analiz** (`trading/`)
   - Favori takım tespiti (odds/bet analizi)
   - Telegram onay iste
   - Onaylanırsa favori takımdan alım yap

4. **Live Trading** (`trading/`)
   - Gol olayında **3 pozisyon** al:
     - Gol atan takım KAZANIR (YES)
     - Karşı takım KAZANIR (NO)
     - BERABERE BİTER (NO)
   - Kademeli satış (.clinerules):
     - 50% kar → 25% sat
     - 100% kar → 35% sat
     - 200% kar → 40% sat
   - Karşı gol → Acil satış

5. **Çoklu Maç Yönetimi** (`core/`)
   - Aynı anda 20-50 maç takip
   - Her maç için ayrı thread/interval
   - EndDate sıralı (asla maç kaçırma)
   - Gün dönümü otomatik güncelleme

### 📏 Maksimum Karakter Limiti

Her dosya **max 300 satır** (kritik durumda 350). Daha uzunsa modüllere böl.

### 🗂️ Klasör Kuralları

Her klasörde `README.md`:
- Klasörün amacı
- Dosyaların görevleri
- API/interface tanımları
- Kullanım örnekleri

### ⚙️ Konfigürasyon

- `.clinerules`: Trading kuralları
- `config/`: Sistem ayarları
- `data/football-matches.json`: Maç listesi

### 🧪 Test Sistemi

```
tests/
├── 01-data-loading.ts
├── 02-match-monitoring.ts
├── 03-trading-logic.ts
└── 04-integration.ts
```

Testler sıralı çalışmalı, her test bir öncekini validate etmeli.

### 📚 Dökümantasyon

```
docs/
├── match-lifecycle.md    # Maç yaşam döngüsü
├── trading-strategy.md   # Trade stratejisi
└── deployment.md         # Canlıya alma
```

Sadece **gerekli** dökümantasyon. Kod kendini açıklamalı.

---

## 🚀 Hızlı Başlangıç

```bash
# Maçları güncelle
npm run update-matches

# Botu başlat (DRY RUN)
npm run bot:dry

# Canlı trade
npm run bot:live
```
