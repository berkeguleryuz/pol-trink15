# Maç Yaşam Döngüsü

## 🔄 Maç Durumları

### 1. UPCOMING (🟢 Yaklaşan)
**Zaman:** Başlamaya 30+ dakika var

**Sistem Davranışı:**
- 5 dakikada bir kontrol
- Durum güncellemesi
- SOON durumuna geçiş kontrolü

**Eylem:** Bekle

---

### 2. SOON (🟡 Yakında)
**Zaman:** 0-30 dakika kaldı

**Sistem Davranışı:**
- 1 dakikada bir kontrol
- Pre-match analiz başlat
- Favori takım tespiti
- Telegram bildirim gönder
- Onay bekle (favori varsa)

**Eylem:** 
- Onaylanırsa → Favori takımdan alım yap
- Onaylanmazsa → Maç başına kadar bekle

---

### 3. LIVE (🔴 Canlı)
**Zaman:** Maç başladı (0-95 dakika)

**Faz Sistemi:**

#### Early Phase (0-15 dk)
- **Interval:** 2 saniye
- **Neden:** İlk gol çok kritik ⚡
- **Eylem:** Agresif takip

#### Mid Game (15-70 dk)
- **Interval:** 2 saniye  
- **Neden:** Sürekli takip
- **Eylem:** Gol olaylarını yakala

#### Critical (70-85 dk)
- **Interval:** 1 saniye
- **Neden:** Kritik anlar 🔥
- **Eylem:** Maksimum hız

#### Ultra Critical (85+ dk)
- **Interval:** 1 saniye
- **Neden:** Son dakika dramı ⚡⚡
- **Eylem:** Her saniye önemli

**Gol Olayı:**
1. Gol tespit et (skor değişimi)
2. Gol atan takım → 3 pozisyon aç:
   - Takım KAZANIR (YES)
   - Karşı takım KAZANIR (NO)
   - BERABERE (NO)
3. Kademeli satış başlat

**Karşı Gol:**
1. Acil satış (berabere olan pozisyonlar)
2. Risk yönetimi
3. Kârlıysa kısmi sat

---

### 4. POST MATCH (⚫ Maç Sonrası)
**Zaman:** 90-120 dakika

**Sistem Davranışı:**
- 10 saniyede bir kontrol
- Uzatma var mı?
- Maç gerçekten bitti mi?

**Eylem:**
- Tüm pozisyonları kapat
- P&L hesapla
- Telegram rapor gönder

---

### 5. FINISHED (✅ Bitmiş)
**Zaman:** 120+ dakika

**Sistem Davranışı:**
- Takibi durdur
- 1 saat sonra JSON'dan çıkar
- İstatistik güncelle

**Eylem:** Temizle

---

## 📊 Durum Geçişleri

```
UPCOMING (30+ dk)
    ↓ (30 dk kaldı)
SOON (0-30 dk)
    ↓ (maç başladı)
LIVE (0-95 dk)
    ├─ Early (0-15)
    ├─ Mid Game (15-70)
    ├─ Critical (70-85)
    └─ Ultra Critical (85+)
    ↓ (maç bitti)
POST MATCH (90-120 dk)
    ↓ (120+ dk)
FINISHED
    ↓ (1 saat sonra)
JSON'dan çıkar
```

---

## ⚙️ Otomatik Güncelleme

### Maç Listesi (1-2 saat)
- Polyfund API'den yeni maçları çek
- Futbol maçlarını filtrele
- Durum güncellemesi yap

### Temizleme (1 saat)
- Bitmiş maçları tespit et
- 1 saat geçtiyse JSON'dan çıkar
- Memory'yi temizle

### Gün Dönümü
- Saat 00:00'da otomatik kontrol
- Yeni günün maçlarını yükle
- Eski maçları arşivle
