/**
 * Enhanced Sports Market Scanner with API-Football Integration
 * 
 * Bu scanner:
 * 1. Polymarket'teki AÇIK spor maçlarını tarar
 * 2. API-Football ile eşleştirir
 * 3. Live odds tracking yapar
 * 4. Telegram alerts ile çapraz doğrulama
 */

import { APIFootballClient, LiveMatch } from '../integrations/api-football';
import axios from 'axios';

const GAMMA_API_URL = 'https://gamma-api.polymarket.com';

interface PolymarketSportsMarket {
  conditionId: string;
  questionId: string;
  question: string;
  tokens: Array<{
    tokenId: string;
    outcome: string;
    price: number;
  }>;
  volume: number;
  liquidity: number;
  endDate: Date;
  active: boolean;
  closed: boolean;
  category: string;
  // Parsed match info
  homeTeam?: string;
  awayTeam?: string;
  league?: string;
  matchType?: 'WINNER' | 'DRAW' | 'OVER_UNDER' | 'BOTH_SCORE';
}

interface MatchMapping {
  polymarketMarket: PolymarketSportsMarket;
  apiFootballMatch?: LiveMatch;
  apiFootballFixtureId?: number;
  confidence: number; // 0-100:얼마나 emin eşleşme olduğu
  isLive: boolean;
  hasOdds: boolean;
}

export class EnhancedSportsScanner {
  private apiFootball: APIFootballClient;
  private trackedMatches: Map<string, MatchMapping> = new Map();
  private lastScanTime: number = 0;
  private scanInterval: number = 60 * 1000; // 1 dakika

  constructor() {
    this.apiFootball = new APIFootballClient();
  }

  /**
   * Polymarket'ten TÜM açık spor maçlarını al
   */
  async scanPolymarketSportsMarkets(): Promise<PolymarketSportsMarket[]> {
    console.log('\n🔍 Scanning Polymarket for OPEN sports markets...\n');

    try {
      // Sports kategorisindeki tüm aktif marketleri al
      const response = await axios.get(`${GAMMA_API_URL}/markets`, {
        params: {
          active: true,
          closed: false,
          limit: 100, // Daha fazla market
        },
      });

      const allMarkets = response.data;
      const sportsMarkets: PolymarketSportsMarket[] = [];

      for (const market of allMarkets) {
        if (this.isSportsMarket(market)) {
          const parsed = this.parsePolymarketMarket(market);
          if (parsed) {
            sportsMarkets.push(parsed);
          }
        }
      }

      console.log(`✅ Found ${sportsMarkets.length} open sports markets on Polymarket\n`);

      return sportsMarkets;
    } catch (error) {
      console.error('❌ Failed to fetch Polymarket markets:', error);
      return [];
    }
  }

  /**
   * Market spor mu kontrol et
   */
  private isSportsMarket(market: any): boolean {
    const question = market.question?.toLowerCase() || '';
    const category = market.category?.toLowerCase() || '';

    // Spor kategorileri
    const sportsCategories = ['sports', 'soccer', 'football', 'basketball', 'tennis'];
    if (sportsCategories.some(cat => category.includes(cat))) {
      return true;
    }

    // Spor keywords
    const sportsKeywords = [
      'win', 'vs', 'beat', 'defeat',
      'champions league', 'premier league', 'la liga', 'serie a',
      'world cup', 'euro', 'copa',
      'nba', 'nfl', 'nhl', 'mlb',
      'real madrid', 'barcelona', 'bayern', 'manchester',
      'goal', 'score', 'match'
    ];

    return sportsKeywords.some(keyword => question.includes(keyword));
  }

  /**
   * Polymarket market'i parse et
   */
  private parsePolymarketMarket(market: any): PolymarketSportsMarket | null {
    try {
      const question = market.question || '';
      
      // Team names çıkar (örn: "Will Real Madrid beat PSG?")
      const teams = this.extractTeams(question);

      // Tokens parse et
      const tokens = (market.tokens || []).map((token: any) => ({
        tokenId: token.token_id,
        outcome: token.outcome,
        price: parseFloat(token.price || '0'),
      }));

      return {
        conditionId: market.condition_id,
        questionId: market.question_id,
        question,
        tokens,
        volume: parseFloat(market.volume || '0'),
        liquidity: parseFloat(market.liquidity || '0'),
        endDate: new Date(market.end_date_iso),
        active: market.active,
        closed: market.closed,
        category: market.category || '',
        homeTeam: teams?.home,
        awayTeam: teams?.away,
        league: this.extractLeague(question),
        matchType: this.detectMatchType(question),
      };
    } catch (error) {
      console.error(`Failed to parse market: ${market.question}`, error);
      return null;
    }
  }

