/**
 * PRODUCTION BOT - Ana koordinatör
 * 
 * Görevler:
 * 1. Tüm modülleri başlat ve koordine et
 * 2. Çoklu maç takibi (20-50 maç eş zamanlı)
 * 3. Otomatik güncelleme (1-2 saat)
 * 4. Gün dönümü yönetimi
 * 
 * İş Akışı:
 * - Her 1-2 saatte maç listesini güncelle
 * - UPCOMING maçlar için 5 dk'da kontrol
 * - SOON maçlar için 1 dk'da kontrol  
 * - LIVE maçlar için 1-2 saniye poll
 * - GOL → Trade (3 pozisyon)
 * - Maç bitince temizle (1 saat sonra)
 */

import { MatchManager } from '../core/match-manager';
import { MatchScheduler } from '../core/match-scheduler';
import { LiveScoreTracker } from '../monitoring/live-score-tracker';
import { FootballMatch, MatchStatus, GoalEvent } from '../core/types';
import { TradeExecutor } from '../trading/trade-executor';
import { PositionManager } from '../trading/position-manager';
import { MarketFetcher } from '../trading/market-fetcher';
import { PolymarketClientWrapper } from '../trading/polymarket-client';
import { TelegramNotifier } from '../notifications/telegram-notifier';
import { NotificationType } from '../notifications/types';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

export interface BotConfig {
  dryRun: boolean;
  updateInterval: number;       // Saat cinsinden (1-2 saat)
  maxConcurrentMatches: number; // Max 20-50
  cleanupInterval: number;      // Saat cinsinden (1 saat)
  enableTelegram: boolean;      // Telegram aktif mi?
}

export class ProductionBot {
  private matchManager: MatchManager;
  private scheduler: MatchScheduler;
  private scoreTracker: LiveScoreTracker;
  private tradeExecutor: TradeExecutor;
  private positionManager: PositionManager;
  private marketFetcher: MarketFetcher;
  private telegram?: TelegramNotifier;
  private config: BotConfig;
  
  private isRunning = false;
  private updateIntervalId?: NodeJS.Timeout;
  private cleanupIntervalId?: NodeJS.Timeout;
  private exitCheckIntervalId?: NodeJS.Timeout;
  private matchIntervals: Map<string, NodeJS.Timeout> = new Map();
  
  // Status tracking
  private matchStatuses: Map<string, MatchStatus> = new Map();
  private lastGoalTime: Map<string, number> = new Map(); // matchId → timestamp (2 dakika trade yasağı)
  private debugLogShown: boolean = false; // Debug log sadece 1 kez göster

  constructor(config?: Partial<BotConfig>) {
    this.config = {
      dryRun: true,
      updateInterval: 2,          // 2 saat
      maxConcurrentMatches: 50,
      cleanupInterval: 1,         // 1 saat
      enableTelegram: false,      // Default: Telegram kapalı
      ...config
    };

    this.matchManager = new MatchManager();
    this.scheduler = new MatchScheduler();
    this.scoreTracker = new LiveScoreTracker();
    this.marketFetcher = new MarketFetcher();
    
    // Trading modülleri start()'ta başlatılacak (ClobClient gerekir)
    this.tradeExecutor = null as any;
    this.positionManager = null as any;

    // Gol event listener
    this.scoreTracker.on('goal', (event: GoalEvent) => {
      this.handleGoalEvent(event);
    });

    // Maç bitişi listener
    this.scoreTracker.on('match-finished', (match: FootballMatch) => {
      this.handleMatchFinished(match);
    });
    
    // Score update listener (her poll'da match data güncellenir)
    this.scoreTracker.on('score-update', (match: FootballMatch) => {
      // Match manager'daki data'yı güncelle + JSON'a yaz
      this.matchManager.updateMatch(match.id, {
        homeScore: match.homeScore,
        awayScore: match.awayScore,
        currentMinute: match.currentMinute,
        matchStatus: match.matchStatus // ⚡ HT, FT status'ü
      });
    });
  }

