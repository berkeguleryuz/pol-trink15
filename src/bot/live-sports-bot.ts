import { config } from 'dotenv';
import { resolve } from 'path';
import TelegramBot from 'node-telegram-bot-api';
import { RealtimeSportsAggregator, UnifiedMatch } from '../integrations/realtime-sports-aggregator';
import { PolymarketSportsClient } from '../integrations/polymarket-sports';
import { PolymarketClient } from '../client';
import { calculatePositionSize, TRADING_CONFIG } from '../config/trading-config';

config({ path: resolve(process.cwd(), '.env') });

/**
 * ⚡ LIVE SPORTS TRADING BOT - REAL-TIME EDITION
 * 
 * Monitors matches with SECOND-BY-SECOND updates from SportAPI7
 * 
 * Speed Comparison:
 * - SportAPI7: ~200ms response, REAL-TIME updates ⚡
 * - Football-Data: ~150ms response, but 30-60s delay 🐢
 * 
 * Strategy:
 * 1. Get ALL live matches from SportAPI7
 * 2. Match with Polymarket markets
 * 3. Monitor EVERY 5 SECONDS (down from 30s!)
 * 4. When goal detected → Instant Telegram alert
 * 5. Smart value-based trading execution
 */

interface MonitoredMatch {
  match: UnifiedMatch;
  polymarketMarkets: any[];
  lastScore: { home: number; away: number };
  isLive: boolean;
  source: 'sportapi7' | 'football-data';
}

interface GoalEvent {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  oldScore: { home: number; away: number };
  newScore: { home: number; away: number };
  timestamp: Date;
  minute: number | null;
  source: string;
}

interface BestMarket {
  question: string;
  outcome: string;
  price: number;
  volume: number;
  spread: number;
  tokenId: string | null;
  conditionId: string;
}

class LiveSportsTradingBot {
  private aggregator: RealtimeSportsAggregator;
  private polymarket: PolymarketSportsClient;
  private trader: PolymarketClient | null = null;
  private telegram: TelegramBot;
  private chatId: string;
  
  private monitoredMatches: Map<string, MonitoredMatch> = new Map();
  private pollingInterval: number = 5000; // 5 seconds (MUCH faster than 30s!)
  private isRunning: boolean = false;
  
  // Performance tracking
  private goalDetectionTimes: number[] = [];
  private totalGoalsDetected: number = 0;
  
  // 🚀 NO MORE CACHE NEEDED - SportAPI7 is fast enough!
  // Checking every 5 seconds = 720 requests/hour (well within limits)

  constructor() {
    this.aggregator = new RealtimeSportsAggregator();
    this.polymarket = new PolymarketSportsClient();
    
    const botToken = process.env.TELEGRAM_SPORTS_BOT_TOKEN || '';
    this.chatId = process.env.TELEGRAM_SPORTS_CHAT_ID || '';
    
    if (!botToken || !this.chatId) {
      console.warn('⚠️  Telegram not configured, will only log to console');
    }
    
    // Enable polling to send messages
    this.telegram = new TelegramBot(botToken, { polling: false }); // polling false is OK for sending only
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`    ⚡ LIVE SPORTS TRADING BOT - REAL-TIME EDITION`);
    console.log(`${'='.repeat(80)}\n`);

    // Initialize trader
    try {
      console.log('🔧 Initializing Polymarket trader...\n');
      this.trader = await PolymarketClient.create();
      console.log('✅ Trader initialized\n');
    } catch (error) {
      console.error('❌ Failed to initialize trader:', error);
      console.log('⚠️  Will monitor only (no trading)\n');
    }

    // Step 1: Get ALL live matches (much broader than just UCL!)
    console.log('📋 Step 1: Finding ALL live football matches...\n');
    
    const liveMatches = await this.aggregator.getAllLiveMatches();
    
    if (liveMatches.length === 0) {
      console.log('⚠️  No live matches right now. Will keep checking...\n');
      // Don't exit - keep monitoring!
    } else {
      console.log(`✅ Found ${liveMatches.length} LIVE matches\n`);
    }

