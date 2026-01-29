import axios from 'axios';
import { config } from '../config';
import { 
  MatchScheduler, 
  getMatchPhase, 
  OPTIMAL_CONFIG,
  MatchSchedule 
} from '../config/two-phase-strategy';

interface LiveMatch {
  id: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  country: string;
  minute: number;
  homeScore: number;
  awayScore: number;
  slug?: string;
  polymarketConditionId?: string;
}

interface PolymarketMatch {
  conditionId: string;
  question: string;
  slug: string;
  teams: {
    home: string;
    away: string;
  };
}

export class ProductionSportsBot {
  private scheduler: MatchScheduler;
  private isRunning = false;
  private discoveryIntervalId?: NodeJS.Timeout;
  private liveMonitoringIntervals = new Map<string, NodeJS.Timeout>();
  private polymarketMatches: PolymarketMatch[] = [];

  constructor() {
    this.scheduler = new MatchScheduler();
  }

  /**
   * Polymarket'teki tüm aktif futbol maçlarını getir
   */
  async fetchPolymarketMatches(): Promise<PolymarketMatch[]> {
    try {
      console.log('\n🔍 Polymarket maçları çekiliyor...');
      
      const response = await axios.get('https://gamma-api.polymarket.com/events', {
        params: {
          limit: 100,
          tag: 'sports', // Sadece spor maçları
          active: true,  // Sadece aktif maçlar
        }
      });

      const matches: PolymarketMatch[] = [];
      
      for (const event of response.data) {
        // Futbol maçlarını filtrele
        if (event.markets && event.markets.length > 0) {
          for (const market of event.markets) {
            if (market.question && market.question.includes('vs')) {
              const parts = market.question.split(' vs ');
              if (parts.length === 2) {
                matches.push({
                  conditionId: market.conditionId,
                  question: market.question,
                  slug: market.slug || '',
                  teams: {
                    home: parts[0].trim(),
                    away: parts[1].trim().split('?')[0].trim()
                  }
                });
              }
            }
          }
        }
      }

      console.log(`✅ Polymarket'te ${matches.length} futbol maçı bulundu`);
      return matches;
    } catch (error) {
      console.error('❌ Polymarket maçları çekilemedi:', error);
      return [];
    }
  }

  /**
   * API-Football'dan canlı maçları çek
   */
  async fetchLiveMatches(): Promise<LiveMatch[]> {
    try {
      const response = await axios.get('https://v3.football.api-sports.io/fixtures', {
        params: {
          live: 'all'
        },
        headers: {
          'x-rapidapi-key': config.footballApiKey,
          'x-rapidapi-host': 'v3.football.api-sports.io'
        }
      });

      if (!response.data?.response) {
        return [];
      }

      const matches: LiveMatch[] = response.data.response.map((fixture: any) => ({
        id: fixture.fixture.id.toString(),
        homeTeam: fixture.teams.home.name,
        awayTeam: fixture.teams.away.name,
        league: fixture.league.name,
        country: fixture.league.country,
        minute: fixture.fixture.status.elapsed || 0,
        homeScore: fixture.goals.home || 0,
        awayScore: fixture.goals.away || 0
      }));

      return matches;
    } catch (error) {
      console.error('❌ API-Football hatası:', error);
      return [];
    }
  }

  /**
   * SLUG oluştur (Polymarket formatında)
   */
  generateSlug(homeTeam: string, awayTeam: string, date: Date): string {
    const country = 'international'; // TODO: Country detection
    const dateStr = date.toISOString().split('T')[0];
    
    const cleanTeam = (team: string) => 
      team.toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');

    return `${country}-${cleanTeam(homeTeam)}-${cleanTeam(awayTeam)}-${dateStr}`;
  }

  /**
   * Canlı maçı Polymarket ile eşleştir
   */
  matchWithPolymarket(liveMatch: LiveMatch): PolymarketMatch | undefined {
    // Takım isimlerini normalize et
    const normalize = (name: string) => 
      name.toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[^a-z0-9]/g, '');

    const liveHome = normalize(liveMatch.homeTeam);
    const liveAway = normalize(liveMatch.awayTeam);