  /**
   * Bot'u başlat
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️  Bot zaten çalışıyor!');
      return;
    }

    console.log('\n' + '='.repeat(80));
    console.log('🚀 POLYMARKET FOOTBALL TRADING BOT - BAŞLATILIYOR');
    console.log('='.repeat(80));
    console.log(`\n⚙️  Konfigürasyon:`);
    console.log(`   📊 Dry Run: ${this.config.dryRun ? 'EVET ✅' : 'HAYIR ⚠️'}`);
    console.log(`   🔄 Güncelleme: ${this.config.updateInterval} saat`);
    console.log(`   🗑️  Temizleme: ${this.config.cleanupInterval} saat`);
    console.log(`   🎯 Max maç: ${this.config.maxConcurrentMatches}`);
    console.log(`   📱 Telegram: ${this.config.enableTelegram ? 'AKTIF ✅' : 'KAPALI'}`);

    // Initialize Telegram if enabled
    if (this.config.enableTelegram) {
      const botToken = process.env.TELEGRAM_SPORTS_BOT_TOKEN;
      const chatId = process.env.TELEGRAM_SPORTS_CHAT_ID;

      if (botToken && chatId) {
        console.log('\n📱 Telegram başlatılıyor...');
        this.telegram = new TelegramNotifier(botToken, chatId);
        console.log('   ✅ Telegram aktif!');
      } else {
        console.warn('   ⚠️  Telegram credentials eksik (.env)');
      }
    }

    // Initialize trading modules
    if (!this.config.dryRun) {
      console.log('\n💰 LIVE MODE - ClobClient başlatılıyor...');
      const clientWrapper = await PolymarketClientWrapper.create();
      const client = clientWrapper.getClient();
      const positionSize = parseFloat(process.env.DEFAULT_BUY_AMOUNT || '3');
      
      this.tradeExecutor = new TradeExecutor(client, false, positionSize);
      this.positionManager = new PositionManager(this.tradeExecutor);
      
      // Connect tradeExecutor to positionManager (circular dependency workaround)
      this.tradeExecutor.setPositionManager(this.positionManager);
      
      console.log(`   ✅ Trade modülleri hazır (Position size: $${positionSize})`);

      // YENİDEN BAŞLATMA: Açık pozisyonları yükle
      console.log('\n🔄 Açık pozisyonlar kontrol ediliyor...');
      const { PositionRecovery } = await import('../trading/position-recovery');
      const recovery = new PositionRecovery(client);
      const existingPositions = await recovery.loadOpenPositions();
      
      if (existingPositions.length > 0) {
        console.log(`   📦 ${existingPositions.length} açık pozisyon bulundu!`);
        existingPositions.forEach(pos => {
          this.positionManager.addPosition(pos);
        });
        
        // İlk fiyat güncellemesi
        await this.positionManager.updateAllPositions();
        this.positionManager.printPositions();

        // ⚠️ BİTMİŞ MAÇLARIN POZİSYONLARINI KAPAT
        console.log('\n🔍 Bitmiş maçlar kontrol ediliyor...');
        await this.closeFinishedMatchPositions(existingPositions);
      } else {
        console.log(`   ✅ Yeni başlangıç - açık pozisyon yok`);
      }
    } else {
      console.log('\n🎭 DRY RUN MODE - Simülasyon');
      // Dummy client for dry run
      this.tradeExecutor = new TradeExecutor(null as any, true, 3);
      this.positionManager = new PositionManager(this.tradeExecutor);
      
      // Connect tradeExecutor to positionManager
      this.tradeExecutor.setPositionManager(this.positionManager);
    }

    this.isRunning = true;

    // ⚡ HIZLI BAŞLATMA: Mevcut JSON'u yükle
    console.log('\n⚡ HIZLI BAŞLATMA - Mevcut maçlar yükleniyor...');
    const loadedMatches = await this.matchManager.loadMatches();
    this.matchManager.updateAllStatuses();
    
    const liveMatches = this.matchManager.getLiveMatches();
    const soonMatches = this.matchManager.getSoonMatches();
    
    console.log(`✅ Maçlar yüklendi`);
    console.log(`   🔴 ${liveMatches.length} CANLI`);
    console.log(`   ⏰ ${soonMatches.length} YAKLAŞAN`);
    
    // 🔥 YENİ: Dosya yok veya boş → HEMEN güncelleme yap!
    if (!loadedMatches || loadedMatches.length === 0) {
      console.log('\n⚠️  Maç bulunamadı - ACIL güncelleme başlatılıyor...');
      await this.updateMatchesBackground();
      console.log('✅ İlk güncelleme tamamlandı\n');
    }
    
    // Hemen tracking başlat
    this.checkAndStartTracking();
    this.startMonitoringLoop();
    
    // 🔄 ARKA PLANDA GÜNCELLEME: 5 dakika sonra (veya zaten yapıldıysa skip)
    setTimeout(() => {
      this.updateMatchesBackground();
    }, 5 * 60 * 1000); // 5 dakika

    // Periyodik güncelleme (1-2 saat)
    this.updateIntervalId = setInterval(
      () => this.updateMatchesBackground(),
      this.config.updateInterval * 60 * 60 * 1000
    );

    // Periyodik temizleme (1 saat)
    this.cleanupIntervalId = setInterval(
      () => this.matchManager.cleanupFinished(),
      this.config.cleanupInterval * 60 * 60 * 1000
    );

    // Exit check loop (30 saniyede bir pozisyonları kontrol et)
    if (!this.config.dryRun) {
      this.exitCheckIntervalId = setInterval(
        async () => {
          try {
            const openPositions = this.positionManager.getOpenPositions();
            if (openPositions.length === 0) return; // Açık pozisyon yoksa atla

            console.log(`\n💹 Pozisyon fiyatları güncelleniyor... (${openPositions.length} açık)`);
            
            // Update all position prices
            await this.positionManager.updateAllPositions();
            
            // Check exit targets (graduated selling)
            await this.positionManager.checkExitTargets();
          } catch (error) {
            console.error('❌ Exit check hatası:', error);
          }
        },
        30000 // 30 saniye
      );
      console.log('   ✅ Exit check loop başlatıldı (30s)');
    }

    // Ana monitoring döngüsü
    this.startMonitoringLoop();

    console.log('\n✅ Bot aktif! Maçlar takip ediliyor...\n');

    // ⚡ İLK DURUM RAPORU (hemen göster)
    setTimeout(() => {
      this.printStatusReport();
    }, 2000); // 2 saniye sonra (cache hazır olduktan sonra)
  }

  /**
   * ARKA PLANDA GÜNCELLEME - Bot'u kesintiye uğratmadan
   */
  private async updateMatchesBackground(): Promise<void> {
    console.log('\n🔄 [ARKA PLAN] Maç listesi güncelleniyor...');
    
    try {
      // SMART UPDATE: Mevcut maçları koruyarak güncelle
      const { smartUpdateMatches } = await import('../scripts/update-matches-smart');
      const updateResult = await smartUpdateMatches(
        path.join(__dirname, '../../data/football-matches.json')
      );
      console.log(`\n📊 [ARKA PLAN] Güncelleme: +${updateResult.added} yeni, ~${updateResult.updated} güncellendi, -${updateResult.removed} silindi, 📦${updateResult.archived} arşivlendi\n`);
      
      // API-Football'dan LIVE + TODAY maçlarını eşleştir
      const { autoLinkMatches } = await import('../scripts/auto-link-matches');
      const linkedCount = await autoLinkMatches(
        path.join(__dirname, '../../data/football-matches.json')
      );
      if (linkedCount > 0) {
        console.log(`🔗 [ARKA PLAN] ${linkedCount} maç API-Football ile eşleştirildi\n`);
      }
      
      // Maçları yeniden yükle
      await this.matchManager.loadMatches();
      this.matchManager.updateAllStatuses();
      
      // Tracking'i güncelle
      this.checkAndStartTracking();
      
      console.log('✅ [ARKA PLAN] Güncelleme tamamlandı\n');
    } catch (error: any) {
      console.error('❌ [ARKA PLAN] Güncelleme hatası:', error.message);
    }
  }

