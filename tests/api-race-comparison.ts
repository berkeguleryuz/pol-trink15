import 'dotenv/config';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { PolymarketSportsClient, PolymarketSportsEvent } from '../src/integrations/polymarket-sports';

/**
 * 🏁 API RACE COMPARISON - POLYMARKET LIVE MAÇLAR
 * 
 * AMAÇ: 
 * 1. Polymarket'teki LIVE maçları bul
 * 2. Bu maçlar için tüm API'leri test et
 * 3. Hangisi en hızlı ve doğru skoru buluyor?
 * 
 * Test edilen API'ler:
 * 1. SofaSport (RapidAPI)
 * 2. Football-Data.org
 * 3. Sportmonks
 * 4. LiveScore6 (RapidAPI)
 * 
 * Her API için:
 * - Response time (ms)
 * - Maç buldu mu?
 * - Skor doğruluğu
 * - Dakika bilgisi
 */

interface PolymarketMatch {
  id: string;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: Date;
  isLive: boolean;
}

interface APISnapshot {
  api: string;
  responseTime: number;
  found: boolean;
  homeScore?: number;
  awayScore?: number;
  minute?: number | null;
  error?: string;
}

async function getPolymarketLiveMatches(): Promise<PolymarketMatch[]> {
  const client = new PolymarketSportsClient();
  
  try {
    // Tüm liglerdeki eventleri al
    const allEvents = await client.getAllSportsEvents();
    
    const now = new Date();
    const liveMatches: PolymarketMatch[] = [];
    
    for (const event of allEvents) {
      const kickoff = event.kickoffTime;
      if (!kickoff || !event.homeTeam || !event.awayTeam) continue;
      
      // Maç başladıysa ve bitmedi ise LIVE
      const timeDiff = now.getTime() - kickoff.getTime();
      const minutesElapsed = timeDiff / 60000;
      
      // 0-120 dakika arası = LIVE (90 + 30 uzatma)
      const isLive = minutesElapsed >= 0 && minutesElapsed <= 120;
      
      if (isLive) {
        liveMatches.push({
          id: event.id,
          homeTeam: event.homeTeam,
          awayTeam: event.awayTeam,
          kickoffTime: kickoff,
          isLive: true
        });
      }
    }
    
    return liveMatches;
  } catch (error) {
    console.error('❌ Polymarket error:', error);
    return [];
  }
}

async function testSofaSport(homeTeam: string, awayTeam: string): Promise<APISnapshot> {
  const start = Date.now();
  
  try {
    const response = await axios.get('https://sofasport.p.rapidapi.com/v1/events/schedule/live', {
      params: { sport_id: 1 },
      headers: {
        'x-rapidapi-key': process.env.SOFASPORT_API_KEY!,
        'x-rapidapi-host': 'sofasport.p.rapidapi.com'
      }
    });
    
    const found = (response.data.data || []).find((event: any) => {
      const home = event.homeTeam?.name?.toLowerCase() || '';
      const away = event.awayTeam?.name?.toLowerCase() || '';
      const targetHome = homeTeam.toLowerCase();
      const targetAway = awayTeam.toLowerCase();
      
      return (home.includes(targetHome) || targetHome.includes(home)) &&
             (away.includes(targetAway) || targetAway.includes(away));
    });
    
    if (found) {
      let minute = null;
      if (found.time?.currentPeriodStartTimestamp) {
        const now = Math.floor(Date.now() / 1000);
        const elapsed = now - found.time.currentPeriodStartTimestamp;
        minute = Math.floor(elapsed / 60);
        if (found.status?.description?.includes('2nd half')) minute += 45;
      }
      
      return {
        api: 'SofaSport',
        responseTime: Date.now() - start,
        found: true,
        homeScore: found.homeScore?.current ?? 0,
        awayScore: found.awayScore?.current ?? 0,
        minute
      };
    }
    
    return { api: 'SofaSport', responseTime: Date.now() - start, found: false };
  } catch (error: any) {
    return { api: 'SofaSport', responseTime: Date.now() - start, found: false, error: error.message };
  }
}

async function testFootballData(homeTeam: string, awayTeam: string): Promise<APISnapshot> {
  const start = Date.now();
  
  try {
    const response = await axios.get('https://api.football-data.org/v4/matches', {
      params: { status: 'LIVE' },
      headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_KEY! }
    });
    
    const found = (response.data.matches || []).find((m: any) => {
      const home = m.homeTeam?.name?.toLowerCase() || '';
      const away = m.awayTeam?.name?.toLowerCase() || '';
      const targetHome = homeTeam.toLowerCase();
      const targetAway = awayTeam.toLowerCase();
      
      return (home.includes(targetHome) || targetHome.includes(home)) &&
             (away.includes(targetAway) || targetAway.includes(away));
    });
    
    if (found) {
      return {
        api: 'Football-Data',
        responseTime: Date.now() - start,
        found: true,
        homeScore: found.score?.fullTime?.home ?? found.score?.halfTime?.home ?? 0,
        awayScore: found.score?.fullTime?.away ?? found.score?.halfTime?.away ?? 0,
        minute: found.minute || null
      };
    }
    
    return { api: 'Football-Data', responseTime: Date.now() - start, found: false };
  } catch (error: any) {
    return { api: 'Football-Data', responseTime: Date.now() - start, found: false, error: error.message };
  }
}

