/**
 * API-Football Integration
 * https://www.api-football.com/documentation-v3
 * 
 * Free Tier: 100 requests/day
 * Use strategically for:
 * 1. Live match updates (scores, minute, status)
 * 2. Pre-match odds (betting odds from bookmakers)
 * 3. Match fixtures (upcoming matches)
 * 4. Match status changes (kickoff, halftime, fulltime)
 */

import axios from 'axios';
import { TimezoneUtils } from '../utils/timezone';

const API_FOOTBALL_BASE_URL = 'https://v3.football.api-sports.io';
const API_FOOTBALL_KEY = process.env.FOOTBALL_API_KEY || '';
const API_FOOTBALL_HOST = 'v3.football.api-sports.io';

/**
 * Match status from API-Football
 */
export type MatchStatus = 
  | 'TBD'        // Time to be defined
  | 'NS'         // Not Started
  | '1H'         // First Half, Kick Off
  | 'HT'         // Halftime
  | '2H'         // Second Half, 2nd Half Started
  | 'ET'         // Extra Time
  | 'P'          // Penalty In Progress
  | 'FT'         // Match Finished
  | 'AET'        // Match Finished After Extra Time
  | 'PEN'        // Match Finished After Penalty
  | 'BT'         // Break Time (in Extra Time)
  | 'SUSP'       // Match Suspended
  | 'INT'        // Match Interrupted
  | 'PST'        // Match Postponed
  | 'CANC'       // Match Cancelled
  | 'ABD'        // Match Abandoned
  | 'AWD'        // Technical Loss
  | 'WO';        // WalkOver

export interface APIFootballFixture {
  fixture: {
    id: number;
    referee: string | null;
    timezone: string;
    date: string; // ISO timestamp
    timestamp: number;
    status: {
      long: string;
      short: MatchStatus;
      elapsed: number | null; // Minutes elapsed
    };
    venue: {
      id: number | null;
      name: string | null;
      city: string | null;
    };
  };
  league: {
    id: number;
    name: string;
    country: string;
    logo: string;
    flag: string;
    season: number;
    round: string;
  };
  teams: {
    home: {
      id: number;
      name: string;
      logo: string;
      winner: boolean | null;
    };
    away: {
      id: number;
      name: string;
      logo: string;
      winner: boolean | null;
    };
  };
  goals: {
    home: number | null;
    away: number | null;
  };
  score: {
    halftime: {
      home: number | null;
      away: number | null;
    };
    fulltime: {
      home: number | null;
      away: number | null;
    };
    extratime: {
      home: number | null;
      away: number | null;
    };
    penalty: {
      home: number | null;
      away: number | null;
    };
  };
}

export interface APIFootballOdds {
  league: {
    id: number;
    name: string;
    country: string;
  };
  fixture: {
    id: number;
    date: string;
  };
  bookmakers: Array<{
    id: number;
    name: string;
    bets: Array<{
      id: number;
      name: string; // "Match Winner", "Goals Over/Under", etc.
      values: Array<{
        value: string; // "Home", "Away", "Draw", "Over 2.5", etc.
        odd: string;   // e.g., "2.10"
      }>;
    }>;
  }>;
}

export interface LiveMatch {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  minute: number;
  status: MatchStatus;
  league: string;
  country: string;
  timestamp: number;
}

export interface PreMatchOdds {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoffTime: Date;
  odds: {
    homeWin: number;
    draw: number;
    awayWin: number;
    bookmaker: string;
  };
}

export class APIFootballClient {
  private apiKey: string;
  private baseUrl: string;
  private requestCount: number = 0;
  private dailyLimit: number = 100;
  private lastResetDate: string;

  constructor() {
    // Load key from process.env at runtime (after dotenv.config())
    this.apiKey = process.env.FOOTBALL_API_KEY || '';
    this.baseUrl = API_FOOTBALL_BASE_URL;
    this.lastResetDate = new Date().toISOString().split('T')[0];
    
    if (!this.apiKey) {
      console.warn('⚠️  API-Football key not found in .env');
    } else {
      console.log(`✅ API-Football key loaded: ${this.apiKey.substring(0, 8)}...`);
    }
  }

