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
  previousScore?: { home: number; away: number };
}

export class SimpleLiveBot {
  private scheduler: MatchScheduler;
  private isRunning = false;
  private discoveryIntervalId?: NodeJS.Timeout;
  private liveMonitoringIntervals = new Map<string, NodeJS.Timeout>();
  private matchScores = new Map<string, { home: number; away: number }>();

  constructor() {
    this.scheduler = new MatchScheduler();
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
   * Keşif modu - Yeni maçları bul
   */
  async discoveryMode() {
    const now = new Date();
    console.log(`\n[${ now.toLocaleTimeString('tr-TR')}] 🔍 KEŞİF MODU - Yeni maçlar aranıyor...`);
    
    try {
      // Canlı maçları getir
      const liveMatches = await this.fetchLiveMatches();
      
      if (liveMatches.length === 0) {
        console.log('   ℹ️  Şu an canlı maç yok');
        return;
      }

      console.log(`   ✅ ${liveMatches.length} canlı maç bulundu`);

      // Yeni maçları scheduler'a ekle
      for (const liveMatch of liveMatches) {
        const existing = this.scheduler.getLiveMatches().find(m => m.id === liveMatch.id);
        
        if (!existing) {
          // Yeni maç bulundu!
          console.log(`\n   🆕 YENİ MAÇ BULUNDU!`);
          console.log(`      ${liveMatch.homeTeam} vs ${liveMatch.awayTeam}`);
          console.log(`      🏆 ${liveMatch.league} (${liveMatch.country})`);
          console.log(`      ⏱️  ${liveMatch.minute}' - ${liveMatch.homeScore}-${liveMatch.awayScore}`);

          // Kickoff time'ı hesapla
          const kickoffTime = new Date();
          kickoffTime.setMinutes(kickoffTime.getMinutes() - liveMatch.minute);

          const matchSchedule: MatchSchedule = {
            id: liveMatch.id,
            homeTeam: liveMatch.homeTeam,
            awayTeam: liveMatch.awayTeam,
            league: liveMatch.league,
            kickoffTime,
            isLive: true
          };

          this.scheduler.scheduleMatch(matchSchedule);
          this.matchScores.set(liveMatch.id, {
            home: liveMatch.homeScore,
            away: liveMatch.awayScore
          });
          
          // Canlı takibe geç
          if (!this.liveMonitoringIntervals.has(liveMatch.id)) {
            this.startLiveMonitoring(liveMatch.id);
          }
        }
      }

      // Biten maçları temizle
      const currentIds = new Set(liveMatches.map(m => m.id));
      for (const match of this.scheduler.getLiveMatches()) {
        if (!currentIds.has(match.id)) {
          console.log(`\n   ✅ Maç bitti: ${match.homeTeam} vs ${match.awayTeam}`);
          this.stopLiveMonitoring(match.id);
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

    console.log(`\n   🔴 CANLI TAKİP BAŞLADI: ${match.homeTeam} vs ${match.awayTeam}`);

    const monitor = async () => {
      try {
        // Maç fazını al
        const phaseInfo = getMatchPhase(match);
        
        const now = new Date();
        const timeStr = now.toLocaleTimeString('tr-TR');
        
        // Maç bittiyse takibi durdur
        if (phaseInfo.phase === 'finished') {
          console.log(`\n[${timeStr}] ✅ Maç bitti: ${match.homeTeam} vs ${match.awayTeam}`);
          this.stopLiveMonitoring(matchId);
          return;
        }

        // Güncel skoru çek
        const liveMatches = await this.fetchLiveMatches();
        const currentMatch = liveMatches.find(m => m.id === matchId);

        if (currentMatch) {
          const previousScore = this.matchScores.get(matchId);
          const currentScore = {
            home: currentMatch.homeScore,
            away: currentMatch.awayScore
          };

          // Skor değişti mi?
          if (previousScore && 
              (previousScore.home !== currentScore.home || previousScore.away !== currentScore.away)) {
            console.log(`\n[${timeStr}] ⚽ GOL! ${match.homeTeam} vs ${match.awayTeam}`);
            console.log(`   📊 ${previousScore.home}-${previousScore.away} → ${currentScore.home}-${currentScore.away}`);
            console.log(`   ⏱️  ${currentMatch.minute}. dakika`);
            console.log(`   💰 TRADE OPPORTUNITY!`);
            
            // TODO: Trade logic buraya gelecek
            // await this.executeTrade(match, currentMatch, previousScore, currentScore);
          } else {
            // Skor değişmedi, sessiz takip
            console.log(`[${timeStr}] 👁️  ${match.homeTeam} vs ${match.awayTeam} - ${currentScore.home}-${currentScore.away} (${currentMatch.minute}') - ${phaseInfo.reason}`);
          }

          // Skoru güncelle
          this.matchScores.set(matchId, currentScore);
        }

        // Sonraki interval'i ayarla
        setTimeout(monitor, phaseInfo.interval * 1000);

      } catch (error) {
        console.error(`❌ Canlı takip hatası (${matchId}):`, error);
        // Hata olursa 5 saniye sonra tekrar dene
        setTimeout(monitor, 5000);
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
    this.matchScores.delete(matchId);
  }

  /**
   * Bot'u başlat
   */
  async start() {
    console.log('\n' + '='.repeat(80));
    console.log('   ⚡ SIMPLE LIVE BOT BAŞLIYOR');
    console.log('='.repeat(80));
    console.log('\n📋 Sistem Özellikleri:');
    console.log('   ✅ Tüm canlı maçları takip et');
    console.log('   ✅ 2 fazlı akıllı sistem');
    console.log('   ✅ Dinamik interval (1-2 saniye)');
    console.log('   ✅ API-Football Ultra (75,000 req/day)');
    console.log('   ✅ Agresif early game (2 saniye)');
    console.log('   ✅ Maksimum hız 70+ dakika (1 saniye)');
    console.log('   ✅ Gerçek zamanlı gol tespiti');

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

    console.log('\n✅ Bot aktif! Canlı maçlar takip ediliyor...\n');
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
    for (const [matchId] of this.liveMonitoringIntervals) {
      this.stopLiveMonitoring(matchId);
    }

    console.log('✅ Bot durduruldu');
  }
}

// Direkt çalıştırma
if (require.main === module) {
  const bot = new SimpleLiveBot();
  
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
