# Trading Module

## 📦 Görev

Polymarket'te otomatik trade execution ve position yönetimi.

## 🎯 Ana Bileşenler

### 1. trade-executor.ts
- Polymarket ClobClient entegrasyonu
- Buy/Sell order execution
- Market order (instant)
- DRY RUN support

### 2. position-manager.ts  
- 3 pozisyon stratejisi (gol olunca)
- Position tracking (open/closed)
- PnL calculation
- Multi-match position management

### 3. exit-strategy.ts
- Kademeli satış logic
- Profit target check (50%, 100%, 200%)
- Stop-loss trigger (-20%)
- Emergency sell (reverse goal)

### 4. market-fetcher.ts
- Polymarket market data çekme
- Token ID'leri bulma (YES/NO outcomes)
- Price/liquidity kontrolü
- Market eşleştirme (slug → tokens)

## 💰 Trading Stratejisi

### Gol Olunca (3 Pozisyon)
```
Real Madrid 1-0 Barcelona →
  1️⃣ Real Madrid KAZANIR (YES) → $3
  2️⃣ Barcelona KAZANIR (NO)  → $3
  3️⃣ BERABERE (NO)           → $3
  
Toplam risk: $9
```

### Kademeli Satış
```
50% kar  → %25 sat   ($3 → $4.50, sell $1.125)
100% kar → %35 sat   ($3 → $6, sell $2.10)
200% kar → %40 sat   ($3 → $9, sell $3.60)
```

### Stop-Loss
```
-20% → Acil sat
Reverse goal → Emergency sell all
```

## 🔧 Polymarket Entegrasyonu

### ClobClient Kullanımı
```typescript
import { ClobClient, Side, OrderType } from '@polymarket/clob-client';

// Initialize
const client = new ClobClient(
  process.env.CLOB_API_URL,
  137, // Polygon
  wallet,
  creds,
  signatureType,
  funderAddress
);

// Buy YES
await client.createMarketOrder({
  tokenID: '0x123...',
  amount: 3, // USDC
  side: Side.BUY
});

// Sell
await client.createMarketOrder({
  tokenID: '0x123...',
  amount: shares,
  side: Side.SELL
});
```

### Market Data Fetching
```typescript
// Get market by slug
const market = await fetchMarketBySlug('spl-haz-kha-2025-11-06');

// Market structure:
{
  slug: 'spl-haz-kha-2025-11-06',
  conditionId: '0xabc...',
  tokens: [
    { tokenId: '0x123', outcome: 'Al Hazem SC', price: 0.45 },
    { tokenId: '0x456', outcome: 'Al Khaleej', price: 0.55 }
  ]
}
```

## 📊 Position Tracking

### Position Interface
```typescript
{
  id: 'pos_123',
  matchId: '59246',
  market: 'spl-haz-kha-2025-11-06',
  tokenId: '0x123...',
  type: 'TEAM_WINS_YES',
  outcome: 'YES',
  amount: 3,
  avgEntryPrice: 0.45,
  currentPrice: 0.68,
  unrealizedPnL: 1.53,
  unrealizedPnLPercent: 51,
  status: 'OPEN'
}
```

## 🚀 Kullanım

### Trade Executor
```typescript
import { TradeExecutor } from './trade-executor';

const executor = new TradeExecutor(clobClient, dryRun);

// Gol olunca 3 pozisyon aç
const result = await executor.openGoalPositions(match, event);
// → 3 position açıldı
```

### Position Manager
```typescript
import { PositionManager } from './position-manager';

const manager = new PositionManager();

// Pozisyon aç
await manager.openPosition(match, tokenId, amount);

// Kademeli sat
await manager.checkExitTargets();
// → 50% kar → %25 satıldı
```

### Exit Strategy
```typescript
import { ExitStrategy } from './exit-strategy';

const strategy = new ExitStrategy();

// Kar kontrolü
const decision = strategy.shouldSell(position);
// → { action: 'PARTIAL', percent: 25 }
```

## 📁 Dosyalar

- `types.ts` (120 sat) - Trading types
- `trade-executor.ts` (250 sat) - Polymarket API
- `position-manager.ts` (280 sat) - Position tracking
- `exit-strategy.ts` (200 sat) - Kademeli satış
- `market-fetcher.ts` (180 sat) - Market data
- `README.md` - Bu dosya

## ⚙️ Config

`.env`:
```bash
# Polymarket
PRIVATE_KEY=...
FUNDER_ADDRESS=...
SIGNATURE_TYPE=2
CLOB_API_URL=https://clob.polymarket.com

# Trading
DEFAULT_BUY_AMOUNT=3
MAX_DAILY_LOSS=100
```

## 🧪 Test

```bash
npm run test:trading
```

## 📝 TODO

- [ ] Market fetcher (Polymarket API)
- [ ] Trade executor (buy/sell)
- [ ] Position manager (3 positions)
- [ ] Exit strategy (kademeli satış)
- [ ] Integration with production-bot