  /**
   * Maçları yükle ve schedule et (ESKİ - sadece ilk yükleme için)
   * 
   * NOT: BÜTÜN futbol maçları yüklenir (600-700+ maç)
   * Ancak sadece LIVE ve SOON olanlar takip edilir (max 50)
   */
  private async loadAndScheduleMatches(): Promise<void> {
    console.log('\n🔄 Maç listesi güncelleniyor...');
    
    // SMART UPDATE: Mevcut maçları koruyarak güncelle
    // - Polyfund'dan yeni maçları çek (sayfalayarak)
    // - API-Football linklerini KORU (apiFootballId)
    // - Bitmiş maçları SİL
    const { smartUpdateMatches } = await import('../scripts/update-matches-smart');
    const updateResult = await smartUpdateMatches(
      path.join(__dirname, '../../data/football-matches.json')
    );
    console.log(`\n📊 Güncelleme: +${updateResult.added} yeni, ~${updateResult.updated} güncellendi, -${updateResult.removed} silindi, 📦${updateResult.archived} arşivlendi\n`);
    
    // API-Football'dan LIVE + TODAY maçlarını eşleştir (apiFootballId ekle)
    const { autoLinkMatches } = await import('../scripts/auto-link-matches');
    const linkedCount = await autoLinkMatches(
      path.join(__dirname, '../../data/football-matches.json')
    );
    if (linkedCount > 0) {
      console.log(`🔗 ${linkedCount} maç API-Football ile eşleştirildi\n`);
    }
    
    // BÜTÜN maçları yükle
    await this.matchManager.loadMatches();
    this.matchManager.updateAllStatuses();
    
    const state = this.matchManager.getSystemState();
    console.log('\n📊 TOPLAM MAÇ İSTATİSTİKLERİ:');
    console.log(`   📁 Sistemde: ${state.allMatches.length} futbol maçı`);
    console.log(`   📅 Bugün: ${state.todayMatches.length} maç`);
    console.log(`   🟢 Upcoming: ${state.upcomingMatches.length} maç`);
    console.log(`   🟡 Soon (30 dk): ${state.soonMatches.length} maç`);
    console.log(`   🔴 Live: ${state.liveMatches.length} maç`);
    console.log(`   ⚫ Finished: ${state.finishedMatches.length} maç`);
    
    const activeCount = state.soonMatches.length + state.liveMatches.length;
    console.log(`\n👁️  AKTİF TAKİP: ${activeCount}/${this.config.maxConcurrentMatches} (SOON + LIVE)`);

    // EN YAKIN MAÇ (ÖNEMLİ!)
    this.printNextMatch(state.todayMatches);

    // Yakında başlayacak maçları göster
    const soon = this.matchManager.getSoonMatches();
    if (soon.length > 0) {
      console.log(`\n🟡 YAKINDA BAŞLAYACAK MAÇLAR (30 dk içinde):`);
      soon.slice(0, 5).forEach(m => {
        console.log(`   ⚽ ${m.kickoffTime} - ${m.title || m.slug}`);
      });
      if (soon.length > 5) {
        console.log(`   ... ve ${soon.length - 5} maç daha`);
      }
    }

    // Canlı maçları göster
    const live = this.matchManager.getLiveMatches();
    if (live.length > 0) {
      console.log(`\n🔴 ŞU ANDA CANLI MAÇLAR:`);
      live.slice(0, 5).forEach(m => {
        console.log(`   ⚽ ${m.currentMinute}' - ${m.title || m.slug}`);
      });
      if (live.length > 5) {
        console.log(`   ... ve ${live.length - 5} maç daha`);
      }
    }

    if (activeCount > this.config.maxConcurrentMatches) {
      console.warn(`\n⚠️  UYARI: ${activeCount} maç aktif olacak ama limit ${this.config.maxConcurrentMatches}`);
      console.warn('   LIVE maçlar öncelikli olacak!');
    }
  }

