import { SportAPI7Client, SportAPI7Match } from './sportapi7-client';
import axios from 'axios';

/**
 * 🚀 Unified Real-Time Sports Data Aggregator
 * 
 * Combines multiple APIs for fastest, most accurate live scores:
 * - SportAPI7 (PRIMARY): Real-time updates, ~200ms response
 * - Football-Data.org (FALLBACK): Free but 30-60s delay
 * 
 * Auto-selects fastest available source
 */

export interface UnifiedMatch {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: string;
  minute: number | null;
  startTime: string;
  league: string;
  source: 'sportapi7' | 'football-data';
  responseTime: number;
}

export class RealtimeSportsAggregator {
  private sportapi7: SportAPI7Client;
  private footballDataKey: string;
  
  constructor() {
    this.sportapi7 = new SportAPI7Client();
    this.footballDataKey = process.env.FOOTBALL_DATA_KEY || '';
  }

  /**
   * Get ALL live football matches from fastest available source
   */
  async getAllLiveMatches(): Promise<UnifiedMatch[]> {
    const startTime = Date.now();
    
    try {
      // Try SportAPI7 first (fastest, real-time)
      console.log('📡 Fetching live matches from SportAPI7...');
      const matches = await this.sportapi7.getLiveMatches();
      
      if (matches.length > 0) {
        const responseTime = Date.now() - startTime;
        console.log(`✅ SportAPI7: ${matches.length} matches in ${responseTime}ms`);
        
        return matches.map(m => ({
          ...m,
          source: 'sportapi7' as const,
          responseTime
        }));
      }
      
      // Fallback to Football-Data if SportAPI7 fails
      console.log('⚠️  SportAPI7 returned no matches, trying Football-Data...');
      return await this.getFootballDataMatches();
      
    } catch (error: any) {
      console.error('❌ SportAPI7 error:', error.message);
      console.log('🔄 Falling back to Football-Data.org...');
      return await this.getFootballDataMatches();
    }
  }

  /**
   * Get live matches from Football-Data.org (fallback)
   */
  private async getFootballDataMatches(): Promise<UnifiedMatch[]> {
    const startTime = Date.now();
    
    try {
      const response = await axios.get('https://api.football-data.org/v4/matches', {
        params: {
          status: 'LIVE'
        },
        headers: {
          'X-Auth-Token': this.footballDataKey
        }
      });

      const responseTime = Date.now() - startTime;
      const matches = response.data.matches || [];
      
      console.log(`✅ Football-Data: ${matches.length} matches in ${responseTime}ms (⚠️  30-60s delay)`);
      
      return matches.map((m: any) => ({
        id: m.id?.toString() || '',
        homeTeam: m.homeTeam?.name || '',
        awayTeam: m.awayTeam?.name || '',
        homeScore: m.score?.fullTime?.home || m.score?.halfTime?.home || 0,
        awayScore: m.score?.fullTime?.away || m.score?.halfTime?.away || 0,
        status: m.status || 'UNKNOWN',
        minute: m.minute || null,
        startTime: m.utcDate || '',
        league: m.competition?.name || '',
        source: 'football-data' as const,
        responseTime
      }));
      
    } catch (error: any) {
      console.error('❌ Football-Data error:', error.message);
      return [];
    }
  }

  /**
   * Get specific match by ID (auto-detect source)
   */
  async getMatch(matchId: string, source?: 'sportapi7' | 'football-data'): Promise<UnifiedMatch | null> {
    const startTime = Date.now();
    
    // If source specified, use that
    if (source === 'sportapi7') {
      const match = await this.sportapi7.getMatch(matchId);
      if (match) {
        return {
          ...match,
          source: 'sportapi7',
          responseTime: Date.now() - startTime
        };
      }
    }
    
    if (source === 'football-data') {
      return await this.getFootballDataMatch(matchId);
    }
    
    // Auto-detect: try SportAPI7 first
    try {
      const match = await this.sportapi7.getMatch(matchId);
      if (match) {
        return {
          ...match,
          source: 'sportapi7',
          responseTime: Date.now() - startTime
        };
      }
    } catch (error) {
      // Continue to fallback
    }
    
    // Fallback to Football-Data
    return await this.getFootballDataMatch(matchId);
  }

  /**
   * Get specific match from Football-Data
   */
  private async getFootballDataMatch(matchId: string): Promise<UnifiedMatch | null> {
    const startTime = Date.now();
    
    try {
      const response = await axios.get(`https://api.football-data.org/v4/matches/${matchId}`, {
        headers: {
          'X-Auth-Token': this.footballDataKey
        }
      });

      const m = response.data;
      const responseTime = Date.now() - startTime;
      
      return {
        id: m.id?.toString() || '',
        homeTeam: m.homeTeam?.name || '',
        awayTeam: m.awayTeam?.name || '',
        homeScore: m.score?.fullTime?.home || m.score?.halfTime?.home || 0,
        awayScore: m.score?.fullTime?.away || m.score?.halfTime?.away || 0,
        status: m.status || 'UNKNOWN',
        minute: m.minute || null,
        startTime: m.utcDate || '',
        league: m.competition?.name || '',
        source: 'football-data',
        responseTime
      };
      
    } catch (error: any) {
      console.error('❌ Football-Data getMatch error:', error.message);
      return null;
    }
  }

  /**
   * Get performance statistics
   */
  getStats() {
    return {
      sportapi7: this.sportapi7.getStatus()
    };
  }
}

export default RealtimeSportsAggregator;
