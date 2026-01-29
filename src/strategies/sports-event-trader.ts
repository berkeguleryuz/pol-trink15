/**
 * Sports Event Driven Trader
 * Integrates Telegram bot signals with live sports strategy
 */

import { SportsTelegramBot, SportsTradingSignal, MatchScore } from '../integrations/sports-telegram-bot';
import { LiveSportsStrategy, Position } from './sports-live-strategy';
import { SportsMarketScanner, SportsMarket } from './sports-market-scanner';

export interface TradeDecision {
  shouldTrade: boolean;
  action: 'BUY' | 'SELL' | 'HOLD';
  markets: {
    marketId?: string;
    marketSlug?: string;
    market: string;
    side: 'YES' | 'NO';
    amount: number;
    reason: string;
    urgency: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  }[];
  explanation: string;
}

export class SportsEventDrivenTrader {
  private telegramBot: SportsTelegramBot;
  private strategy: LiveSportsStrategy;
  private scanner: SportsMarketScanner;
  
  constructor() {
    this.telegramBot = new SportsTelegramBot();
    this.strategy = new LiveSportsStrategy();
    this.scanner = new SportsMarketScanner();
    
    console.log('⚽ Sports Event Driven Trader initialized');
  }

  /**
   * Process goal event from Telegram
   */
  async processGoalEvent(signal: SportsTradingSignal): Promise<TradeDecision> {
    console.log(`\n⚽ PROCESSING GOAL EVENT`);
    console.log(`Match: ${signal.match.homeTeam} ${signal.match.homeScore}-${signal.match.awayScore} ${signal.match.awayTeam}`);
    console.log(`Minute: ${signal.match.minute}'`);
    
    // Find matching markets on Polymarket
    const matchingMarkets = await this.findMatchingMarkets(signal.match);
    
    if (matchingMarkets.length === 0) {
      console.log(`⚠️  No matching markets found for this match`);
      return {
        shouldTrade: false,
        action: 'HOLD',
        markets: [],
        explanation: 'No matching markets available',
      };
    }
    
    console.log(`✅ Found ${matchingMarkets.length} matching markets`);
    
    // Let strategy decide
    const strategyDecision = await this.strategy.onGoalScored(signal.match, signal.actions);
    
    if (!strategyDecision.shouldTrade) {
      return {
        shouldTrade: false,
        action: 'HOLD',
        markets: [],
        explanation: 'Strategy decided not to trade',
      };
    }
    
    // Map actions to actual markets
    const trades = this.mapActionsToMarkets(
      strategyDecision.positions,
      matchingMarkets,
      signal.urgency
    );
    
    return {
      shouldTrade: true,
      action: 'BUY',
      markets: trades,
      explanation: `Goal scored - opening ${trades.length} positions`,
    };
  }

  /**
   * Check profit targets for existing positions
   */
  async checkProfitTargets(): Promise<TradeDecision> {
    const activeMatches = this.strategy.getActiveMatches();
    
    if (activeMatches.length === 0) {
      return {
        shouldTrade: false,
        action: 'HOLD',
        markets: [],
        explanation: 'No active positions',
      };
    }
    
    const allTrades: TradeDecision['markets'] = [];
    
    for (const matchState of activeMatches) {
      const decision = await this.strategy.checkProfitTargets(matchState);
      
      if (decision.shouldTrade) {
        // Map to sell orders
        for (const position of decision.positions) {
          allTrades.push({
            market: position.market,
            side: position.side,
            amount: 0, // Will be calculated based on profit target
            reason: position.reason,
            urgency: 'MEDIUM',
          });
        }
      }
    }
    
    if (allTrades.length > 0) {
      return {
        shouldTrade: true,
        action: 'SELL',
        markets: allTrades,
        explanation: `Profit targets hit - selling ${allTrades.length} positions`,
      };
    }
    
    return {
      shouldTrade: false,
      action: 'HOLD',
      markets: [],
      explanation: 'No profit targets reached',
    };
  }

  /**
   * Handle reverse goal (emergency stop-loss)
   */
  async handleReverseGoal(signal: SportsTradingSignal): Promise<TradeDecision> {
    console.log(`\n🚨 REVERSE GOAL DETECTED!`);
    
    const matchKey = `${signal.match.homeTeam}_${signal.match.awayTeam}`;
    const matchState = this.strategy.getMatchState(signal.match.homeTeam, signal.match.awayTeam);
    
    if (!matchState) {
      return {
        shouldTrade: false,
        action: 'HOLD',
        markets: [],
        explanation: 'No positions found for this match',
      };
    }
    
    const decision = await this.strategy.onReverseGoal(matchState, signal.match);
    
    if (!decision.shouldTrade) {
      return {
        shouldTrade: false,
        action: 'HOLD',
        markets: [],
        explanation: 'Positions are still safe',
      };
    }
    
    // Emergency sell
    const trades = decision.positions.map(pos => ({
      market: pos.market,
      side: pos.side,
      amount: 0, // Sell all
      reason: pos.reason,
      urgency: 'CRITICAL' as const,
    }));
    
    return {
      shouldTrade: true,
      action: 'SELL',
      markets: trades,
      explanation: `EMERGENCY: Reverse goal - selling ${trades.length} positions`,
    };
  }

