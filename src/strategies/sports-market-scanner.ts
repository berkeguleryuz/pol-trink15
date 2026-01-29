/**
 * Sports Market Scanner - LIVE MATCHES ONLY
 * Scans for active sports markets, kick-off opportunities, and live match updates
 */

export interface SportsMarket {
  id: string;
  slug: string;
  question: string;
  category: string;
  
  // Match info
  homeTeam?: string;
  awayTeam?: string;
  league?: string;
  sport?: string;
  
  // Market data
  tokens: MarketToken[];
  liquidity: number;
  volume24h: number;
  
  // Status
  active: boolean;
  closed: boolean;
  startDate?: string;
  endDate?: string;
  
  // Trading signals
  isLive: boolean;
  isKickoffSoon: boolean; // Starting in next 30 min
  minutesToKickoff?: number;
}

export interface MarketToken {
  tokenId: string;
  outcome: string; // "Yes", "No", "Team A", "Team B", "Draw"
  price: number;
  side: 'YES' | 'NO';
}

export interface SportsOpportunity {
  market: SportsMarket;
  type: 'LIVE' | 'KICKOFF_SOON' | 'EARLY_ENTRY';
  urgency: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  reason: string;
  recommendedActions: {
    outcome: string;
    side: 'YES' | 'NO';
    currentPrice: number;
    priority: number;
  }[];
}

export class SportsMarketScanner {
  private knownMarkets: Set<string> = new Set();
  private liveMatches: Map<string, SportsMarket> = new Map();
  
  private readonly GAMMA_API = 'https://gamma-api.polymarket.com';
  private readonly MIN_LIQUIDITY = 5000; // $5K minimum for sports
  private readonly KICKOFF_WINDOW = 30; // 30 minutes before start
  
  constructor() {
    console.log('⚽ Sports Market Scanner initialized');
  }

  /**
   * Scan for sports markets
   */
  async scanSportsMarkets(): Promise<SportsOpportunity[]> {
    console.log('\n🔍 Scanning sports markets...');
    
    const opportunities: SportsOpportunity[] = [];
    
    try {
      // Fetch active sports markets
      const markets = await this.fetchSportsMarkets();
      console.log(`📊 Found ${markets.length} active sports markets`);
      
      // Check for new markets
      const newMarkets = markets.filter(m => !this.knownMarkets.has(m.id));
      if (newMarkets.length > 0) {
        console.log(`🆕 ${newMarkets.length} NEW sports markets detected!`);
        newMarkets.forEach(m => {
          console.log(`   - ${m.question}`);
          this.knownMarkets.add(m.id);
        });
      }
      
      // Analyze each market
      for (const market of markets) {
        const opp = this.analyzeMarket(market);
        if (opp) {
          opportunities.push(opp);
        }
      }
      
      console.log(`✅ Found ${opportunities.length} opportunities\n`);
      
    } catch (error: any) {
      console.error(`❌ Scan error: ${error.message}`);
    }
    
    return opportunities;
  }

  /**
   * Fetch sports markets from Polymarket
   */
  private async fetchSportsMarkets(): Promise<SportsMarket[]> {
    const markets: SportsMarket[] = [];
    
    try {
      // Fetch with sports filter
      const response = await fetch(
        `${this.GAMMA_API}/markets?limit=500&active=true&closed=false`
      );
      
      if (!response.ok) {
        throw new Error(`API error: ${response.statusText}`);
      }
      
      const data: any[] = await response.json() as any[];
      
      // Filter for sports only
      for (const item of data) {
        // Check if it's a sports market
        if (!this.isSportsMarket(item)) {
          continue;
        }
        
        const market = this.parseMarket(item);
        if (market && market.liquidity >= this.MIN_LIQUIDITY) {
          markets.push(market);
          
          // Track live matches
          if (market.isLive) {
            this.liveMatches.set(market.id, market);
          }
        }
      }
      
    } catch (error: any) {
      console.error(`Failed to fetch markets: ${error.message}`);
    }
    
    return markets;
  }

