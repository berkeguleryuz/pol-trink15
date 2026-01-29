import axios from 'axios';

/**
 * ⚡ SofaSport API Client
 * 
 * REAL-TIME football data with SECOND-BY-SECOND updates!
 * 
 * Features:
 * - Live scores updated every 2-3 seconds
 * - Match events (goals, cards, substitutions)
 * - Live odds from bookmakers
 * - Match statistics (possession, shots, etc.)
 * 
 * Company: SofaScore (www.sofascore.com)
 * API: RapidAPI - https://rapidapi.com/tipsters/api/sofasport
 */

export interface SofaSportMatch {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: string;
  minute: number | null;
  startTime: string;
  league: string;
}

export interface SofaSportEvent {
  time: number;
  type: string; // 'goal', 'yellow_card', 'red_card', 'substitution'
  team: 'home' | 'away';
  player?: string;
  minute: number;
}

export interface SofaSportOdds {
  provider: string;
  homeWin: number;
  draw: number;
  awayWin: number;
  updatedAt: string;
}

export class SofaSportClient {
  private apiKey: string;
  private baseURL: string = 'https://sofasport.p.rapidapi.com';
  private requestCount: number = 0;
  private avgResponseTime: number = 0;

  constructor() {
    this.apiKey = process.env.SOFASPORT_API_KEY || '';
    if (!this.apiKey) {
      console.warn('⚠️  SofaSport API key not found in .env');
    }
  }

  /**
   * Get ALL live football matches
   */
  async getAllLiveFootballMatches(): Promise<SofaSportMatch[]> {
    const startTime = Date.now();
    
    try {
      // Use the WORKING endpoint
      const response = await axios.get(`${this.baseURL}/v1/events/schedule/live`, {
        params: {
          sport_id: '1' // Football
        },
        headers: {
          'x-rapidapi-key': this.apiKey,
          'x-rapidapi-host': 'sofasport.p.rapidapi.com'
        }
      });

      this.updateMetrics(Date.now() - startTime);

      const data = response.data;
      let events = [];
      
      // Handle different response structures
      if (Array.isArray(data)) {
        events = data;
      } else if (data.data) {
        events = data.data;
      } else if (data.events) {
        events = data.events;
      }
      
      console.log(`✅ SofaSport found ${events.length} live matches`);
      
      return events.map((e: any) => this.convertToMatch(e));

    } catch (error: any) {
      console.error('❌ SofaSport getAllLiveFootballMatches error:', error.response?.data || error.message);
      return [];
    }
  }

  /**
   * Get live matches from specific tournament (Champions League = 7)
   */
  async getLiveTournamentMatches(tournamentId: string): Promise<SofaSportMatch[]> {
    const startTime = Date.now();
    
    try {
      // Try multiple endpoint patterns
      const endpoints = [
        `/v1/unique-tournament/${tournamentId}/events/live`,
        `/v1/tournaments/${tournamentId}/events/live`,
        `/v1/tournament/${tournamentId}/events/live`
      ];
      
      for (const endpoint of endpoints) {
        try {
          const response = await axios.get(`${this.baseURL}${endpoint}`, {
            headers: {
              'x-rapidapi-key': this.apiKey,
              'x-rapidapi-host': 'sofasport.p.rapidapi.com'
            }
          });

          this.updateMetrics(Date.now() - startTime);

          const events = response.data.data || response.data.events || [];
          console.log(`✅ SofaSport tournament endpoint ${endpoint} worked!`);
          
          return events.map((e: any) => this.convertToMatch(e));
        } catch (error: any) {
          if (error.response?.status === 404 || error.response?.data?.message?.includes('does not exist')) {
            continue;
          }
          throw error;
        }
      }
      
      throw new Error('All tournament endpoints failed');

    } catch (error: any) {
      console.error('❌ SofaSport getLiveTournamentMatches error:', error.response?.data || error.message);
      return [];
    }
  }

