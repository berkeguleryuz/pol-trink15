/**
 * LIVE SCORE TRACKER - API-Football canlı skor takibi
 * Görevler:
 * 1. API-Football'dan canlı skor çek
 * 2. Gol olaylarını tespit et
 * 3. Event emitter (goal, red_card, etc.)
 * Max 280 satır
 */

import axios from 'axios';
import { EventEmitter } from 'events';
import { FootballMatch, GoalEvent } from '../core/types';

interface APIFixture {
  fixture: {
    id: number;
    timestamp?: number; // Unix timestamp
    status: { elapsed: number; short: string };
  };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
  goals: {
    home: number | null;
    away: number | null;
  };
  score: {
    halftime: { home: number | null; away: number | null };
    fulltime: { home: number | null; away: number | null };
  };
  events?: Array<{
    time: { elapsed: number };
    team: { id: number; name: string };
    player: { name: string };
    type: string;
    detail: string;
  }>;
}

interface TrackedMatch {
  match: FootballMatch;
  intervalId: NodeJS.Timeout;
  lastScore: { home: number; away: number };
  isInitialized: boolean; // İlk skor alındı mı?
}

export class LiveScoreTracker extends EventEmitter {
  private apiKey: string;
  private trackedMatches: Map<string, TrackedMatch> = new Map();
  private requestCount = 0;
  private batchIntervalId?: NodeJS.Timeout;

  constructor(apiKey?: string) {
    super();
    this.apiKey = apiKey || process.env.FOOTBALL_API_KEY || '';
  }

  /**
   * API-Football'dan canlı maçları çek
   */
  async fetchLiveMatches(): Promise<APIFixture[]> {
    try {
      const response = await axios.get('https://v3.football.api-sports.io/fixtures', {
        params: { live: 'all' },
        headers: {
          'x-apisports-key': process.env.FOOTBALL_API_KEY || this.apiKey
        },
        timeout: 15000  // ✅ 5s → 15s (daha uzun timeout)
      });

      this.requestCount++;
      
      if (response.data?.response) {
        return response.data.response;
      }
      
      return [];
    } catch (error: any) {
      console.error('❌ API-Football error:', error.message);
      this.emit('error', error);
      return [];
    }
  }

  /**
   * Belirli bir maçın skorunu çek
   */
  async fetchMatchScore(apiFootballId: number): Promise<APIFixture | null> {
    try {
      const response = await axios.get(`https://v3.football.api-sports.io/fixtures`, {
        params: { id: apiFootballId },
        headers: {
          'x-apisports-key': process.env.FOOTBALL_API_KEY || this.apiKey
        },
        timeout: 15000  // ✅ 5s → 15s
      });

      this.requestCount++;

      if (response.data?.response?.[0]) {
        return response.data.response[0];
      }

      return null;
    } catch (error: any) {
      console.error(`❌ API-Football error (${apiFootballId}):`, error.message);
      return null;
    }
  }

  /**
   * Maç takibini başlat - BATCH MODE
   * @param match - Takip edilecek maç
   * @param intervalMs - Batch polling intervali (tüm maçlar için tek request)
   */
  startTracking(match: FootballMatch, intervalMs: number = 1000): void {
    if (this.trackedMatches.has(match.id)) {
      console.log(`⚠️  ${match.slug} zaten takip ediliyor`);
      return;
    }

    // ⚡ API Football ID opsiyonel - slug/takım adı ile matching yapacağız!
    if (match.apiFootballId) {
      console.log(`🔴 Takip listesine eklendi: ${match.slug}`);
      console.log(`   📊 API Football ID: ${match.apiFootballId}`);
    } else {
      console.log(`🔴 Takip listesine eklendi: ${match.slug}`);
      console.log(`   📊 Matching: Takım adı ile (${match.homeTeam} vs ${match.awayTeam})`);
    }
    console.log(`   ⚽ İlk skor: ${match.homeScore || 0}-${match.awayScore || 0}`);

    // İlk skor
    const initialScore = {
      home: match.homeScore || 0,
      away: match.awayScore || 0
    };

    // Tracked matches'e ekle (interval yok - batch mode)
    this.trackedMatches.set(match.id, {
      match,
      intervalId: null as any, // Batch mode - per-match interval yok
      lastScore: initialScore,
      isInitialized: false // Henüz gerçek skor alınmadı
    });

    // İlk kez batch update başlat (sadece ilk maç eklendiğinde)
    if (this.trackedMatches.size === 1) {
      console.log(`\n🚀 BATCH POLLING başlatıldı (${intervalMs/1000}s = her ${intervalMs}ms)`);
      console.log(`   📊 TÜM maçlar tek requestte alınıyor (live=all)`);
      console.log(`   ⚡ API tasarrufu: ${this.trackedMatches.size} maç = 1 request/saniye`);
      
      // Global batch interval
      if (this.batchIntervalId) {
        clearInterval(this.batchIntervalId);
      }
      
      this.batchIntervalId = setInterval(async () => {
        await this.checkAllScores();
      }, intervalMs);
      
      // İlk kontrolü hemen yap
      this.checkAllScores();
    } else {
      console.log(`   📊 Batch size: ${this.trackedMatches.size} maç → 1 request/saniye`);
    }
  }