  /**
   * Make API request with rate limiting
   */
  private async makeRequest<T>(endpoint: string, params: Record<string, any> = {}): Promise<T | null> {
    // Check daily limit
    const today = new Date().toISOString().split('T')[0];
    if (today !== this.lastResetDate) {
      this.requestCount = 0;
      this.lastResetDate = today;
    }

    if (this.requestCount >= this.dailyLimit) {
      console.error(`❌ API-Football daily limit reached (${this.dailyLimit} requests/day)`);
      return null;
    }

    try {
      const response = await axios.get(`${this.baseUrl}${endpoint}`, {
        params,
        headers: {
          'x-apisports-key': this.apiKey,
          'x-apisports-host': API_FOOTBALL_HOST,
        },
        timeout: 10000,
      });

      this.requestCount++;
      console.log(`📡 API-Football request ${this.requestCount}/${this.dailyLimit}: ${endpoint}`);

      if (response.data.response) {
        return response.data.response as T;
      }

      return null;
    } catch (error: any) {
      console.error(`❌ API-Football request failed:`, error.message);
      return null;
    }
  }

  /**
   * Get live matches (IN PLAY right now)
   */
  async getLiveMatches(): Promise<LiveMatch[]> {
    console.log('\n⚽ Fetching LIVE matches from API-Football...\n');
    
    const fixtures = await this.makeRequest<APIFootballFixture[]>('/fixtures', {
      live: 'all', // All live matches
    });

    if (!fixtures || fixtures.length === 0) {
      console.log('   No live matches found');
      return [];
    }

    const liveMatches = fixtures
      .filter(f => 
        f.fixture.status.short === '1H' || 
        f.fixture.status.short === '2H' ||
        f.fixture.status.short === 'ET'
      )
      .map(f => ({
        fixtureId: f.fixture.id,
        homeTeam: f.teams.home.name,
        awayTeam: f.teams.away.name,
        homeScore: f.goals.home || 0,
        awayScore: f.goals.away || 0,
        minute: f.fixture.status.elapsed || 0,
        status: f.fixture.status.short,
        league: f.league.name,
        country: f.league.country,
        timestamp: f.fixture.timestamp * 1000,
      }));

    console.log(`   Found ${liveMatches.length} live matches\n`);
    
    liveMatches.forEach(m => {
      console.log(`   ⚽ ${m.homeTeam} ${m.homeScore}-${m.awayScore} ${m.awayTeam}`);
      console.log(`      ${m.league} | ${m.minute}' | ${m.status}`);
    });

    return liveMatches;
  }

  /**
   * Get specific match by ID
   */
  async getMatch(fixtureId: number): Promise<APIFootballFixture | null> {
    console.log(`\n🔍 Fetching match ${fixtureId}...\n`);
    
    const fixtures = await this.makeRequest<APIFootballFixture[]>('/fixtures', {
      id: fixtureId,
    });

    if (!fixtures || fixtures.length === 0) {
      console.log(`   Match ${fixtureId} not found`);
      return null;
    }

    return fixtures[0];
  }

  /**
   * Get upcoming fixtures (today and tomorrow)
   */
  async getUpcomingFixtures(date?: Date): Promise<APIFootballFixture[]> {
    const targetDate = date || new Date();
    const dateStr = targetDate.toISOString().split('T')[0];
    
    console.log(`\n📅 Fetching fixtures for ${dateStr}...\n`);
    
    const fixtures = await this.makeRequest<APIFootballFixture[]>('/fixtures', {
      date: dateStr,
      timezone: 'Europe/Berlin',
    });

    if (!fixtures || fixtures.length === 0) {
      console.log(`   No fixtures found for ${dateStr}`);
      return [];
    }

    console.log(`   Found ${fixtures.length} fixtures\n`);

    return fixtures || [];
  }

  /**
   * Get today's fixtures for a specific league
   */
  async getFixturesToday(leagueId: number): Promise<APIFootballFixture[]> {
    const today = new Date().toISOString().split('T')[0];
    
    const fixtures = await this.makeRequest<APIFootballFixture[]>('/fixtures', {
      date: today,
      league: leagueId,
      timezone: 'Europe/Istanbul',
    });

    return fixtures || [];
  }