  /**
   * En yakın maçı göster (countdown ile)
   */
  private printNextMatch(todayMatches: FootballMatch[]): void {
    if (todayMatches.length === 0) {
      console.log('\n⏰ EN YAKIN MAÇ: Bugün maç yok');
      return;
    }

    // En yakın upcoming maçı bul
    const upcomingToday = todayMatches
      .filter(m => m.status === MatchStatus.UPCOMING || m.status === MatchStatus.SOON)
      .sort((a, b) => (a.minutesUntilKickoff || 0) - (b.minutesUntilKickoff || 0));

    if (upcomingToday.length === 0) {
      const liveCount = todayMatches.filter(m => m.status === MatchStatus.LIVE).length;
      console.log(`\n⏰ EN YAKIN MAÇ: Bugün tüm maçlar başladı (${liveCount} canlı)`);
      return;
    }

    const nextMatch = upcomingToday[0];
    const minutes = nextMatch.minutesUntilKickoff || 0;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;

    let countdown = '';
    if (hours > 0) {
      countdown = `${hours} saat ${mins} dakika`;
    } else {
      countdown = `${mins} dakika`;
    }

    console.log('\n⏰ EN YAKIN MAÇ:');
    console.log(`   ⚽ ${nextMatch.title || nextMatch.slug}`);
    console.log(`   🕐 ${nextMatch.kickoffTime} (${countdown} sonra)`);
    console.log(`   📍 ${nextMatch.homeTeam} vs ${nextMatch.awayTeam}`);
  }

  /**
   * API'den maçları güncelle (Polyfund + Filter)
   */
  /**
   * DEPRECATED - Artık smartUpdateMatches kullanılıyor
   * 
   * Bu fonksiyon her seferinde sıfırdan yüklüyordu ve apiFootballId'leri kaybediyordu.
   * Yeni sistem: update-matches-smart.ts
   */
  /*
  private async updateMatchesFromAPI(): Promise<void> {
    try {
      console.log('📡 Polyfund API\'den yeni maçlar çekiliyor...');
      
      // 1. Polyfund scraper çalıştır
      await execAsync('npx ts-node tests/scrape-polyfund-matches.ts');
      
      // 2. Futbol filtresi çalıştır
      await execAsync('npx ts-node tests/filter-football-matches.ts');
      
      console.log('✅ Maç listesi API\'den güncellendi');
    } catch (error: any) {
      console.error('❌ API güncelleme hatası:', error.message);
      console.error('   Mevcut cache kullanılacak...');
    }
  }
  */

  /**
   * Ana monitoring döngüsü
   */
  private startMonitoringLoop(): void {
    // Her 5 saniyede statüleri güncelle ve maçları kontrol et
    setInterval(() => {
      this.matchManager.updateAllStatuses();
      this.checkAndStartTracking();
    }, 5000);

    // ⚡ HER 30 SANİYEDE DURUM RAPORU
    setInterval(() => {
      this.printStatusReport();
    }, 30000); // 30 saniye
  }