  /**
   * TÜM maçların skorlarını kontrol et (BATCH - tek request)
   */
  async checkAllScores(): Promise<void> {
    // ⚡ Aktif maç yoksa polling yapma
    if (this.trackedMatches.size === 0) {
      return; // Sessizce skip - API tasarrufu
    }

    try {
      // Sessiz batch kontrol - sadece ilk ve gol'de log
      const liveFixtures = await this.fetchLiveMatches();
      
      if (!liveFixtures || liveFixtures.length === 0) {
        return; // Sessizce skip
      }

      // Her tracked maçı güncelle
      for (const [matchId, tracked] of this.trackedMatches.entries()) {
        // ⚡ MATCHING: 1) apiFootballId ile (varsa), 2) Takım adı ile
        let fixture = null;
        
        if (tracked.match.apiFootballId) {
          // ID varsa öncelikli olarak ID ile ara
          fixture = liveFixtures.find(f => f.fixture.id === tracked.match.apiFootballId);
        }
        
        if (!fixture) {
          // ID yok veya bulunamadı → Takım adına bak
          fixture = liveFixtures.find(f => {
            if (!tracked.match.homeTeam || !tracked.match.awayTeam) return false;
            const homeMatch = this.fuzzyMatch(f.teams.home.name, tracked.match.homeTeam);
            const awayMatch = this.fuzzyMatch(f.teams.away.name, tracked.match.awayTeam);
            return homeMatch && awayMatch;
          });
        }
        
        if (!fixture) {
          // Bu maç API-Football'da yok (coverage dışı lig olabilir)
          continue;
        }

      const currentScore = {
        home: fixture.goals.home || 0,
        away: fixture.goals.away || 0
      };

      const currentMinute = fixture.fixture.status.elapsed;
      const matchStatus = fixture.fixture.status.short; // HT, FT, 1H, 2H, etc.

      // İLK KONTROL: Sadece başlangıç skorunu al, gol event'i yayınlama!
      if (!tracked.isInitialized) {
        console.log(`📊 İlk skor alındı: ${tracked.match.slug} → ${currentScore.home}-${currentScore.away} (${currentMinute}' ${matchStatus})`);
        
        // ⏱️ API delay check
        if (fixture.fixture.timestamp) {
          const now = new Date();
          const apiTime = new Date(fixture.fixture.timestamp * 1000);
          const delay = Math.floor((now.getTime() - apiTime.getTime()) / 1000);
          console.log(`   ⏱️  API time: ${apiTime.toISOString().substr(11, 8)} | Delay: ${delay}s`);
        }
        
        tracked.lastScore = currentScore;
        tracked.isInitialized = true;
        
        // Score update event (UI için)
        tracked.match.homeScore = currentScore.home;
        tracked.match.awayScore = currentScore.away;
        tracked.match.currentMinute = currentMinute;
        tracked.match.matchStatus = matchStatus; // ⚡ YENİ: HT/FT bilgisi
        this.emit('score-update', tracked.match);
        continue; // Gol event'i yayınlama!
      }

      // SONRAKI KONTROLLER: Sadece GERÇEK skor değişikliğinde gol event'i yayınla
      if (
        currentScore.home !== tracked.lastScore.home ||
        currentScore.away !== tracked.lastScore.away
      ) {
        // GOL İPTAL KONTROLÜ!
        const homeGoalCancelled = currentScore.home < tracked.lastScore.home;
        const awayGoalCancelled = currentScore.away < tracked.lastScore.away;
        
        if (homeGoalCancelled || awayGoalCancelled) {
          console.log(`\n🚫 GOL İPTAL OLDU! ${tracked.match.slug}`);
          console.log(`   ${tracked.lastScore.home}-${tracked.lastScore.away} → ${currentScore.home}-${currentScore.away}`);
          console.log(`   ${currentMinute}. dakika`);
          console.log(`   ⚠️  VAR kontrolü veya hakem kararı - Trade atlanıyor!`);
          
          // Skoru güncelle ama event yayınlama
          tracked.lastScore = currentScore;
          tracked.match.homeScore = currentScore.home;
          tracked.match.awayScore = currentScore.away;
          tracked.match.currentMinute = currentMinute;
          tracked.match.matchStatus = matchStatus;
          this.emit('score-update', tracked.match);
          continue; // Gol event'i yayınlama!
        }
        
        // Normal gol (skor arttı)
        const goalEvent: GoalEvent = {
          matchId: tracked.match.id,
          team: currentScore.home > tracked.lastScore.home ? 'home' : 'away',
          minute: currentMinute,
          scorer: this.extractScorer(fixture.events, currentMinute),
          newScore: currentScore,
          previousScore: tracked.lastScore,
          timestamp: new Date()
        };

        console.log(`\n⚽⚽⚽ GOL! ${tracked.match.slug}`);
        console.log(`   ${tracked.lastScore.home}-${tracked.lastScore.away} → ${currentScore.home}-${currentScore.away}`);
        console.log(`   ${currentMinute}. dakika`);

        // Event emit et
        this.emit('goal', goalEvent);

        // Skoru güncelle
        tracked.lastScore = currentScore;
      }

      // Maç durumunu güncelle
      tracked.match.homeScore = currentScore.home;
      tracked.match.awayScore = currentScore.away;
      tracked.match.currentMinute = currentMinute;
      tracked.match.matchStatus = matchStatus; // ⚡ HT, FT, 1H, 2H
      
      // Score update event (her poll'da)
      this.emit('score-update', tracked.match);

      // Maç bittiyse takibi durdur
      if (matchStatus === 'FT' || matchStatus === 'AET' || matchStatus === 'PEN' || currentMinute > 95) {
        console.log(`✅ Maç bitti: ${tracked.match.slug} (${matchStatus})`);
        this.stopTracking(tracked.match.id);
        this.emit('match-finished', tracked.match);
      }
    }
    } catch (error: any) {
      // Timeout veya network hatası - sessizce devam et
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        console.log(`   ⏱️  API-Football timeout - bir sonraki poll'da denenecek`);
      } else {
        console.error(`   ❌ Score check error:`, error.message);
      }
    }
  }

  /**
   * Skor kontrolü yap (ESKİ - artık kullanılmıyor, batch mode aktif)
   * @deprecated
   */
  private async checkScore(match: FootballMatch): Promise<void> {
    if (!match.apiFootballId) return;

    console.log(`🔍 Skor kontrol: ${match.slug} (API ID: ${match.apiFootballId})`);

    const fixture = await this.fetchMatchScore(match.apiFootballId);
    if (!fixture) {
      console.log(`   ⚠️  Fixture alınamadı`);
      return;
    }

    const tracked = this.trackedMatches.get(match.id);
    if (!tracked) return;

    const currentScore = {
      home: fixture.goals.home || 0,
      away: fixture.goals.away || 0
    };

    const currentMinute = fixture.fixture.status.elapsed;

    console.log(`   ⚽ Skor: ${currentScore.home}-${currentScore.away} (${currentMinute}')`);

    // Skor değişti mi?
    if (
      currentScore.home !== tracked.lastScore.home ||
      currentScore.away !== tracked.lastScore.away
    ) {
      // GOL İPTAL KONTROLÜ!
      const homeGoalCancelled = currentScore.home < tracked.lastScore.home;
      const awayGoalCancelled = currentScore.away < tracked.lastScore.away;
      
      if (homeGoalCancelled || awayGoalCancelled) {
        console.log(`\n🚫 GOL İPTAL OLDU! ${match.slug}`);
        console.log(`   ${tracked.lastScore.home}-${tracked.lastScore.away} → ${currentScore.home}-${currentScore.away}`);
        console.log(`   ⚠️  VAR kontrolü - Trade atlanıyor!`);
        tracked.lastScore = currentScore;
        return; // Event yayınlama
      }
      
      const goalEvent: GoalEvent = {
        matchId: match.id,
        team: currentScore.home > tracked.lastScore.home ? 'home' : 'away',
        minute: currentMinute,
        scorer: this.extractScorer(fixture.events, currentMinute),
        newScore: currentScore,
        previousScore: tracked.lastScore,
        timestamp: new Date()
      };

      console.log(`\n⚽ GOL! ${match.slug}`);
      console.log(`   ${tracked.lastScore.home}-${tracked.lastScore.away} → ${currentScore.home}-${currentScore.away}`);
      console.log(`   ${currentMinute}. dakika`);

      // Event emit et
      this.emit('goal', goalEvent);

      // Skoru güncelle
      tracked.lastScore = currentScore;
    }

    // Maç durumunu güncelle
    match.homeScore = currentScore.home;
    match.awayScore = currentScore.away;
    match.currentMinute = currentMinute;
    
    // Score update event (her poll'da)
    this.emit('score-update', match);

    // Maç bittiyse takibi durdur
    if (fixture.fixture.status.short === 'FT' || currentMinute > 95) {
      console.log(`✅ Maç bitti: ${match.slug}`);
      this.stopTracking(match.id);
      this.emit('match-finished', match);
    }
  }

  /**
   * Event'lerden golü atan oyuncuyu çıkar
   */
  private extractScorer(events: APIFixture['events'], minute: number): string {
    if (!events) return 'Unknown';

    const goalEvent = events
      .filter(e => e.type === 'Goal' && e.time.elapsed === minute)
      .pop();

    return goalEvent?.player.name || 'Unknown';
  }

  /**
   * Fuzzy team name matching (takım adı eşleştirme)
   * Örnek: "Al Fayha Saudi Club" = "Al-Fayha" = "Al Fayha"
   * Örnek: "FK Dinamo Moskva" = "Dynamo" = "Dinamo Moscow"
   */
  private fuzzyMatch(apiName: string, polymarketName: string): boolean {
    // Normalize: küçük harf, boşlukları/tire kaldır
    const normalize = (name: string) => 
      name.toLowerCase()
        .replace(/\s+/g, '')
        .replace(/-/g, '')
        .replace(/fc|fk|club|sc|cf|united|city|town/gi, '')
        // ⚡ Dinamo/Dynamo normalize
        .replace(/dinamo/g, 'dynamo')
        .replace(/moskva/g, 'moscow')
        .replace(/moskow/g, 'moscow');
    
    const apiNorm = normalize(apiName);
    const polyNorm = normalize(polymarketName);
    
    // 1. Tam eşleşme
    if (apiNorm === polyNorm) return true;
    
    // 2. Birbirini içeriyor mu (en az 4 karakter)
    if (apiNorm.length >= 4 && polyNorm.length >= 4) {
      if (apiNorm.includes(polyNorm) || polyNorm.includes(apiNorm)) {
        return true;
      }
    }
    
    // 3. İlk 4 karakter aynı mı
    if (apiNorm.slice(0, 4) === polyNorm.slice(0, 4)) {
      return true;
    }
    
    return false;
  }

  /**
   * Maç takibini durdur
   */
  stopTracking(matchId: string): void {
    const tracked = this.trackedMatches.get(matchId);
    if (!tracked) return;

    console.log(`⏹️  Takipten çıkarıldı: ${tracked.match.slug}`);
    
    this.trackedMatches.delete(matchId);
    
    // Son maç kaldıysa batch interval'i durdur
    if (this.trackedMatches.size === 0 && this.batchIntervalId) {
      console.log('⏹️  Batch polling durduruldu (hiç maç kalmadı)');
      clearInterval(this.batchIntervalId);
      this.batchIntervalId = undefined;
    } else if (this.trackedMatches.size > 0) {
      console.log(`   📊 Kalan maç: ${this.trackedMatches.size}`);
    }
  }

    /**
   * Tüm takipleri durdur
   */
  stopAllTracking(): void {
    console.log(`🛑 ${this.trackedMatches.size} maçın takibi durduruluyor...`);
    
    // Batch interval'i temizle
    if (this.batchIntervalId) {
      clearInterval(this.batchIntervalId);
      this.batchIntervalId = undefined;
    }
    
    this.trackedMatches.clear();
  }

  /**
   * Takip istatistikleri
   */
  getStatistics(): {
    trackedMatches: number;
    totalRequests: number;
  } {
    return {
      trackedMatches: this.trackedMatches.size,
      totalRequests: this.requestCount
    };
  }
}
