/**
 * MATCH SCHEDULER - İki fazlı akıllı takip sistemi
 * Görevler:
 * 1. Maç fazını belirle (pre-match, early, mid, critical, ultra-critical)
 * 2. Dinamik interval hesapla (1-2 saniye canlıda)
 * 3. Faz geçişlerini yönet
 * Max 200 satır
 */

import { FootballMatch, MatchPhase, MatchPhaseInfo } from './types';

export interface PhaseIntervals {
  discovery: number;        // 60s - Maç arama
  preMatch: number;         // 30s - Maç başlamak üzere
  early: number;            // 0.15s (150ms) - İlk 15 dakika (ULTRA FAST!)
  midGame: number;          // 0.15s (150ms) - 15-70 dakika
  critical: number;         // 0.1s (100ms) - 70-85 dakika
  final: number;            // 0.1s (100ms) - 85+ dakika (son dakika!)
  postMatch: number;        // 10s - Maç bitti kontrol
}

export class MatchScheduler {
  // Polling intervals (saniye) - BALANCED MODE
  private intervals = {
    discovery: 60,   // Maç keşfi
    preMatch: 30,    // Maç başlamadan önce
    early: 1,        // ⚡ İlk 15 dk - İLK GOL KRİTİK! (Her 1 saniye)
    midGame: 1,      // ⚡ 15-70 dk - Hızlı takip (Her 1 saniye)
    critical: 1,     // ⚡ 70-85 dk - KRİTİK FAZ (Her 1 saniye)
    final: 1,        // ⚡ 85+ dk - SON DAKİKA (Her 1 saniye)
    postMatch: 10
  };

  /**
   * Maç fazını belirle
   */
  getMatchPhase(match: FootballMatch): MatchPhaseInfo {
    const now = new Date();
    const kickoff = new Date(match.kickoffUTC);
    const diffMs = kickoff.getTime() - now.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));

    // Maç bittiyse (120+ dakika)
    if (diffMinutes < -120) {
      return {
        phase: MatchPhase.POST_MATCH,
        interval: 0, // Takibi durdur
        reason: 'Maç bitti, takip sonlandırıldı'
      };
    }

    // Maç sonrası kontrol (90-120 dakika)
    if (diffMinutes > -120 && diffMinutes <= -90) {
      return {
        phase: MatchPhase.POST_MATCH,
        interval: this.intervals.postMatch,
        reason: 'Maç sonrası kontrol (uzatma olabilir)'
      };
    }

    // Canlı maç fazları (currentMinute varsa)
    // ⚡ ÖNEMLI: currentMinute: 0 da geçerli! (undefined ve null kontrolü)
    if (match.currentMinute !== undefined && match.currentMinute !== null) {
      return this.getLivePhase(match.currentMinute);
    }

    // Maç başlamış ama currentMinute yok (0-90 dk)
    if (diffMinutes >= -90 && diffMinutes < 0) {
      const estimatedMinute = Math.abs(diffMinutes);
      return this.getLivePhase(estimatedMinute);
    }

    // Maç başlamak üzere (-10 ila 0 dakika)
    if (diffMinutes >= -10 && diffMinutes < 0) {
      return {
        phase: MatchPhase.PRE_MATCH,
        interval: this.intervals.preMatch,
        reason: `Maç ${Math.abs(diffMinutes)} dakika içinde başlıyor!`
      };
    }

    // Henüz zamanı gelmemiş
    return {
      phase: MatchPhase.PRE_MATCH,
      interval: this.intervals.discovery,
      reason: `Maç ${diffMinutes} dakika sonra başlayacak`
    };
  }

  /**
   * Canlı maç için faz belirle (dakikaya göre)
   */
  private getLivePhase(minute: number): MatchPhaseInfo {
    if (minute < 15) {
      return {
        phase: MatchPhase.EARLY,
        interval: this.intervals.early,
        reason: `${minute}. dakika - İlk gol kritik! ⚡ (Her 300ms kontrol)`
      };
    } else if (minute < 70) {
      return {
        phase: MatchPhase.MID_GAME,
        interval: this.intervals.midGame,
        reason: `${minute}. dakika - Sürekli hızlı takip (Her 300ms)`
      };
    } else if (minute < 85) {
      return {
        phase: MatchPhase.CRITICAL,
        interval: this.intervals.critical,
        reason: `${minute}. dakika - KRİTİK FAZ! 🔥 (Her 100ms)`
      };
    } else {
      return {
        phase: MatchPhase.ULTRA_CRITICAL,
        interval: this.intervals.final,
        reason: `${minute}. dakika - MAKSIMUM HIZ! ⚡⚡ (Her 100ms)`
      };
    }
  }

  /**
   * İntervalleri özelleştir
   */
  setIntervals(intervals: Partial<PhaseIntervals>): void {
    this.intervals = { ...this.intervals, ...intervals };
    console.log('✅ İnterval ayarları güncellendi');
  }

  /**
   * Mevcut interval ayarlarını getir
   */
  getIntervals(): PhaseIntervals {
    return { ...this.intervals };
  }

  /**
   * Günlük request tahmini
   */
  estimateDailyRequests(avgLiveMatches: number = 15): {
    discovery: number;
    liveMonitoring: number;
    total: number;
    breakdown: Record<string, number>;
  } {
    // Discovery: Her 5 dakikada 1
    const discovery = Math.floor((24 * 60) / 5); // 288

    // Live monitoring: Her maç için
    const avgMatchDuration = 105; // 90 + uzatma + kontrol
    
    const breakdown = {
      discovery,
      preMatch: avgLiveMatches * Math.floor(10 / (this.intervals.preMatch / 60)),
      early: avgLiveMatches * Math.floor(15 / (this.intervals.early / 60)),
      midGame: avgLiveMatches * Math.floor(55 / (this.intervals.midGame / 60)),
      critical: avgLiveMatches * Math.floor(15 / (this.intervals.critical / 60)),
      final: avgLiveMatches * Math.floor(10 / (this.intervals.final / 60)),
      postMatch: avgLiveMatches * Math.floor(15 / (this.intervals.postMatch / 60))
    };

    const liveMonitoring = Object.values(breakdown).reduce((a, b) => a + b, 0) - discovery;
    const total = discovery + liveMonitoring;

    return {
      discovery,
      liveMonitoring,
      total,
      breakdown
    };
  }

  /**
   * Request limiti kontrol
   */
  checkDailyLimit(avgLiveMatches: number = 15): {
    estimated: number;
    limit: number;
    remaining: number;
    percentage: number;
    safe: boolean;
  } {
    const DAILY_LIMIT = 75000;
    const est = this.estimateDailyRequests(avgLiveMatches);

    return {
      estimated: est.total,
      limit: DAILY_LIMIT,
      remaining: DAILY_LIMIT - est.total,
      percentage: (est.total / DAILY_LIMIT) * 100,
      safe: est.total < DAILY_LIMIT * 0.9 // 90% altında güvenli
    };
  }

  /**
   * Faz istatistikleri yazdır
   */
  printPhaseInfo(match: FootballMatch): void {
    const phase = this.getMatchPhase(match);
    
    console.log(`\n⚽ ${match.title || match.slug}`);
    console.log(`   📍 Faz: ${phase.phase}`);
    console.log(`   ⏱️  Interval: ${phase.interval}s`);
    console.log(`   💡 ${phase.reason}`);
    
    if (match.homeScore !== undefined && match.awayScore !== undefined) {
      console.log(`   📊 Skor: ${match.homeScore}-${match.awayScore}`);
    }
  }
}