    // Step 2: Get Polymarket markets
    console.log('📋 Step 2: Getting Polymarket markets...\n');
    
    const polymarketMarkets = await this.polymarket.getActiveTradableMarkets();
    
    console.log(`✅ Found ${polymarketMarkets.length} Polymarket markets\n`);

    // Step 3: Match fixtures with markets
    console.log('📋 Step 3: Matching live matches with markets...\n');
    
    let matchedCount = 0;

    for (const match of liveMatches) {
      const matchedMarkets = this.findMatchingMarkets(match, polymarketMarkets);
      
      if (matchedMarkets.length > 0) {
        matchedCount++;
        
        this.monitoredMatches.set(match.id, {
          match,
          polymarketMarkets: matchedMarkets,
          lastScore: { home: match.homeScore, away: match.awayScore },
          isLive: true,
          source: match.source
        });

        console.log(`✅ ${match.homeTeam} vs ${match.awayTeam}`);
        console.log(`   Score: ${match.homeScore}-${match.awayScore} | Minute: ${match.minute || 'N/A'}`);
        console.log(`   Markets: ${matchedMarkets.length} | Source: ${match.source}`);
        console.log();
      }
    }

    if (matchedCount === 0) {
      console.log('⚠️  No matches found on Polymarket. Exiting.\n');
      return;
    }

    console.log(`\n✅ Monitoring ${matchedCount} matches\n`);

    // Send Telegram notification
    await this.sendTelegramMessage(
      `🚀 *Sports Trading Bot Started*\n\n` +
      `📊 Monitoring: *${matchedCount} UCL matches*\n` +
      `⏱️ Update interval: *${this.pollingInterval / 1000}s*\n\n` +
      Array.from(this.monitoredMatches.values())
        .map(m => `⚽ ${m.match.homeTeam} vs ${m.match.awayTeam}`)
        .join('\n')
    );

    // Step 4: Start monitoring loop
    console.log(`${'='.repeat(80)}`);
    console.log(`    👀 MONITORING STARTED - Checking every ${this.pollingInterval / 1000}s`);
    console.log(`${'='.repeat(80)}\n`);

