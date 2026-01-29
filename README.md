# 🎯 PolyBuy - Polymarket Trading Bot

Polymarket üzerinde otomatik share alım-satımı yapan TypeScript tabanlı trading bot.

## 🚀 Hızlı Başlangıç

### 1. Bağımlılıkları Yükleyin

```bash
npm install
```

### 2. Environment Dosyasını Oluşturun

```bash
cp .env.example .env
```

### 3. MetaMask Bilgilerinizi Ekleyin

`.env` dosyasını düzenleyin ve gerekli bilgileri ekleyin:

```env
PRIVATE_KEY=your_metamask_private_key_here_without_0x
FUNDER_ADDRESS=0xYourMetaMaskWalletAddress
```

**Bilgiler nasıl alınır:**

**Private Key:**
1. MetaMask'ı açın
2. Account Details'e tıklayın
3. "Export Private Key" seçin
4. Parolanızı girin
5. Private key'i kopyalayın (0x olmadan)

**Funder Address (Wallet Address):**
1. MetaMask'ta hesap adınızın üzerine tıklayın
2. Adresiniz otomatik kopyalanır (0x ile başlar)
3. Bu, USDC göndereceğiniz adres

### 4. Bağlantı Testini Yapın

```bash
npm run test:connection
```

### 5. Balance Kontrolü

```bash
npm run test:balance
```

### 2. **USDC Yükleyin**

USDC'yi MetaMask adresinize gönderin:
- **Network:** Polygon (MATIC)
- **Token:** USDC  
- **Adres:** .env dosyasındaki FUNDER_ADDRESS
- **Önerilen:** 10-20 USDC test için
- **Önemli:** Polygon network'ünü seçmeyi unutmayın!
### Yöntem 2: Bridge Kullanma

1. https://wallet.polygon.technology/polygon/bridge
2. Ethereum'dan Polygon'a USDC bridge edin

## 📖 Kullanım

### Test Komutları

```bash
# Bağlantı testi
npm run test:connection

# Balance kontrolü
npm run test:balance

# Market görüntüleme ve buy testi
npm run test:buy

# Sell testi (önce share'iniz olmalı)
npm run test:sell

# Tüm testler
npm run test:all
```

### Kod İçinde Kullanım

```typescript
import { PolymarketClient, buyShares, sellShares, getActiveMarkets } from './src';

async function trade() {
  // Client oluştur
  const client = await PolymarketClient.create();
  
  // Marketleri listele
  const markets = await getActiveMarkets({ limit: 10 });
  console.log('Active markets:', markets);
  
  // Buy order
  await buyShares(client, {
    tokenId: 'YOUR_TOKEN_ID',
    amount: 10,  // $10 USDC
    type: 'market'
  });
  
  // Sell order
  await sellShares(client, {
    tokenId: 'YOUR_TOKEN_ID',
    amount: 5,  // 5 shares
    type: 'market'
  });
}
```

## 📁 Proje Yapısı

```
polybuy/
├── src/
│   ├── config/          # Configuration (env loader)
│   ├── client/          # Polymarket client wrapper
│   ├── markets/         # Market data fetching
│   ├── trading/         # Buy/sell fonksiyonları
│   ├── utils/           # Logger, balance checker
│   └── index.ts         # Main export
├── tests/
│   ├── 01-connection.ts # Bağlantı testi
│   ├── 02-balance.ts    # Balance kontrolü
│   ├── 03-buy-test.ts   # Buy testi
│   └── 04-sell-test.ts  # Sell testi
├── .env                 # Your config (DON'T COMMIT!)
├── .env.example         # Template
└── package.json
```

## 🔧 API Referansı

### PolymarketClient

```typescript
// Client oluşturma
const client = await PolymarketClient.create();

// Wallet adresi
const address = await client.getAddress();

// CLOB client
const clobClient = client.getClient();
```

### Market İşlemleri

