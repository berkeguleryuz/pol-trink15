/**
 * Football-Data.org API Client
 * https://www.football-data.org/
 * 
 * FREE Tier: 10 requests/minute
 * Coverage: UCL, EPL, La Liga, Bundesliga, Serie A, Ligue 1, etc.
 * 
 *장점:
 * - FREE!
 * - UCL coverage ✅
 * - Fast response (~300ms)
 * - Live scores + events
 * 
 * 단점:
 * - No WebSocket (REST only)
 * - 10 req/min limit
 */

import axios from 'axios';

const FOOTBALL_DATA_API_URL = 'https://api.football-data.org/v4';
const FOOTBALL_DATA_KEY = process.env.FOOTBALL_DATA_KEY || '';

/**
 * Competition IDs (from Football-Data.org API)
 */
export const FOOTBALL_DATA_COMPETITIONS = {
  UCL: 2001,    // UEFA Champions League (CL)
  EPL: 2021,    // Premier League (PL)
  LA_LIGA: 2014, // Primera Division (PD)
  BUNDESLIGA: 2002, // Bundesliga (BL1)
  SERIE_A: 2019, // Serie A (SA)
  LIGUE_1: 2015, // Ligue 1 (FL1)
  EREDIVISIE: 2003, // Eredivisie (DED)
  PRIMEIRA_LIGA: 2017, // Primeira Liga (PPL)
  CHAMPIONSHIP: 2016, // Championship (ELC)
  WORLD_CUP: 2000, // FIFA World Cup (WC)
};

export interface FootballDataMatch {
  id: number;
  utcDate: string;
  status: 'SCHEDULED' | 'LIVE' | 'IN_PLAY' | 'PAUSED' | 'FINISHED' | 'POSTPONED' | 'CANCELLED';
  matchday: number;
  stage: string;
  homeTeam: {
    id: number;
    name: string;
    shortName: string;
    tla: string; // 3-letter abbreviation
  };
  awayTeam: {
    id: number;
    name: string;
    shortName: string;
    tla: string;
  };
  score: {
    winner: 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW' | null;
    duration: 'REGULAR' | 'EXTRA_TIME' | 'PENALTY_SHOOTOUT';
    fullTime: {
      home: number | null;
      away: number | null;
    };
    halfTime: {
      home: number | null;
      away: number | null;
    };
  };
  competition: {
    id: number;
    name: string;
    code: string;
    type: string;
  };
}

export interface FootballDataGoalEvent {
  minute: number;
  team: 'HOME_TEAM' | 'AWAY_TEAM';
  player: string;
  type: 'GOAL' | 'PENALTY' | 'OWN_GOAL';
  score: {
    home: number;
    away: number;
  };
}

export class FootballDataClient {
  private apiKey: string;
  private baseUrl: string;
  private requestCount: number = 0;
  private requestWindow: number = 60000; // 1 minute
  private maxRequests: number = 10; // 10 req/min
  private requestTimestamps: number[] = [];

  constructor() {
    this.apiKey = process.env.FOOTBALL_DATA_KEY || '';
    this.baseUrl = FOOTBALL_DATA_API_URL;

    if (!this.apiKey) {
      console.warn('⚠️  Football-Data.org API key not found in .env');
      console.warn('   Get your FREE key: https://www.football-data.org/client/register');
    } else {
      console.log(`✅ Football-Data.org key loaded: ${this.apiKey.substring(0, 8)}...`);
    }
  }

  /**
   * Rate limiting check
   */
  private canMakeRequest(): boolean {
    const now = Date.now();
    
    // Remove timestamps older than 1 minute
    this.requestTimestamps = this.requestTimestamps.filter(
      ts => now - ts < this.requestWindow
    );

    return this.requestTimestamps.length < this.maxRequests;
  }

