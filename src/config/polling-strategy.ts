/**
 * 🎯 AKILLI POLLING STRATEJİSİ
 * 
 * Maç durumuna göre dinamik interval
 * 75,000 req/day limiti içinde optimal kullanım
 */

export interface PollingConfig {
  defaultInterval: number;  // Varsayılan interval (saniye)
  intervals: {
    veryEarly: number;      // 0-10 dakika
    early: number;          // 10-30 dakika
    normal: number;         // 30-70 dakika
    critical: number;       // 70-85 dakika
    ultra: number;          // 85+ dakika
    halfTime: number;       // Devre arası
  };
  scoreAdjustment: {
    tied: number;           // Berabere maçlarda ekle/çıkar
    closeGame: number;      // 1 gol fark
    blowout: number;        // 3+ gol fark
  };
}

export const DEFAULT_POLLING_CONFIG: PollingConfig = {
  defaultInterval: 3,
  intervals: {
    veryEarly: 5,    // 0-10 dak → 5 sn (maç yeni, sakin)
    early: 4,        // 10-30 dak → 4 sn 
    normal: 3,       // 30-70 dak → 3 sn (standart)
    critical: 2,     // 70-85 dak → 2 sn (kritik)
    ultra: 1,        // 85+ dak → 1 sn (🔥 son dakika)
    halfTime: 10     // Devre arası → 10 sn (oyun yok)
  },
  scoreAdjustment: {
    tied: -1,        // Berabere → 1 sn daha hızlı (gol olasılığı yüksek)
    closeGame: 0,    // 1 fark → değişiklik yok
    blowout: +2      // 3+ fark → 2 sn daha yavaş (sonuç belli)
  }
};

export interface MatchState {
  minute: number;
  homeScore: number;
  awayScore: number;
  isHalfTime: boolean;
}

/**
 * Maç durumuna göre optimal polling interval hesapla
 */
export function calculatePollingInterval(
  match: MatchState,
  config: PollingConfig = DEFAULT_POLLING_CONFIG
): number {
  // Devre arası kontrolü
  if (match.isHalfTime || (match.minute >= 45 && match.minute <= 46)) {
    return config.intervals.halfTime;
  }
  
  // Dakikaya göre base interval
  let interval: number;
  
  if (match.minute < 10) {
    interval = config.intervals.veryEarly;
  } else if (match.minute < 30) {
    interval = config.intervals.early;
  } else if (match.minute < 70) {
    interval = config.intervals.normal;
  } else if (match.minute < 85) {
    interval = config.intervals.critical;
  } else {
    interval = config.intervals.ultra; // 85+ dakika → 1 saniye!
  }
  
  // Skor durumuna göre ayarlama
  const scoreDiff = Math.abs(match.homeScore - match.awayScore);
  
  if (scoreDiff === 0) {
    // Berabere → daha hızlı poll (gol beklentisi yüksek)
    interval += config.scoreAdjustment.tied;
  } else if (scoreDiff === 1 && match.minute > 70) {
    // 1 gol fark + son 20 dakika → hızlı poll
    interval += config.scoreAdjustment.closeGame;
  } else if (scoreDiff >= 3) {
    // 3+ gol fark → yavaş poll (sonuç belli gibi)
    interval += config.scoreAdjustment.blowout;
  }
  
  // Minimum 1 saniye, maksimum 10 saniye
  return Math.max(1, Math.min(10, interval));
}

/**
 * Günlük request tahmini
 */
export function estimateDailyRequests(
  avgLiveMatches: number = 20,
  config: PollingConfig = DEFAULT_POLLING_CONFIG
): {
  total: number;
  breakdown: Record<string, number>;
  limitUsage: number;
} {
  const DAILY_LIMIT = 75000;
  
  // Ortalama maç dağılımı (dakika başına request)
  const breakdown = {
    veryEarly: (10 * avgLiveMatches * (60 / config.intervals.veryEarly)),  // 0-10 dak
    early: (20 * avgLiveMatches * (60 / config.intervals.early)),           // 10-30 dak
    normal: (40 * avgLiveMatches * (60 / config.intervals.normal)),         // 30-70 dak
    halfTime: (15 * avgLiveMatches * (60 / config.intervals.halfTime)),     // Devre arası
    critical: (15 * avgLiveMatches * (60 / config.intervals.critical)),     // 70-85 dak
    ultra: (10 * avgLiveMatches * (60 / config.intervals.ultra)),           // 85+ dak
  };
  
  const total = Object.values(breakdown).reduce((sum, val) => sum + val, 0);
  const limitUsage = (total / DAILY_LIMIT) * 100;
  
  return {
    total: Math.round(total),
    breakdown: Object.fromEntries(
      Object.entries(breakdown).map(([k, v]) => [k, Math.round(v)])
    ),
    limitUsage: Math.round(limitUsage)
  };
}

/**
 * Rate limiter - 75,000 req/day kontrolü
 */
export class RateLimiter {
  private requestLog: number[] = [];
  private readonly dailyLimit = 75000;
  
  canMakeRequest(): boolean {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    
    // Son 24 saatteki requestleri filtrele
    this.requestLog = this.requestLog.filter(ts => ts > oneDayAgo);
    
    return this.requestLog.length < this.dailyLimit;
  }
  
  recordRequest(): void {
    this.requestLog.push(Date.now());
  }
  
  getRemainingRequests(): number {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const recentRequests = this.requestLog.filter(ts => ts > oneDayAgo).length;
    
    return Math.max(0, this.dailyLimit - recentRequests);
  }
  
  getUsagePercentage(): number {
    return ((this.dailyLimit - this.getRemainingRequests()) / this.dailyLimit) * 100;
  }
}

// Kullanım örneği:
/*
const match = {
  minute: 87,
  homeScore: 1,
  awayScore: 1,
  isHalfTime: false
};

const interval = calculatePollingInterval(match);
console.log(`Next poll in ${interval} seconds`); // 1 saniye (87. dakika + berabere)

// Günlük tahmin
const estimate = estimateDailyRequests(20);
console.log(`Daily requests: ${estimate.total} (${estimate.limitUsage}% of limit)`);
console.log('Breakdown:', estimate.breakdown);
*/