async function testSportmonks(homeTeam: string, awayTeam: string): Promise<APISnapshot> {
  const start = Date.now();
  
  try {
    const response = await axios.get('https://api.sportmonks.com/v3/football/livescores/inplay', {
      params: { api_token: process.env.SPORTMONKS_API_KEY! }
    });
    
    // Response format farklı olabilir, bu yüzden basit bir kontrol
    return { api: 'Sportmonks', responseTime: Date.now() - start, found: false };
  } catch (error: any) {
    return { api: 'Sportmonks', responseTime: Date.now() - start, found: false, error: error.message };
  }
}

async function testLiveScore6(homeTeam: string, awayTeam: string): Promise<APISnapshot> {
  const start = Date.now();
  
  try {
    const response = await axios.get('https://livescore6.p.rapidapi.com/matches/v2/list-live', {
      params: { Category: 'soccer', Timezone: '-7' },
      headers: {
        'x-rapidapi-key': process.env.LIVESCORE_API_KEY!,
        'x-rapidapi-host': 'livescore6.p.rapidapi.com'
      }
    });
    
    const allEvents = (response.data.Stages || []).flatMap((stage: any) => stage.Events || []);
    
    const found = allEvents.find((e: any) => {
      const home = e.T1?.[0]?.Nm?.toLowerCase() || '';
      const away = e.T2?.[0]?.Nm?.toLowerCase() || '';
      const targetHome = homeTeam.toLowerCase();
      const targetAway = awayTeam.toLowerCase();
      
      return (home.includes(targetHome) || targetHome.includes(home)) &&
             (away.includes(targetAway) || targetAway.includes(away));
    });
    
    if (found) {
      return {
        api: 'LiveScore6',
        responseTime: Date.now() - start,
        found: true,
        homeScore: parseInt(found.Tr1 || '0'),
        awayScore: parseInt(found.Tr2 || '0'),
        minute: found.Eps ? parseInt(found.Eps.split("'")[0]) : null
      };
    }
    
    return { api: 'LiveScore6', responseTime: Date.now() - start, found: false };
  } catch (error: any) {
    return { api: 'LiveScore6', responseTime: Date.now() - start, found: false, error: error.message };
  }
}