```typescript
// Aktif marketleri getir
const markets = await getActiveMarkets({ limit: 20 });

// Slug ile market bul
const market = await getMarketBySlug('bitcoin-100k-2025');

// Market arama
const results = await searchMarkets('Trump', 10);

// Token ID'leri al
const tokens = getTokenIds(market);
// { yes: 'token_id_1', no: 'token_id_2' }
```

### Trading

```typescript
// Market buy (anında alım)
await buyShares(client, {
  tokenId: 'TOKEN_ID',
  amount: 10,  // USDC
  type: 'market'
});

// Limit buy (belirli fiyattan)
await buyShares(client, {
  tokenId: 'TOKEN_ID',
  amount: 10,
  price: 0.50,
  type: 'limit'
});

// Market sell
await sellShares(client, {
  tokenId: 'TOKEN_ID',
  amount: 5,  // Shares
  type: 'market'
});

// Order iptal
await cancelOrder(client, 'ORDER_ID');
```

### Balance ve Orders

```typescript
// Balance kontrol
const balance = await getBalance(client);
console.log(`USDC: $${balance.usdc}`);

// Açık orderlar
const orders = await getOpenOrders(client);

// Balance yeterli mi?
const sufficient = await checkSufficientBalance(client, 10);
```

## ⚠️ Önemli Notlar

### Güvenlik

- ⚠️ **ASLA `.env` dosyanızı git'e eklemeyin!**
- 🔐 Private key'lerinizi kimseyle paylaşmayın
- 💰 Küçük miktarlarla test edin

### MetaMask ile Trading

Bu proje MetaMask wallet kullanır:
- **Signature Type:** 2 (Browser Wallet)
- **Network:** Polygon (Chain ID: 137)
- **Private Key:** MetaMask'tan export edilir

### Order Tipleri

- **Market Order:** Anında işlem yapar, mevcut fiyattan
- **Limit Order:** Belirlediğiniz fiyattan order açar, bekler
- **GTC (Good Till Cancelled):** İptal edilene kadar açık kalır
- **FOK (Fill or Kill):** Ya tamamen dolur ya iptal olur

### Common Errors

**"Insufficient balance"**
- USDC balance'ınızı kontrol edin
- Açık orderlar balance'ınızı kilitliyor olabilir

**"Invalid signature"**
- Private key'inizi kontrol edin
- Signature type'ı doğru olduğundan emin olun (MetaMask = 2)

**"Allowance not set"**
- İlk trade'den önce allowance set etmeniz gerekebilir
- Genelde otomatik yapılır, ama bazen manuel gerekir

## 🎓 Polymarket Hakkında

### Nasıl Çalışır?

1. **Share Satın Al:** YES/NO shares (0.00 - 1.00 USDC arası)
2. **Bekle veya Trade:** Fiyat değişikliklerinden kar et
3. **Kazan:** Doğru outcome = $1.00 per share

### Örnek

- Market: "Will Bitcoin hit $100k in 2025?"
- YES shares: $0.65
- 100 YES share alırsın = $65 harcarsın
- Bitcoin $100k'ya ulaşırsa: 100 × $1.00 = $100 kazanırsın
- Kar: $35

## 📚 Kaynaklar

- [Polymarket](https://polymarket.com)
- [Polymarket Docs](https://docs.polymarket.com)
- [CLOB Client GitHub](https://github.com/Polymarket/clob-client)
- [Polygon Network](https://polygon.technology/)

## 🗺️ Roadmap

### ✅ Phase 1: MVP (Tamamlandı)
- Basic buy/sell operations
- Market data fetching
- Balance management
- MetaMask integration

### 🔄 Phase 2: Advanced (Geliştirme Aşamasında)
- Limit order strategies
- Portfolio tracking
- PnL calculation
- WebSocket real-time data

### 🚀 Phase 3: Automation (Planlanan)
- News-based trading
- AI predictions
- Telegram/Discord bot
- Advanced risk management

## 📝 Lisans

MIT

---

**⚠️ Risk Uyarısı:** Bu bot sadece eğitim amaçlıdır. Trading risk içerir. Kaybetmeyi göze alamayacağınız parayla işlem yapmayın.

**🤝 Destek:** Sorularınız için issue açabilirsiniz.
