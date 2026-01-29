/**
 * Sports Data Aggregator
 * 
 * Çoklu spor API'lerini kullanır, en hızlı olanı seçer
 * 
 * Supported APIs:
 * 1. Football-Data.org (FREE, UCL coverage)
 * 2. API-Football (100 req/day, broader coverage)
 * 3. [Future] LiveScore WebSocket
 * 4. [Future] SportMonks
 * 5. [Future] SofaScore
 */

import { FootballDataClient, FootballDataMatch } from './football-data';
import { APIFootballClient, LiveMatch as APIFootballLiveMatch } from './api-football';

export interface UnifiedMatch {
  id: string; // Unique ID across sources
  source: 'football-data' | 'api-football' | 'livescore' | 'sportmonks';
  
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  
  league: string;
  competition: string;
  
  status: 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'POSTPONED' | 'CANCELLED';
  minute?: number; // For live matches
  
  kickoffTime: Date;
  
  // Source-specific IDs for cross-reference
  sourceIds: {
    footballData?: number;
    apiFootball?: number;
    livescore?: string;
    sportmonks?: string;
  };
}

export interface GoalEvent {
  matchId: string;
  timestamp: Date;
  minute: number;
  team: 'home' | 'away';
  scorer?: string;
  newScore: {
    home: number;
    away: number;
  };
  source: string;
  latencyMs: number; // How long after goal to detect
}

export class SportsDataAggregator {
  private footballData: FootballDataClient;
  private apiFootball: APIFootballClient;
  
  // Response time tracking
  private responseTimesMs: Map<string, number[]> = new Map();
  
  constructor() {
    this.footballData = new FootballDataClient();
    this.apiFootball = new APIFootballClient();
    
    console.log('\n🎯 Sports Data Aggregator initialized');
    console.log('   Sources: Football-Data.org, API-Football');
    console.log('   Strategy: Race for fastest response\n');
  }

  /**
   * Get today's UCL matches from ALL sources
   * Returns fastest response
   */
  async getTodaysUCLMatches(): Promise<UnifiedMatch[]> {
    console.log('\n⭐ Fetching UCL matches from MULTIPLE sources...\n');

    const startTime = Date.now();

    // Race: Who responds fastest?
    const results = await Promise.allSettled([
      this.getUCLFromFootballData(),
      this.getUCLFromAPIFootball(),
    ]);

    const successfulResults = results
      .filter((r): r is PromiseFulfilledResult<UnifiedMatch[]> => r.status === 'fulfilled')
      .map(r => r.value);

    if (successfulResults.length === 0) {
      console.log('❌ No sources responded successfully');
      return [];
    }

    // Merge and deduplicate
    const allMatches = successfulResults.flat();
    const uniqueMatches = this.deduplicateMatches(allMatches);

    const totalTime = Date.now() - startTime;
    console.log(`\n✅ Got ${uniqueMatches.length} UCL matches in ${totalTime}ms`);
    console.log(`   Sources used: ${successfulResults.length}/${results.length}\n`);

    return uniqueMatches;
  }

  /**
   * Get LIVE matches from fastest source
   */
  async getLiveMatches(): Promise<UnifiedMatch[]> {
    console.log('\n🔴 Fetching LIVE matches (racing sources)...\n');

    const startTime = Date.now();

    // Race condition: First to respond wins
    const result = await Promise.race([
      this.getLiveFromFootballData(),
      this.getLiveFromAPIFootball(),
    ]);

    const totalTime = Date.now() - startTime;
    
    console.log(`\n✅ Got ${result.matches.length} live matches from ${result.source} in ${totalTime}ms\n`);
    
    // Track response times
    this.trackResponseTime(result.source, totalTime);

    return result.matches;
  }

