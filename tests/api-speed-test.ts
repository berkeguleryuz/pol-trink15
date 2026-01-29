import 'dotenv/config';
import axios from 'axios';

/**
 * ⚡ API HIZ KARŞILAŞTIRMA TESTİ
 * 
 * Test edilen:
 * 1. API-Football (api-football.com)
 * 2. Football-Data.org
 * 3. SofaSport (RapidAPI)
 * 4. LiveScore6 (RapidAPI)
 * 
 * Metrikler:
 * - Response time (ms)
 * - Canlı maç sayısı
 * - Veri kalitesi (skor, dakika)
 */

interface APITest {
  name: string;
  responseTime: number;
  matchCount: number;
  success: boolean;
  error?: string;
  sampleMatch?: {
    home: string;
    away: string;
    score: string;
    minute?: string | number;
  };
}

async function testAPIFootball(): Promise<APITest> {
  const start = Date.now();
  
  try {
    const response = await axios.get('https://v3.football.api-sports.io/fixtures', {
      params: { live: 'all' },
      headers: {
        'x-apisports-key': process.env.FOOTBALL_API_KEY!
      },
      timeout: 10000
    });
    
    const fixtures = response.data.response || [];
    const sampleMatch = fixtures[0] ? {
      home: fixtures[0].teams.home.name,
      away: fixtures[0].teams.away.name,
      score: `${fixtures[0].goals.home}-${fixtures[0].goals.away}`,
      minute: fixtures[0].fixture.status.elapsed
    } : undefined;
    
    return {
      name: 'API-Football',
      responseTime: Date.now() - start,
      matchCount: fixtures.length,
      success: true,
      sampleMatch
    };
  } catch (error: any) {
    return {
      name: 'API-Football',
      responseTime: Date.now() - start,
      matchCount: 0,
      success: false,
      error: error.message
    };
  }
}

async function testFootballData(): Promise<APITest> {
  const start = Date.now();
  
  try {
    const response = await axios.get('https://api.football-data.org/v4/matches', {
      params: { status: 'LIVE' },
      headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_KEY! },
      timeout: 10000
    });
    
    const matches = response.data.matches || [];
    const sampleMatch = matches[0] ? {
      home: matches[0].homeTeam.name,
      away: matches[0].awayTeam.name,
      score: `${matches[0].score.fullTime.home || 0}-${matches[0].score.fullTime.away || 0}`,
      minute: matches[0].minute
    } : undefined;
    
    return {
      name: 'Football-Data',
      responseTime: Date.now() - start,
      matchCount: matches.length,
      success: true,
      sampleMatch
    };
  } catch (error: any) {
    return {
      name: 'Football-Data',
      responseTime: Date.now() - start,
      matchCount: 0,
      success: false,
      error: error.message
    };
  }
}

async function testSofaSport(): Promise<APITest> {
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
    const sampleMatch = events[0] ? {
      home: events[0].homeTeam?.name || '',
      away: events[0].awayTeam?.name || '',
      score: `${events[0].homeScore?.current ?? 0}-${events[0].awayScore?.current ?? 0}`,
      minute: events[0].time?.currentPeriodStartTimestamp ? 
        Math.floor((Date.now() / 1000 - events[0].time.currentPeriodStartTimestamp) / 60) : undefined
    } : undefined;
    
    return {
      name: 'SofaSport',
      responseTime: Date.now() - start,
      matchCount: events.length,
      success: true,
      sampleMatch
    };
  } catch (error: any) {
    return {
      name: 'SofaSport',
      responseTime: Date.now() - start,
      matchCount: 0,
      success: false,
      error: error.message
    };
  }
}

async function testLiveScore6(): Promise<APITest> {
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
    const sampleMatch = allEvents[0] ? {
      home: allEvents[0].T1?.[0]?.Nm || '',
      away: allEvents[0].T2?.[0]?.Nm || '',
      score: `${allEvents[0].Tr1 || 0}-${allEvents[0].Tr2 || 0}`,
      minute: allEvents[0].Eps ? parseInt(allEvents[0].Eps.split("'")[0]) : undefined
    } : undefined;
    
    return {
      name: 'LiveScore6',
      responseTime: Date.now() - start,
      matchCount: allEvents.length,
      success: true,
      sampleMatch
    };
  } catch (error: any) {
    return {
      name: 'LiveScore6',
      responseTime: Date.now() - start,
      matchCount: 0,
      success: false,
      error: error.message
    };
  }
}

