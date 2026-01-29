/**
 * Sports API Integration
 * Real-time sports data for live betting
 */

import { TimezoneUtils } from '../utils/timezone';

export interface LiveMatch {
  id: string;
  sport: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: 'LIVE' | 'HALFTIME' | 'FINISHED' | 'SCHEDULED';
  minute: number;
  events: MatchEvent[];
  odds?: MatchOdds;
}

export interface MatchEvent {
  type: 'GOAL' | 'RED_CARD' | 'YELLOW_CARD' | 'PENALTY' | 'SUBSTITUTION';
  team: 'HOME' | 'AWAY';
  player?: string;
  minute: number;
  timestamp: string;
}

export interface MatchOdds {
  homeWin: number;
  draw: number;
  awayWin: number;
  overUnder25: {
    over: number;
    under: number;
  };
  btts: { // Both Teams To Score
    yes: number;
    no: number;
  };
}

export interface SportsTradingSignal {
  matchId: string;
  match: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  reason: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  suggestedMarket: string;
  timestamp: string;
}

/**
 * Sports data provider
 * NOTE: For MVP, we'll use free endpoints. Production needs paid APIs:
 * - API-Football: $30/month (comprehensive football data)
 * - The Odds API: Free tier then $50/month
 * - SportMonks: $12/month starter
 */
export class SportsAPI {
  private readonly baseUrl = 'https://api-football-v1.p.rapidapi.com/v3';
  private readonly oddsBaseUrl = 'https://api.the-odds-api.com/v4';
  private apiKey: string | undefined;
  private oddsApiKey: string | undefined;

  constructor() {
    this.apiKey = process.env.SPORTS_API_KEY;
    this.oddsApiKey = process.env.ODDS_API_KEY;
    
    if (!this.apiKey) {
      TimezoneUtils.log('⚠️  SPORTS_API_KEY not found - using demo mode', 'WARN');
    }
  }

  /**
   * Get live matches
   */
  async getLiveMatches(sport: string = 'football'): Promise<LiveMatch[]> {
    try {
      // For demo/testing without API key
      if (!this.apiKey) {
        return this.getMockLiveMatches();
      }

      const response = await fetch(`${this.baseUrl}/fixtures?live=all`, {
        headers: {
          'X-RapidAPI-Key': this.apiKey,
          'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com',
        },
      });

      if (!response.ok) {
        throw new Error(`Sports API error: ${response.statusText}`);
      }

      const data: any = await response.json();
      return this.parseLiveMatches(data);

    } catch (error: any) {
      TimezoneUtils.log(`Failed to fetch live matches: ${error.message}`, 'ERROR');
      return [];
    }
  }

  /**
   * Get match details by ID
   */
  async getMatchDetails(matchId: string): Promise<LiveMatch | null> {
    try {
      if (!this.apiKey) {
        const mockMatches = this.getMockLiveMatches();
        return mockMatches.find(m => m.id === matchId) || null;
      }

      const response = await fetch(`${this.baseUrl}/fixtures?id=${matchId}`, {
        headers: {
          'X-RapidAPI-Key': this.apiKey,
          'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com',
        },
      });

      if (!response.ok) {
        return null;
      }

      const data: any = await response.json();
      const matches = this.parseLiveMatches(data);
      return matches[0] || null;

    } catch (error: any) {
      TimezoneUtils.log(`Failed to fetch match details: ${error.message}`, 'ERROR');
      return null;
    }
  }

  /**
   * Get match odds
   */
  async getMatchOdds(sport: string = 'soccer_epl'): Promise<any[]> {
    try {
      if (!this.oddsApiKey) {
        TimezoneUtils.log('No odds API key, returning mock data', 'WARN');
        return [];
      }

      const response = await fetch(
        `${this.oddsBaseUrl}/sports/${sport}/odds/?regions=us&markets=h2h,totals,spreads&apiKey=${this.oddsApiKey}`
      );

      if (!response.ok) {
        throw new Error(`Odds API error: ${response.statusText}`);
      }

      return (await response.json()) as any[];

    } catch (error: any) {
      TimezoneUtils.log(`Failed to fetch odds: ${error.message}`, 'ERROR');
      return [];
    }
  }

