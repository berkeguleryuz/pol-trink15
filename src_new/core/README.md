# Core Module - Sistem Çekirdeği

## 🎯 Amaç
Bot'un temel bileşenlerini içerir. Maç yönetimi, durum takibi, koordinasyon.

## 📁 Dosyalar

### `match-manager.ts` (250 satır)
- Maç listesi yönetimi
- Durum güncellemeleri (upcoming → soon → live → finished)
- Multi-match coordination (20-50 maç)
- EndDate sıralaması

### `match-scheduler.ts` (200 satır)
- İki fazlı sistem (discovery + live)
- Dinamik interval ayarlama
- Faz geçişleri (pre-match → live → post-match)

### `types.ts` (150 satır)
- Tüm TypeScript interface'leri
- Match, Trade, Position tipleri
- Enum'lar (MatchStatus, TradeAction, etc.)

## 🔗 Dışa Aktarılan API

```typescript
// Match Manager
export class MatchManager {
  loadMatches(): Promise<FootballMatch[]>
  updateStatus(matchId: string, status: MatchStatus): void
  getActiveMatches(): FootballMatch[]
  cleanupFinished(): void
}

// Match Scheduler
export class MatchScheduler {
  schedule(match: FootballMatch): void
  getPhase(match: FootballMatch): MatchPhase
  getDynamicInterval(phase: MatchPhase): number
}
```

## 💡 Kullanım

```typescript
import { MatchManager } from './match-manager';

const manager = new MatchManager();
await manager.loadMatches();

const active = manager.getActiveMatches();
// → [{ id, slug, status: 'live', ... }]
```