  /**
   * Find matching markets on Polymarket for a match
   */
  private async findMatchingMarkets(match: MatchScore): Promise<SportsMarket[]> {
    const liveMatches = this.scanner.getLiveMatches();
    const matching: SportsMarket[] = [];
    
    for (const market of liveMatches) {
      // Check if teams match
      if (this.isMatchingMarket(market, match)) {
        matching.push(market);
      }
    }
    
    return matching;
  }

  /**
   * Check if market matches the Telegram match
   */
  private isMatchingMarket(market: SportsMarket, match: MatchScore): boolean {
    const question = market.question.toLowerCase();
    const homeTeam = match.homeTeam.toLowerCase();
    const awayTeam = match.awayTeam.toLowerCase();
    
    // Check if both teams are mentioned in the market question
    const hasHome = question.includes(homeTeam) || 
                    this.fuzzyMatch(question, homeTeam);
    const hasAway = question.includes(awayTeam) || 
                    this.fuzzyMatch(question, awayTeam);
    
    return hasHome && hasAway;
  }

  /**
   * Fuzzy match for team names (handle abbreviations, etc.)
   */
  private fuzzyMatch(text: string, team: string): boolean {
    // Simple fuzzy matching - can be improved
    const teamWords = team.split(' ');
    return teamWords.some(word => text.includes(word.toLowerCase()));
  }

  /**
   * Map trading actions to actual Polymarket markets
   */
  private mapActionsToMarkets(
    actions: any[],
    markets: SportsMarket[],
    urgency: 'CRITICAL' | 'HIGH' | 'MEDIUM'
  ): TradeDecision['markets'] {
    const trades: TradeDecision['markets'] = [];
    
    for (const action of actions) {
      // Find best matching market
      const market = this.findBestMarket(action.market, markets);
      
      if (market) {
        // Find matching token
        const token = market.tokens.find(t => 
          t.outcome.toLowerCase().includes(action.market.toLowerCase()) ||
          action.market.toLowerCase().includes(t.outcome.toLowerCase())
        );
        
        if (token) {
          trades.push({
            marketId: market.id,
            marketSlug: market.slug,
            market: action.market,
            side: action.side,
            amount: 2.0, // $2 default
            reason: action.reason,
            urgency,
          });
        }
      }
    }
    
    return trades;
  }

  /**
   * Find best matching market for an action
   */
  private findBestMarket(actionMarket: string, markets: SportsMarket[]): SportsMarket | undefined {
    const action = actionMarket.toLowerCase();
    
    // Try exact match first
    let best = markets.find(m => m.question.toLowerCase().includes(action));
    if (best) return best;
    
    // Try fuzzy match
    for (const market of markets) {
      const question = market.question.toLowerCase();
      
      if (action.includes('win') && question.includes('win')) {
        return market;
      }
      if (action.includes('draw') && question.includes('draw')) {
        return market;
      }
    }
    
    // Return first market as fallback
    return markets[0];
  }

  /**
   * Scan for new opportunities
   */
  async scanForOpportunities(): Promise<TradeDecision> {
    const opportunities = await this.scanner.scanSportsMarkets();
    
    if (opportunities.length === 0) {
      return {
        shouldTrade: false,
        action: 'HOLD',
        markets: [],
        explanation: 'No opportunities found',
      };
    }
    
    const trades: TradeDecision['markets'] = [];
    
    for (const opp of opportunities) {
      // Only act on LIVE or KICKOFF_SOON
      if (opp.urgency === 'CRITICAL' || opp.urgency === 'HIGH') {
        for (const action of opp.recommendedActions) {
          trades.push({
            marketId: opp.market.id,
            marketSlug: opp.market.slug,
            market: action.outcome,
            side: action.side,
            amount: 2.0,
            reason: opp.reason,
            urgency: opp.urgency,
          });
        }
      }
    }
    
    if (trades.length > 0) {
      return {
        shouldTrade: true,
        action: 'BUY',
        markets: trades,
        explanation: `Found ${opportunities.length} opportunities`,
      };
    }
    
    return {
      shouldTrade: false,
      action: 'HOLD',
      markets: [],
      explanation: 'Opportunities found but none actionable',
    };
  }

  /**
   * Update position prices from market data
   */
  async updatePositionPrices(): Promise<void> {
    const activeMatches = this.strategy.getActiveMatches();
    
    for (const matchState of activeMatches) {
      for (const position of matchState.positions) {
        // Fetch current price from market
        // This would need actual market data fetch
        // For now, we'll skip implementation
      }
    }
  }

  /**
   * Get bot instance
   */
  getTelegramBot(): SportsTelegramBot {
    return this.telegramBot;
  }

  /**
   * Get strategy instance
   */
  getStrategy(): LiveSportsStrategy {
    return this.strategy;
  }

  /**
   * Get scanner instance
   */
  getScanner(): SportsMarketScanner {
    return this.scanner;
  }
}