  /**
   * Detect trading signals from match events
   */
  detectTradingSignals(match: LiveMatch, previousState?: LiveMatch): SportsTradingSignal[] {
    const signals: SportsTradingSignal[] = [];

    if (!previousState) {
      return signals;
    }

    // Goal scored detection
    if (match.events.length > previousState.events.length) {
      const newEvents = match.events.slice(previousState.events.length);
      
      for (const event of newEvents) {
        if (event.type === 'GOAL') {
          const scoringTeam = event.team === 'HOME' ? match.homeTeam : match.awayTeam;
          
          signals.push({
            matchId: match.id,
            match: `${match.homeTeam} vs ${match.awayTeam}`,
            signal: 'BUY',
            reason: `GOAL! ${scoringTeam} scored at ${event.minute}'. Team likely to win.`,
            confidence: this.assessGoalConfidence(match, event),
            suggestedMarket: `Will ${scoringTeam} win?`,
            timestamp: TimezoneUtils.getBerlinTimestamp(),
          });

          // Over 2.5 goals signal
          const totalGoals = match.homeScore + match.awayScore;
          if (totalGoals >= 2 && match.minute < 80) {
            signals.push({
              matchId: match.id,
              match: `${match.homeTeam} vs ${match.awayTeam}`,
              signal: 'BUY',
              reason: `${totalGoals} goals already! Over 2.5 goals likely.`,
              confidence: totalGoals >= 3 ? 'HIGH' : 'MEDIUM',
              suggestedMarket: 'Over 2.5 goals',
              timestamp: TimezoneUtils.getBerlinTimestamp(),
            });
          }
        }

        // Red card detection
        if (event.type === 'RED_CARD') {
          const oppositeTeam = event.team === 'HOME' ? match.awayTeam : match.homeTeam;
          
          signals.push({
            matchId: match.id,
            match: `${match.homeTeam} vs ${match.awayTeam}`,
            signal: 'BUY',
            reason: `RED CARD! ${oppositeTeam} now has advantage (man up).`,
            confidence: 'HIGH',
            suggestedMarket: `Will ${oppositeTeam} win?`,
            timestamp: TimezoneUtils.getBerlinTimestamp(),
          });
        }
      }
    }

    // Late game lead signals
    if (match.minute >= 75) {
      const scoreDiff = Math.abs(match.homeScore - match.awayScore);
      if (scoreDiff >= 2) {
        const leadingTeam = match.homeScore > match.awayScore ? match.homeTeam : match.awayTeam;
        
        signals.push({
          matchId: match.id,
          match: `${match.homeTeam} vs ${match.awayTeam}`,
          signal: 'BUY',
          reason: `${leadingTeam} leading by ${scoreDiff} goals at ${match.minute}'. Very likely to win.`,
          confidence: 'HIGH',
          suggestedMarket: `Will ${leadingTeam} win?`,
          timestamp: TimezoneUtils.getBerlinTimestamp(),
        });
      }
    }

    return signals;
  }

  /**
   * Assess confidence of goal-based trading signal
   */
  private assessGoalConfidence(match: LiveMatch, goalEvent: MatchEvent): 'HIGH' | 'MEDIUM' | 'LOW' {
    const minute = goalEvent.minute;
    const scoreDiff = Math.abs(match.homeScore - match.awayScore);

    // Late goal with 2+ goal lead = HIGH confidence
    if (minute >= 75 && scoreDiff >= 2) {
      return 'HIGH';
    }

    // Mid-game with 1+ goal lead = MEDIUM confidence
    if (minute >= 60 && scoreDiff >= 1) {
      return 'MEDIUM';
    }

    // Early goal or tied game = LOW confidence
    return 'LOW';
  }

