import { TimezoneUtils } from '../utils/timezone';

/**
 * Event-Driven Trading System
 * Waits for triggers (news, match events) and executes instantly
 */

export interface TradingEvent {
  type: 'NEWS' | 'MATCH' | 'MANUAL';
  market: string; // Market question/description
  side: 'YES' | 'NO';
  urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  reason: string;
  confidence: number; // 0-100
  timestamp: Date;
  metadata?: {
    newsTitle?: string;
    matchScore?: string;
    team?: string;
    relatedMarkets?: string[]; // Opposite bets
  };
}

export interface MarketSnapshot {
  conditionId: string;
  question: string;
  yesPrice: number;
  noPrice: number;
  liquidity: number;
  lastUpdate: Date;
  closed?: boolean; // Market closed/resolved
  active?: boolean; // Market still active
}

export class EventDrivenTrader {
  private marketCache: Map<string, MarketSnapshot> = new Map();
  private recentEvents: TradingEvent[] = [];
  private readonly MAX_CACHE_AGE = 60 * 1000; // 1 minute

  constructor() {}

  /**
   * Process incoming event and determine action
   */
  async processEvent(event: TradingEvent): Promise<{
    shouldTrade: boolean;
    primaryAction?: {
      market: string;
      side: 'YES' | 'NO';
      amount: number;
      reason: string;
    };
    oppositeAction?: {
      market: string;
      side: 'YES' | 'NO';
      amount: number;
      reason: string;
    };
  }> {
    this.recentEvents.push(event);
    this.logEvent(event);

    // CRITICAL: Check if event is too old (must be FRESH NEWS/EVENT)
    if (this.isEventTooOld(event)) {
      console.log(`❌ Event rejected: Too old, only trading FRESH events`);
      return { shouldTrade: false };
    }

    // Check if we already acted on similar event
    if (this.isDuplicateEvent(event)) {
      console.log(`⚠️  Similar event already processed, skipping.`);
      return { shouldTrade: false };
    }

    // Determine action based on event type
    if (event.type === 'NEWS') {
      return this.processNewsEvent(event);
    } else if (event.type === 'MATCH') {
      return this.processMatchEvent(event);
    }

    return { shouldTrade: false };
  }

  /**
   * NEWS EVENT: Breaking news → Immediate YES on outcome
   * Example: "Israel bombs Gaza" → YES on "Will Israel attack Gaza?"
   */
  private processNewsEvent(event: TradingEvent): {
    shouldTrade: boolean;
    primaryAction?: any;
    oppositeAction?: any;
  } {
    console.log(`\n📰 BREAKING NEWS EVENT`);
    console.log(`Event: ${event.reason}`);

    // HIGH urgency news → Instant action
    if (event.urgency === 'HIGH' || event.urgency === 'CRITICAL') {
      const amount = event.urgency === 'CRITICAL' ? 5.0 : 3.0;

      return {
        shouldTrade: true,
        primaryAction: {
          market: event.market,
          side: event.side, // Usually YES for "Did X happen?"
          amount,
          reason: `Breaking news: ${event.reason}`,
        },
      };
    }

    return { shouldTrade: false };
  }

  /**
   * MATCH EVENT: Live match action → YES on winner + NO on loser
   * Example: Bayern scores → YES Bayern + NO PSG
   */
  private processMatchEvent(event: TradingEvent): {
    shouldTrade: boolean;
    primaryAction?: any;
    oppositeAction?: any;
  } {
    console.log(`\n⚽ LIVE MATCH EVENT`);
    console.log(`Event: ${event.reason}`);

    // If a team scored/leads → Buy YES on winner, NO on loser
    if (event.urgency === 'HIGH' || event.urgency === 'CRITICAL') {
      const amount = 2.5; // $2.5 per match bet

      const primaryAction = {
        market: event.market,
        side: event.side,
        amount,
        reason: `Match event: ${event.reason}`,
      };

      // Find opposite market (e.g., if Bayern YES → PSG NO)
      let oppositeAction;
      if (event.metadata?.relatedMarkets && event.metadata.relatedMarkets.length > 0) {
        oppositeAction = {
          market: event.metadata.relatedMarkets[0],
          side: event.side === 'YES' ? 'NO' : 'YES',
          amount: amount * 0.5, // Hedge with 50% amount
          reason: `Hedge against ${event.metadata.team || 'opponent'}`,
        };
      }

      return {
        shouldTrade: true,
        primaryAction,
        oppositeAction,
      };
    }

    return { shouldTrade: false };
  }

  /**
   * Check if event is too old (prevent trading on old news)
   */
  private isEventTooOld(event: TradingEvent): boolean {
    const now = Date.now();
    const eventAge = now - event.timestamp.getTime();
    const maxAge = 2 * 60 * 1000; // 2 minutes max - must be FRESH

    if (eventAge > maxAge) {
      console.log(`⚠️  Event too old (${(eventAge / 1000).toFixed(0)}s ago), ignoring`);
      return true;
    }

    return false;
  }

  /**
   * Check if we already acted on similar event (prevent duplicate trades)
   */
  private isDuplicateEvent(event: TradingEvent): boolean {
    const recentWindow = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();

    return this.recentEvents.some(e => 
      e.market === event.market &&
      e.side === event.side &&
      now - e.timestamp.getTime() < recentWindow &&
      e !== event // Don't compare with itself
    );
  }

