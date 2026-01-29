# Monitoring Module - Canlı Maç Takibi

## 🎯 Amaç
API-Football'dan canlı skor takibi, gol olaylarını tespit, SLUG eşleştirme.

## 📁 Dosyalar

### `live-score-tracker.ts` (280 satır)
- API-Football entegrasyonu
- 1-2 saniyede skor çekme (live maçlar için)
- Gol tespiti (score değişimi)
- Event detection (red card, penalty)

### `match-matcher.ts` (200 satır)
- Polymarket SLUG ↔ API-Football eşleştirme
- Takım ismi normalizasyonu
- Fuzzy matching algoritması

### `goal-detector.ts` (150 satır)
- Gol olayı tespiti
- Karşı gol (reverse goal) tespiti
- Goal event payload oluştur

## 🔗 Dışa Aktarılan API

```typescript
// Live Score Tracker
export class LiveScoreTracker {
  fetchLiveScore(matchId: string): Promise<LiveScore>
  detectGoal(prev: Score, current: Score): GoalEvent | null
  startTracking(match: FootballMatch): void
  stopTracking(matchId: string): void
}

// Match Matcher
export class MatchMatcher {
  matchPolymarketWithAPI(slug: string): Promise<APIMatch | null>
  normalizeTeamName(name: string): string
}
```

## 💡 Kullanım

```typescript
import { LiveScoreTracker } from './live-score-tracker';

const tracker = new LiveScoreTracker();

// Maç takibini başlat (1 saniye interval)
tracker.startTracking(match);

// Gol olayı dinle
tracker.on('goal', (event) => {
  console.log(`⚽ GOL! ${event.team} - ${event.minute}'`);
  // → Trading module'e ilet
});
```
