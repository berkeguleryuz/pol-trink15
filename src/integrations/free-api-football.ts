import axios from 'axios';

/**
 * 🆓 Free API Live Football Data Client (via RapidAPI)
 * 
 * Real-time football data - FREE tier available
 * 
 * Company: Creativesdev
 * API: https://rapidapi.com/Creativesdev/api/free-api-live-football-data
 */

export interface FreeAPIMatch {
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

export class FreeAPILiveFootballClient {
  private apiKey: string;
  private baseURL: string = 'https://free-api-live-football-data.p.rapidapi.com';
  private requestCount: number = 0;
  private avgResponseTime: number = 0;

  constructor() {
    this.apiKey = process.env.FREE_API_FOOTBALL_KEY || process.env.SPORTAPI7_API_KEY || '';
    if (!this.apiKey) {
      console.warn('⚠️  Free API Football key not found in .env');
    }
  }

  /**
   * Get live matches
   */
  async getLiveMatches(): Promise<FreeAPIMatch[]> {
    const startTime = Date.now();
    
    try {
      // Use the WORKING endpoint
      const response = await axios.get(`${this.baseURL}/football-current-live`, {
        headers: {
          'x-rapidapi-key': this.apiKey,
          'x-rapidapi-host': 'free-api-live-football-data.p.rapidapi.com'
        }
      });

      this.updateMetrics(Date.now() - startTime);

      const data = response.data;
      
      // FreeAPI format: {status: "success", response: {live: []}}
      let matches = [];
      
      if (data.response && data.response.live && Array.isArray(data.response.live)) {
        matches = data.response.live;
      } else if (Array.isArray(data)) {
        matches = data;
      } else if (data.matches && Array.isArray(data.matches)) {
        matches = data.matches;
      } else if (data.data && Array.isArray(data.data)) {
        matches = data.data;
      } else {
        console.log('⚠️  FreeAPI: No live matches found');
        return [];
      }
      
      return matches.map((m: any) => this.convertToMatch(m));

    } catch (error: any) {
      console.error('❌ FreeAPI getLiveMatches error:', error.response?.data || error.message);
      return [];
    }
  }

  /**
   * Get specific match by ID
   */
  async getMatch(matchId: string): Promise<FreeAPIMatch | null> {
    const startTime = Date.now();
    
    try {
      // Try to get from live matches first
      const liveMatches = await this.getLiveMatches();
      const match = liveMatches.find(m => m.id === matchId);
      
      if (match) {
        this.updateMetrics(Date.now() - startTime);
        return match;
      }
      
      return null;

    } catch (error: any) {
      console.error('❌ FreeAPI getMatch error:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Convert API match to our format
   */
  private convertToMatch(match: any): FreeAPIMatch {
    return {
      id: match.id?.toString() || match.match_id?.toString() || '',
      homeTeam: match.home_team?.name || match.homeTeam || match.home || '',
      awayTeam: match.away_team?.name || match.awayTeam || match.away || '',
      homeScore: parseInt(match.home_score || match.homeScore || match.score?.home || '0') || 0,
      awayScore: parseInt(match.away_score || match.awayScore || match.score?.away || '0') || 0,
      status: match.status || match.match_status || 'unknown',
      minute: match.minute || match.match_time || null,
      startTime: match.start_time || match.startTime || match.date || '',
      league: match.league?.name || match.competition?.name || match.league || ''
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
      `${icon} [${timestamp}] free-api: ${responseTime}ms ` +
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

export default FreeAPILiveFootballClient;