  /**
   * Get today's fixtures for MAJOR leagues (EPL, UCL, La Liga, etc.)
   * Bu sadece büyük ligleri tarar - daha az request kullanır
   */
  async getTodaysMajorLeagueFixtures(): Promise<APIFootballFixture[]> {
    const today = new Date().toISOString().split('T')[0];
    
    console.log(`\n📅 Fetching today's fixtures from MAJOR leagues (${today})...\n`);

    // Major league IDs from API-Football
    const majorLeagues = [
      { id: 39, name: 'Premier League' },      // EPL
      { id: 2, name: 'Champions League' },     // UCL
      { id: 140, name: 'La Liga' },            // Spain
      { id: 78, name: 'Bundesliga' },          // Germany
      { id: 61, name: 'Ligue 1' },             // France
      { id: 135, name: 'Serie A' },            // Italy
      { id: 3, name: 'Europa League' },        // UEL
      { id: 848, name: 'Conference League' },  // Conference
      { id: 262, name: 'MLS' },                // USA
      { id: 203, name: 'Super Lig' },          // Turkey
    ];

    const allFixtures: APIFootballFixture[] = [];

    for (const league of majorLeagues) {
      const fixtures = await this.getFixturesToday(league.id);
      
      if (fixtures.length > 0) {
        console.log(`   ✅ ${league.name}: ${fixtures.length} matches`);
        allFixtures.push(...fixtures);
      }
    }

    console.log(`\n📊 TOTAL: ${allFixtures.length} matches from major leagues today\n`);

    return allFixtures;
  }

  /**
   * Get fixtures starting in next N minutes
   */
  async getFixturesStartingSoon(minutesAhead: number = 30): Promise<APIFootballFixture[]> {
    const now = Date.now();
    const maxTime = now + (minutesAhead * 60 * 1000);

    // Get today's fixtures
    const today = await this.getUpcomingFixtures(new Date());
    
    // Filter for matches starting soon
    const startingSoon = today.filter(f => {
      const kickoffTime = f.fixture.timestamp * 1000;
      const isNotStarted = f.fixture.status.short === 'NS' || f.fixture.status.short === 'TBD';
      const isInTimeWindow = kickoffTime >= now && kickoffTime <= maxTime;
      
      return isNotStarted && isInTimeWindow;
    });

    console.log(`\n⏰ Found ${startingSoon.length} matches starting in next ${minutesAhead} minutes:\n`);
    
    startingSoon.forEach(f => {
      const kickoffBerlin = TimezoneUtils.formatBerlinTime(new Date(f.fixture.timestamp * 1000));
      const minutesUntil = Math.floor((f.fixture.timestamp * 1000 - now) / 60000);
      console.log(`   ⚽ ${f.teams.home.name} vs ${f.teams.away.name}`);
      console.log(`      ${f.league.name} | Kickoff: ${kickoffBerlin} (in ${minutesUntil} min)`);
    });

    return startingSoon;
  }

  /**
   * Get pre-match odds from bookmakers
   */
  async getPreMatchOdds(fixtureId: number): Promise<PreMatchOdds | null> {
    console.log(`\n💰 Fetching odds for fixture ${fixtureId}...\n`);
    
    const oddsData = await this.makeRequest<APIFootballOdds[]>('/odds', {
      fixture: fixtureId,
    });

    if (!oddsData || oddsData.length === 0) {
      console.log('   No odds data available');
      return null;
    }

    const data = oddsData[0];
    
    // Find "Match Winner" bet from first bookmaker
    const bookmaker = data.bookmakers[0];
    if (!bookmaker) {
      console.log('   No bookmaker data');
      return null;
    }

    const matchWinnerBet = bookmaker.bets.find(bet => bet.name === 'Match Winner');
    if (!matchWinnerBet) {
      console.log('   No Match Winner odds');
      return null;
    }

    // Extract home/draw/away odds
    const homeOdd = parseFloat(matchWinnerBet.values.find(v => v.value === 'Home')?.odd || '0');
    const drawOdd = parseFloat(matchWinnerBet.values.find(v => v.value === 'Draw')?.odd || '0');
    const awayOdd = parseFloat(matchWinnerBet.values.find(v => v.value === 'Away')?.odd || '0');

    // Get match details
    const fixture = await this.getMatch(fixtureId);
    if (!fixture) {
      return null;
    }

    const result: PreMatchOdds = {
      fixtureId,
      homeTeam: fixture.teams.home.name,
      awayTeam: fixture.teams.away.name,
      league: fixture.league.name,
      kickoffTime: new Date(fixture.fixture.timestamp * 1000),
      odds: {
        homeWin: homeOdd,
        draw: drawOdd,
        awayWin: awayOdd,
        bookmaker: bookmaker.name,
      },
    };

    console.log(`   ${result.homeTeam} vs ${result.awayTeam}`);
    console.log(`   Home: ${homeOdd} | Draw: ${drawOdd} | Away: ${awayOdd}`);
    console.log(`   Bookmaker: ${bookmaker.name}\n`);

    return result;
  }