  /**
   * Question'dan team names çıkar
   */
  private extractTeams(question: string): { home: string; away: string } | null {
    // Pattern 1: "Will X beat Y?"
    let match = question.match(/will\s+(.+?)\s+(?:beat|defeat)\s+(.+?)\?/i);
    if (match) {
      return { home: match[1].trim(), away: match[2].trim() };
    }

    // Pattern 2: "X vs Y"
    match = question.match(/(.+?)\s+vs\.?\s+(.+?)(?:\s|$|\?)/i);
    if (match) {
      return { home: match[1].trim(), away: match[2].trim() };
    }

    // Pattern 3: "X to win"
    match = question.match(/(.+?)\s+to\s+win/i);
    if (match) {
      return { home: match[1].trim(), away: 'Unknown' };
    }

    return null;
  }

  /**
   * League/Competition çıkar
   */
  private extractLeague(question: string): string | undefined {
    const leagues = [
      'Champions League', 'Europa League', 'Conference League',
      'Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1',
      'World Cup', 'Euro', 'Copa America',
      'NBA', 'NFL', 'NHL', 'MLB'
    ];

    for (const league of leagues) {
      if (question.toLowerCase().includes(league.toLowerCase())) {
        return league;
      }
    }

    return undefined;
  }

  /**
   * Match type tespit et
   */
  private detectMatchType(question: string): 'WINNER' | 'DRAW' | 'OVER_UNDER' | 'BOTH_SCORE' {
    const q = question.toLowerCase();
    
    if (q.includes('draw') || q.includes('tie')) {
      return 'DRAW';
    }
    if (q.includes('over') || q.includes('under') || q.includes('goals')) {
      return 'OVER_UNDER';
    }
    if (q.includes('both') && q.includes('score')) {
      return 'BOTH_SCORE';
    }
    
    return 'WINNER';
  }

  /**
   * Polymarket markets ile API-Football matches eşleştir
   */
  async matchWithAPIFootball(
    polymarkets: PolymarketSportsMarket[]
  ): Promise<MatchMapping[]> {
    console.log('\n🔗 Matching Polymarket markets with API-Football...\n');

    const mappings: MatchMapping[] = [];

    // API-Football'dan live ve yaklaşan maçları al
    const liveMatches = await this.apiFootball.getLiveMatches();
    const upcomingFixtures = await this.apiFootball.getFixturesStartingSoon(120); // 2 saat

    console.log(`   API-Football: ${liveMatches.length} live, ${upcomingFixtures.length} upcoming\n`);

    for (const polymarket of polymarkets) {
      if (!polymarket.homeTeam || !polymarket.awayTeam) {
        continue; // Team parse edilememiş
      }

      // Live match ile eşleştir
      const liveMatch = this.findMatchingLiveMatch(
        polymarket.homeTeam,
        polymarket.awayTeam,
        liveMatches
      );

      if (liveMatch) {
        mappings.push({
          polymarketMarket: polymarket,
          apiFootballMatch: liveMatch,
          apiFootballFixtureId: liveMatch.fixtureId,
          confidence: 85, // Live match, yüksek confidence
          isLive: true,
          hasOdds: true, // Live maçlarda odds var
        });

        console.log(`   ✅ LIVE: ${polymarket.homeTeam} vs ${polymarket.awayTeam}`);
        console.log(`      Polymarket: ${polymarket.question}`);
        console.log(`      API-Football: ${liveMatch.homeTeam} ${liveMatch.homeScore}-${liveMatch.awayScore} ${liveMatch.awayTeam} (${liveMatch.minute}')\n`);
        continue;
      }

      // Upcoming match ile eşleştir
      const upcomingMatch = this.findMatchingUpcomingMatch(
        polymarket.homeTeam,
        polymarket.awayTeam,
        upcomingFixtures
      );

      if (upcomingMatch) {
        mappings.push({
          polymarketMarket: polymarket,
          apiFootballFixtureId: upcomingMatch.fixture.id,
          confidence: 70, // Upcoming match, orta confidence
          isLive: false,
          hasOdds: true, // Pre-match odds mevcut
        });

        console.log(`   ⏰ UPCOMING: ${polymarket.homeTeam} vs ${polymarket.awayTeam}`);
        console.log(`      Polymarket: ${polymarket.question}`);
        console.log(`      API-Football: ${upcomingMatch.teams.home.name} vs ${upcomingMatch.teams.away.name}\n`);
        continue;
      }

      // Eşleşme bulunamadı
      mappings.push({
        polymarketMarket: polymarket,
        confidence: 0,
        isLive: false,
        hasOdds: false,
      });

      console.log(`   ⚠️  NO MATCH: ${polymarket.homeTeam} vs ${polymarket.awayTeam}`);
      console.log(`      ${polymarket.question}\n`);
    }

    return mappings;
  }