  /**
   * Parse live matches from API response
   */
  private parseLiveMatches(data: any): LiveMatch[] {
    const matches: LiveMatch[] = [];

    if (!data.response || !Array.isArray(data.response)) {
      return matches;
    }

    for (const item of data.response) {
      const fixture = item.fixture;
      const teams = item.teams;
      const goals = item.goals;
      const events = item.events || [];

      matches.push({
        id: fixture.id.toString(),
        sport: 'football',
        league: item.league?.name || 'Unknown',
        homeTeam: teams.home.name,
        awayTeam: teams.away.name,
        homeScore: goals.home || 0,
        awayScore: goals.away || 0,
        status: this.mapStatus(fixture.status.short),
        minute: fixture.status.elapsed || 0,
        events: this.parseEvents(events, teams),
      });
    }

    return matches;
  }

  /**
   * Parse match events
   */
  private parseEvents(events: any[], teams: any): MatchEvent[] {
    const matchEvents: MatchEvent[] = [];

    for (const event of events) {
      const eventType = this.mapEventType(event.type);
      if (!eventType) continue;

      matchEvents.push({
        type: eventType,
        team: event.team.id === teams.home.id ? 'HOME' : 'AWAY',
        player: event.player?.name,
        minute: event.time.elapsed,
        timestamp: new Date().toISOString(),
      });
    }

    return matchEvents;
  }

  /**
   * Map API status to our status
   */
  private mapStatus(status: string): LiveMatch['status'] {
    switch (status) {
      case '1H':
      case '2H':
        return 'LIVE';
      case 'HT':
        return 'HALFTIME';
      case 'FT':
        return 'FINISHED';
      default:
        return 'SCHEDULED';
    }
  }

  /**
   * Map API event type to our event type
   */
  private mapEventType(type: string): MatchEvent['type'] | null {
    switch (type.toLowerCase()) {
      case 'goal':
      case 'normal goal':
        return 'GOAL';
      case 'card':
      case 'red card':
        return 'RED_CARD';
      case 'yellow card':
        return 'YELLOW_CARD';
      case 'subst':
        return 'SUBSTITUTION';
      default:
        return null;
    }
  }

  /**
   * Get mock live matches for testing
   */
  private getMockLiveMatches(): LiveMatch[] {
    return [
      {
        id: 'mock_1',
        sport: 'football',
        league: 'Premier League',
        homeTeam: 'Arsenal',
        awayTeam: 'Chelsea',
        homeScore: 2,
        awayScore: 1,
        status: 'LIVE',
        minute: 67,
        events: [
          {
            type: 'GOAL',
            team: 'HOME',
            player: 'Saka',
            minute: 23,
            timestamp: new Date().toISOString(),
          },
          {
            type: 'GOAL',
            team: 'AWAY',
            player: 'Jackson',
            minute: 45,
            timestamp: new Date().toISOString(),
          },
          {
            type: 'GOAL',
            team: 'HOME',
            player: 'Martinelli',
            minute: 62,
            timestamp: new Date().toISOString(),
          },
        ],
      },
      {
        id: 'mock_2',
        sport: 'football',
        league: 'La Liga',
        homeTeam: 'Barcelona',
        awayTeam: 'Real Madrid',
        homeScore: 0,
        awayScore: 0,
        status: 'LIVE',
        minute: 34,
        events: [],
      },
    ];
  }

  /**
   * Log trading signal
   */
  logSignal(signal: SportsTradingSignal): void {
    const emoji = signal.signal === 'BUY' ? '🟢' : signal.signal === 'SELL' ? '🔴' : '🟡';
    const confEmoji = signal.confidence === 'HIGH' ? '⭐⭐⭐' : signal.confidence === 'MEDIUM' ? '⭐⭐' : '⭐';
    
    TimezoneUtils.log(`${emoji} ${signal.signal} SIGNAL ${confEmoji}`, 'INFO');
    console.log(`   Match: ${signal.match}`);
    console.log(`   Market: ${signal.suggestedMarket}`);
    console.log(`   Reason: ${signal.reason}`);
    console.log(`   Confidence: ${signal.confidence}\n`);
  }
}
