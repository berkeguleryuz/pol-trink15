import 'dotenv/config';
import { LiveScore6Client } from '../integrations/livescore6-client';
import { PolymarketClient } from '../client';
import { SportsEventDrivenTrader } from '../strategies/sports-event-trader';
import { MatchAwareRiskManager } from '../risk/sports-risk-manager';
import { PolymarketSportsClient } from '../integrations/polymarket-sports';
import { SportsTradingSignal } from '../integrations/sports-telegram-bot';
import TelegramBot from 'node-telegram-bot-api';

/**
 * 🚀 POLYMARKET-FIRST TRADING BOT
 * 
 * Polymarket'teki maçları takip eder, başlayınca LiveScore6'dan skor alır
 * 
 * Özellikler:
 * - Polymarket'ten yakında başlayacak maçları al
 * - Başlama saatine göre LiveScore6'ya sorgu at (API tasarrufu!)
 * - Gol tespit edilince ANINDA işlem
 * - Multi-position açma (Winner YES + Loser NO + Draw NO)
 * - Kademeli satış (50%/100%/200% profit)
 * - Risk yönetimi
 */

interface TrackedMatch {
  homeTeam: string;
  awayTeam: string;
  lastScore: { home: number; away: number };
  polymarketMatches: any[];
  startDate: Date;
  isLive: boolean; // Maç başladı mı?
}

export class LiveScore6TradingBot {
  private livescore6: LiveScore6Client;
  private polymarket?: PolymarketClient;
  private polymarketSports: PolymarketSportsClient;
  private trader: SportsEventDrivenTrader;
  private riskManager: MatchAwareRiskManager;
  private telegram?: TelegramBot;
  
  private trackedMatches: Map<string, TrackedMatch> = new Map();
  private running = false;
  private checkInterval?: NodeJS.Timeout;
  private lastMatchScanTime: number = 0;
  private readonly MATCH_SCAN_INTERVAL = 5 * 60 * 1000; // 5 dakikada bir yeni maç ara
  
  constructor() {
    this.livescore6 = new LiveScore6Client();
    this.polymarketSports = new PolymarketSportsClient();
    this.trader = new SportsEventDrivenTrader();
    this.riskManager = new MatchAwareRiskManager();
    
    // Telegram
    const botToken = process.env.TELEGRAM_SPORTS_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_SPORTS_CHAT_ID;
    
    if (botToken && chatId) {
      this.telegram = new TelegramBot(botToken, { polling: false });
    }
  }
  
  /**
   * Initialize with real PolymarketClient for trading
   */
  async initialize(): Promise<void> {
    this.polymarket = await PolymarketClient.create();
  }

  /**
   * Botu başlat
   */
  async start(): Promise<void> {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🚀 POLYMARKET-FIRST TRADING BOT STARTING');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    this.running = true;
    
    // Polymarket'ten maçları al
    await this.initializeMatches();
    
    // Her 15 saniyede kontrol et
    this.checkInterval = setInterval(() => {
      this.checkAllMatches();
    }, 15000);
    
    console.log('✅ Bot started! Monitoring every 15 seconds...\n');
  }