  /**
   * Live match ara (fuzzy matching)
   */
  private findMatchingLiveMatch(
    polyHome: string,
    polyAway: string,
    liveMatches: LiveMatch[]
  ): LiveMatch | undefined {
    const normalizedPolyHome = this.normalizeTeamName(polyHome);
    const normalizedPolyAway = this.normalizeTeamName(polyAway);

    return liveMatches.find(match => {
      const normalizedHome = this.normalizeTeamName(match.homeTeam);
      const normalizedAway = this.normalizeTeamName(match.awayTeam);

      // Tam eşleşme veya kısmi eşleşme
      return (
        (normalizedHome.includes(normalizedPolyHome) || normalizedPolyHome.includes(normalizedHome)) &&
        (normalizedAway.includes(normalizedPolyAway) || normalizedPolyAway.includes(normalizedAway))
      );
    });
  }

  /**
   * Upcoming match ara
   */
  private findMatchingUpcomingMatch(
    polyHome: string,
    polyAway: string,
    upcomingFixtures: any[]
  ): any | undefined {
    const normalizedPolyHome = this.normalizeTeamName(polyHome);
    const normalizedPolyAway = this.normalizeTeamName(polyAway);

    return upcomingFixtures.find(fixture => {
      const normalizedHome = this.normalizeTeamName(fixture.teams.home.name);
      const normalizedAway = this.normalizeTeamName(fixture.teams.away.name);

      return (
        (normalizedHome.includes(normalizedPolyHome) || normalizedPolyHome.includes(normalizedHome)) &&
        (normalizedAway.includes(normalizedPolyAway) || normalizedPolyAway.includes(normalizedAway))
      );
    });
  }