  /**
   * Durum raporu göster (her 30 saniyede)
   */
  private printStatusReport(): void {
    // ⚡ -more-markets duplicate'leri filtrele
    const liveMatches = this.matchManager.getLiveMatches()
      .filter(m => !m.slug.includes('-more-markets'));
    const soonMatches = this.matchManager.getSoonMatches()
      .filter(m => !m.slug.includes('-more-markets'));
    const todayMatches = this.matchManager.getTodayMatches()
      .filter(m => m.status === MatchStatus.UPCOMING && !m.slug.includes('-more-markets'))
      .sort((a, b) => (a.minutesUntilKickoff || 0) - (b.minutesUntilKickoff || 0));

    console.log('\n' + '━'.repeat(60));
    console.log('📊 DURUM RAPORU');
    console.log('━'.repeat(60));
    
    // Canlı maçlar
    if (liveMatches.length > 0) {
      console.log(`\n🔴 CANLI MAÇLAR (${liveMatches.length}):`);
      liveMatches.forEach(match => {
        const score = `${match.homeScore || 0}-${match.awayScore || 0}`;
        
        // ⚡ API-Football status kullan (HT, FT, 1H, 2H)
        let minute = '';
        if (match.currentMinute !== undefined && match.currentMinute !== null) {
          minute = `${match.currentMinute}'`;
          
          // API'den gelen matchStatus varsa göster
          if (match.matchStatus) {
            const statusMap: { [key: string]: string } = {
              'HT': '(Devre Arası)',
              'FT': '(Maç Bitti)',
              'AET': '(Uzatma Bitti)',
              'PEN': '(Penaltılar)',
              '1H': '',  // İlk yarı - dakika yeterli
              '2H': ''   // İkinci yarı - dakika yeterli
            };
            const statusText = statusMap[match.matchStatus] || '';
            if (statusText) {
              minute += ` ${statusText}`;
            }
          }
        } else {
          minute = '0\'';
        }
        
        console.log(`   ⚽ ${match.homeTeam} vs ${match.awayTeam}`);
        console.log(`      📊 Skor: ${score} ${minute}`);
      });
    }

    // Yaklaşan maçlar (30 dk içinde)
    if (soonMatches.length > 0) {
      console.log(`\n⏰ YAKIN MAÇLAR (${soonMatches.length}):`);
      soonMatches.forEach(match => {
        const mins = match.minutesUntilKickoff || 0;
        console.log(`   🕐 ${mins} dk sonra: ${match.homeTeam} vs ${match.awayTeam}`);
      });
    }

    // Bugün başlayacak maçlar
    if (todayMatches.length > 0 && soonMatches.length === 0 && liveMatches.length === 0) {
      const nextMatch = todayMatches[0];
      const minutes = nextMatch.minutesUntilKickoff || 0;
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;

      let countdown = '';
      if (hours > 0) {
        countdown = `${hours}h ${mins}m`;
      } else {
        countdown = `${mins}m`;
      }

      console.log(`\n🗓️  SONRAKI MAÇ:`);
      console.log(`   ⚽ ${nextMatch.homeTeam} vs ${nextMatch.awayTeam}`);
      console.log(`   ⏱️  ${countdown} sonra başlayacak`);
    }

    // Pozisyon özeti
    if (this.positionManager) {
      const positions = this.positionManager.getOpenPositions();
      if (positions.length > 0) {
        console.log(`\n💰 AÇIK POZİSYONLAR: ${positions.length}`);
        const totalPnL = positions.reduce((sum, p) => sum + (p.unrealizedPnL || 0), 0);
        const totalPnLPct = positions.reduce((sum, p) => sum + (p.unrealizedPnLPercent || 0), 0) / positions.length;
        console.log(`   📈 Toplam PnL: ${totalPnL >= 0 ? '+' : ''}$${totalPnL.toFixed(2)} (${totalPnLPct >= 0 ? '+' : ''}${totalPnLPct.toFixed(1)}%)`);
      }
    }

    console.log('━'.repeat(60));
  }

  /**
   * Maçları kontrol et ve takip başlat
   * 
   * NOT: Sistemde BÜTÜN futbol maçları yüklenir (data'da 100-200+ maç olabilir)
   * Ama aynı anda MAKSIMUM 50 maç aktif olarak takip edilir (LIVE + SOON)
   * Bu limit API rate limit ve performans için konulmuştur
   */
  private checkAndStartTracking(): void {
    const now = new Date();

    // Aktif takip sayısını kontrol et
    const currentTracked = this.matchIntervals.size;

    // SOON maçlar (30 dk içinde) - Pre-match analiz
    const soonMatches = this.matchManager.getSoonMatches();
    soonMatches.forEach(match => {
      // Durum değişikliği kontrolü
      const oldStatus = this.matchStatuses.get(match.id);
      if (oldStatus !== MatchStatus.SOON) {
        console.log(`\n🟡 DURUM DEĞİŞTİ: ${match.slug}`);
        console.log(`   📊 ${oldStatus || 'UPCOMING'} → SOON (${match.minutesUntilKickoff} dk kaldı)`);
        console.log(`   🕐 Kickoff: ${match.kickoffUTC || match.endDate}`);
        this.matchStatuses.set(match.id, MatchStatus.SOON);
        // TODO: Telegram bildirimi gönder
      }

      // Limit kontrolü - aynı anda max 50 maç
      if (currentTracked >= this.config.maxConcurrentMatches) {
        return; // Limit doldu, yeni maç ekleme
      }

      if (!this.matchIntervals.has(match.id)) {
        console.log(`\n🎯 TAKİBE ALINDI: ${match.slug}`);
        console.log(`   ⏰ ${match.minutesUntilKickoff} dakika sonra başlayacak`);
        this.matchIntervals.set(match.id, {} as NodeJS.Timeout); // Marker
        // TODO: Pre-match analiz ve telegram onay
      }
    });

    // LIVE maçlar - Canlı takip (öncelikli)
    const liveMatches = this.matchManager.getLiveMatches();
    liveMatches.forEach(match => {
      // ⚡ SKIP: -more-markets duplicate'leri takip etme (sessizce)
      if (match.slug.includes('-more-markets')) {
        return; // Sessizce skip - log spam'i önle
      }

      // Durum değişikliği kontrolü (MAÇ BAŞLADI!)
      const oldStatus = this.matchStatuses.get(match.id);
      if (oldStatus !== MatchStatus.LIVE) {
        console.log(`\n🔴 MAÇ BAŞLADI! ${match.slug}`);
        console.log(`   📊 ${oldStatus || 'SOON'} → LIVE`);
        console.log(`   📍 ${match.homeTeam} vs ${match.awayTeam}`);
        console.log(`   🏆 İlk dakikalar - fırsatlar takip ediliyor...`);
        this.matchStatuses.set(match.id, MatchStatus.LIVE);
        
        // ⚡⚡⚡ CRITICAL: Market verilerini HEMEN cache'e al (gol geldiğinde 0ms bekleme!)
        if (this.tradeExecutor) {
          console.log(`   ⚡ Market cache'leniyor (gol gelince INSTANT trade!)...`);
          this.tradeExecutor.precacheMarketData(match.slug).then(cached => {
            if (cached) {
              console.log(`   ✅ CACHE HAZIR! Gol gelince ${match.slug} için 0ms bekleme.`);
            }
          }).catch(err => {
            console.error(`❌ Market cache hatası (${match.slug}):`, err.message);
          });
        }
        
        // TODO: Telegram bildirimi gönder
      }

      // Limit kontrolü - ama LIVE maçlar öncelikli
      if (currentTracked >= this.config.maxConcurrentMatches && !this.matchIntervals.has(match.id)) {
        console.warn(`⚠️  LIMIT: ${match.slug} takip edilemiyor (${currentTracked}/${this.config.maxConcurrentMatches})`);
        return;
      }

      const phase = this.scheduler.getMatchPhase(match);
      
      // Henüz takip edilmiyorsa başlat
      if (!this.matchIntervals.has(match.id)) {
        console.log(`\n🎯 SKOR TAKİBİ BAŞLATILDI: ${match.slug}`);
        console.log(`   📡 API polling: Her ${phase.interval} saniye (BATCH mode)`);
        console.log(`   🎮 Faz: ${phase.phase}`);
        
        // interval saniye cinsinden geliyor, millisaniye'ye çevir
        const intervalMs = phase.interval * 1000;
        this.scoreTracker.startTracking(match, intervalMs);
        this.matchIntervals.set(match.id, {} as NodeJS.Timeout); // Marker
      }
    });

    // Bitmiş maçları temizle (yer aç)
    this.matchIntervals.forEach((_, matchId) => {
      const match = this.matchManager.getMatch(matchId);
      if (!match || match.status === MatchStatus.FINISHED) {
        console.log(`\n✅ TAKİPTEN ÇIKARILDI: ${matchId}`);
        console.log(`   📊 Maç bitti, kaynak serbest bırakıldı`);
        this.scoreTracker.stopTracking(matchId);
        this.matchIntervals.delete(matchId);
        this.matchStatuses.delete(matchId);
      }
    });
  }