async function runComparison() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🏁 LIVE MAÇLAR - API KARŞILAŞTIRMA');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('AMAÇ: Hangi API skorları en hızlı ve doğru güncelliyor?\n');
  
  const logsDir = path.join(process.cwd(), 'logs', 'api-comparison');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  const logFile = path.join(logsDir, `api_comparison_${new Date().toISOString().split('T')[0]}.jsonl`);
  
  // Skor geçmişi - hangi API ne zaman hangi skoru gördü
  const scoreHistory = new Map<string, Array<{timestamp: Date, api: string, score: string}>>();
  
  // 60 dakika boyunca 20 saniyede bir test et
  for (let i = 0; i < 180; i++) {
    const checkNum = i + 1;
    const timestamp = new Date();
    
    console.log(`\n🔍 CHECK #${checkNum} [${timestamp.toLocaleTimeString('tr-TR')}]`);
    console.log('━'.repeat(80));
    
    // TÜM API'leri paralel çağır
    console.log('� Calling ALL APIs in parallel...\n');
    
    const allAPIs = await Promise.allSettled([
      (async () => {
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
          const matches = (response.data.data || []).slice(0, 10).map((e: any) => {
            let minute = null;
            if (e.time?.currentPeriodStartTimestamp) {
              const now = Math.floor(Date.now() / 1000);
              const elapsed = now - e.time.currentPeriodStartTimestamp;
              minute = Math.floor(elapsed / 60);
              // 2. yarı kontrolü
              if (e.status?.description?.includes('2nd half') || e.status?.type === 'inprogress') {
                if (minute < 45) minute += 45; // 2. yarıda ise 45 ekle
              }
            }
            return {
              home: e.homeTeam?.name || '',
              away: e.awayTeam?.name || '',
              score: `${e.homeScore?.current ?? 0}-${e.awayScore?.current ?? 0}`,
              minute
            };
          });
          return { api: 'SofaSport', responseTime: Date.now() - start, matches, timestamp };
        } catch (e: any) {
          return { api: 'SofaSport', responseTime: Date.now() - start, matches: [], error: e.message, timestamp };
        }
      })(),
      (async () => {
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
          const allEvents = (response.data.Stages || []).flatMap((s: any) => s.Events || []).slice(0, 10);
          const matches = allEvents.map((e: any) => {
            let minute: number | string | null = null;
            if (e.Eps) {
              const epsStr = String(e.Eps).trim();
              // "64'" -> 64, "45+2'" -> 45, "HT" -> "HT", "FT" -> null
              if (epsStr === 'HT') {
                minute = 'HT';
              } else if (epsStr !== 'FT' && epsStr.length > 0) {
                const match = epsStr.match(/^(\d+)/);
                if (match) {
                  minute = parseInt(match[1]);
                }
              }
            }
            return {
              home: e.T1?.[0]?.Nm || '',
              away: e.T2?.[0]?.Nm || '',
              score: `${e.Tr1 || 0}-${e.Tr2 || 0}`,
              minute
            };
          });
          return { api: 'LiveScore6', responseTime: Date.now() - start, matches, timestamp };
        } catch (e: any) {
          return { api: 'LiveScore6', responseTime: Date.now() - start, matches: [], error: e.message, timestamp };
        }
      })()
    ]);
    
    // Sonuçları göster
    const apiResults: any[] = [];
    allAPIs.forEach((result) => {
      if (result.status === 'fulfilled') {
        const r = result.value;
        apiResults.push(r);
        const icon = r.responseTime < 500 ? '⚡' : r.responseTime < 2000 ? '📊' : '🐢';
        const status = r.error ? `❌ ${r.error}` : `✅ ${r.matches.length} matches`;
        console.log(`${icon} ${r.api.padEnd(15)} ${String(r.responseTime).padStart(5)}ms  ${status}`);
      }
    });
    
    console.log('\n📊 MATCH COMPARISON (İlk 5 maç):\n');
    
    // Ortak maçları bul ve karşılaştır
    const allMatches = new Map<string, any[]>();
    
    // Takım ismi normalize fonksiyonu - daha agresif
    const normalizeTeam = (name: string) => {
      return name.toLowerCase()
        .replace(/\b(fc|sc|cf|ac|ca|rb|red bull|sport club|club|athletic|clube|ec|fr|cr)\b/gi, '')
        .replace(/\b(recife|sport)\b/gi, 'recife') // Sport Recife için
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
    };
    
    apiResults.forEach(api => {
      api.matches.forEach((match: any) => {
        const homeNorm = normalizeTeam(match.home);
        const awayNorm = normalizeTeam(match.away);
        const key = `${homeNorm.substring(0, 8)} vs ${awayNorm.substring(0, 8)}`;
        if (!allMatches.has(key)) allMatches.set(key, []);
        allMatches.get(key)!.push({ ...match, api: api.api, apiTime: api.timestamp });
      });
    });
    
    let matchNum = 1;
    for (const [key, sources] of allMatches.entries()) {
      if (sources.length < 2 || matchNum > 5) continue;
      
      const first = sources[0];
      console.log(`${matchNum}. ${first.home} vs ${first.away}`);
      
      sources.forEach(s => {
        console.log(`   ${s.api.padEnd(15)} ${s.score.padEnd(6)} (${String(s.minute || 'N/A').padStart(3)}')`);
        
        // Skor geçmişine ekle
        const historyKey = `${first.home} vs ${first.away}`;
        if (!scoreHistory.has(historyKey)) scoreHistory.set(historyKey, []);
        scoreHistory.get(historyKey)!.push({
          timestamp: s.apiTime,
          api: s.api,
          score: s.score
        });
      });
      
      // Skor uyuşmazlığı kontrolü
      const scores = sources.map((s: any) => s.score);
      const uniqueScores = [...new Set(scores)];
      
      if (uniqueScores.length > 1) {
        console.log(`   ⚠️  SKOR UYUŞMAZLIĞI! ${uniqueScores.join(' vs ')}`);
        
        // Hangi API ilk güncelledi?
        const history = scoreHistory.get(`${first.home} vs ${first.away}`) || [];
        if (history.length > 1) {
          const latestScore = history[history.length - 1].score;
          const previousScore = history[history.length - 2].score;
          if (latestScore !== previousScore) {
            const firstUpdater = history[history.length - 1];
            console.log(`   🏆 İLK GÜNCELLEYEN: ${firstUpdater.api} (${firstUpdater.score})`);
          }
        }
      } else {
        console.log(`   ✅ Tüm API'ler aynı: ${uniqueScores[0]}`);
      }
      
      console.log('');
      matchNum++;
    }
    
    // Log kaydet
    const logEntry = {
      timestamp: timestamp.toISOString(),
      checkNumber: checkNum,
      apis: apiResults
    };
    fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
    
    if (i < 179) {
      console.log('⏳ Waiting 20 seconds...\n');
      await new Promise(resolve => setTimeout(resolve, 20000));
    }
  }
  
  console.log('\n✅ Comparison completed!\n');
}

runComparison().catch(console.error);