  /**
   * Team name normalize et (fuzzy matching için)
   */
  private normalizeTeamName(name: string): string {
    return name
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/fc|cf|sc|ac|as|cd/g, '') // Club prefixes kaldır
      .replace(/united|city|town|athletic/g, '') // Common suffixes
      .trim();
  }

  /**
   * Live odds tracking (In-Play)
   * API-Football'dan canlı odds al
   */
  async trackLiveOdds(fixtureId: number): Promise<any> {
    try {
      const response = await axios.get(`https://v3.football.api-sports.io/odds/live`, {
        params: {
          fixture: fixtureId,
        },
        headers: {
          'x-apisports-key': process.env.FOOTBALL_API_KEY || '',
        },
        timeout: 10000,
      });

      if (response.data.response && response.data.response.length > 0) {
        const odds = response.data.response[0];
        console.log(`📊 Live Odds for fixture ${fixtureId}:`);
        
        // İlk bookmaker'dan odds al
        const bookmaker = odds.bookmakers?.[0];
        if (bookmaker) {
          const matchWinner = bookmaker.bets.find((b: any) => b.name === 'Match Winner');
          if (matchWinner) {
            console.log(`   Bookmaker: ${bookmaker.name}`);
            matchWinner.values.forEach((v: any) => {
              console.log(`   ${v.value}: ${v.odd}`);
            });
          }
        }

        return odds;
      }

      return null;
    } catch (error) {
      console.error(`Failed to fetch live odds for fixture ${fixtureId}`);
      return null;
    }
  }

  /**
   * Ana scanning loop - sürekli çalışır
   */
  async startContinuousScanning(intervalMinutes: number = 1): Promise<void> {
    console.log(`\n🔄 Starting continuous Polymarket scanning (every ${intervalMinutes} min)...\n`);

    const scan = async () => {
      try {
        // 1. Polymarket'ten açık spor marketleri al
        const polymarkets = await this.scanPolymarketSportsMarkets();

        // 2. API-Football ile eşleştir
        const mappings = await this.matchWithAPIFootball(polymarkets);

        // 3. Eşleşenleri track et
        for (const mapping of mappings) {
          if (mapping.apiFootballFixtureId) {
            const key = mapping.polymarketMarket.conditionId;
            this.trackedMatches.set(key, mapping);

            // Live odds tracking (sadece live maçlar için)
            if (mapping.isLive && mapping.hasOdds) {
              await this.trackLiveOdds(mapping.apiFootballFixtureId);
            }
          }
        }

        // 4. Özet
        console.log(`\n📊 SCAN SUMMARY:`);
        console.log(`   Total Polymarket Sports Markets: ${polymarkets.length}`);
        console.log(`   Matched with API-Football: ${mappings.filter(m => m.confidence > 0).length}`);
        console.log(`   Live Matches: ${mappings.filter(m => m.isLive).length}`);
        console.log(`   Upcoming Matches: ${mappings.filter(m => !m.isLive && m.apiFootballFixtureId).length}`);
        console.log(`   Tracked Matches: ${this.trackedMatches.size}\n`);

        this.lastScanTime = Date.now();
      } catch (error) {
        console.error('❌ Scan error:', error);
      }
    };

    // İlk scan
    await scan();

    // Periyodik scan
    setInterval(scan, intervalMinutes * 60 * 1000);
  }

  /**
   * Tracked matches'i getir
   */
  getTrackedMatches(): MatchMapping[] {
    return Array.from(this.trackedMatches.values());
  }

  /**
   * Belirli bir match'i getir
   */
  getTrackedMatch(conditionId: string): MatchMapping | undefined {
    return this.trackedMatches.get(conditionId);
  }

  /**
   * Match tracking'i durdur
   */
  stopTracking(conditionId: string): boolean {
    return this.trackedMatches.delete(conditionId);
  }

  /**
   * Status yazdır
   */
  printStatus(): void {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📊 ENHANCED SPORTS SCANNER STATUS`);
    console.log(`${'='.repeat(80)}\n`);
    console.log(`Tracked Matches: ${this.trackedMatches.size}`);
    console.log(`Last Scan: ${new Date(this.lastScanTime).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}\n`);

    const live = Array.from(this.trackedMatches.values()).filter(m => m.isLive);
    const upcoming = Array.from(this.trackedMatches.values()).filter(m => !m.isLive && m.apiFootballFixtureId);

    if (live.length > 0) {
      console.log(`🔴 LIVE MATCHES (${live.length}):\n`);
      live.forEach(m => {
        console.log(`   ${m.polymarketMarket.homeTeam} vs ${m.polymarketMarket.awayTeam}`);
        if (m.apiFootballMatch) {
          console.log(`   Score: ${m.apiFootballMatch.homeScore}-${m.apiFootballMatch.awayScore} (${m.apiFootballMatch.minute}')`);
        }
        console.log(`   Polymarket: ${m.polymarketMarket.question}`);
        console.log(`   Confidence: ${m.confidence}%\n`);
      });
    }

    if (upcoming.length > 0) {
      console.log(`⏰ UPCOMING MATCHES (${upcoming.length}):\n`);
      upcoming.forEach(m => {
        console.log(`   ${m.polymarketMarket.homeTeam} vs ${m.polymarketMarket.awayTeam}`);
        console.log(`   Polymarket: ${m.polymarketMarket.question}`);
        console.log(`   Confidence: ${m.confidence}%\n`);
      });
    }

    console.log(`${'='.repeat(80)}\n`);
  }
}
