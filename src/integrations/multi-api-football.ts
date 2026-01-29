import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 🔥 MULTI-SOURCE FOOTBALL API AGGREGATOR
 * 
 * Tests 7 different football APIs simultaneously:
 * 1. Football-Data.org (current)
 * 2. API-Football (current)
 * 3. LiveScore API
 * 4. The Odds API
 * 5. Sportmonks
 * 6. SofaScore API
 * 7. API-Sports (alternative)
 * 
 * Logs all responses to compare speed & accuracy
 */

interface APIResponse {
  api: string;
  responseTime: number;
  score: { home: number; away: number };
  status: string;
  minute: number | null;
  timestamp: string;
  error?: string;
}

interface MatchComparison {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  responses: APIResponse[];
  fastest: string;
  mostRecentScore: { home: number; away: number };
  consensusScore: { home: number; away: number };
}

export class MultiAPIFootball {
  private logDir: string;
  private currentLogFile: string;

  constructor() {
    this.logDir = path.join(process.cwd(), 'logs', 'api-comparison');
    this.currentLogFile = path.join(
      this.logDir,
      `api_comparison_${new Date().toISOString().split('T')[0]}.jsonl`
    );
    
    // Create log directory
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Fetch Manchester City vs Dortmund from ALL APIs
   */
  async compareManCityMatch(): Promise<MatchComparison> {
    console.log('\n🔥 TESTING 7 FOOTBALL APIs - Man City vs Dortmund\n');

    const apis = [
      this.fetchFootballData(),
      this.fetchAPIFootball(),
      this.fetchLiveScore(),
      this.fetchTheOddsAPI(),
      this.fetchSportmonks(),
      this.fetchSofaScore(),
      this.fetchAPISports()
    ];

    const results = await Promise.allSettled(apis);
    
    const responses: APIResponse[] = results.map((result, i) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          api: ['Football-Data', 'API-Football', 'LiveScore', 'TheOdds', 'Sportmonks', 'SofaScore', 'API-Sports'][i],
          responseTime: -1,
          score: { home: 0, away: 0 },
          status: 'ERROR',
          minute: null,
          timestamp: new Date().toISOString(),
          error: result.reason?.message || 'Unknown error'
        };
      }
    });

    // Find fastest & most accurate
    const validResponses = responses.filter(r => r.responseTime > 0);
    const fastest = validResponses.reduce((prev, curr) => 
      curr.responseTime < prev.responseTime ? curr : prev
    , validResponses[0]);

    // Consensus score (most common)
    const scoreMap = new Map<string, number>();
    validResponses.forEach(r => {
      const key = `${r.score.home}-${r.score.away}`;
      scoreMap.set(key, (scoreMap.get(key) || 0) + 1);
    });
    
    let consensusKey = '0-0';
    let maxCount = 0;
    scoreMap.forEach((count, key) => {
      if (count > maxCount) {
        maxCount = count;
        consensusKey = key;
      }
    });
    
    const [consensusHome, consensusAway] = consensusKey.split('-').map(Number);

    const comparison: MatchComparison = {
      matchId: 'man-city-vs-dortmund-nov5',
      homeTeam: 'Manchester City',
      awayTeam: 'Borussia Dortmund',
      responses,
      fastest: fastest?.api || 'None',
      mostRecentScore: fastest?.score || { home: 0, away: 0 },
      consensusScore: { home: consensusHome, away: consensusAway }
    };

    // Log to file
    this.logComparison(comparison);

    // Print results
    this.printResults(comparison);

    return comparison;
  }

  /**
   * 1. Football-Data.org (existing)
   */
  private async fetchFootballData(): Promise<APIResponse> {
    const startTime = Date.now();
    
    const response = await axios.get(
      'https://api.football-data.org/v4/matches/551939',
      {
        headers: {
          'X-Auth-Token': process.env.FOOTBALL_DATA_KEY || ''
        }
      }
    );

    const data = response.data;
    const responseTime = Date.now() - startTime;

    return {
      api: 'Football-Data.org',
      responseTime,
      score: {
        home: data.score?.fullTime?.home || 0,
        away: data.score?.fullTime?.away || 0
      },
      status: data.status,
      minute: data.minute,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * 2. API-Football (existing)
   */
  private async fetchAPIFootball(): Promise<APIResponse> {
    const startTime = Date.now();
    
    // Get today's UCL matches
    const response = await axios.get(
      'https://v3.football.api-sports.io/fixtures',
      {
        params: {
          date: new Date().toISOString().split('T')[0],
          league: 2 // UCL
        },
        headers: {
          'x-rapidapi-key': process.env.API_FOOTBALL_KEY || ''
        }
      }
    );

    const responseTime = Date.now() - startTime;

    // Find Man City match
    const match = response.data.response.find((m: any) => 
      m.teams.home.name.includes('Manchester City')
    );

    if (!match) {
      throw new Error('Match not found in API-Football');
    }

    return {
      api: 'API-Football',
      responseTime,
      score: {
        home: match.goals.home || 0,
        away: match.goals.away || 0
      },
      status: match.fixture.status.long,
      minute: match.fixture.status.elapsed,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * 3. LiveScore API (RapidAPI - livescore6)
   */
  private async fetchLiveScore(): Promise<APIResponse> {
    const startTime = Date.now();
    
    try {
      // Get live matches from livescore6 API
      const response = await axios.get(
        'https://livescore6.p.rapidapi.com/matches/v2/list-live',
        {
          params: {
            Category: 'soccer',
            Timezone: '0'
          },
          headers: {
            'x-rapidapi-key': process.env.LIVESCORE_API_KEY || '',
            'x-rapidapi-host': 'livescore6.p.rapidapi.com'
          }
        }
      );

      const responseTime = Date.now() - startTime;

      // Search for Man City match in all stages
      let foundMatch = null;
      const stages = response.data.Stages || [];

      for (const stage of stages) {
        const events = stage.Events || [];
        for (const event of events) {
          const team1 = event.T1?.[0]?.Nm || '';
          const team2 = event.T2?.[0]?.Nm || '';
          
          if (team1.toLowerCase().includes('manchester city') || 
              team1.toLowerCase().includes('man city') ||
              team2.toLowerCase().includes('manchester city') ||
              team2.toLowerCase().includes('man city')) {
            foundMatch = event;
            break;
          }
        }
        if (foundMatch) break;
      }

      if (!foundMatch) {
        throw new Error('Match not found in LiveScore');
      }

      return {
        api: 'LiveScore',
        responseTime,
        score: {
          home: parseInt(foundMatch.Tr1) || 0,
          away: parseInt(foundMatch.Tr2) || 0
        },
        status: foundMatch.Eps || 'LIVE',
        minute: foundMatch.Epr ? parseInt(foundMatch.Epr) : null,
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      return {
        api: 'LiveScore',
        responseTime: responseTime > 0 ? responseTime : -1,
        score: { home: 0, away: 0 },
        status: 'ERROR',
        minute: null,
        timestamp: new Date().toISOString(),
        error: error.response?.data?.message || error.message || 'LiveScore API error'
      };
    }
  }

  /**
   * 4. The Odds API
   */
  private async fetchTheOddsAPI(): Promise<APIResponse> {
    const startTime = Date.now();
    
    try {
      const response = await axios.get(
        'https://api.the-odds-api.com/v4/sports/soccer_uefa_champs_league/scores',
        {
          params: {
            apiKey: process.env.ODDS_API_KEY || 'DEMO_KEY',
            daysFrom: 1
          }
        }
      );

      const responseTime = Date.now() - startTime;

      // Find Man City match
      const match = response.data.find((m: any) => 
        m.home_team?.includes('Manchester City') || 
        m.away_team?.includes('Manchester City')
      );

      if (!match) {
        throw new Error('Match not found in TheOdds API');
      }

      return {
        api: 'TheOdds API',
        responseTime,
        score: {
          home: match.scores?.find((s: any) => s.name === match.home_team)?.score || 0,
          away: match.scores?.find((s: any) => s.name === match.away_team)?.score || 0
        },
        status: match.completed ? 'FINISHED' : 'LIVE',
        minute: null,
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      if (error.message.includes('Match not found')) throw error;
      
      const responseTime = Date.now() - startTime;
      return {
        api: 'TheOdds API',
        responseTime,
        score: { home: 0, away: 0 },
        status: 'API_KEY_REQUIRED',
        minute: null,
        timestamp: new Date().toISOString(),
        error: 'Free API key available at the-odds-api.com'
      };
    }
  }

  /**
   * 5. Sportmonks (Direct API)
   */
  private async fetchSportmonks(): Promise<APIResponse> {
    const startTime = Date.now();
    
    try {
      // Get today's fixtures
      const today = new Date().toISOString().split('T')[0];
      const response = await axios.get(
        `https://api.sportmonks.com/v3/football/fixtures/date/${today}`,
        {
          params: {
            api_token: process.env.SPORTMONKS_API_KEY || '',
            include: 'scores;state;participants'
          }
        }
      );

      const responseTime = Date.now() - startTime;

      // Find Man City match
      const fixtures = response.data.data || [];
      const match = fixtures.find((m: any) => {
        const participants = m.participants || [];
        return participants.some((p: any) => 
          p.name?.toLowerCase().includes('manchester city') ||
          p.name?.toLowerCase().includes('man city')
        );
      });

      if (!match) {
        throw new Error('Match not found in Sportmonks');
      }

      // Extract scores
      const scores = match.scores || [];
      const currentScore = scores.find((s: any) => s.description === 'CURRENT') || {};
      
      // Get home/away scores
      let homeScore = 0;
      let awayScore = 0;
      
      const participants = match.participants || [];
      if (participants.length >= 2) {
        const homeId = participants[0].id;
        const awayId = participants[1].id;
        
        scores.forEach((s: any) => {
          if (s.description === 'CURRENT') {
            if (s.participant_id === homeId) homeScore = s.score?.goals || 0;
            if (s.participant_id === awayId) awayScore = s.score?.goals || 0;
          }
        });
      }

      return {
        api: 'Sportmonks',
        responseTime,
        score: {
          home: homeScore,
          away: awayScore
        },
        status: match.state?.state || 'UNKNOWN',
        minute: match.state?.minute || null,
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      return {
        api: 'Sportmonks',
        responseTime: responseTime > 0 ? responseTime : -1,
        score: { home: 0, away: 0 },
        status: 'ERROR',
        minute: null,
        timestamp: new Date().toISOString(),
        error: error.response?.data?.message || error.message || 'Sportmonks API error'
      };
    }
  }

  /**
   * 6. SofaScore API (RapidAPI)
   */
  private async fetchSofaScore(): Promise<APIResponse> {
    const startTime = Date.now();
    
    try {
      // Using RapidAPI's SofaScore live events
      const response = await axios.get(
        'https://sofascore.p.rapidapi.com/v1/sport/football/events/live',
        {
          headers: {
            'x-rapidapi-key': process.env.SOFASCORE_API_KEY || '',
            'x-rapidapi-host': 'sofascore.p.rapidapi.com'
          }
        }
      );

      const responseTime = Date.now() - startTime;

      // Find Man City match
      const events = response.data.events || [];
      const match = events.find((event: any) => {
        const homeName = event.homeTeam?.name?.toLowerCase() || '';
        const awayName = event.awayTeam?.name?.toLowerCase() || '';
        return homeName.includes('manchester city') || 
               homeName.includes('man city') ||
               awayName.includes('manchester city') ||
               awayName.includes('man city');
      });

      if (!match) {
        throw new Error('Match not found in SofaScore');
      }

      return {
        api: 'SofaScore',
        responseTime,
        score: {
          home: match.homeScore?.current || 0,
          away: match.awayScore?.current || 0
        },
        status: match.status?.type || 'LIVE',
        minute: match.time?.played || null,
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      return {
        api: 'SofaScore',
        responseTime: responseTime > 0 ? responseTime : -1,
        score: { home: 0, away: 0 },
        status: 'ERROR',
        minute: null,
        timestamp: new Date().toISOString(),
        error: error.response?.data?.message || error.message || 'SofaScore API error'
      };
    }
  }

  /**
   * 7. API-Sports (alternative)
   */
  private async fetchAPISports(): Promise<APIResponse> {
    const startTime = Date.now();
    
    try {
      const response = await axios.get(
        'https://api-football-v1.p.rapidapi.com/v3/fixtures',
        {
          params: {
            date: new Date().toISOString().split('T')[0],
            league: 2
          },
          headers: {
            'x-rapidapi-key': process.env.API_SPORTS_KEY || 'DEMO_KEY',
            'x-rapidapi-host': 'api-football-v1.p.rapidapi.com'
          }
        }
      );

      const responseTime = Date.now() - startTime;

      // Find Man City match
      const match = response.data.response.find((m: any) => 
        m.teams.home.name.includes('Manchester City')
      );

      if (!match) {
        throw new Error('Match not found in API-Sports');
      }

      return {
        api: 'API-Sports',
        responseTime,
        score: {
          home: match.goals.home || 0,
          away: match.goals.away || 0
        },
        status: match.fixture.status.long,
        minute: match.fixture.status.elapsed,
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      if (error.message.includes('Match not found')) throw error;
      
      const responseTime = Date.now() - startTime;
      return {
        api: 'API-Sports',
        responseTime,
        score: { home: 0, away: 0 },
        status: 'API_KEY_REQUIRED',
        minute: null,
        timestamp: new Date().toISOString(),
        error: 'Same as API-Football but different host'
      };
    }
  }

  /**
   * Log comparison to file
   */
  private logComparison(comparison: MatchComparison): void {
    const logLine = JSON.stringify(comparison) + '\n';
    fs.appendFileSync(this.currentLogFile, logLine);
  }

  /**
   * Print comparison table
   */
  private printResults(comparison: MatchComparison): void {
    console.log('\n' + '='.repeat(100));
    console.log('    📊 API COMPARISON RESULTS');
    console.log('='.repeat(100) + '\n');

    console.log(`🏟️  Match: ${comparison.homeTeam} vs ${comparison.awayTeam}\n`);

    // Sort by response time
    const sorted = [...comparison.responses].sort((a, b) => {
      if (a.responseTime === -1) return 1;
      if (b.responseTime === -1) return -1;
      return a.responseTime - b.responseTime;
    });

    console.log('┌─────────────────────────┬──────────┬───────────────┬────────────┬──────────┐');
    console.log('│ API                     │ Time(ms) │ Score         │ Status     │ Minute   │');
    console.log('├─────────────────────────┼──────────┼───────────────┼────────────┼──────────┤');

    sorted.forEach(r => {
      const api = r.api.padEnd(23);
      const time = r.responseTime > 0 ? r.responseTime.toString().padStart(8) : '   ERROR';
      const score = `${r.score.home}-${r.score.away}`.padEnd(13);
      const status = r.status.substring(0, 10).padEnd(10);
      const minute = r.minute ? r.minute.toString().padStart(8) : '     N/A';
      
      const icon = r.api === comparison.fastest ? '⚡' : '  ';
      console.log(`│ ${icon}${api} │ ${time} │ ${score} │ ${status} │ ${minute} │`);
      
      if (r.error) {
        console.log(`│   └─ ⚠️  ${r.error.substring(0, 70).padEnd(70)} │`);
      }
    });

    console.log('└─────────────────────────┴──────────┴───────────────┴────────────┴──────────┘\n');

    console.log(`⚡ Fastest: ${comparison.fastest}`);
    console.log(`🎯 Consensus Score: ${comparison.consensusScore.home}-${comparison.consensusScore.away}`);
    console.log(`📂 Logged to: ${this.currentLogFile}\n`);

    console.log('='.repeat(100) + '\n');
  }

  /**
   * Continuous monitoring - test every 10 seconds
   */
  async startMonitoring(intervalSeconds: number = 10): Promise<void> {
    console.log(`\n🔄 Starting continuous API monitoring (${intervalSeconds}s intervals)\n`);

    while (true) {
      await this.compareManCityMatch();
      await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
    }
  }
}

// Export for use in tests
export default MultiAPIFootball;
