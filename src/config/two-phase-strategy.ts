/**
 * 🎯 2 FAZLI AKILLI TARAMA SİSTEMİ
 * 
 * FAZ 1: KEŞIF - Maçları bul ve programla
 * FAZ 2: SAVAŞ - Canlı maçları agresif takip et
 * 
 * 75,000 request/day optimal kullanımı
 */

export interface MatchSchedule {
  id: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoffTime: Date;
  isLive: boolean;
  polymarketSlug?: string;
  polymarketConditionId?: string;
}

export interface PhaseConfig {
  // FAZ 1: Keşif (Match Discovery)
  discovery: {
    enabled: boolean;
    interval: number;          // 5 dakika = 300 saniye
    maxDailyRequests: number;  // 288 request (5dk interval)
  };
  
  // FAZ 2: Canlı Takip (Live Monitoring)
  liveMonitoring: {
    enabled: boolean;
    dynamicInterval: boolean;  // Dakikaya göre değişken interval
    intervals: {
      preMatch: number;        // -10 dakika: 30 sn (maç başlamak üzere)
      early: number;           // 0-15 dak: 5 sn
      midGame: number;         // 15-70 dak: 3 sn
      critical: number;        // 70-85 dak: 2 sn
      ultraCritical: number;   // 85+ dak: 1 sn
      postMatch: number;       // +5 dakika: 10 sn (maç bitti mi?)
    };
  };
}

export const OPTIMAL_CONFIG: PhaseConfig = {
  discovery: {
    enabled: true,
    interval: 300,          // 5 dakika
    maxDailyRequests: 288   // 24 * 60 / 5 = 288
  },
  
  liveMonitoring: {
    enabled: true,
    dynamicInterval: true,
    intervals: {
      preMatch: 30,         // -10 dak: Her 30 saniyede kontrol
      early: 2,             // 0-15 dak: 2 saniye ⚡ AGRESİF BAŞLANGIÇ!
      midGame: 2,           // 15-70 dak: 2 saniye - Sürekli takip
      critical: 1,          // 70-85 dak: 1 saniye 🔥
      ultraCritical: 1,     // 85+ dak: 1 saniye ⚡ MAKSIMUM HIZ!
      postMatch: 10         // Maç sonrası: 10 saniye
    }
  }
};

/**
 * Maç durumuna göre hangi fazda olduğumuzu belirle
 */
export function getMatchPhase(match: MatchSchedule, now: Date = new Date()): {
  phase: 'discovery' | 'preMatch' | 'live' | 'postMatch' | 'finished';
  interval: number;
  reason: string;
} {
  const kickoff = match.kickoffTime.getTime();
  const nowTime = now.getTime();
  const diffMinutes = (nowTime - kickoff) / 60000;
  
  // Maç bitmişse (120+ dakika)
  if (diffMinutes > 120) {
    return {
      phase: 'finished',
      interval: 0,
      reason: 'Maç bitti, takibi durdur'
    };
  }
  
  // Maç sonrası kontrol (90-120 dakika)
  if (diffMinutes > 90 && diffMinutes <= 120) {
    return {
      phase: 'postMatch',
      interval: OPTIMAL_CONFIG.liveMonitoring.intervals.postMatch,
      reason: 'Maç bitti mi kontrol et'
    };
  }
  
  // Canlı maç (0-90 dakika)
  if (match.isLive || (diffMinutes >= 0 && diffMinutes <= 90)) {
    const minute = Math.floor(diffMinutes);
    
    if (minute < 15) {
      return {
        phase: 'live',
        interval: OPTIMAL_CONFIG.liveMonitoring.intervals.early,
        reason: `${minute}. dakika - AGRESİF! İlk gol önemli ⚡`
      };
    } else if (minute < 70) {
      return {
        phase: 'live',
        interval: OPTIMAL_CONFIG.liveMonitoring.intervals.midGame,
        reason: `${minute}. dakika - Sürekli takip`
      };
    } else if (minute < 85) {
      return {
        phase: 'live',
        interval: OPTIMAL_CONFIG.liveMonitoring.intervals.critical,
        reason: `${minute}. dakika - ÇOK KRİTİK! 🔥`
      };
    } else {
      return {
        phase: 'live',
        interval: OPTIMAL_CONFIG.liveMonitoring.intervals.ultraCritical,
        reason: `${minute}. dakika - MAKSIMUM HIZ! ⚡`
      };
    }
  }
  
  // Maç başlamak üzere (-10 dakika içinde)
  if (diffMinutes >= -10 && diffMinutes < 0) {
    return {
      phase: 'preMatch',
      interval: OPTIMAL_CONFIG.liveMonitoring.intervals.preMatch,
      reason: `Maç ${Math.abs(Math.round(diffMinutes))} dakika içinde başlayacak`
    };
  }
  
  // Henüz zamanı gelmemiş
  return {
    phase: 'discovery',
    interval: OPTIMAL_CONFIG.discovery.interval,
    reason: 'Keşif modunda, maç programlandı'
  };
}

/**
 * Günlük request tahmini - 2 fazlı sistem
 */