  /**
   * Get current price for a market (cached for 1 min)
   */
  async getMarketPrice(conditionId: string): Promise<MarketSnapshot | null> {
    const cached = this.marketCache.get(conditionId);
    
    if (cached && Date.now() - cached.lastUpdate.getTime() < this.MAX_CACHE_AGE) {
      return cached;
    }

    // Fetch fresh price (lightweight call)
    try {
      const response = await fetch(`https://clob.polymarket.com/markets/${conditionId}`);
      if (!response.ok) return null;

      const data = await response.json() as any;
      
      // Check if market is closed/resolved
      const isClosed = data.closed === true || data.active === false;
      
      if (isClosed) {
        console.log(`⚠️  Market "${data.question}" is CLOSED/RESOLVED - cannot trade`);
        return null;
      }

      const snapshot: MarketSnapshot = {
        conditionId,
        question: data.question || '',
        yesPrice: parseFloat(data.tokens?.[0]?.price || '0.5'),
        noPrice: parseFloat(data.tokens?.[1]?.price || '0.5'),
        liquidity: parseFloat(data.liquidity || '0'),
        lastUpdate: new Date(),
        closed: isClosed,
        active: !isClosed,
      };

      this.marketCache.set(conditionId, snapshot);
      return snapshot;
    } catch (error) {
      console.error(`Error fetching market ${conditionId}:`, error);
      return null;
    }
  }

  /**
   * Monitor market and wait for specific price condition
   * Example: "Wait until YES < 0.30, then buy"
   */
  async waitForPriceCondition(
    conditionId: string,
    condition: (snapshot: MarketSnapshot) => boolean,
    timeoutMinutes: number = 60
  ): Promise<MarketSnapshot | null> {
    console.log(`\n⏳ Monitoring market for price condition...`);
    console.log(`Market: ${conditionId}`);
    console.log(`Timeout: ${timeoutMinutes} minutes`);

    const startTime = Date.now();
    const timeout = timeoutMinutes * 60 * 1000;

    while (Date.now() - startTime < timeout) {
      const snapshot = await this.getMarketPrice(conditionId);
      
      if (snapshot && condition(snapshot)) {
        console.log(`\n✅ CONDITION MET!`);
        console.log(`YES: ${(snapshot.yesPrice * 100).toFixed(1)}%`);
        console.log(`NO: ${(snapshot.noPrice * 100).toFixed(1)}%`);
        return snapshot;
      }

      // Wait 30 seconds before next check (not heavy API calls)
      await new Promise(resolve => setTimeout(resolve, 30 * 1000));
    }

    console.log(`\n⏰ Timeout reached, condition not met.`);
    return null;
  }

  /**
   * Check multiple markets simultaneously for opportunities
   */
  async scanQuickOpportunities(
    marketIds: string[],
    minConfidence: number = 70
  ): Promise<TradingEvent[]> {
    console.log(`\n🔍 Quick scan: ${marketIds.length} markets...`);
    
    const opportunities: TradingEvent[] = [];

    // Parallel fetch (lightweight)
    const snapshots = await Promise.all(
      marketIds.map(id => this.getMarketPrice(id))
    );

    for (let i = 0; i < snapshots.length; i++) {
      const snapshot = snapshots[i];
      if (!snapshot) continue;

      // Look for extreme prices (potential opportunities)
      if (snapshot.yesPrice < 0.05) {
        opportunities.push({
          type: 'MANUAL',
          market: snapshot.question,
          side: 'YES',
          urgency: 'MEDIUM',
          reason: `Very low YES price (${(snapshot.yesPrice * 100).toFixed(1)}%)`,
          confidence: 60,
          timestamp: new Date(),
        });
      } else if (snapshot.noPrice < 0.05) {
        opportunities.push({
          type: 'MANUAL',
          market: snapshot.question,
          side: 'NO',
          urgency: 'MEDIUM',
          reason: `Very low NO price (${(snapshot.noPrice * 100).toFixed(1)}%)`,
          confidence: 60,
          timestamp: new Date(),
        });
      }
    }

    return opportunities;
  }

  /**
   * Log event with timestamp
   */
  private logEvent(event: TradingEvent): void {
    const urgencyEmoji = {
      LOW: '📘',
      MEDIUM: '📙',
      HIGH: '📕',
      CRITICAL: '🚨',
    }[event.urgency];

    console.log(`\n${urgencyEmoji} EVENT DETECTED - ${event.type}`);
    console.log(`📊 [${TimezoneUtils.formatBerlinTime()}]`);
    console.log(`🎯 Market: ${event.market}`);
    console.log(`💹 Side: ${event.side}`);
    console.log(`⚡ Urgency: ${event.urgency}`);
    console.log(`📝 Reason: ${event.reason}`);
    console.log(`🎲 Confidence: ${event.confidence}%`);
  }

  /**
   * Clear old events (keep last 100)
   */
  cleanupOldEvents(): void {
    if (this.recentEvents.length > 100) {
      this.recentEvents = this.recentEvents.slice(-100);
    }
  }

  /**
   * Get recent events summary
   */
  getRecentEvents(limit: number = 10): TradingEvent[] {
    return this.recentEvents.slice(-limit);
  }
}
