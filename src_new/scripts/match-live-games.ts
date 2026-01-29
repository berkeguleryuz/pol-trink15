/**
 * LIVE MATCH MATCHER
 * 
 * API-Football'dan canlı maçları çek
 * Polymarket maçlarıyla eşleştir
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

interface APIFootballFixture {
  fixture: {
    id: number;
    date: string;
    status: {
      elapsed: number;
      short: string;
    };
  };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
  goals: {
    home: number | null;
    away: number | null;
  };
  league: {
    id: number;
    name: string;
    country: string;
  };
}

async function fetchLiveMatches(): Promise<APIFootballFixture[]> {
  const apiKey = process.env.FOOTBALL_API_KEY || '1e740a955d2767e80806740c4f492f29';
  
  try {
    console.log('📡 API-Football\'dan canlı maçlar çekiliyor...\n');
    
    const response = await axios.get('https://v3.football.api-sports.io/fixtures', {
      params: { live: 'all' },
      headers: { 'x-apisports-key': apiKey },
      timeout: 10000
    });

    if (response.data?.response) {
      console.log(`✅ ${response.data.response.length} canlı maç bulundu\n`);
      return response.data.response;
    }

    return [];
  } catch (error: any) {
    console.error('❌ API-Football hatası:', error.message);
    return [];
  }
}

function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .trim();
}

function matchTeams(polyTeam: string, apiTeam: string): boolean {
  const poly = normalizeTeamName(polyTeam);
  const api = normalizeTeamName(apiTeam);
  
  // Exact match
  if (poly === api) return true;
  
  // Contains match
  if (poly.includes(api) || api.includes(poly)) return true;
  
  // Fuzzy match (first 3 chars)
  if (poly.substring(0, 3) === api.substring(0, 3)) return true;
  
  return false;
}

async function matchLiveGames() {
  // Load Polymarket matches
  const dataPath = path.join(__dirname, '../../data/football-matches.json');
  const rawData = fs.readFileSync(dataPath, 'utf-8');
  let polymatches: any[] = [];
  let originalData: any;
  
  try {
    originalData = JSON.parse(rawData);
    
    // Handle different JSON structures
    if (Array.isArray(originalData) && originalData[0]?.matches) {
      polymatches = originalData[0].matches;
    } else if (Array.isArray(originalData)) {
      polymatches = originalData;
    } else if (originalData.matches) {
      polymatches = originalData.matches;
    } else {
      polymatches = [originalData];
    }
  } catch (error) {
    console.error('❌ JSON parse hatası:', error);
    return;
  }
  
  console.log(`📊 Polymarket maçları: ${polymatches.length}\n`);
  
  // Fetch live matches
  const liveMatches = await fetchLiveMatches();
  
  if (liveMatches.length === 0) {
    console.log('⚠️  Şu anda canlı maç yok\n');
    return;
  }

  console.log('🔴 CANLI MAÇLAR:\n');
  console.log('='.repeat(80));
  
  let matchCount = 0;
  
  for (const live of liveMatches) {
    console.log(`\n${live.fixture.id} | ${live.teams.home.name} vs ${live.teams.away.name}`);
    console.log(`   ${live.fixture.status.elapsed}' - ${live.goals.home}-${live.goals.away}`);
    console.log(`   🏆 ${live.league.name} (${live.league.country})`);
    
    // Polymarket'te eşleşen maçı bul
    const matched = polymatches.find((pm: any) => {
      // Parse teams from title if homeTeam/awayTeam are null
      let homeTeam = pm.homeTeam;
      let awayTeam = pm.awayTeam;
      
      if (!homeTeam || !awayTeam) {
        const titleParts = (pm.title || '').split(' vs. ');
        if (titleParts.length === 2) {
          homeTeam = titleParts[0].trim();
          awayTeam = titleParts[1].trim();
        } else {
          return false;
        }
      }
      
      const homeMatch = matchTeams(homeTeam, live.teams.home.name);
      const awayMatch = matchTeams(awayTeam, live.teams.away.name);
      
      return homeMatch && awayMatch;
    });
    
    if (matched) {
      console.log(`   ✅ EŞLEŞTİ: ${matched.slug}`);
      console.log(`   📍 ${matched.title}`);
      console.log(`   🔗 polymarket.com/event/${matched.slug}`);
      
      // Update apiFootballId
      matched.apiFootballId = live.fixture.id;
      matched.homeScore = live.goals.home;
      matched.awayScore = live.goals.away;
      matched.currentMinute = live.fixture.status.elapsed;
      
      matchCount++;
    } else {
      console.log(`   ⚠️  Polymarket'te bulunamadı`);
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log(`\n✅ ${matchCount} maç eşleştirildi\n`);
  
  // Save updated matches
  if (matchCount > 0) {
    if (Array.isArray(originalData) && originalData[0]?.matches) {
      originalData[0].matches = polymatches;
    } else if (originalData.matches) {
      originalData.matches = polymatches;
    } else if (Array.isArray(originalData)) {
      originalData = polymatches;
    }
    
    fs.writeFileSync(dataPath, JSON.stringify(originalData, null, 2));
    console.log('💾 football-matches.json güncellendi\n');
  }
}

// Run
matchLiveGames().catch(console.error);
