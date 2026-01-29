import 'dotenv/config';
import axios from 'axios';

/**
 * ⚡ DETAYLI API KARŞILAŞTIRMA
 * 
 * Aynı maçları farklı API'lerden çekip karşılaştırır:
 * - Hangisi daha hızlı?
 * - Hangisi daha doğru skor gösteriyor?
 * - Hangisi daha fazla maç buluyor?
 */

interface Match {
  home: string;
  away: string;
  score: string;
  minute?: string | number;
  league?: string;
}

interface APIResult {
  api: string;
  responseTime: number;
  matches: Match[];
  success: boolean;
  error?: string;
}

const normalizeTeam = (name: string): string => {
  return name.toLowerCase()
    .replace(/\b(fc|sc|cf|ac|ca|rb|red bull|sport club|club|athletic|clube|ec|fr|cr|ss|fk|sk)\b/gi, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

async function getAPIFootballMatches(): Promise<APIResult> {
  const start = Date.now();
  
  try {
    const response = await axios.get('https://v3.football.api-sports.io/fixtures', {
      params: { live: 'all' },
      headers: { 'x-apisports-key': process.env.FOOTBALL_API_KEY! },
      timeout: 10000
    });
    
    const fixtures = response.data.response || [];
    const matches: Match[] = fixtures.slice(0, 20).map((f: any) => ({
      home: f.teams.home.name,
      away: f.teams.away.name,
      score: `${f.goals.home}-${f.goals.away}`,
      minute: f.fixture.status.elapsed,
      league: f.league.name
    }));
    
    return {
      api: 'API-Football',
      responseTime: Date.now() - start,
      matches,
      success: true
    };
  } catch (error: any) {
    return {
      api: 'API-Football',
      responseTime: Date.now() - start,
      matches: [],
      success: false,
      error: error.message
    };
  }
}

async function getFootballDataMatches(): Promise<APIResult> {
  const start = Date.now();
  
  try {
    const response = await axios.get('https://api.football-data.org/v4/matches', {
      params: { status: 'LIVE' },
      headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_KEY! },
      timeout: 10000
    });
    
    const allMatches = response.data.matches || [];
    const matches: Match[] = allMatches.slice(0, 20).map((m: any) => ({
      home: m.homeTeam.name,
      away: m.awayTeam.name,
      score: `${m.score.fullTime.home || 0}-${m.score.fullTime.away || 0}`,
      minute: m.minute,
      league: m.competition.name
    }));
    
    return {
      api: 'Football-Data',
      responseTime: Date.now() - start,
      matches,
      success: true
    };
  } catch (error: any) {
    return {
      api: 'Football-Data',
      responseTime: Date.now() - start,
      matches: [],
      success: false,
      error: error.message
    };
  }
}

async function getSofaSportMatches(): Promise<APIResult> {
  const start = Date.now();
  
  try {
    const response = await axios.get('https://sofasport.p.rapidapi.com/v1/events/schedule/live', {
      params: { sport_id: 1 },
      headers: {
        'x-rapidapi-key': process.env.SOFASPORT_API_KEY!,
        'x-rapidapi-host': 'sofasport.p.rapidapi.com'
      },
      timeout: 10000
    });
    
    const events = response.data.data || [];
    const matches: Match[] = events.slice(0, 20).map((e: any) => {
      let minute: number | string | undefined = undefined;
      if (e.time?.currentPeriodStartTimestamp) {
        const now = Math.floor(Date.now() / 1000);
        const elapsed = now - e.time.currentPeriodStartTimestamp;
        minute = Math.floor(elapsed / 60);
        if (e.status?.description?.includes('2nd half')) minute += 45;
      }
      
      return {
        home: e.homeTeam?.name || '',
        away: e.awayTeam?.name || '',
        score: `${e.homeScore?.current ?? 0}-${e.awayScore?.current ?? 0}`,
        minute,
        league: e.tournament?.name
      };
    });
    
    return {
      api: 'SofaSport',
      responseTime: Date.now() - start,
      matches,
      success: true
    };
  } catch (error: any) {
    return {
      api: 'SofaSport',
      responseTime: Date.now() - start,
      matches: [],
      success: false,
      error: error.message
    };
  }
}

async function getLiveScore6Matches(): Promise<APIResult> {
  const start = Date.now();
  
  try {
    const response = await axios.get('https://livescore6.p.rapidapi.com/matches/v2/list-live', {
      params: { Category: 'soccer', Timezone: '-7' },
      headers: {
        'x-rapidapi-key': process.env.LIVESCORE_API_KEY!,
        'x-rapidapi-host': 'livescore6.p.rapidapi.com'
      },
      timeout: 10000
    });
    
    const allEvents = (response.data.Stages || []).flatMap((s: any) => s.Events || []);
    const matches: Match[] = allEvents.slice(0, 20).map((e: any) => {
      let minute: number | string | undefined = undefined;
      if (e.Eps) {
        const epsStr = String(e.Eps).trim();
        if (epsStr === 'HT') {
          minute = 'HT';
        } else if (epsStr !== 'FT' && epsStr.length > 0) {
          const match = epsStr.match(/^(\d+)/);
          if (match) minute = parseInt(match[1]);
        }
      }
      
      return {
        home: e.T1?.[0]?.Nm || '',
        away: e.T2?.[0]?.Nm || '',
        score: `${e.Tr1 || 0}-${e.Tr2 || 0}`,
        minute,
        league: 'N/A'
      };
    });
    
    return {
      api: 'LiveScore6',
      responseTime: Date.now() - start,
      matches,
      success: true
    };
  } catch (error: any) {
    return {
      api: 'LiveScore6',
      responseTime: Date.now() - start,
      matches: [],
      success: false,
      error: error.message
    };
  }
}

async function runDetailedComparison() {
  console.log('\n' + '='.repeat(80));
  console.log('   ⚡ DETAYLI API KARŞILAŞTIRMA - AYNI MAÇLAR');
  console.log('='.repeat(80) + '\n');
  
  const rounds = 3;
  
  for (let round = 1; round <= rounds; round++) {
    console.log(`\n🔍 Round ${round}/${rounds}`);
    console.log('─'.repeat(80));
    
    // Tüm API'lerden maçları çek
    const results = await Promise.all([
      getAPIFootballMatches(),
      getFootballDataMatches(),
      getSofaSportMatches(),
      getLiveScore6Matches()
    ]);
    
    // API performansını göster
    console.log('\n📊 API PERFORMANSI:\n');
    results.forEach(result => {
      const icon = result.success ? '✅' : '❌';
      const speed = result.responseTime < 500 ? '⚡' : 
                    result.responseTime < 1000 ? '🚀' : 
                    result.responseTime < 2000 ? '📊' : '🐢';
      
      console.log(`${icon} ${speed} ${result.api.padEnd(20)} ${String(result.responseTime).padStart(6)}ms  ${result.matches.length} maç`);
      
      if (result.error) {
        console.log(`       ❌ Error: ${result.error}`);
      }
    });
    
    // Ortak maçları bul
    console.log('\n\n🎯 ORTAK MAÇLARIN KARŞILAŞTIRMASI:');
    console.log('─'.repeat(80));
    
    const matchMap = new Map<string, Array<{
      api: string;
      home: string;
      away: string;
      score: string;
      minute: any;
      responseTime: number;
      league?: string;
    }>>();
    
    // Tüm maçları normalize et ve grupla
    results.forEach(result => {
      if (!result.success) return;
      
      result.matches.forEach(match => {
        const homeNorm = normalizeTeam(match.home);
        const awayNorm = normalizeTeam(match.away);
        const key = `${homeNorm}|${awayNorm}`;
        
        if (!matchMap.has(key)) matchMap.set(key, []);
        matchMap.get(key)!.push({
          api: result.api,
          home: match.home,
          away: match.away,
          score: match.score,
          minute: match.minute,
          responseTime: result.responseTime,
          league: match.league
        });
      });
    });
    
    // Sadece birden fazla API'de bulunan maçları göster
    const commonMatches = Array.from(matchMap.entries())
      .filter(([_, sources]) => sources.length >= 2)
      .slice(0, 5);
    
    if (commonMatches.length === 0) {
      console.log('\n⚠️  Ortak maç bulunamadı!\n');
      console.log('💡 Bu normal olabilir çünkü:');
      console.log('   - API\'ler farklı ligleri izliyor olabilir');
      console.log('   - Football-Data sadece 12 büyük lig kapsar');
      console.log('   - API-Football 1214 lig kapsar (çok daha fazla)\n');
    } else {
      console.log(`\n✅ ${commonMatches.length} ortak maç bulundu:\n`);
      
      commonMatches.forEach(([key, sources], index) => {
        const first = sources[0];
        
        console.log(`${index + 1}. ${first.home} vs ${first.away}`);
        if (first.league) {
          console.log(`   🏆 Lig: ${first.league}`);
        }
        console.log('');
        
        // En hızlı API'yi bul
        const fastest = sources.reduce((min, curr) => 
          curr.responseTime < min.responseTime ? curr : min
        );
        
        // Her API'nin verisini göster
        sources.forEach(s => {
          const speedIcon = s.api === fastest.api ? '🏆' : '  ';
          const minuteStr = s.minute === 'HT' ? 'HT' : 
                           s.minute ? `${s.minute}'` : 'N/A';
          console.log(`   ${speedIcon} ${s.api.padEnd(20)} ${s.score.padEnd(6)} (${minuteStr.padStart(5)}) - ${s.responseTime}ms`);
        });
        
        // Skor karşılaştırması
        const scores = sources.map(s => s.score);
        const uniqueScores = [...new Set(scores)];
        
        if (uniqueScores.length > 1) {
          console.log(`   ⚠️  SKOR UYUŞMAZLIĞI: ${uniqueScores.join(' ≠ ')}`);
          console.log(`   💡 En hızlı güncelleme: ${fastest.api} (${fastest.score})`);
        } else {
          console.log(`   ✅ Tüm API'ler aynı skoru gösteriyor: ${uniqueScores[0]}`);
        }
        
        console.log('');
      });
    }
    
    // Bir sonraki round için bekle
    if (round < rounds) {
      console.log('\n⏳ 10 saniye bekleniyor...\n');
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('   ✅ KARŞILAŞTIRMA TAMAMLANDI');
  console.log('='.repeat(80) + '\n');
}

runDetailedComparison().catch(console.error);