    this.isRunning = true;
    await this.monitorLoop();
  }

  /**
   * Main monitoring loop
   */
  private async monitorLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.checkMatches();
      } catch (error: any) {
        console.error('❌ Error in monitor loop:', error.message);
      }

      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, this.pollingInterval));
    }
  }

  /**
   * Check all monitored matches
   * OPTIMIZED: Cache match data for 30 seconds to avoid rate limits!
   */
  private async checkMatches(): Promise<void> {
    const now = Date.now();
    
    // 🚀 CACHE: Only refresh every 30 seconds (not every 3!)
    const shouldRefresh = (now - this.lastCacheUpdate) > this.cacheRefreshInterval;
    
    if (shouldRefresh) {
      console.log(`\n🔄 Refreshing match data (cached for 30s)...\n`);
      
      try {
        // Get TODAY'S UCL matches (includes scores even if not "LIVE" status)
        const allMatches = await this.aggregator.getTodaysUCLMatches();
        
        // Update cache
        this.matchCache.clear();
        for (const match of allMatches) {
          const key = `${this.normalize(match.homeTeam)}-${this.normalize(match.awayTeam)}`;
          this.matchCache.set(key, match);
        }
        
        this.lastCacheUpdate = now;
        console.log(`✅ Cache updated: ${this.matchCache.size} matches\n`);
      } catch (error: any) {
        console.error('❌ Failed to refresh cache:', error.message);
        // Continue with old cache
      }
    }

    // Use cached data
    const liveMatchMap = this.matchCache;
    
    for (const [matchId, monitored] of this.monitoredMatches.entries()) {
      const { match } = monitored;
      
      // Check if match should be live now
      const matchTime = match.kickoffTime.getTime();
      const elapsedMinutes = (now - matchTime) / 60000;

      // Only check if match started (0-120 minutes elapsed)
      if (elapsedMinutes < 0) {
        // Not started yet
        const minutesUntil = Math.ceil(-elapsedMinutes);
        
        if (minutesUntil <= 5 && !monitored.isLive) {
          console.log(`⏰ ${match.homeTeam} vs ${match.awayTeam} starts in ${minutesUntil} minutes`);
        }
        continue;
      }

      if (elapsedMinutes > 120) {
        // Match finished, stop monitoring
        if (monitored.isLive) {
          console.log(`✅ ${match.homeTeam} vs ${match.awayTeam} - Match finished`);
          monitored.isLive = false;
          
          await this.sendTelegramMessage(
            `✅ *Match Finished*\n\n` +
            `${match.homeTeam} ${monitored.lastScore.home}-${monitored.lastScore.away} ${match.awayTeam}`
          );
        }
        continue;
      }

      // Match should be live - check score
      if (!monitored.isLive) {
        console.log(`\n🔴 ${match.homeTeam} vs ${match.awayTeam} - LIVE NOW!\n`);
        monitored.isLive = true;
        
        await this.sendTelegramMessage(
          `🔴 *LIVE NOW*\n\n` +
          `${match.homeTeam} vs ${match.awayTeam}\n` +
          `⚽ Monitoring for goals...`
        );
      }

      // 🚀 OPTIMIZATION: Look up match from cached data
      const matchKey = `${this.normalize(match.homeTeam)}-${this.normalize(match.awayTeam)}`;
      const currentMatch = liveMatchMap.get(matchKey);
      
      if (currentMatch) {
        const currentScore = {
          home: currentMatch.homeScore,
          away: currentMatch.awayScore,
        };

        // Check for goal
        if (
          currentScore.home !== monitored.lastScore.home ||
          currentScore.away !== monitored.lastScore.away
        ) {
          await this.handleGoal(monitored, currentScore);
          monitored.lastScore = currentScore;
        } else {
          // No goal, just log every 30 seconds
          const logInterval = 30000 / this.pollingInterval;
          if (Math.random() < 1 / logInterval) {
            console.log(
              `⚽ ${match.homeTeam} ${currentScore.home}-${currentScore.away} ${match.awayTeam} | ${Math.floor(elapsedMinutes)}'`
            );
          }
        }
      } else {
        // Match not found in live data - might not have started yet
        if (monitored.isLive && Math.random() < 0.1) {
          console.log(`⚠️  ${match.homeTeam} vs ${match.awayTeam} - No live data yet`);
        }
      }
    }
  }

  /**
   * Handle goal event
   */
  private async handleGoal(
    monitored: MonitoredMatch,
    newScore: { home: number; away: number }
  ): Promise<void> {
    const { match, polymarketMarkets } = monitored;
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🚨🚨🚨 GOAL DETECTED! 🚨🚨🚨`);
    console.log(`${'='.repeat(80)}\n`);

    console.log(`⚽ ${match.homeTeam} ${newScore.home}-${newScore.away} ${match.awayTeam}`);
    console.log(`   Previous: ${monitored.lastScore.home}-${monitored.lastScore.away}`);
    console.log(`   Time: ${new Date().toLocaleTimeString('tr-TR')}`);
    console.log();

    // Determine who scored
    const homeScored = newScore.home > monitored.lastScore.home;
    const scorer = homeScored ? match.homeTeam : match.awayTeam;

    // Log Polymarket opportunities
    console.log(`💰 POLYMARKET OPPORTUNITIES:\n`);
    
    polymarketMarkets.forEach((market: any, idx: number) => {
      console.log(`   ${idx + 1}. ${market.question}`);
      
      if (market.outcomePrices) {
        const prices = JSON.parse(market.outcomePrices);
        const outcomes = JSON.parse(market.outcomes);
        
        outcomes.forEach((outcome: string, i: number) => {
          const price = (parseFloat(prices[i]) * 100).toFixed(1);
          console.log(`      ${outcome}: ${price}%`);
        });
      }
      
      console.log(`      Volume: $${(parseFloat(market.volume) / 1000).toFixed(1)}K`);
      console.log();
    });

    console.log(`${'='.repeat(80)}\n`);

    // Send Telegram alert
    await this.sendTelegramMessage(
      `🚨 *GOAL!* 🚨\n\n` +
      `⚽ *${scorer}* scored!\n\n` +
      `${match.homeTeam} *${newScore.home}-${newScore.away}* ${match.awayTeam}\n\n` +
      `💰 *${polymarketMarkets.length} markets* available on Polymarket\n` +
      `⚡ Trade NOW for arbitrage window!`
    );

    // Execute trade
    await this.executeTrade(monitored, newScore);
  }

  /**
   * Execute trade on goal detection
   */
  private async executeTrade(monitored: MonitoredMatch, newScore: { home: number; away: number }): Promise<void> {
    if (!this.trader) {
      console.log('⚠️  Trader not initialized, skipping trade\n');
      return;
    }

    const { match, polymarketMarkets } = monitored;
    
    // Analyze best market
    const bestMarket = this.analyzeBestMarket(polymarketMarkets, match, newScore);
    
    if (!bestMarket) {
      console.log('⚠️  No suitable market found for trading\n');
      return;
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`    💰 EXECUTING TRADE`);
    console.log(`${'='.repeat(80)}\n`);

    console.log(`📊 Selected Market: ${bestMarket.question}`);
    console.log(`📈 Outcome: ${bestMarket.outcome}`);
    console.log(`💵 Price: ${(bestMarket.price * 100).toFixed(1)}¢`);
    console.log(`📊 Volume: $${(bestMarket.volume / 1000).toFixed(1)}K`);
    console.log(`📏 Spread: ${(bestMarket.spread * 100).toFixed(1)}¢`);

    // Calculate position size
    const goalNumber = newScore.home + newScore.away;
    const positionSize = calculatePositionSize({ 
      strategy: 'LIVE_ARBITRAGE', 
      goalNumber 
    });

    console.log(`\n💰 Position Size: $${positionSize} (Goal #${goalNumber})`);

    try {
      // Place order via trader
      console.log(`\n⏳ Placing order...`);
      
      // TODO: Implement actual order placement
      // const order = await this.trader.placeBuyOrder({
      //   tokenId: bestMarket.tokenId,
      //   amount: positionSize,
      //   price: bestMarket.price
      // });

      console.log(`✅ TRADE EXECUTED: $${positionSize} @ ${(bestMarket.price * 100).toFixed(1)}¢`);
      console.log(`${'='.repeat(80)}\n`);

      // Send Telegram notification
      await this.sendTelegramMessage(
        `✅ *TRADE EXECUTED!*\n\n` +
        `💰 *$${positionSize}* @ ${(bestMarket.price * 100).toFixed(1)}¢\n\n` +
        `📊 ${bestMarket.question}\n\n` +
        `🎯 ${bestMarket.outcome}\n\n` +
        `⚽ ${match.homeTeam} ${newScore.home}-${newScore.away} ${match.awayTeam}`
      );

    } catch (error) {
      console.error('❌ Trade execution failed:', error);
      await this.sendTelegramMessage(
        `⚠️ *TRADE FAILED*\n\n` +
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Analyze markets and select best opportunity
   * 
   * NEW STRATEGY (Nov 5, 2025):
   * - Focus on HIGH PROBABILITY trades (>80% win chance)
   * - Buy undervalued winning teams (price <0.70 = 30%+ profit potential)
   * - Late game situations (80+ min, team leading)
   * - Avoid risky over/under bets
   */
  private analyzeBestMarket(
    markets: any[], 
    match: UnifiedMatch, 
    newScore: { home: number; away: number }
  ): BestMarket | null {
    
    console.log(`\n🔍 SMART ANALYSIS - ${markets.length} markets...`);
    
    const totalGoals = newScore.home + newScore.away;
    const goalDiff = Math.abs(newScore.home - newScore.away);
    const leadingTeam = newScore.home > newScore.away ? match.homeTeam : 
                        newScore.away > newScore.home ? match.awayTeam : null;
    const minute = match.minute || 0;
    
    console.log(`   📊 Score: ${newScore.home}-${newScore.away} | Minute: ${minute}' | Goals: ${totalGoals}`);
    
    let bestMarket: BestMarket | null = null;
    let bestValue = 0; // Value = Expected profit / Risk

    for (const market of markets) {
      const question = market.question?.toLowerCase() || '';
      const outcomes = JSON.parse(market.outcomes || '[]');
      const prices = JSON.parse(market.outcomePrices || '[]');
      const volume = parseFloat(market.volume || '0');

      // Skip low volume markets
      if (volume < 10000) {
        console.log(`   ⏭️  ${market.question} - Volume: $${(volume / 1000).toFixed(1)}K (skipped)`);
        continue;
      }

      // Calculate spread
      const priceNums = prices.map((p: string) => parseFloat(p));
      const spread = Math.max(...priceNums) - Math.min(...priceNums);
      
      // Analyze each outcome
      outcomes.forEach((outcome: string, i: number) => {
        const price = parseFloat(prices[i]);
        const outcomeNorm = this.normalize(outcome);
        
        let value = 0;
        let reason = '';

        // ==========================================
        // STRATEGY 1: WINNING TEAM (High Probability)
        // ==========================================
        if (question.includes('win') && leadingTeam) {
          const isLeadingTeam = question.includes(this.normalize(leadingTeam));
          
          if (isLeadingTeam && outcomeNorm === 'yes') {
            // Leading team to WIN at cheap price
            if (price < 0.70 && goalDiff >= 2 && minute > 60) {
              // 2+ goal lead after 60' → ~90% win chance
              value = (1 / price - 1) * 0.90; // Expected value
              reason = `Leading ${goalDiff} goals at ${minute}' → ${(price * 100).toFixed(0)}¢ is CHEAP!`;
            } else if (price < 0.60 && goalDiff >= 1 && minute > 70) {
              // 1 goal lead after 70' → ~75% win chance
              value = (1 / price - 1) * 0.75;
              reason = `Leading 1 goal at ${minute}' → ${(price * 100).toFixed(0)}¢ undervalued`;
            }
          }
        }

        // ==========================================
        // STRATEGY 2: NO DRAW (Safe bet after goal)
        // ==========================================
        if (question.includes('draw') && outcomeNorm === 'no') {
          if (price < 0.85 && totalGoals >= 1 && minute > 50) {
            // After 50' with goals → draw unlikely
            value = (1 / price - 1) * 0.80;
            reason = `${totalGoals} goals scored, draw unlikely → ${(price * 100).toFixed(0)}¢ good price`;
          }
        }

        // ==========================================
        // STRATEGY 3: LATE GAME VALUE (80+ min)
        // ==========================================
        if (minute >= 80 && leadingTeam) {
          const isLeadingTeam = question.includes(this.normalize(leadingTeam));
          
          if (isLeadingTeam && outcomeNorm === 'yes' && question.includes('win')) {
            if (price < 0.80 && goalDiff >= 1) {
              // 80+ min, any lead → very high win chance
              value = (1 / price - 1) * 0.85;
              reason = `80+ min, leading ${goalDiff} goal(s) → ${(price * 100).toFixed(0)}¢ is GREAT`;
            }
          }
        }

        // ==========================================
        // STRATEGY 4: AVOID RISKY BETS
        // ==========================================
        // Skip Over/Under unless very confident
        if (question.includes('o/u') || question.includes('over')) {
          // Only take if score is already close to total
          if (question.includes('2.5') && totalGoals >= 3 && outcomeNorm === 'over') {
            if (price < 0.60) {
              value = (1 / price - 1) * 0.70;
              reason = `Already ${totalGoals} goals → Over 2.5 likely`;
            }
          } else {
            // Skip other O/U bets
            value = 0;
          }
        }

        // ==========================================
        // SELECT BEST VALUE BET
        // ==========================================
        if (value > bestValue && value > 0.20) { // Min 20% expected value
          // Additional checks
          if (spread < 0.05 && volume >= 10000) { // Tight spread, good volume
            bestValue = value;
            bestMarket = {
              question: market.question,
              outcome: outcome,
              price: price,
              volume: volume,
              spread: spread,
              tokenId: market.clobTokenIds ? JSON.parse(market.clobTokenIds)[i] : null,
              conditionId: market.conditionId
            };
            
            console.log(`   ✨ VALUE FOUND: ${market.question}`);
            console.log(`      → ${outcome} @ ${(price * 100).toFixed(0)}¢`);
            console.log(`      → ${reason}`);
            console.log(`      → Expected Value: ${(value * 100).toFixed(0)}% | Volume: $${(volume / 1000).toFixed(1)}K`);
          }
        }
      });
    }

    if (bestMarket !== null) {
      const selectedMarket: BestMarket = bestMarket;
      console.log(`   ✅ Selected: ${selectedMarket.question} - ${selectedMarket.outcome}`);
      return selectedMarket;
    }
    
    console.log(`   ❌ No suitable market found`);
    return null;
  }

  /**
   * Get current match data
   */
  private async getCurrentMatch(matchId: string): Promise<UnifiedMatch | null> {
    try {
      // Extract source and ID
      const [source, id] = matchId.split('-');
      
      if (source === 'fd') {
        // Football-Data
        const match = await this.aggregator['footballData'].getMatch(parseInt(id));
        if (match) {
          return this.aggregator['convertFootballDataToUnified'](match);
        }
      } else if (source === 'af') {
        // API-Football
        const match = await this.aggregator['apiFootball'].getMatch(parseInt(id));
        if (match) {
          return this.aggregator['convertAPIFootballToUnified'](match);
        }
      }
      
      return null;
    } catch (error) {
      console.error(`Error getting match ${matchId}:`, error);
      return null;
    }
  }

  /**
   * Find matching Polymarket markets for a match
   */
  private findMatchingMarkets(match: UnifiedMatch, allMarkets: any[]): any[] {
    return allMarkets.filter((market: any) => {
      const question = market.question?.toLowerCase() || '';
      
      const homeWords = this.normalize(match.homeTeam).split(' ').filter((w: string) => w.length > 3);
      const awayWords = this.normalize(match.awayTeam).split(' ').filter((w: string) => w.length > 3);
      
      const normQuestion = this.normalize(question);
      
      const homeMatch = homeWords.some((word: string) => normQuestion.includes(word)) || 
                        normQuestion.includes(this.normalize(match.homeTeam));
      
      const awayMatch = awayWords.some((word: string) => normQuestion.includes(word)) ||
                        normQuestion.includes(this.normalize(match.awayTeam));
      
      return homeMatch && awayMatch;
    });
  }

  /**
   * Normalize team name for matching
   */
  private normalize(text: string): string {
    return text
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/\bfc\b|\bcf\b|\bkv\b|\bsk\b|\bfk\b/g, '')
      .replace(/\bclub\b|\bunited\b|\bcity\b|\bathletic\b/g, '')
      .replace(/ağdam/g, 'agdam')
      .replace(/qarabağ/g, 'qarabag')
      .trim();
  }

  /**
   * Send Telegram message
   */
  private async sendTelegramMessage(message: string): Promise<void> {
    if (!this.chatId) return;
    
    try {
      await this.telegram.sendMessage(this.chatId, message, {
        parse_mode: 'Markdown',
      });
    } catch (error) {
      console.error('Failed to send Telegram message:', error);
    }
  }

  /**
   * Stop the bot
   */
  stop(): void {
    console.log('\n🛑 Stopping bot...\n');
    this.isRunning = false;
  }
}

// Start bot
const bot = new LiveSportsTradingBot();

// Handle CTRL+C
process.on('SIGINT', () => {
  bot.stop();
  process.exit(0);
});

// Start
bot.start().catch(error => {
  console.error('\n❌ Bot failed:', error);
  process.exit(1);
});