  /**
   * Gol olayını işle
   */
  private async handleGoalEvent(event: GoalEvent): Promise<void> {
    const match = this.matchManager.getMatch(event.matchId);
    if (!match) return;

    // ⚡ FIX: -more-markets slug'larını skip et (duplicate trade'leri önle)
    if (match.slug.includes('-more-markets')) {
      console.log(`   ⏩ Skipping duplicate slug: ${match.slug}`);
      return;
    }

    // ⚡ COOLDOWN KONTROLÜ: Son gol sonrası 5 saniye bekleme (API delay + fiyat stabilizasyonu)
    const now = Date.now();
    const lastGoal = this.lastGoalTime.get(event.matchId);
    const cooldownMs = 5000; // 5 saniye
    
    if (lastGoal && (now - lastGoal < cooldownMs)) {
      const remainingSec = Math.ceil((cooldownMs - (now - lastGoal)) / 1000);
      console.log(`\n⏸️  GOL COOLDOWN: ${match.slug} (${remainingSec}s kaldı)`);
      console.log(`   📊 Skor: ${event.newScore.home}-${event.newScore.away}`);
      console.log(`   � API/fiyat stabilizasyonu bekleniyor...`);
      return;
    }

    console.log('\n' + '='.repeat(80));
    console.log(`⚽⚽⚽ GOL OLDU! ${match.slug}`);
    console.log('='.repeat(80));
    console.log(`   📊 Skor: ${event.previousScore.home}-${event.previousScore.away} → ${event.newScore.home}-${event.newScore.away}`);
    console.log(`   👤 Golü atan: ${event.scorer}`);
    console.log(`   ⏱️  Dakika: ${event.minute}'`);
    console.log(`   🏆 Takım: ${event.team === 'home' ? match.homeTeam : match.awayTeam}`);
    
    // Market linki
    const marketLink = this.marketFetcher.getMarketLink(match.slug);
    console.log(`   🔗 Market: ${marketLink}`);
    console.log('='.repeat(80));

    // ⚡ GOL ZAMANI KAYDET (cooldown başlat - 5 saniye)
    this.lastGoalTime.set(event.matchId, now);

    // ⚡⚡⚡ TELEGRAM BİLDİRİMİ PARALEL GÖNDER (TRADE'İ ENGELLEME!)
    if (this.telegram) {
      this.telegram.sendNotification({
        type: NotificationType.GOAL_SCORED,
        timestamp: new Date(),
        data: {
          matchId: match.id,
          slug: match.slug,
          title: match.title || `${match.homeTeam} vs ${match.awayTeam}`,
          scorer: event.scorer,
          team: event.team,
          minute: event.minute,
          previousScore: event.previousScore,
          newScore: event.newScore,
          marketLink
        }
      }).catch(err => console.error('❌ Telegram hatası:', err.message));
      // ⚡ .catch() ile hata olsa bile trade devam eder!
    }

    if (this.config.dryRun) {
      console.log('\n🔸 DRY RUN MODE - Trade simüle ediliyor...');
      console.log('   1️⃣  Gol atan takım KAZANIR (YES) → ALIM');
      console.log('   2️⃣  Karşı takım KAZANIR (NO) → ALIM');
      console.log('   3️⃣  BERABERE BİTER (NO) → ALIM');
    } else {
      // ⚡⚡⚡ EXECUTE REAL TRADES - HEMEN!
      try {
        console.log('\n💰 POZİSYONLAR AÇILIYOR (PARALEL)...');
        const startTime = Date.now();
        
        const results = await this.tradeExecutor.openGoalPositions(match, event);
        
        const execTime = Date.now() - startTime;
        console.log(`   ⚡ Execution time: ${execTime}ms`);
        
        // Add positions to manager
        for (const result of results) {
          if (result.success && result.position) {
            this.positionManager.addPosition(result.position);
          }
        }

        const successCount = results.filter(r => r.success).length;
        console.log(`\n✅ ${successCount}/3 pozisyon açıldı`);

        // ⚡ TELEGRAM BİLDİRİMİ PARALEL GÖNDER (BOT'U ENGELLEME!)
        if (this.telegram && successCount > 0) {
          const positions = results
            .filter(r => r.success && r.position)
            .map(r => ({
              type: r.position!.type,
              amount: r.position!.amount,
              price: r.position!.avgEntryPrice
            }));

          this.telegram.sendNotification({
            type: NotificationType.TRADE_EXECUTED,
            timestamp: new Date(),
            data: {
              matchId: match.id,
              slug: match.slug,
              title: match.title || `${match.homeTeam} vs ${match.awayTeam}`,
              positions,
              totalInvestment: positions.reduce((sum, p) => sum + p.amount, 0),
              marketLink
            }
          }).catch(err => console.error('❌ Telegram hatası:', err.message));
          // ⚡ await yok - paralel çalışır!
        }
      } catch (error) {
        console.error(`\n❌ Trade hatası:`, error);
        
        // ⚡ TELEGRAM ERROR BİLDİRİMİ PARALEL
        if (this.telegram) {
          this.telegram.sendNotification({
            type: NotificationType.ERROR,
            timestamp: new Date(),
            data: {
              error: String(error),
              context: `Goal trade - ${match.slug}`
            }
          }).catch(err => console.error('❌ Telegram hatası:', err.message));
          // ⚡ await yok!
        }
      }
    }
  }

