# 📱 Telegram Entegrasyonu - Planlama

## ❓ Şu Anda Telegram Var mı?

**HAYIR** ❌ - Henüz Telegram entegrasyonu yok.

Bot şu anda sadece **terminal'de log** atıyor:
```
🟡 DURUM DEĞİŞTİ: epl-sun-ars-2025-11-08
🔴 MAÇ BAŞLADI! ucl-mid1-cel3-2025-11-06
⚽⚽⚽ GOL OLDU! Real Madrid vs Barcelona
```

## 🎯 Telegram Ne Zaman Gelecek?

**Sonraki adım!** (Todo #8)

Şu anda:
1. ✅ Core modülü (maç yönetimi)
2. ✅ Monitoring modülü (gol tespiti)
3. ✅ Bot coordinator (çoklu maç)
4. ✅ Bilgilendirme sistemi
5. ❌ **Trading modülü** (sonraki)
6. ❌ **Telegram modülü** (ondan sonra)

## 📋 Telegram Özellikleri (Gelecek)

### 🔔 Bildirim Türleri

#### 1. Maç Başlangıç (🟡 SOON)
```
🟡 YAKINDA BAŞLAYACAK MAÇ

⚽ Real Madrid vs Barcelona
🕐 15:00 (10 dakika kaldı)
🏆 La Liga
📊 Odds: Real %55 | Beraberlik %25 | Barca %20

🤖 Bot maçı takibe aldı
```

#### 2. Maç Başladı (🔴 LIVE)
```
🔴 MAÇ BAŞLADI!

⚽ Real Madrid vs Barcelona
🏆 La Liga
📊 Skor: 0-0
⏱️ 1. dakika

🎯 İlk 10 dakika kritik - fırsatlar izleniyor...
```

#### 3. Gol! (⚽)
```
⚽⚽⚽ GOOOL!

⚽ Real Madrid 1-0 Barcelona
👤 Golü atan: Vinícius Jr.
⏱️ 23. dakika

💰 TRADE AÇILDI:
   1️⃣ Real Madrid KAZANIR (YES) - $2.50
   2️⃣ Barcelona KAZANIR (NO) - $2.50
   3️⃣ BERABERE (NO) - $2.00
   
📊 Toplam risk: $7.00
```

#### 4. Pozisyon Kazanıyor (💎)
```
💎 KAR ARTIŞI!

⚽ Real Madrid 2-0 Barcelona (65')

📈 Pozisyon Durumu:
   1️⃣ Real Wins (YES): +$3.50 (+70% 🔥)
   2️⃣ Barca Wins (NO): +$2.25 (+45%)
   3️⃣ Draw (NO): +$1.80 (+36%)

🎯 Toplam: +$7.55 kar (+54%)

⚡ Kademeli satış aktif:
   - 50% kar → %25 satıldı ✅
   - Hedef: 100% kar
```

#### 5. Favori Tespit (💎 + Onay Sistemi)
```
💎 FAVORİ TESPİT EDİLDİ!

⚽ Manchester City vs Norwich City
🏆 Premier League
📊 Odds: Man City %85 | Norwich %5 | Draw %10

🎯 ÖNERİ: Manchester City çok güçlü favori
💰 Erken pozisyon önerisi: $5.00

❓ Bu maça erken girmek ister misin?
👍 EVET - İşlemi başlat
👎 HAYIR - Atla

⏳ 30 saniye içinde yanıt ver (varsayılan: HAYIR)
```

**Onay Sistemi:**
- Bot telegram mesajı gönderir
- Kullanıcı 👍 veya 👎 react yapar
- 30 saniye yanıt yoksa → HAYIR (güvenli)
- EVET → Trade açılır
- HAYIR → Maç atlanır

#### 6. Maç Bitti (✅)
```
✅ MAÇ BİTTİ!

⚽ Real Madrid 3-1 Barcelona
🏆 La Liga

💰 POZİSYONLAR KAPATILDI:
   1️⃣ Real Wins (YES): +$5.20 (2.6x 🔥)
   2️⃣ Barca Wins (NO): +$2.50 (1.25x)
   3️⃣ Draw (NO): +$2.00 (1.0x)

📊 Toplam: +$9.70 kar (+138% 🎉)

🎯 Bu maçtan: $16.70 kazanıldı
   - Risk: $7.00
   - Kar: +$9.70
```

#### 7. Stop-Loss (⚠️)
```
⚠️ STOP-LOSS TETİKLENDİ!

⚽ Real Madrid 1-2 Barcelona (78')
   (Barca geri döndü! 0-1 → 1-2)

📉 Pozisyonlar kapatıldı (acil satış):
   1️⃣ Real Wins (YES): -$1.20 (-%24)
   2️⃣ Barca Wins (NO): -$1.80 (-%36)
   3️⃣ Draw (NO): +$0.50 (+10%)

📊 Toplam: -$2.50 zarar (-%17)

🛡️ Risk yönetimi devreye girdi
```

### 📊 Periyodik Raporlar

#### Günlük Özet (Her Gün 23:00)
```
📊 GÜNLÜK RAPOR - 6 Kasım 2025

⚽ İşlem Yapılan Maçlar: 8
💰 Toplam Kar: +$23.50
📈 ROI: +47%
✅ Kazanan: 6 maç
❌ Kaybeden: 2 maç
🎯 Başarı Oranı: 75%

🏆 EN İYİ MAÇ:
   Real Madrid vs Barcelona: +$9.70 (+138%)

⚠️ EN KÖTÜ MAÇ:
   Arsenal vs Chelsea: -$3.20 (-%45%)

💵 Günlük Bakiye:
   Başlangıç: $50.00
   Bitiş: $73.50
   Değişim: +$23.50 (+47%)
```

## 🔧 Teknik Detaylar

### Telegram Bot Kurulumu

```typescript
// src_new/notifications/telegram-notifier.ts

import TelegramBot from 'node-telegram-bot-api';

export class TelegramNotifier {
  private bot: TelegramBot;
  private chatId: string;
  
  constructor(token: string, chatId: string) {
    this.bot = new TelegramBot(token, { polling: true });
    this.chatId = chatId;
    this.setupListeners();
  }
  
  // Maç başlangıç bildirimi
  async notifyMatchStarting(match: FootballMatch): Promise<void> {
    const message = `
🟡 YAKINDA BAŞLAYACAK MAÇ

⚽ ${match.homeTeam} vs ${match.awayTeam}
🕐 ${match.kickoffTime} (${match.minutesUntilKickoff} dakika kaldı)
🏆 ${match.league || 'Bilinmiyor'}

🤖 Bot maçı takibe aldı
    `;
    
    await this.bot.sendMessage(this.chatId, message);
  }
  
  // Gol bildirimi
  async notifyGoal(event: GoalEvent, positions: Position[]): Promise<void> {
    const match = event.match;
    const message = `
⚽⚽⚽ GOOOL!

⚽ ${match.homeTeam} ${event.newScore.home}-${event.newScore.away} ${match.awayTeam}
👤 Golü atan: ${event.scorer}
⏱️ ${event.minute}. dakika

💰 TRADE AÇILDI:
${positions.map((p, i) => `   ${i+1}️⃣ ${p.description} - $${p.amount.toFixed(2)}`).join('\n')}

📊 Toplam risk: $${positions.reduce((sum, p) => sum + p.amount, 0).toFixed(2)}
    `;
    
    await this.bot.sendMessage(this.chatId, message);
  }
  
  // Favori onay talebi (Interactive)
  async requestFavoriteApproval(match: FootballMatch, odds: any): Promise<boolean> {
    const message = `
💎 FAVORİ TESPİT EDİLDİ!

⚽ ${match.homeTeam} vs ${match.awayTeam}
📊 Odds: ${match.homeTeam} %${Math.round(odds.home * 100)} | ${match.awayTeam} %${Math.round(odds.away * 100)}

🎯 ÖNERİ: Erken pozisyon al
💰 Önerilen: $5.00

❓ Bu maça erken girmek ister misin?
    `;
    
    const keyboard = {
      inline_keyboard: [
        [
          { text: '👍 EVET', callback_data: `approve_${match.id}` },
          { text: '👎 HAYIR', callback_data: `reject_${match.id}` }
        ]
      ]
    };
    
    await this.bot.sendMessage(this.chatId, message, { reply_markup: keyboard });
    
    // 30 saniye bekle
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), 30000);
      
      this.bot.once('callback_query', (query) => {
        clearTimeout(timeout);
        const approved = query.data?.includes('approve');
        this.bot.answerCallbackQuery(query.id);
        resolve(approved || false);
      });
    });
  }
}
```

### Entegrasyon (production-bot.ts)

```typescript
import { TelegramNotifier } from '../notifications/telegram-notifier';

export class ProductionBot {
  private telegram?: TelegramNotifier;
  
  constructor(config: BotConfig) {
    // ...existing code...
    
    // Telegram aktifse
    if (config.telegram?.enabled) {
      this.telegram = new TelegramNotifier(
        config.telegram.token,
        config.telegram.chatId
      );
    }
  }
  
  private async handleGoalEvent(event: GoalEvent): Promise<void> {
    // ...existing code...
    
    // Telegram bildirimi
    if (this.telegram) {
      await this.telegram.notifyGoal(event, positions);
    }
  }
}
```

## 🚀 Nasıl Aktif Edilir?

### 1. Telegram Bot Oluştur
```bash
1. @BotFather ile konuş
2. /newbot komutu ver
3. Bot token al: "123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
4. Bot'u grubuna ekle veya DM'den kullan
```

### 2. Chat ID Bul
```bash
1. Bot'a mesaj at
2. https://api.telegram.org/bot<TOKEN>/getUpdates
3. "chat":{"id":123456789} değerini kopyala
```

### 3. Config Ekle (.env)
```bash
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=123456789
TELEGRAM_ENABLED=true
```

### 4. Bot'u Başlat
```bash
npm run new:bot:live
# Artık telegram bildirimleri gelir!
```

## 📝 Özet

- ❌ **Şu anda Telegram yok** (sadece terminal log)
- ✅ **Altyapı hazır** (bot events, durum değişiklikleri)
- 🔜 **Sırada:** Trading modülü → Telegram modülü
- 💬 **7 bildirim türü** planlandı (SOON, LIVE, GOL, KAR, FAVORİ, BİTTİ, STOP-LOSS)
- 🎯 **Onay sistemi** (favori tespitinde kullanıcı onayı)
- 📊 **Günlük raporlar** (gün sonunda özet)

**İşlem Sırası:**
1. Trading modülü ekle (şimdi)
2. Telegram modülü ekle (sonra)
3. Test et (DRY RUN)
4. Gerçek kullan (LIVE)