async function runSpeedTest() {
  console.log('\n' + '='.repeat(80));
  console.log('   ⚡ API HIZ KARŞILAŞTIRMA TESTİ');
  console.log('='.repeat(80) + '\n');
  
  const rounds = 10;
  const allResults: APITest[][] = [];
  
  for (let i = 1; i <= rounds; i++) {
    console.log(`\n🔍 Round ${i}/${rounds}`);
    console.log('─'.repeat(80));
    
    // Tüm API'leri paralel çağır
    const results = await Promise.all([
      testAPIFootball(),
      testFootballData(),
      testSofaSport(),
      testLiveScore6()
    ]);
    
    allResults.push(results);
    
    // Sonuçları göster
    results.forEach(result => {
      const icon = result.success ? '✅' : '❌';
      const speed = result.responseTime < 500 ? '⚡' : 
                    result.responseTime < 1000 ? '🚀' : 
                    result.responseTime < 2000 ? '📊' : '🐢';
      
      console.log(`${icon} ${speed} ${result.name.padEnd(20)} ${String(result.responseTime).padStart(6)}ms  ${result.matchCount} matches`);
      
      if (result.error) {
        console.log(`       ❌ Error: ${result.error}`);
      }
    });
    
    // ORTAK MAÇLARI BUL VE KARŞILAŞTIR
    console.log('\n📊 ORTAK MAÇLAR (İlk 4):');
    console.log('─'.repeat(80));
    
    const normalizeTeam = (name: string) => {
      return name.toLowerCase()
        .replace(/\b(fc|sc|cf|ac|ca|rb|red bull|sport club|club|athletic|clube|ec|fr|cr)\b/gi, '')
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    };
    
    // Her API'den ilk 10 maçı al
    const allMatches = new Map<string, Array<{api: string, home: string, away: string, score: string, minute: any, responseTime: number}>>();
    
    results.forEach(result => {
      if (!result.success || result.matchCount === 0) return;
      
      // İlk 10 maçı almak için API'yi tekrar çağırmak yerine sample match'i kullan
      // Gerçek uygulamada tüm maçları alıp karşılaştırmalıyız
      if (result.sampleMatch) {
        const homeNorm = normalizeTeam(result.sampleMatch.home);
        const awayNorm = normalizeTeam(result.sampleMatch.away);
        const key = `${homeNorm} vs ${awayNorm}`;
        
        if (!allMatches.has(key)) allMatches.set(key, []);
        allMatches.get(key)!.push({
          api: result.name,
          home: result.sampleMatch.home,
          away: result.sampleMatch.away,
          score: result.sampleMatch.score,
          minute: result.sampleMatch.minute,
          responseTime: result.responseTime
        });
      }
    });
    
    // Sadece birden fazla API'de bulunan maçları göster
    let shownMatches = 0;
    for (const [key, sources] of allMatches.entries()) {
      if (sources.length < 2 || shownMatches >= 4) continue;
      
      const first = sources[0];
      console.log(`\n${shownMatches + 1}. ${first.home} vs ${first.away}`);
      
      // En hızlı response time'ı bul
      const fastest = sources.reduce((min, curr) => 
        curr.responseTime < min.responseTime ? curr : min
      );
      
      sources.forEach(s => {
        const speedIcon = s.api === fastest.api ? '🏆' : '  ';
        console.log(`   ${speedIcon} ${s.api.padEnd(20)} ${s.score.padEnd(6)} (${String(s.minute || 'N/A').padStart(3)}') - ${s.responseTime}ms`);
      });
      
      // Skor uyuşmazlığı kontrolü
      const scores = sources.map(s => s.score);
      const uniqueScores = [...new Set(scores)];
      
      if (uniqueScores.length > 1) {
        console.log(`   ⚠️  SKOR FARKI: ${uniqueScores.join(' vs ')}`);
      } else {
        console.log(`   ✅ Tüm API'ler aynı skoru gösteriyor`);
      }
      
      shownMatches++;
    }
    
    if (shownMatches === 0) {
      console.log('\n⚠️  Ortak maç bulunamadı (farklı ligler izleniyor olabilir)\n');
    }
    
    if (i < rounds) {
      console.log('\n⏳ Waiting 10 seconds...');
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
  
  // İSTATİSTİKLER
  console.log('\n' + '='.repeat(80));
  console.log('   📊 İSTATİSTİKLER (10 Test Ortalaması)');
  console.log('='.repeat(80) + '\n');
  
  const apiNames = ['API-Football', 'Football-Data', 'SofaSport', 'LiveScore6'];
  
  apiNames.forEach(apiName => {
    const apiResults = allResults.flatMap(round => 
      round.filter(r => r.name === apiName)
    );
    
    const successfulResults = apiResults.filter(r => r.success);
    const avgResponseTime = successfulResults.length > 0 
      ? Math.round(successfulResults.reduce((sum, r) => sum + r.responseTime, 0) / successfulResults.length)
      : 0;
    
    const minResponseTime = successfulResults.length > 0
      ? Math.min(...successfulResults.map(r => r.responseTime))
      : 0;
    
    const maxResponseTime = successfulResults.length > 0
      ? Math.max(...successfulResults.map(r => r.responseTime))
      : 0;
    
    const avgMatches = successfulResults.length > 0
      ? Math.round(successfulResults.reduce((sum, r) => sum + r.matchCount, 0) / successfulResults.length)
      : 0;
    
    const successRate = (successfulResults.length / apiResults.length) * 100;
    
    console.log(`${apiName}:`);
    console.log(`   AVG Response: ${avgResponseTime}ms`);
    console.log(`   MIN Response: ${minResponseTime}ms`);
    console.log(`   MAX Response: ${maxResponseTime}ms`);
    console.log(`   AVG Matches:  ${avgMatches}`);
    console.log(`   Success Rate: ${successRate.toFixed(0)}%`);
    console.log('');
  });
  
  // KAZANAN
  console.log('='.repeat(80));
  console.log('   🏆 SONUÇ');
  console.log('='.repeat(80) + '\n');
  
  const winner = apiNames
    .map(name => {
      const results = allResults.flatMap(r => r.filter(res => res.name === name && res.success));
      const avg = results.length > 0 
        ? results.reduce((sum, r) => sum + r.responseTime, 0) / results.length 
        : Infinity;
      return { name, avg };
    })
    .sort((a, b) => a.avg - b.avg);
  
  winner.forEach((api, index) => {
    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '  ';
    console.log(`${medal} ${(index + 1)}. ${api.name.padEnd(20)} ${Math.round(api.avg)}ms`);
  });
  
  console.log('\n' + '='.repeat(80) + '\n');
}

runSpeedTest().catch(console.error);