  /**
   * Calculate implied probability from odds
   * Example: Odds 2.00 → 50% probability
   */
  calculateImpliedProbability(decimalOdds: number): number {
    if (decimalOdds <= 0) return 0;
    return 1 / decimalOdds;
  }

  /**
   * Convert bookmaker odds to Polymarket-style percentage
   */
  oddsToPolymarketPrice(decimalOdds: number): number {
    const probability = this.calculateImpliedProbability(decimalOdds);
    return probability; // Already 0-1 range
  }

  /**
   * Get recommended pre-match positions based on odds
   * Compare bookmaker odds vs Polymarket prices
   */
  getPreMatchRecommendation(
    bookmakerOdds: { homeWin: number; draw: number; awayWin: number },
    polymarketPrices: { homeWin: number; draw: number; awayWin: number }
  ): {
    shouldTrade: boolean;
    recommendations: Array<{
      position: 'HOME_YES' | 'DRAW_YES' | 'AWAY_YES';
      reason: string;
      edge: number; // % edge (positive = good value)
    }>;
  } {
    const recommendations: Array<{
      position: 'HOME_YES' | 'DRAW_YES' | 'AWAY_YES';
      reason: string;
      edge: number;
    }> = [];

    // Calculate implied probabilities from bookmaker odds
    const bookmakerProbs = {
      home: this.calculateImpliedProbability(bookmakerOdds.homeWin),
      draw: this.calculateImpliedProbability(bookmakerOdds.draw),
      away: this.calculateImpliedProbability(bookmakerOdds.awayWin),
    };

    // Compare with Polymarket prices (which are already probabilities)
    const edges = {
      home: bookmakerProbs.home - polymarketPrices.homeWin,
      draw: bookmakerProbs.draw - polymarketPrices.draw,
      away: bookmakerProbs.away - polymarketPrices.awayWin,
    };

    // Threshold: 5% edge required for trade
    const MIN_EDGE = 0.05;

    if (edges.home > MIN_EDGE) {
      recommendations.push({
        position: 'HOME_YES',
        reason: `Home win undervalued on Polymarket. Bookmaker odds ${bookmakerOdds.homeWin} (${(bookmakerProbs.home * 100).toFixed(1)}%) vs Polymarket ${(polymarketPrices.homeWin * 100).toFixed(1)}%`,
        edge: edges.home * 100,
      });
    }

    if (edges.draw > MIN_EDGE) {
      recommendations.push({
        position: 'DRAW_YES',
        reason: `Draw undervalued on Polymarket. Bookmaker odds ${bookmakerOdds.draw} (${(bookmakerProbs.draw * 100).toFixed(1)}%) vs Polymarket ${(polymarketPrices.draw * 100).toFixed(1)}%`,
        edge: edges.draw * 100,
      });
    }

    if (edges.away > MIN_EDGE) {
      recommendations.push({
        position: 'AWAY_YES',
        reason: `Away win undervalued on Polymarket. Bookmaker odds ${bookmakerOdds.awayWin} (${(bookmakerProbs.away * 100).toFixed(1)}%) vs Polymarket ${(polymarketPrices.awayWin * 100).toFixed(1)}%`,
        edge: edges.away * 100,
      });
    }

    return {
      shouldTrade: recommendations.length > 0,
      recommendations,
    };
  }

  /**
   * Get request usage stats
   */
  getUsageStats(): {
    requestsToday: number;
    remainingToday: number;
    dailyLimit: number;
    resetDate: string;
  } {
    return {
      requestsToday: this.requestCount,
      remainingToday: this.dailyLimit - this.requestCount,
      dailyLimit: this.dailyLimit,
      resetDate: this.lastResetDate,
    };
  }

  /**
   * Print usage summary
   */
  printUsage(): void {
    const stats = this.getUsageStats();
    console.log(`\n📊 API-Football Usage:`);
    console.log(`   Requests today: ${stats.requestsToday}/${stats.dailyLimit}`);
    console.log(`   Remaining: ${stats.remainingToday}`);
    console.log(`   Resets: ${stats.resetDate} (daily)\n`);
  }
}

/**
 * Match these fixtures with Polymarket markets
 */
export interface MatchMapping {
  fixtureId: number;
  fixture: APIFootballFixture;
  polymarketMarkets: Array<{
    conditionId: string;
    question: string;
    yesPrice: number;
    noPrice: number;
    type: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  }>;
}