  /**
   * Maç bitişini işle
   */
  private async handleMatchFinished(match: FootballMatch): Promise<void> {
    console.log(`\n✅ MAÇ BİTTİ: ${match.slug}`);
    console.log(`   📊 Final Skor: ${match.homeScore}-${match.awayScore}`);
    
    // ⚡ ÖNEMLI: Status'u FINISHED yap + JSON'a yaz
    this.matchManager.updateMatch(match.id, {
      status: MatchStatus.FINISHED,
      currentMinute: match.currentMinute
    });
    
    // Takibi durdur
    this.scoreTracker.stopTracking(match.id);
    this.matchIntervals.delete(match.id);

    // Pozisyonları kapat
    if (this.config.dryRun) {
      console.log('   💰 DRY RUN - Pozisyonlar kapatılıyor (simülasyon)');
    } else {
      console.log('   💰 Pozisyonlar kapatılıyor...');
      await this.positionManager.closeMatchPositions(match.id);
    }
  }

  /**
   * Bot başlarken bitmiş maçların pozisyonlarını kapat
   */
  private async closeFinishedMatchPositions(positions: any[]): Promise<void> {
    // Her pozisyonun matchId'sine bak
    const uniqueMatchIds = new Set(positions.map(p => p.matchId));
    
    for (const matchId of uniqueMatchIds) {
      // Match bilgisini al
      const match = this.matchManager.getMatch(matchId);
      
      if (!match) {
        console.log(`   ⚠️  Match bulunamadı: ${matchId}`);
        continue;
      }

      // Maç bitti mi kontrol et
      const isFinished = match.status === MatchStatus.FINISHED || 
                        (match.currentMinute && match.currentMinute > 95);
      
      if (isFinished) {
        console.log(`\n🏁 BİTMİŞ MAÇ BULUNDU: ${match.slug}`);
        console.log(`   📊 Final Skor: ${match.homeScore}-${match.awayScore}`);
        console.log(`   💰 Pozisyonlar kapatılıyor...`);
        
        await this.positionManager.closeMatchPositions(matchId);
      }
    }
  }

  /**
   * Bot'u durdur
   */
  async stop(): Promise<void> {
    console.log('\n🛑 Bot durduruluyor...');
    
    this.isRunning = false;

    // Tüm interval'leri temizle
    if (this.updateIntervalId) clearInterval(this.updateIntervalId);
    if (this.cleanupIntervalId) clearInterval(this.cleanupIntervalId);
    if (this.exitCheckIntervalId) clearInterval(this.exitCheckIntervalId);

    // Tüm takipleri durdur
    this.scoreTracker.stopAllTracking();
    this.matchIntervals.clear();

    // Telegram'ı durdur
    if (this.telegram) {
      this.telegram.stop();
    }

    console.log('✅ Bot durduruldu');
  }