  /**
   * Monitor match for goals across ALL sources
   * Returns first goal event detected
   */
  async *monitorMatchForGoals(matchId: string, pollingIntervalSeconds: number = 2): AsyncGenerator<GoalEvent> {
    console.log(`\n👀 Monitoring match ${matchId} for goals...\n`);
    
    let previousScores = new Map<string, { home: number; away: number }>();

    while (true) {
      const startTime = Date.now();

      // Poll all sources in parallel
      const results = await Promise.allSettled([
        this.getMatchFromFootballData(matchId),
        this.getMatchFromAPIFootball(matchId),
      ]);

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          const match = result.value;
          const prevScore = previousScores.get(match.source);

          if (prevScore && 
              (match.homeScore !== prevScore.home || match.awayScore !== prevScore.away)) {
            
            const latencyMs = Date.now() - startTime;
            
            const goalEvent: GoalEvent = {
              matchId: match.id,
              timestamp: new Date(),
              minute: match.minute || 0,
              team: match.homeScore > prevScore.home ? 'home' : 'away',
              newScore: {
                home: match.homeScore,
                away: match.awayScore,
              },
              source: match.source,
              latencyMs,
            };

            console.log(`\n🚨 GOAL DETECTED!`);
            console.log(`   ${match.homeTeam} ${match.homeScore}-${match.awayScore} ${match.awayTeam}`);
            console.log(`   Source: ${match.source}`);
            console.log(`   Latency: ${latencyMs}ms\n`);

            yield goalEvent;
          }

          previousScores.set(match.source, {
            home: match.homeScore,
            away: match.awayScore,
          });

          // Check if match finished
          if (match.status === 'FINISHED') {
            console.log(`✅ Match ${matchId} finished\n`);
            return;
          }
        }
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollingIntervalSeconds * 1000));
    }
  }

  /**
   * Get fastest API source based on historical performance
   */
  getFastestSource(): string {
    const averages = new Map<string, number>();

    for (const [source, times] of this.responseTimesMs.entries()) {
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      averages.set(source, avg);
    }

    if (averages.size === 0) return 'football-data'; // Default

    return Array.from(averages.entries())
      .sort((a, b) => a[1] - b[1])[0][0];
  }

  /**
   * Print performance stats
   */
  printPerformanceStats(): void {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📊 API PERFORMANCE STATS`);
    console.log(`${'='.repeat(80)}\n`);

    for (const [source, times] of this.responseTimesMs.entries()) {
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const min = Math.min(...times);
      const max = Math.max(...times);

      console.log(`${source}:`);
      console.log(`   Requests: ${times.length}`);
      console.log(`   Avg: ${avg.toFixed(0)}ms`);
      console.log(`   Min: ${min}ms`);
      console.log(`   Max: ${max}ms\n`);
    }

    const fastest = this.getFastestSource();
    console.log(`🏆 Fastest source: ${fastest}\n`);
  }

  // ==================== Private Methods ====================

  private async getUCLFromFootballData(): Promise<UnifiedMatch[]> {
    const startTime = Date.now();
    
    try {
      const matches = await this.footballData.getTodaysUCLMatches();
      const unified = matches.map(m => this.convertFootballDataToUnified(m));
      
      this.trackResponseTime('football-data', Date.now() - startTime);
      
      return unified;
    } catch (error) {
      console.error('❌ Football-Data failed:', error);
      return [];
    }
  }

  private async getUCLFromAPIFootball(): Promise<UnifiedMatch[]> {
    const startTime = Date.now();
    
    try {
      const matches = await this.apiFootball.getFixturesToday(2); // UCL = 2
      const unified = matches.map(m => this.convertAPIFootballToUnified(m));
      
      this.trackResponseTime('api-football', Date.now() - startTime);
      
      return unified;
    } catch (error) {
      console.error('❌ API-Football failed:', error);
      return [];
    }
  }

  private async getLiveFromFootballData(): Promise<{ source: string; matches: UnifiedMatch[] }> {
    const matches = await this.footballData.getLiveMatches();
    return {
      source: 'football-data',
      matches: matches.map(m => this.convertFootballDataToUnified(m)),
    };
  }

  private async getLiveFromAPIFootball(): Promise<{ source: string; matches: UnifiedMatch[] }> {
    const matches = await this.apiFootball.getLiveMatches();
    return {
      source: 'api-football',
      matches: matches.map(m => this.convertAPIFootballLiveToUnified(m)),
    };
  }

  private async getMatchFromFootballData(matchId: string): Promise<UnifiedMatch | null> {
    const fdId = parseInt(matchId.split('-')[1] || matchId);
    const match = await this.footballData.getMatch(fdId);
    return match ? this.convertFootballDataToUnified(match) : null;
  }

  private async getMatchFromAPIFootball(matchId: string): Promise<UnifiedMatch | null> {
    const afId = parseInt(matchId.split('-')[2] || matchId);
    const match = await this.apiFootball.getMatch(afId);
    return match ? this.convertAPIFootballToUnified(match) : null;
  }

  private convertFootballDataToUnified(match: FootballDataMatch): UnifiedMatch {
    return {
      id: `fd-${match.id}`,
      source: 'football-data',
      homeTeam: match.homeTeam.name,
      awayTeam: match.awayTeam.name,
      homeScore: match.score.fullTime.home || 0,
      awayScore: match.score.fullTime.away || 0,
      league: match.competition.name,
      competition: match.competition.code,
      status: match.status === 'LIVE' || match.status === 'IN_PLAY' ? 'LIVE' :
              match.status === 'FINISHED' ? 'FINISHED' :
              match.status === 'SCHEDULED' ? 'SCHEDULED' : 'POSTPONED',
      kickoffTime: new Date(match.utcDate),
      sourceIds: {
        footballData: match.id,
      },
    };
  }

  private convertAPIFootballToUnified(match: any): UnifiedMatch {
    return {
      id: `af-${match.fixture.id}`,
      source: 'api-football',
      homeTeam: match.teams.home.name,
      awayTeam: match.teams.away.name,
      homeScore: match.goals.home || 0,
      awayScore: match.goals.away || 0,
      league: match.league.name,
      competition: match.league.name,
      status: ['1H', '2H', 'ET', 'HT'].includes(match.fixture.status.short) ? 'LIVE' :
              match.fixture.status.short === 'FT' ? 'FINISHED' :
              match.fixture.status.short === 'NS' ? 'SCHEDULED' : 'POSTPONED',
      minute: match.fixture.status.elapsed,
      kickoffTime: new Date(match.fixture.timestamp * 1000),
      sourceIds: {
        apiFootball: match.fixture.id,
      },
    };
  }

  private convertAPIFootballLiveToUnified(match: APIFootballLiveMatch): UnifiedMatch {
    return {
      id: `af-${match.fixtureId}`,
      source: 'api-football',
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      league: match.league,
      competition: match.league,
      status: 'LIVE',
      minute: match.minute,
      kickoffTime: new Date(match.timestamp),
      sourceIds: {
        apiFootball: match.fixtureId,
      },
    };
  }

  private deduplicateMatches(matches: UnifiedMatch[]): UnifiedMatch[] {
    const uniqueMap = new Map<string, UnifiedMatch>();

    for (const match of matches) {
      const key = `${match.homeTeam}-${match.awayTeam}-${match.kickoffTime.toISOString()}`;
      
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, match);
      } else {
        // Merge source IDs
        const existing = uniqueMap.get(key)!;
        existing.sourceIds = {
          ...existing.sourceIds,
          ...match.sourceIds,
        };
      }
    }

    return Array.from(uniqueMap.values());
  }

  private trackResponseTime(source: string, timeMs: number): void {
    if (!this.responseTimesMs.has(source)) {
      this.responseTimesMs.set(source, []);
    }
    
    const times = this.responseTimesMs.get(source)!;
    times.push(timeMs);
    
    // Calculate stats
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const emoji = timeMs < avg ? '⚡' : timeMs > avg * 1.5 ? '🐢' : '📊';
    
    // DETAILED LOG: Her request'i timestamp ile logla
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 8); // HH:MM:SS
    console.log(`${emoji} [${timestamp}] ${source}: ${timeMs}ms (avg: ${avg.toFixed(0)}ms, total requests: ${times.length})`);
    
    // Keep only last 50 measurements
    if (times.length > 50) {
      times.shift();
    }
  }
}