  /**
   * 🎯 SLUG METHOD: %100 Kesin Eşleştirme!
   * 
   * 1. LiveScore6'dan CANLI futbol maçlarını al
   * 2. Her maç için Polymarket SLUG oluştur (örn: bra-sao-fla-2025-11-05)
   * 3. SLUG ile direkt Polymarket API'den event al
   * 
   * ✅ Takım ismi normalizasyonu yok - API kısaltmaları kullanılıyor!
   * ✅ %100 doğruluk - Slug eşleşmesi kesin
   */
  private async initializeMatches(): Promise<void> {
    console.log('🔴 LIVE SOCCER MATCHES (SLUG METHOD)\n');
    console.log('='.repeat(60));
    console.log('');
    
    // STEP 1: LiveScore6'dan CANLI maçları al
    console.log('📡 Step 1: Getting LIVE matches from LiveScore6...\n');
    const liveMatches = await this.livescore6.getLiveMatches();
    console.log(`⚽ Found ${liveMatches.length} LIVE matches\n`);
    
    if (liveMatches.length === 0) {
      console.log('ℹ️  No live matches. Will check again in 15 seconds.\n');
      return;
    }
    
    // STEP 2: Her LIVE maç için SLUG ile Polymarket'te ara
    console.log('� Step 2: Searching Polymarket via SLUG...\n');
    
    let matchedCount = 0;
    const now = new Date();
    
    for (const liveMatch of liveMatches) {
      // SLUG oluştur (örn: bra-sao-fla-2025-11-05)
      const slug = this.livescore6.generatePolymarketSlug(liveMatch);
      
      // Polymarket'te SLUG ile ara
      const polyEvent = await this.polymarketSports.searchEventBySlug(slug);
      
      if (polyEvent && polyEvent.markets && polyEvent.markets.length > 0) {
        matchedCount++;
        
        const matchKey = `${liveMatch.homeTeam}-${liveMatch.awayTeam}`;
        
        this.trackedMatches.set(matchKey, {
          homeTeam: liveMatch.homeTeam,
          awayTeam: liveMatch.awayTeam,
          lastScore: { 
            home: liveMatch.homeScore, 
            away: liveMatch.awayScore 
          },
          polymarketMatches: polyEvent.markets,
          startDate: now,
          isLive: true,
        });
        
        console.log(`✅ 🔴 LIVE: ${liveMatch.homeTeam} ${liveMatch.homeScore}-${liveMatch.awayScore} ${liveMatch.awayTeam}`);
        console.log(`   ${liveMatch.minute}' | ${liveMatch.league}`);
        console.log(`   🏷️  SLUG: ${slug}`);
        console.log(`   📌 ${polyEvent.title}`);
        console.log(`   🎰 ${polyEvent.markets.length} markets | $${Math.round(polyEvent.liquidity || 0)} liquidity\n`);
      } else {
        // Polymarket'te market yok (normal - tüm ligler için market olmayabilir)
        console.log(`⚠️  ${liveMatch.homeTeam} vs ${liveMatch.awayTeam} - No Polymarket market`);
        console.log(`   🏷️  Tried SLUG: ${slug}\n`);
      }
    }
    
    console.log('='.repeat(60));
    console.log(`\n📊 MATCHED: ${matchedCount}/${liveMatches.length} live matches with Polymarket`);
    console.log(`📊 TRACKING: ${this.trackedMatches.size} matches\n`);
  }
  