    // Polymarket maçları içinde ara
    return this.polymarketMatches.find(pm => {
      const polyHome = normalize(pm.teams.home);
      const polyAway = normalize(pm.teams.away);

      // İsimler eşleşiyor mu?
      const homeMatch = liveHome.includes(polyHome) || polyHome.includes(liveHome);
      const awayMatch = liveAway.includes(polyAway) || polyAway.includes(liveAway);

      return homeMatch && awayMatch;
    });
  }

  /**
   * Keşif modu - Yeni maçları bul
   */
  async discoveryMode() {
    console.log('\n🔍 KEŞİF MODU - Yeni maçlar aranıyor...');
    
    try {
      // Polymarket maçlarını güncelle
      this.polymarketMatches = await this.fetchPolymarketMatches();
      
      if (this.polymarketMatches.length === 0) {
        console.log('⚠️  Polymarket\'te aktif maç yok');
        return;
      }

      // Canlı maçları getir
      const liveMatches = await this.fetchLiveMatches();
      console.log(`📊 ${liveMatches.length} canlı maç bulundu`);

      // Polymarket maçlarını canlı skorlarla eşleştir
      for (const liveMatch of liveMatches) {
        const polyMatch = this.matchWithPolymarket(liveMatch);
        
        if (polyMatch) {
          // Polymarket'te olan bir maç bulundu!
          console.log(`\n✅ POLYMARKET MAÇI BULUNDU!`);
          console.log(`   ${liveMatch.homeTeam} vs ${liveMatch.awayTeam}`);
          console.log(`   🏆 ${liveMatch.league}`);
          console.log(`   ⏱️  ${liveMatch.minute}' - ${liveMatch.homeScore}-${liveMatch.awayScore}`);
          console.log(`   🔗 Polymarket: ${polyMatch.slug}`);

          // Scheduler'a ekle
          const kickoffTime = new Date();
          kickoffTime.setMinutes(kickoffTime.getMinutes() - liveMatch.minute);

          const matchSchedule: MatchSchedule = {
            id: liveMatch.id,
            homeTeam: liveMatch.homeTeam,
            awayTeam: liveMatch.awayTeam,
            league: liveMatch.league,
            kickoffTime,
            isLive: true,
            polymarketSlug: polyMatch.slug,
            polymarketConditionId: polyMatch.conditionId
          };

          this.scheduler.scheduleMatch(matchSchedule);
          
          // Canlı takibe geç
          if (!this.liveMonitoringIntervals.has(liveMatch.id)) {
            this.startLiveMonitoring(liveMatch.id);
          }
        } else {
          // Polymarket'te yok, skip
          console.log(`⏭️  ${liveMatch.homeTeam} vs ${liveMatch.awayTeam} - Polymarket'te yok, atlanıyor`);
        }
      }

    } catch (error) {
      console.error('❌ Keşif hatası:', error);
    }
  }

  /**
   * Canlı takip - Belirli bir maçı agresif takip et
   */
  async startLiveMonitoring(matchId: string) {
    const match = this.scheduler.getLiveMatches().find(m => m.id === matchId);
    if (!match) return;

    console.log(`\n🔴 CANLI TAKİP BAŞLADI: ${match.homeTeam} vs ${match.awayTeam}`);

    const monitor = async () => {
      try {
        // Maç fazını al
        const phaseInfo = getMatchPhase(match);
        
        console.log(`\n⚽ ${match.homeTeam} vs ${match.awayTeam}`);
        console.log(`   📍 Faz: ${phaseInfo.phase}`);
        console.log(`   ⏱️  Interval: ${phaseInfo.interval} saniye`);
        console.log(`   💡 ${phaseInfo.reason}`);

        // Maç bittiyse takibi durdur
        if (phaseInfo.phase === 'finished') {
          console.log(`✅ Maç bitti, takip durduruluyor`);
          this.stopLiveMonitoring(matchId);
          return;
        }

        // Güncel skoru çek
        const liveMatches = await this.fetchLiveMatches();
        const currentMatch = liveMatches.find(m => m.id === matchId);

        if (currentMatch) {
          console.log(`   📊 Skor: ${currentMatch.homeScore}-${currentMatch.awayScore} (${currentMatch.minute}')`);
          
          // TODO: Gol kontrolü ve trade logic
          // if (skorDeğişti) {
          //   await this.executeTrade(match, currentMatch);
          // }
        }

        // Sonraki interval'i ayarla
        if (this.liveMonitoringIntervals.has(matchId)) {
          clearInterval(this.liveMonitoringIntervals.get(matchId)!);
        }

        const intervalId = setInterval(monitor, phaseInfo.interval * 1000);
        this.liveMonitoringIntervals.set(matchId, intervalId);

      } catch (error) {
        console.error(`❌ Canlı takip hatası (${matchId}):`, error);
      }
    };

    // İlk çalıştırma
    await monitor();
  }

  /**
   * Canlı takibi durdur
   */
  stopLiveMonitoring(matchId: string) {
    const intervalId = this.liveMonitoringIntervals.get(matchId);
    if (intervalId) {
      clearInterval(intervalId);
      this.liveMonitoringIntervals.delete(matchId);
    }
  }

  /**
   * Bot'u başlat
   */
  async start() {
    console.log('\n' + '='.repeat(80));
    console.log('   🚀 PRODUCTION SPORTS BOT BAŞLIYOR');
    console.log('='.repeat(80));
    console.log('\n📋 Sistem Özellikleri:');
    console.log('   ✅ Sadece Polymarket maçları');
    console.log('   ✅ 2 fazlı akıllı sistem');
    console.log('   ✅ Dinamik interval (1-2 saniye)');
    console.log('   ✅ API-Football Ultra (75,000 req/day)');
    console.log('   ✅ Agresif early game (2 saniye)');
    console.log('   ✅ Maksimum hız 70+ dakika (1 saniye)');

    this.isRunning = true;

    // Keşif modunu başlat (5 dakikada bir)
    console.log(`\n🔍 Keşif modu aktif: Her ${OPTIMAL_CONFIG.discovery.interval} saniyede tarama`);
    
    // İlk keşif
    await this.discoveryMode();
    
    // Periyodik keşif
    this.discoveryIntervalId = setInterval(
      () => this.discoveryMode(),
      OPTIMAL_CONFIG.discovery.interval * 1000
    );

    console.log('\n✅ Bot aktif! Polymarket maçları takip ediliyor...\n');
  }

  /**
   * Bot'u durdur
   */
  async stop() {
    console.log('\n🛑 Bot durduruluyor...');
    
    this.isRunning = false;

    // Keşif modunu durdur
    if (this.discoveryIntervalId) {
      clearInterval(this.discoveryIntervalId);
    }

    // Tüm canlı takipleri durdur
    for (const [matchId, intervalId] of this.liveMonitoringIntervals) {
      clearInterval(intervalId);
    }
    this.liveMonitoringIntervals.clear();

    console.log('✅ Bot durduruldu');
  }
}

// Direkt çalıştırma
if (require.main === module) {
  const bot = new ProductionSportsBot();
  
  bot.start().catch(error => {
    console.error('❌ Bot başlatılamadı:', error);
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    await bot.stop();
    process.exit(0);
  });
}