  /**
   * Make API request with rate limiting
   */
  private async makeRequest<T>(endpoint: string, params: Record<string, any> = {}): Promise<T | null> {
    if (!this.canMakeRequest()) {
      console.warn(`⚠️  Rate limit reached (10 req/min). Waiting...`);
      
      // Wait until oldest request expires
      const oldestRequest = this.requestTimestamps[0];
      const waitTime = this.requestWindow - (Date.now() - oldestRequest);
      
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime + 100));
      }
    }

    try {
      const response = await axios.get(`${this.baseUrl}${endpoint}`, {
        params,
        headers: {
          'X-Auth-Token': this.apiKey,
        },
        timeout: 10000,
      });

      this.requestTimestamps.push(Date.now());
      this.requestCount++;

      console.log(`📡 Football-Data request ${this.requestCount}: ${endpoint}`);

      return response.data;
    } catch (error: any) {
      if (error.response?.status === 429) {
        console.error('❌ Rate limit exceeded');
      } else {
        console.error(`❌ Football-Data API error: ${error.message}`);
      }
      return null;
    }
  }

  /**
   * Get today's matches for a competition
   */
  async getTodaysMatches(competitionId: number): Promise<FootballDataMatch[]> {
    const today = new Date().toISOString().split('T')[0];
    
    const response = await this.makeRequest<{ matches: FootballDataMatch[] }>(
      `/competitions/${competitionId}/matches`,
      {
        dateFrom: today,
        dateTo: today,
      }
    );

    return response?.matches || [];
  }

  /**
   * Get LIVE matches across all competitions
   */
  async getLiveMatches(): Promise<FootballDataMatch[]> {
    console.log('\n⚽ Fetching LIVE matches from Football-Data.org...\n');

    const allMatches: FootballDataMatch[] = [];

    // Scan major competitions
    const competitions = [
      FOOTBALL_DATA_COMPETITIONS.UCL,
      FOOTBALL_DATA_COMPETITIONS.EPL,
      FOOTBALL_DATA_COMPETITIONS.LA_LIGA,
      FOOTBALL_DATA_COMPETITIONS.BUNDESLIGA,
      FOOTBALL_DATA_COMPETITIONS.SERIE_A,
      FOOTBALL_DATA_COMPETITIONS.LIGUE_1,
    ];

    for (const compId of competitions) {
      const matches = await this.getTodaysMatches(compId);
      
      const liveMatches = matches.filter(m => 
        m.status === 'LIVE' || m.status === 'IN_PLAY' || m.status === 'PAUSED'
      );

      if (liveMatches.length > 0) {
        console.log(`   ✅ ${liveMatches[0].competition.name}: ${liveMatches.length} live`);
        allMatches.push(...liveMatches);
      }
    }

    console.log(`\n📊 Total: ${allMatches.length} live matches\n`);

    return allMatches;
  }

  /**
   * Get specific match by ID
   */
  async getMatch(matchId: number): Promise<FootballDataMatch | null> {
    const response = await this.makeRequest<{ match: FootballDataMatch }>(
      `/matches/${matchId}`
    );

    return response?.match || null;
  }

  /**
   * Get today's UCL matches
   */
  async getTodaysUCLMatches(): Promise<FootballDataMatch[]> {
    console.log('\n⭐ Fetching today\'s UCL matches...\n');
    
    const matches = await this.getTodaysMatches(FOOTBALL_DATA_COMPETITIONS.UCL);
    
    console.log(`   Found ${matches.length} UCL matches today\n`);

    matches.forEach(match => {
      const kickoff = new Date(match.utcDate);
      const status = match.status === 'LIVE' || match.status === 'IN_PLAY' ? '🔴 LIVE' : 
                     match.status === 'FINISHED' ? '✅ FT' : '⏰ Scheduled';
      
      console.log(`${status} ${match.homeTeam.name} vs ${match.awayTeam.name}`);
      
      if (match.score.fullTime.home !== null) {
        console.log(`   Score: ${match.score.fullTime.home}-${match.score.fullTime.away}`);
      }
      
      console.log(`   Kickoff: ${kickoff.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}`);
      console.log(`   Match ID: ${match.id}`);
      console.log();
    });

    return matches;
  }

  /**
   * Monitor match for goals (polling every 3 seconds)
   */
  async *monitorMatch(matchId: number, intervalSeconds: number = 3): AsyncGenerator<FootballDataMatch> {
    let previousScore = { home: -1, away: -1 };

    while (true) {
      const match = await this.getMatch(matchId);
      
      if (!match) {
        console.warn(`⚠️  Match ${matchId} not found`);
        break;
      }

      // Check if match finished
      if (match.status === 'FINISHED') {
        console.log(`✅ Match ${matchId} finished`);
        yield match;
        break;
      }

      // Check for goal
      const currentScore = {
        home: match.score.fullTime.home || 0,
        away: match.score.fullTime.away || 0,
      };

      if (previousScore.home !== -1 && 
          (currentScore.home !== previousScore.home || currentScore.away !== previousScore.away)) {
        console.log(`\n🚨 GOAL! ${match.homeTeam.name} ${currentScore.home}-${currentScore.away} ${match.awayTeam.name}\n`);
        yield match;
      }

      previousScore = currentScore;

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
    }
  }

  /**
   * Print match details
   */
  printMatch(match: FootballDataMatch): void {
    const kickoff = new Date(match.utcDate);
    const status = match.status === 'LIVE' || match.status === 'IN_PLAY' ? '🔴 LIVE' : 
                   match.status === 'FINISHED' ? '✅ FT' : '⏰ Scheduled';

    console.log(`\n${status} ${match.homeTeam.name} vs ${match.awayTeam.name}`);
    console.log(`   Competition: ${match.competition.name}`);
    
    if (match.score.fullTime.home !== null) {
      console.log(`   Score: ${match.score.fullTime.home}-${match.score.fullTime.away}`);
      
      if (match.score.halfTime.home !== null) {
        console.log(`   HT: ${match.score.halfTime.home}-${match.score.halfTime.away}`);
      }
    }
    
    console.log(`   Kickoff: ${kickoff.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}`);
    console.log(`   Match ID: ${match.id}`);
    console.log();
  }
}