export function estimateDailyRequestsOptimized(): {
  discovery: number;
  liveMonitoring: number;
  total: number;
  limitUsage: number;
  breakdown: Record<string, number>;
} {
  const DAILY_LIMIT = 75000;
  
  // FAZ 1: Keşif (her 5 dakikada 1)
  const discoveryRequests = 288; // 24 * 60 / 5
  
  // FAZ 2: Canlı takip (ortalama 15 maç)
  const avgLiveMatches = 15;
  const avgMatchDuration = 105; // 90 + 15 (uzatma + maç sonu kontrol)
  
  const liveBreakdown = {
    preMatch: avgLiveMatches * 10 * 2,           // 10 dak, 30sn interval
    early: avgLiveMatches * 15 * 12,             // 15 dak, 5sn interval
    midGame: avgLiveMatches * 55 * 20,           // 55 dak, 3sn interval
    critical: avgLiveMatches * 15 * 30,          // 15 dak, 2sn interval
    ultraCritical: avgLiveMatches * 10 * 60,     // 10 dak, 1sn interval
    postMatch: avgLiveMatches * 15 * 6           // 15 dak, 10sn interval
  };
  
  const liveMonitoringRequests = Object.values(liveBreakdown).reduce((a, b) => a + b, 0);
  
  const total = discoveryRequests + liveMonitoringRequests;
  const limitUsage = (total / DAILY_LIMIT) * 100;
  
  return {
    discovery: discoveryRequests,
    liveMonitoring: liveMonitoringRequests,
    total,
    limitUsage,
    breakdown: {
      discovery: discoveryRequests,
      ...liveBreakdown
    }
  };
}

/**
 * Match Scheduler - Bugünkü ve yarınki maçları programla
 */
export class MatchScheduler {
  private scheduledMatches: Map<string, MatchSchedule> = new Map();
  private liveMatches: Set<string> = new Set();
  
  /**
   * Yeni maçları programa ekle
   */
  scheduleMatch(match: MatchSchedule): void {
    this.scheduledMatches.set(match.id, match);
    console.log(`📅 Maç programlandı: ${match.homeTeam} vs ${match.awayTeam} - ${match.kickoffTime.toLocaleString('tr-TR')}`);
  }
  
  /**
   * Maçı canlı takibe al
   */
  startLiveMonitoring(matchId: string): void {
    const match = this.scheduledMatches.get(matchId);
    if (match) {
      match.isLive = true;
      this.liveMatches.add(matchId);
      console.log(`🔴 CANLI: ${match.homeTeam} vs ${match.awayTeam} başladı!`);
    }
  }
  
  /**
   * Maç takibini durdur
   */
  stopMonitoring(matchId: string): void {
    const match = this.scheduledMatches.get(matchId);
    if (match) {
      match.isLive = false;
      this.liveMatches.delete(matchId);
      console.log(`✅ Tamamlandı: ${match.homeTeam} vs ${match.awayTeam}`);
    }
  }
  
  /**
   * Şu an canlı olan maçları getir
   */
  getLiveMatches(): MatchSchedule[] {
    return Array.from(this.liveMatches)
      .map(id => this.scheduledMatches.get(id))
      .filter((m): m is MatchSchedule => m !== undefined);
  }
  
  /**
   * Yakında başlayacak maçları getir (10 dakika içinde)
   */
  getUpcomingMatches(): MatchSchedule[] {
    const now = new Date();
    const tenMinutesLater = new Date(now.getTime() + 10 * 60000);
    
    return Array.from(this.scheduledMatches.values())
      .filter(m => 
        !m.isLive && 
        m.kickoffTime >= now && 
        m.kickoffTime <= tenMinutesLater
      );
  }
  
  /**
   * Bugünkü tüm programlanmış maçları getir
   */
  getTodaysSchedule(): MatchSchedule[] {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    return Array.from(this.scheduledMatches.values())
      .filter(m => m.kickoffTime >= today && m.kickoffTime < tomorrow)
      .sort((a, b) => a.kickoffTime.getTime() - b.kickoffTime.getTime());
  }
  
  /**
   * Hangi maçlar hangi fazda - istatistik
   */
  getPhaseStatistics(): {
    discovery: number;
    preMatch: number;
    live: number;
    postMatch: number;
    finished: number;
  } {
    const stats = {
      discovery: 0,
      preMatch: 0,
      live: 0,
      postMatch: 0,
      finished: 0
    };
    
    this.scheduledMatches.forEach(match => {
      const phase = getMatchPhase(match);
      stats[phase.phase]++;
    });
    
    return stats;
  }
}

/**
 * Request Counter - Günlük kullanımı takip et
 */
export class RequestCounter {
  private requestLog: Array<{timestamp: Date, phase: string}> = [];
  
  logRequest(phase: 'discovery' | 'live'): void {
    this.requestLog.push({
      timestamp: new Date(),
      phase
    });
  }
  
  getDailyUsage(): {
    discovery: number;
    live: number;
    total: number;
    remaining: number;
    percentage: number;
  } {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    const recentRequests = this.requestLog.filter(r => r.timestamp >= oneDayAgo);
    const discovery = recentRequests.filter(r => r.phase === 'discovery').length;
    const live = recentRequests.filter(r => r.phase === 'live').length;
    const total = recentRequests.length;
    
    return {
      discovery,
      live,
      total,
      remaining: 75000 - total,
      percentage: (total / 75000) * 100
    };
  }
  
  getHourlyRate(): number {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    return this.requestLog.filter(r => r.timestamp >= oneHourAgo).length;
  }
}

// Export singleton instances
export const matchScheduler = new MatchScheduler();
export const requestCounter = new RequestCounter();