  /**
   * İstatistikler
   */
  printStats(): void {
    const state = this.matchManager.getSystemState();
    const trackerStats = this.scoreTracker.getStatistics();
    const trackedMatches = Array.from(this.matchIntervals.keys());
    const now = new Date();

    console.log('\n' + '='.repeat(80));
    console.log('📊 BOT İSTATİSTİKLERİ - ' + now.toLocaleTimeString('tr-TR'));
    console.log('='.repeat(80));
    console.log(`� Toplam maç: ${state.allMatches.length}`);
    console.log(`📅 Bugün: ${state.todayMatches.length} maç`);
    console.log(`🟢 Upcoming: ${state.upcomingMatches.length} maç`);
    console.log(`🟡 Soon (30dk): ${state.soonMatches.length} maç`);
    console.log(`🔴 Live: ${state.liveMatches.length} maç`);
    console.log(`👁️  Takip edilen: ${trackerStats.trackedMatches} maç`);
    console.log(`📡 API calls: ${trackerStats.totalRequests}`);
    
    // Position istatistikleri
    if (this.positionManager) {
      const posStats = this.positionManager.getStatistics();
      if (posStats.totalPositions > 0) {
        console.log(`\n💰 POZİSYON İSTATİSTİKLERİ:`);
        console.log(`   📊 Toplam: ${posStats.totalPositions}`);
        console.log(`   🟢 Açık: ${posStats.openPositions}`);
        console.log(`   🔴 Kapalı: ${posStats.closedPositions}`);
        console.log(`   💵 Günlük PnL: $${posStats.dailyPnL.toFixed(2)}`);
        console.log(`   💎 Toplam PnL: $${posStats.totalPnL.toFixed(2)}`);
      }
    }
    
    // Aktif takip edilen maçları göster
    if (trackedMatches.length > 0) {
      console.log(`\n🎯 AKTİF TAKİP EDİLEN MAÇLAR (${trackedMatches.length}):`);
      trackedMatches.slice(0, 5).forEach((matchId, index) => {
        const match = this.matchManager.getMatch(matchId);
        if (match) {
          const status = match.status === MatchStatus.LIVE ? '🔴 LIVE' : '🟡 SOON';
          const info = match.status === MatchStatus.LIVE 
            ? `${match.currentMinute || '?'}' - ${match.homeScore ?? 0}-${match.awayScore ?? 0}`
            : `${match.minutesUntilKickoff} dk kaldı`;
          console.log(`   ${index + 1}. ${status} ${match.title || match.slug}`);
          console.log(`      📍 ${match.homeTeam || '?'} vs ${match.awayTeam || '?'}`);
          console.log(`      ${info}`);
          
          // Show positions for this match
          if (this.positionManager) {
            const positions = this.positionManager.getMatchPositions(matchId);
            if (positions.length > 0) {
              const totalPnL = positions.reduce((s, p) => s + p.unrealizedPnL, 0);
              console.log(`      💼 ${positions.length} pozisyon (PnL: $${totalPnL.toFixed(2)})`);
            }
          }
        }
      });
      if (trackedMatches.length > 5) {
        console.log(`   ... ve ${trackedMatches.length - 5} maç daha`);
      }
    } else {
      console.log('\n💤 Şu anda takip edilen maç yok');
      
      // En yakın maçı göster
      const upcoming = state.todayMatches
        .filter(m => (m.status === MatchStatus.UPCOMING || m.status === MatchStatus.SOON) && m.minutesUntilKickoff && m.minutesUntilKickoff > 0)
        .sort((a, b) => (a.minutesUntilKickoff || 0) - (b.minutesUntilKickoff || 0));
      
      if (upcoming.length > 0) {
        const next = upcoming[0];
        const minutes = next.minutesUntilKickoff || 0;
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        
        let countdown = '';
        if (hours > 0) {
          countdown = `${hours}s ${mins}dk`;
        } else {
          countdown = `${mins} dakika`;
        }
        
        console.log(`\n⏰ EN YAKIN MAÇ:`);
        console.log(`   ⚽ ${next.title || next.slug}`);
        console.log(`   🕐 ${next.kickoffTime} (${countdown} sonra)`);
        console.log(`   📍 ${next.homeTeam} vs ${next.awayTeam}`);
      } else {
        console.log(`\n⏰ Bugün maç kalmadı veya hepsi başladı`);
      }
    }
    
    console.log('='.repeat(80) + '\n');
  }
}

// Direkt çalıştırma
if (require.main === module) {
  // Parse command line arguments
  const isLiveMode = process.argv.includes('--live');
  
  const bot = new ProductionBot({
    dryRun: !isLiveMode,  // --live flag varsa gerçek trade, yoksa DRY RUN
    updateInterval: 2,
    maxConcurrentMatches: 50
  });

  console.log('\n🤖 POLYSPORT PRODUCTION BOT');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📊 Mode: ${!isLiveMode ? '⚠️  DRY RUN (test modu)' : '🔴 LIVE TRADING'}`);
  console.log(`⏱️  Update: Her ${2} saatte bir`);
  console.log(`📈 Max Concurrent: ${50} maç`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  if (isLiveMode) {
    console.log('⚠️  UYARI: LIVE TRADING modu aktif!');
    console.log('   Gerçek işlemler yapılacak. Dikkatli olun!\n');
  }

  bot.start().catch(console.error);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    await bot.stop();
    process.exit(0);
  });

  // Her 30 saniyede istatistik
  setInterval(() => bot.printStats(), 30000);
}
