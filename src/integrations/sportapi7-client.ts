import axios from 'axios';

/**
 * ⚡ SportAPI7 Client (via RapidAPI)
 * 
 * Real-time football data with live scores, events, and statistics
 * 
 * Company: RapidSportAPI
 * API: https://rapidapi.com/rapidsportapi/api/sportapi7
 */

export interface SportAPI7Match {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: string;
  minute: number | null;
  startTime: string;
  league: string;
  tournament: string;
}

export class SportAPI7Client {
  private apiKey: string;
  private baseURL: string = 'https://sportapi7.p.rapidapi.com/api/v1';
  private requestCount: number = 0;
  private avgResponseTime: number = 0;

  constructor() {
    this.apiKey = process.env.SPORTAPI7_API_KEY || '';
    if (!this.apiKey) {
      console.warn('⚠️  SportAPI7 API key not found in .env');
    }
  }

  /**
   * Get live matches (all sports)
   */
  async getLiveMatches(): Promise<SportAPI7Match[]> {
    const startTime = Date.now();
    
    try {
      const response = await axios.get(`${this.baseURL}/sport/football/events/live`, {
        headers: {
          'x-rapidapi-key': this.apiKey,
          'x-rapidapi-host': 'sportapi7.p.rapidapi.com'
        }
      });

      this.updateMetrics(Date.now() - startTime);

      const events = response.data.events || [];
      
      return events.map((e: any) => this.convertToMatch(e));

    } catch (error: any) {
      console.error('❌ SportAPI7 getLiveMatches error:', error.response?.data || error.message);
      return [];
    }
  }

  /**
   * Get live matches for specific tournament (e.g., Champions League)
   */
  async getLiveTournamentMatches(tournamentId: string): Promise<SportAPI7Match[]> {
    const startTime = Date.now();
    
    try {
      const response = await axios.get(`${this.baseURL}/unique-tournament/${tournamentId}/events/live`, {
        headers: {
          'x-rapidapi-key': this.apiKey,
          'x-rapidapi-host': 'sportapi7.p.rapidapi.com'
        }
      });

      this.updateMetrics(Date.now() - startTime);

      const events = response.data.events || [];
      
      return events.map((e: any) => this.convertToMatch(e));

    } catch (error: any) {
      console.error('❌ SportAPI7 getLiveTournamentMatches error:', error.response?.data || error.message);
      return [];
    }
  }

  /**
   * Get specific match by ID
   */
  async getMatch(eventId: string): Promise<SportAPI7Match | null> {
    const startTime = Date.now();
    
    try {
      const response = await axios.get(`${this.baseURL}/event/${eventId}`, {
        headers: {
          'x-rapidapi-key': this.apiKey,
          'x-rapidapi-host': 'sportapi7.p.rapidapi.com'
        }
      });

      this.updateMetrics(Date.now() - startTime);

      const event = response.data.event;
      if (!event) return null;

      return this.convertToMatch(event);

    } catch (error: any) {
      console.error('❌ SportAPI7 getMatch error:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Get today's UCL matches (Champions League tournament ID: 7)
   */
  async getTodaysUCLMatches(): Promise<SportAPI7Match[]> {
    // UEFA Champions League ID: 7
    return this.getLiveTournamentMatches('7');
  }

  /**
   * Convert SportAPI7 event to our Match format
   */
  private convertToMatch(event: any): SportAPI7Match {
    const homeScore = event.homeScore?.current || event.homeScore?.display || 0;
    const awayScore = event.awayScore?.current || event.awayScore?.display || 0;
    
    return {
      id: event.id?.toString() || '',
      homeTeam: event.homeTeam?.name || '',
      awayTeam: event.awayTeam?.name || '',
      homeScore: parseInt(homeScore) || 0,
      awayScore: parseInt(awayScore) || 0,
      status: event.status?.description || event.status?.type || 'unknown',
      minute: event.time?.currentPeriodStartTimestamp ? 
        Math.floor((Date.now() - event.time.currentPeriodStartTimestamp * 1000) / 60000) : null,
      startTime: event.startTimestamp ? new Date(event.startTimestamp * 1000).toISOString() : '',
      league: event.tournament?.category?.name || '',
      tournament: event.tournament?.name || ''
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
      `${icon} [${timestamp}] sportapi7: ${responseTime}ms ` +
      `(avg: ${Math.round(this.avgResponseTime)}ms, requests: ${this.requestCount})`
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

export default SportAPI7Client;