  /**
   * Check if market is sports-related
   */
  private isSportsMarket(item: any): boolean {
    const question = (item.question || '').toLowerCase();
    const category = (item.category || '').toLowerCase();
    
    // Category check
    if (category === 'sports') {
      return true;
    }
    
    // Keyword check for sports terms
    const sportsKeywords = [
      'win', 'lose', 'match', 'game', 'score', 'goal',
      'premier league', 'la liga', 'bundesliga', 'serie a', 'ligue 1',
      'champions league', 'europa league',
      'nba', 'nfl', 'mlb', 'nhl',
      'tournament', 'championship', 'cup', 'playoff',
      'vs', 'v ', // team vs team format
    ];
    
    return sportsKeywords.some(keyword => question.includes(keyword));
  }

  /**
   * Parse market data
   */
  private parseMarket(item: any): SportsMarket | null {
    try {
      const question = item.question || '';
      const tokens: MarketToken[] = [];
      
      // Parse tokens (all outcomes)
      if (item.tokens && Array.isArray(item.tokens)) {
        for (const token of item.tokens) {
          tokens.push({
            tokenId: token.token_id || token.tokenId,
            outcome: token.outcome || 'Unknown',
            price: parseFloat(token.price || '0'),
            side: this.determineSide(token.outcome),
          });
        }
      }
      
      // Extract teams from question
      const teams = this.extractTeams(question);
      
      // Check if live (simple heuristic)
      const isLive = this.isMarketLive(item);
      
      // Check kickoff timing
      const kickoffInfo = this.calculateKickoffTiming(item);
      
      return {
        id: item.id,
        slug: item.slug,
        question,
        category: item.category || 'sports',
        homeTeam: teams.home,
        awayTeam: teams.away,
        league: this.extractLeague(question),
        sport: this.extractSport(question),
        tokens,
        liquidity: parseFloat(item.liquidity || '0'),
        volume24h: parseFloat(item.volume24hr || '0'),
        active: item.active !== false,
        closed: item.closed === true,
        startDate: item.startDate,
        endDate: item.endDate,
        isLive,
        isKickoffSoon: kickoffInfo.isSoon,
        minutesToKickoff: kickoffInfo.minutes,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract team names from question
   */
  private extractTeams(question: string): { home?: string; away?: string } {
    // Pattern: "Team A vs Team B" or "Team A v Team B"
    const vsPattern = /(.+?)\s+(?:vs|v)\s+(.+?)(?:\s+to|\s+win|\?|$)/i;
    const match = question.match(vsPattern);
    
    if (match) {
      return {
        home: match[1].trim(),
        away: match[2].trim(),
      };
    }
    
    return {};
  }

  /**
   * Extract league/competition name
   */
  private extractLeague(question: string): string | undefined {
    const leagues = [
      'Premier League', 'La Liga', 'Bundesliga', 'Serie A', 'Ligue 1',
      'Champions League', 'Europa League', 'World Cup',
      'NBA', 'NFL', 'MLB', 'NHL',
    ];
    
    for (const league of leagues) {
      if (question.includes(league)) {
        return league;
      }
    }
    
    return undefined;
  }

  /**
   * Extract sport type
   */
  private extractSport(question: string): string | undefined {
    const q = question.toLowerCase();
    
    if (q.includes('nba') || q.includes('basketball')) return 'basketball';
    if (q.includes('nfl') || q.includes('football')) return 'american_football';
    if (q.includes('mlb') || q.includes('baseball')) return 'baseball';
    if (q.includes('nhl') || q.includes('hockey')) return 'hockey';
    if (q.includes('premier league') || q.includes('champions league')) return 'soccer';
    
    return 'soccer'; // Default to soccer
  }

  /**
   * Determine if market is currently live
   */
  private isMarketLive(item: any): boolean {
    // Check if market has recent activity
    const volume24h = parseFloat(item.volume24hr || '0');
    if (volume24h > 10000) {
      return true; // High volume = likely live
    }
    
    // Check end date (if match ends today, it's likely live)
    if (item.endDate) {
      const endDate = new Date(item.endDate);
      const now = new Date();
      const hoursUntilEnd = (endDate.getTime() - now.getTime()) / (1000 * 60 * 60);
      
      if (hoursUntilEnd > 0 && hoursUntilEnd < 3) {
        return true; // Ends in next 3 hours = live
      }
    }
    
    return false;
  }

  /**
   * Calculate kickoff timing
   */
  private calculateKickoffTiming(item: any): { isSoon: boolean; minutes?: number } {
    if (!item.startDate) {
      return { isSoon: false };
    }
    
    const startDate = new Date(item.startDate);
    const now = new Date();
    const minutesUntilStart = (startDate.getTime() - now.getTime()) / (1000 * 60);
    
    if (minutesUntilStart > 0 && minutesUntilStart <= this.KICKOFF_WINDOW) {
      return { isSoon: true, minutes: Math.round(minutesUntilStart) };
    }
    
    return { isSoon: false, minutes: Math.round(minutesUntilStart) };
  }

  /**
   * Determine YES/NO side for outcome
   */
  private determineSide(outcome: string): 'YES' | 'NO' {
    const o = outcome.toLowerCase();
    if (o.includes('no') || o.includes('lose') || o.includes('draw')) {
      return 'NO';
    }
    return 'YES';
  }

  /**
   * Analyze market for opportunities
   */
  private analyzeMarket(market: SportsMarket): SportsOpportunity | null {
    const actions: SportsOpportunity['recommendedActions'] = [];
    
    // LIVE MATCH - Highest priority
    if (market.isLive) {
      console.log(`🔴 LIVE: ${market.question}`);
      
      // Look for good entry prices
      for (const token of market.tokens) {
        if (token.price < 0.30 && token.price > 0.05) {
          actions.push({
            outcome: token.outcome,
            side: token.side,
            currentPrice: token.price,
            priority: 1,
          });
        }
      }
      
      if (actions.length > 0) {
        return {
          market,
          type: 'LIVE',
          urgency: 'CRITICAL',
          reason: `Live match with ${actions.length} entry opportunities`,
          recommendedActions: actions,
        };
      }
    }
    
    // KICKOFF SOON - High priority
    if (market.isKickoffSoon && market.minutesToKickoff) {
      console.log(`⏱️  KICKOFF SOON (${market.minutesToKickoff} min): ${market.question}`);
      
      // Get all tokens for early positioning
      for (const token of market.tokens) {
        if (token.price >= 0.40 && token.price <= 0.60) {
          // Fair odds - good for early entry
          actions.push({
            outcome: token.outcome,
            side: token.side,
            currentPrice: token.price,
            priority: 2,
          });
        }
      }
      
      if (actions.length > 0) {
        return {
          market,
          type: 'KICKOFF_SOON',
          urgency: 'HIGH',
          reason: `Match starting in ${market.minutesToKickoff} minutes`,
          recommendedActions: actions,
        };
      }
    }
    
    // EARLY ENTRY - Low price opportunities
    for (const token of market.tokens) {
      if (token.price < 0.10 && market.volume24h > 5000) {
        actions.push({
          outcome: token.outcome,
          side: token.side,
          currentPrice: token.price,
          priority: 3,
        });
      }
    }
    
    if (actions.length > 0) {
      return {
        market,
        type: 'EARLY_ENTRY',
        urgency: 'MEDIUM',
        reason: `Low price entry opportunities`,
        recommendedActions: actions,
      };
    }
    
    return null;
  }

  /**
   * Get all live matches
   */
  getLiveMatches(): SportsMarket[] {
    return Array.from(this.liveMatches.values());
  }

  /**
   * Get market by ID
   */
  getMarket(marketId: string): SportsMarket | undefined {
    return this.liveMatches.get(marketId);
  }

  /**
   * Clear old data
   */
  cleanup(): void {
    const now = Date.now();
    for (const [id, market] of this.liveMatches.entries()) {
      if (market.closed || !market.active) {
        this.liveMatches.delete(id);
      }
    }
  }
}