  /**
   * Get specific match by ID
   */
  async getMatch(eventId: string): Promise<SofaSportMatch | null> {
    const startTime = Date.now();
    
    try {
      // Get from live matches list
      const liveMatches = await this.getAllLiveFootballMatches();
      const match = liveMatches.find(m => m.id === eventId);
      
      if (match) {
        this.updateMetrics(Date.now() - startTime);
        return match;
      }
      
      return null;

    } catch (error: any) {
      console.error('❌ SofaSport getMatch error:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Get live events (goals, cards, etc.) for a match
   */
  async getMatchEvents(eventId: string): Promise<SofaSportEvent[]> {
    const startTime = Date.now();
    
    try {
      const response = await axios.get(`${this.baseURL}/v1/events/incidents`, {
        params: {
          event_id: eventId
        },
        headers: {
          'x-rapidapi-key': this.apiKey,
          'x-rapidapi-host': 'sofasport.p.rapidapi.com'
        }
      });

      this.updateMetrics(Date.now() - startTime);

      const incidents = response.data.data || [];
      
      return incidents.map((i: any) => ({
        time: i.time || 0,
        type: i.incidentType || 'unknown',
        team: i.isHome ? 'home' : 'away',
        player: i.player?.name,
        minute: i.time || 0
      }));

    } catch (error: any) {
      console.error('❌ SofaSport getMatchEvents error:', error.response?.data || error.message);
      return [];
    }
  }

  /**
   * Get live odds for a match
   */
  async getMatchOdds(eventId: string): Promise<SofaSportOdds[]> {
    const startTime = Date.now();
    
    try {
      const response = await axios.get(`${this.baseURL}/v1/events/odds/winning`, {
        params: {
          event_id: eventId,
          provider_id: '1', // Bet365
          odds_format: 'decimal'
        },
        headers: {
          'x-rapidapi-key': this.apiKey,
          'x-rapidapi-host': 'sofasport.p.rapidapi.com'
        }
      });

      this.updateMetrics(Date.now() - startTime);

      const oddsData = response.data.data || {};
      const choices = oddsData.choices || [];

      if (choices.length < 3) return [];

      return [{
        provider: 'Bet365',
        homeWin: parseFloat(choices[0]?.fractionalValue || '0'),
        draw: parseFloat(choices[1]?.fractionalValue || '0'),
        awayWin: parseFloat(choices[2]?.fractionalValue || '0'),
        updatedAt: new Date().toISOString()
      }];

    } catch (error: any) {
      console.error('❌ SofaSport getMatchOdds error:', error.response?.data || error.message);
      return [];
    }
  }

  /**
   * Search for today's UCL matches
   */
  async getTodaysUCLMatches(): Promise<SofaSportMatch[]> {
    // UEFA Champions League ID in SofaSport: 7
    return this.getLiveTournamentMatches('7');
  }

  /**
   * Convert SofaSport event to our Match format
   */
  private convertToMatch(event: any): SofaSportMatch {
    // Calculate minute from timestamp if available
    let minute = null;
    if (event.time?.currentPeriodStartTimestamp) {
      const now = Math.floor(Date.now() / 1000);
      const elapsedSeconds = now - event.time.currentPeriodStartTimestamp;
      minute = Math.floor(elapsedSeconds / 60);
      
      // Add extra time if in second half
      if (event.status?.description?.includes('2nd half')) {
        minute += 45;
      }
    }
    
    return {
      id: event.id?.toString() || '',
      homeTeam: event.homeTeam?.name || '',
      awayTeam: event.awayTeam?.name || '',
      homeScore: event.homeScore?.current || event.homeScore?.display || 0,
      awayScore: event.awayScore?.current || event.awayScore?.display || 0,
      status: event.status?.description || event.status?.type || 'unknown',
      minute: minute,
      startTime: event.startTimestamp ? new Date(event.startTimestamp * 1000).toISOString() : '',
      league: event.tournament?.name || ''
    };
  }

  /**
   * Update performance metrics
   */
  private updateMetrics(responseTime: number): void {
    this.requestCount++;
    this.avgResponseTime = ((this.avgResponseTime * (this.requestCount - 1)) + responseTime) / this.requestCount;
    
    const icon = responseTime < 100 ? '⚡' : responseTime < 200 ? '📊' : '🐢';
    const timestamp = new Date().toLocaleTimeString('tr-TR');
    
    console.log(
      `${icon} [${timestamp}] sofasport: ${responseTime}ms ` +
      `(avg: ${Math.round(this.avgResponseTime)}ms, total requests: ${this.requestCount})`
    );
  }

  /**
   * Get API status
   */
  getStatus(): { requests: number; avgTime: number } {
    return {
      requests: this.requestCount,
      avgTime: Math.round(this.avgResponseTime)
    };
  }
}

export default SofaSportClient;