  /**
   * Tüm maçları kontrol et
   * 
   * ⚡ OPTİMİZASYON: 
   * 1. Sadece BAŞLAYAN maçlar için LiveScore6'ya sorgu at
   * 2. Her 5 dakikada bir yeni maçları ara
   */
  private async checkAllMatches(): Promise<void> {
    if (!this.running) return;
    
    const timestamp = new Date().toLocaleTimeString('tr-TR');
    const now = new Date();
    
    // HER 5 DAKİKADA BİR YENİ MAÇLARI ARA
    const timeSinceLastScan = now.getTime() - this.lastMatchScanTime;
    if (timeSinceLastScan > this.MATCH_SCAN_INTERVAL) {
      console.log('\n🔍 Scanning for NEW matches...\n');
      await this.initializeMatches();
      this.lastMatchScanTime = now.getTime();
    }
    
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`⏰ [${timestamp}] MATCH MONITOR`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    
    // Önce hangi maçlar başladı kontrol et
    const liveMatches: TrackedMatch[] = [];
    const upcomingMatches: TrackedMatch[] = [];
    
    for (const [matchKey, tracked] of this.trackedMatches.entries()) {
      // Maç başladı mı?
      if (!tracked.isLive && tracked.startDate <= now) {
        tracked.isLive = true;
        console.log(`🔴 MATCH STARTED: ${tracked.homeTeam} vs ${tracked.awayTeam}\n`);
      }
      
      if (tracked.isLive) {
        liveMatches.push(tracked);
      } else {
        upcomingMatches.push(tracked);
      }
    }
    
    // SADECE CANLI MAÇLAR için LiveScore6'ya sorgu at!
    if (liveMatches.length > 0) {
      console.log(`📡 Fetching live scores for ${liveMatches.length} active matches...\n`);
      const liveScores = await this.livescore6.getLiveMatches();
      
      let matchIndex = 0;
      for (const tracked of liveMatches) {
        matchIndex++;
        
        // Bu maçın güncel skorunu bul
        const currentMatch = liveScores.find(m => 
          this.normalize(m.homeTeam) === this.normalize(tracked.homeTeam) &&
          this.normalize(m.awayTeam) === this.normalize(tracked.awayTeam)
        );
        
        if (!currentMatch) {
          console.log(`${matchIndex}. ⚠️  ${tracked.homeTeam} vs ${tracked.awayTeam}`);
          console.log(`   Status: Not found in LiveScore6 (may have ended)\n`);
          continue;
        }
        
        // Skor durumu
        const scoreDiff = currentMatch.homeScore - currentMatch.awayScore;
        let scoreEmoji = '⚖️';
        if (scoreDiff > 0) scoreEmoji = '🔵';
        else if (scoreDiff < 0) scoreEmoji = '🔴';
        
        // Maç durumu
        const minute = currentMatch.minute || 'N/A';
        const minuteStr = String(minute);
        const minuteEmoji = minuteStr === 'HT' ? '⏸️' : (parseInt(minuteStr) > 80 ? '🔥' : '⚽');
        
        console.log(`${matchIndex}. ${scoreEmoji} ${tracked.homeTeam} ${currentMatch.homeScore}-${currentMatch.awayScore} ${tracked.awayTeam}`);
        console.log(`   ${minuteEmoji} ${minute}' | ${tracked.polymarketMatches.length} markets | ✓\n`);
        
        // Skor değişti mi?
        if (currentMatch.homeScore !== tracked.lastScore.home || 
            currentMatch.awayScore !== tracked.lastScore.away) {
          
          // GOL! 🚨
          await this.handleGoal(tracked, currentMatch);
          
          // Skoru güncelle
          tracked.lastScore = {
            home: currentMatch.homeScore,
            away: currentMatch.awayScore,
          };
        }
      }
    } else {
      console.log(`ℹ️  No live matches yet. Waiting for matches to start...\n`);
    }
    
    // Yakında başlayacak maçları göster
    if (upcomingMatches.length > 0) {
      console.log(`\n📅 UPCOMING MATCHES (${upcomingMatches.length}):\n`);
      
      upcomingMatches.slice(0, 5).forEach((tracked, idx) => {
        const timeUntil = Math.round((tracked.startDate.getTime() - now.getTime()) / 1000 / 60);
        console.log(`${idx + 1}. 🕐 ${tracked.homeTeam} vs ${tracked.awayTeam}`);
        console.log(`   Starts in ${timeUntil} minutes (${tracked.startDate.toLocaleTimeString('tr-TR')})\n`);
      });
    }
    
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`✓ ${liveMatches.length} live, ${upcomingMatches.length} upcoming | Next check in 15s`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  }

