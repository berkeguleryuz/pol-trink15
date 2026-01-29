import axios, { AxiosInstance } from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * LiveScore6 API Client (RapidAPI)
 * ⚡ EN HIZLI VE DOĞRU SKOR GÜNCELEMELERİ
 * 
 * API: https://rapidapi.com/apidojo/api/livescore6
 * Özellikler:
 * - ~1 saniye response time
 * - Gerçek zamanlı skorlar
 * - Dakika bilgisi (Eps field)
 * - Geniş lig kapsamı (Brasileirão dahil)
 */

export interface LiveScore6Match {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  homeAbbr?: string; // Team abbreviation from API (e.g., "SAO", "FLA")
  awayAbbr?: string;
  homeScore: number;
  awayScore: number;
  minute: number | string | null; // 64, "HT", null
  league: string;
  status: string;
  timestamp?: number;
  startTime?: number; // Match start timestamp (Esd field)
}

export class LiveScore6Client {
  private client: AxiosInstance;
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.LIVESCORE_API_KEY || '';
    
    if (!this.apiKey) {
      console.warn('⚠️  LIVESCORE_API_KEY not found in .env');
    }

    this.client = axios.create({
      baseURL: 'https://livescore6.p.rapidapi.com',
      timeout: 10000,
      headers: {
        'x-rapidapi-key': this.apiKey,
        'x-rapidapi-host': 'livescore6.p.rapidapi.com'
      }
    });
  }

  /**
   * Tüm canlı futbol maçlarını getir
   */
  async getLiveMatches(): Promise<LiveScore6Match[]> {
    try {
      const response = await this.client.get('/matches/v2/list-live', {
        params: {
          Category: 'soccer',
          Timezone: '-7'
        }
      });

      const stages = response.data.Stages || [];
      const allMatches: LiveScore6Match[] = [];
      
      // Her stage için
      for (const stage of stages) {
        const events = stage.Events || [];
        const stageName = stage.Sdn || stage.Cnm || 'Unknown'; // Stage display name veya country name
        
        // Her event'i parse et
        for (const event of events) {
          const match = this.parseMatch(event);
          match.league = stageName; // Stage bilgisini league olarak kullan
          allMatches.push(match);
        }
      }
      
      return allMatches;
    } catch (error: any) {
      console.error('❌ LiveScore6 getLiveMatches error:', error.response?.data || error.message);
      return [];
    }
  }

  /**
   * Belirli takımlar için maç ara
   */
  async findMatch(homeTeam: string, awayTeam: string): Promise<LiveScore6Match | null> {
    const matches = await this.getLiveMatches();
    
    const homeNorm = this.normalizeTeamName(homeTeam);
    const awayNorm = this.normalizeTeamName(awayTeam);
    
    return matches.find(m => {
      const mHomeNorm = this.normalizeTeamName(m.homeTeam);
      const mAwayNorm = this.normalizeTeamName(m.awayTeam);
      
      return (mHomeNorm.includes(homeNorm) || homeNorm.includes(mHomeNorm)) &&
             (mAwayNorm.includes(awayNorm) || awayNorm.includes(mAwayNorm));
    }) || null;
  }

  /**
   * Event objesini parse et
   */
  private parseMatch(event: any): LiveScore6Match {
    let minute: number | string | null = null;
    
    if (event.Eps) {
      const epsStr = String(event.Eps).trim();
      
      if (epsStr === 'HT') {
        minute = 'HT'; // Devre arası
      } else if (epsStr !== 'FT' && epsStr.length > 0) {
        // "64'" -> 64, "45+2'" -> 45
        const match = epsStr.match(/^(\d+)/);
        if (match) {
          minute = parseInt(match[1]);
        }
      }
    }

    return {
      eventId: event.Eid || '',
      homeTeam: event.T1?.[0]?.Nm || '',
      awayTeam: event.T2?.[0]?.Nm || '',
      homeAbbr: event.T1?.[0]?.Abr || undefined, // API abbreviation
      awayAbbr: event.T2?.[0]?.Abr || undefined,
      homeScore: parseInt(event.Tr1 || '0'),
      awayScore: parseInt(event.Tr2 || '0'),
      minute,
      league: event.Snm || event.Sdn || event.Cnm || 'Unknown', // Will be overridden by stage name
      status: event.Eps || 'UNKNOWN',
      timestamp: Date.now(),
      startTime: event.Esd || undefined // Match start timestamp (YYYYMMDDHHmmss)
    };
  }

  /**
   * Takım ismini normalize et
   */
  private normalizeTeamName(name: string): string {
    return name.toLowerCase()
      .replace(/\b(fc|sc|cf|ac|ca|rb|red bull|sport club|club|athletic|clube|ec|fr|cr)\b/gi, '')
      .replace(/\b(recife|sport)\b/gi, 'recife')
      .replace(/\b(internacional|inter)\b/gi, 'internacional')
      .replace(/\b(corinthians|corint)\b/gi, 'corinthians')
      .replace(/\b(bragantino|bragan)\b/gi, 'bragantino')
      .replace(/\b(vitoria|vitória)\b/gi, 'vitoria')
      .replace(/\b(juventude|juven)\b/gi, 'juventude')
      .replace(/\b(botafogo|botaf)\b/gi, 'botafogo')
      .replace(/\b(vasco|vasco da gama)\b/gi, 'vasco')
      .replace(/\b(mineiro|atletico)\b/gi, 'mineiro')
      .replace(/\b(bahia)\b/gi, 'bahia')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Maç durumunu kontrol et (skor değişikliği)
   */
  async detectGoal(
    homeTeam: string, 
    awayTeam: string, 
    previousScore: { home: number; away: number }
  ): Promise<{ goalScored: boolean; newScore: { home: number; away: number }; scorer?: 'home' | 'away' } | null> {
    const match = await this.findMatch(homeTeam, awayTeam);
    
    if (!match) return null;

    const goalScored = 
      match.homeScore !== previousScore.home || 
      match.awayScore !== previousScore.away;

    if (!goalScored) return null;

    return {
      goalScored: true,
      newScore: { home: match.homeScore, away: match.awayScore },
      scorer: match.homeScore > previousScore.home ? 'home' : 'away'
    };
  }

  /**
   * 🎯 Polymarket SLUG oluştur (LiveScore6 maçından)
   * 
   * Format: [country]-[home_abbr]-[away_abbr]-[YYYY-MM-DD]
   * Örnek: bra-sao-fla-2025-11-05
   * 
   * Bu SLUG ile Polymarket API'den direkt event alabiliriz!
   * 
   * ⚠️  TARİH: Maç başlangıç saatini kullan (startTime = YYYYMMDDHHmmss)
   * ⚠️  ABBR: API'den gelen kısaltmayı kullan (T1[0].Abr), yoksa generate et
   */
  generatePolymarketSlug(match: LiveScore6Match): string {
    // startTime format: 20251105173000 (YYYYMMDDHHmmss)
    let dateStr: string;
    
    if (match.startTime) {
      const timeStr = String(match.startTime);
      const year = timeStr.substring(0, 4);
      const month = timeStr.substring(4, 6);
      const day = timeStr.substring(6, 8);
      dateStr = `${year}-${month}-${day}`;
    } else {
      // Fallback: Bugün
      dateStr = new Date().toISOString().split('T')[0];
    }
    
    // Ülke kodu (league'den çıkar)
    const countryCode = this.getCountryCode(match.league);
    
    // Takım kısaltmaları - API'den geleni kullan, yoksa generate et
    const homeAbbr = match.homeAbbr?.toLowerCase() || this.getTeamAbbreviation(match.homeTeam);
    const awayAbbr = match.awayAbbr?.toLowerCase() || this.getTeamAbbreviation(match.awayTeam);
    
    return `${countryCode}-${homeAbbr}-${awayAbbr}-${dateStr}`;
  }

  /**
   * League'den ülke kodu çıkar
   */
  private getCountryCode(league: string): string {
    const leagueLower = league.toLowerCase();
    
    // Brazil
    if (leagueLower.includes('brasil') || leagueLower.includes('brazil') || 
        leagueLower.includes('série a') || leagueLower.includes('serie a')) {
      return 'bra';
    }
    
    // England
    if (leagueLower.includes('premier') || leagueLower.includes('england')) {
      return 'epl';
    }
    
    // Spain
    if (leagueLower.includes('la liga') || leagueLower.includes('spain')) {
      return 'lal';
    }
    
    // Germany
    if (leagueLower.includes('bundesliga') || leagueLower.includes('germany')) {
      return 'bun';
    }
    
    // France
    if (leagueLower.includes('ligue 1') || leagueLower.includes('france')) {
      return 'fl1';
    }
    
    // Italy
    if (leagueLower.includes('serie a') && leagueLower.includes('italy')) {
      return 'sea';
    }
    
    // Champions League
    if (leagueLower.includes('champions')) {
      return 'ucl';
    }
    
    // Default
    return 'soccer';
  }

  /**
   * Takım isminden kısaltma çıkar (Polymarket tarzı)
   * 
   * Örnekler:
   * - "São Paulo FC" -> "sao"
   * - "CR Flamengo" -> "fla"
   * - "CA Mineiro" -> "min"
   * - "Botafogo FR" -> "bot"
   */
  private getTeamAbbreviation(teamName: string): string {
    const cleaned = teamName
      .toLowerCase()
      .replace(/\b(fc|sc|cf|ac|ca|rb|cr|fr|ec|fbpa)\b/gi, '')
      .trim();
    
    // Özel kısaltmalar (Brazil takımları)
    const abbreviations: { [key: string]: string } = {
      'flamengo': 'fla',
      'são paulo': 'sao',
      'sao paulo': 'sao',
      'corinthians': 'cor',
      'palmeiras': 'pal',
      'grêmio': 'gre',
      'gremio': 'gre',
      'cruzeiro': 'cru',
      'mineiro': 'min',
      'atletico mineiro': 'min',
      'atlético mineiro': 'min',
      'bahia': 'bah',
      'botafogo': 'bot',
      'vasco': 'vas',
      'vasco da gama': 'vas',
      'internacional': 'int',
      'sport recife': 'rec',
      'recife': 'rec',
      'athletico paranaense': 'ath',
      'bragantino': 'bra',
      'fortaleza': 'for',
      'juventude': 'juv',
      'cuiabá': 'cui',
      'cuiaba': 'cui',
      'vitória': 'vit',
      'vitoria': 'vit',
    };
    
    // Eşleşme ara
    for (const [full, abbr] of Object.entries(abbreviations)) {
      if (cleaned.includes(full)) {
        return abbr;
      }
    }
    
    // Eşleşme yoksa ilk 3 harfi al
    const words = cleaned.split(' ').filter(w => w.length > 0);
    if (words.length > 0) {
      return words[0].substring(0, 3);
    }
    
    return 'team';
  }
}