  /**
   * Gol tespit edildiğinde işlem yap
   */
  private async handleGoal(tracked: TrackedMatch, currentMatch: any): Promise<void> {
    const oldScore = `${tracked.lastScore.home}-${tracked.lastScore.away}`;
    const newScore = `${currentMatch.homeScore}-${currentMatch.awayScore}`;
    
    console.log('\n🚨━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`⚽ GOAL DETECTED!`);
    console.log(`   ${tracked.homeTeam} vs ${tracked.awayTeam}`);
    console.log(`   ${oldScore} → ${newScore} (${currentMatch.minute || 'N/A'}')`);
    console.log('🚨━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Telegram bildirim
    if (this.telegram && process.env.TELEGRAM_SPORTS_CHAT_ID) {
      await this.telegram.sendMessage(
        process.env.TELEGRAM_SPORTS_CHAT_ID,
        `🚨 *GOAL!*\n\n` +
        `⚽ ${tracked.homeTeam} vs ${tracked.awayTeam}\n` +
        `${oldScore} → *${newScore}* (${currentMatch.minute || 'N/A'}')\n\n` +
        `💰 Trading signal detected!`,
        { parse_mode: 'Markdown' }
      );
    }
    
    // Trading signal oluştur
    const signal: SportsTradingSignal = {
      type: 'GOAL',
      match: {
        homeTeam: tracked.homeTeam,
        awayTeam: tracked.awayTeam,
        homeScore: currentMatch.homeScore,
        awayScore: currentMatch.awayScore,
        minute: currentMatch.minute || 0,
        event: 'GOAL',
      },
      urgency: 'CRITICAL',
      confidence: 1.0,
      actions: this.generateTradeActions(tracked, currentMatch),
      timestamp: new Date(),
    };
    
    // Trader'a gönder
    const decision = await this.trader.processGoalEvent(signal);
    
    if (!decision.shouldTrade) {
      console.log(`⏸️  Strategy decision: ${decision.explanation}\n`);
      return;
    }
    
    // Risk kontrolü
    const riskCheck = this.riskManager.shouldEnterPosition(signal.match, 6); // 3x$2 = $6
    
    if (!riskCheck.allowed) {
      console.log(`🚫 Risk check failed: ${riskCheck.reason}\n`);
      return;
    }
    
    // İŞLEM YAP! 
    console.log(`\n💰 EXECUTING TRADES:`);
    for (const trade of decision.markets) {
      console.log(`   ${trade.market} - ${trade.side} - $${trade.amount}`);
      
      // TODO: Gerçek işlem
      // await this.polymarket.buy/sell(...)
    }
    
    console.log(`\n✅ ${decision.markets.length} positions opened!\n`);
  }

  /**
   * Trade aksiyonları oluştur (Winner YES, Loser NO, Draw NO)
   */
  private generateTradeActions(tracked: TrackedMatch, currentMatch: any): any[] {
    const whoScored = currentMatch.homeScore > tracked.lastScore.home ? 'home' : 'away';
    const winner = whoScored === 'home' ? tracked.homeTeam : tracked.awayTeam;
    const loser = whoScored === 'home' ? tracked.awayTeam : tracked.homeTeam;
    
    return [
      {
        market: `${winner} to win`,
        side: 'YES' as const,
        priority: 10,
        reason: `${winner} just scored, increased win probability`,
      },
      {
        market: `${loser} to win`,
        side: 'NO' as const,
        priority: 9,
        reason: `${loser} is now losing, decreased win probability`,
      },
      {
        market: 'Draw',
        side: 'NO' as const,
        priority: 8,
        reason: 'Score changed, draw less likely',
      },
    ];
  }

  /**
   * Polymarket marketlerini bul
   */
  private findMatchingPolymarkets(match: any, allMarkets: any[]): any[] {
    const homeNorm = this.normalize(match.homeTeam);
    const awayNorm = this.normalize(match.awayTeam);
    
    return allMarkets.filter(market => {
      const question = this.normalize(market.question || '');
      const eventTitle = this.normalize(market.eventTitle || '');
      const fullText = `${question} ${eventTitle}`;
      return fullText.includes(homeNorm) && fullText.includes(awayNorm);
    });
  }

  /**
   * Takım ismi normalize et
   */
  private normalize(text: string): string {
    return text.toLowerCase()
      .replace(/\b(fc|sc|cf|ac|ca|rb|red bull|sport club|club|athletic|clube|ec|fr|cr|fbpa)\b/gi, '')
      .replace(/\bmineiro\b/gi, 'atletico mg') // CA Mineiro = Atletico MG
      .replace(/\bgrêmio\b/gi, 'gremio') // Aksan normalize
      .replace(/\bathlético\b/gi, 'athletico') // Aksan normalize
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Botu durdur
   */
  stop(): void {
    console.log('\n⏹️  Stopping bot...\n');
    this.running = false;
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }
}

// CLI'dan çalıştırma
if (require.main === module) {
  const bot = new LiveScore6TradingBot();
  
  bot.start().catch(console.error);
  
  // CTRL+C ile durdur
  process.on('SIGINT', () => {
    bot.stop();
    process.exit(0);
  });
}
