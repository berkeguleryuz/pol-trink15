/**
 * BUGÜNKÜ MAÇLARI LİNKLE - API-Football ID'lerini ekle
 * 
 * API-Football'dan bugünün TÜM maçlarını çeker
 * Polymarket maçlarıyla eşleştirir
 * apiFootballId + kickoffUTC ekler
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

const API_KEY = '1e740a955d2767e80806740c4f492f29';
const API_BASE = 'https://v3.football.api-sports.io';

interface ApiFootballFixture {
  fixture: {
    id: number;
    date: string;
    timestamp: number;
    status: {
      short: string;
      long: string;
      elapsed: number | null;
    };
  };
  league: {
    id: number;
    name: string;
    country: string;
  };
  teams: {
    home: {
      id: number;
      name: string;
    };
    away: {
      id: number;
      name: string;
    };
  };
  goals: {
    home: number | null;
    away: number | null;
  };
}

interface FootballMatch {
  id: string;
  slug: string;
  title: string;
  homeTeam?: string | null;
  awayTeam?: string | null;
  endDate?: string;
  apiFootballId?: number;
  kickoffUTC?: string;
  homeScore?: number;
  awayScore?: number;
  currentMinute?: number;
  [key: string]: any;
}

/**
 * API-Football'dan bugünkü tüm maçları çek
 */
async function fetchTodaysFixtures(): Promise<ApiFootballFixture[]> {
  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    
    console.log(`\n📡 API-Football'dan bugünkü maçlar çekiliyor (${today})...`);
    
    const response = await axios.get(`${API_BASE}/fixtures`, {
      headers: { 'x-apisports-key': API_KEY },
      params: {
        date: today,
        timezone: 'Europe/Berlin'
      },
      timeout: 10000
    });
    
    const fixtures = response.data.response as ApiFootballFixture[];
    console.log(`✅ ${fixtures.length} maç bulundu\n`);
    
    return fixtures;
  } catch (error: any) {
    console.error('❌ API-Football hatası:', error.message);
    return [];
  }
}

/**
 * Takım isimlerini normalize et (fuzzy matching için)
 */
function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+(fc|sc|cf|ac|bk|fk|afc|club|united|city|town|rovers|athletic|real|sporting)\b/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * İki takım isminin benzerliğini hesapla
 */
function similarity(a: string, b: string): number {
  const normA = normalizeTeamName(a);
  const normB = normalizeTeamName(b);
  
  if (normA === normB) return 1.0;
  if (normA.includes(normB) || normB.includes(normA)) return 0.8;
  
  // Levenshtein benzeri basit similarity
  let matches = 0;
  for (let i = 0; i < Math.min(normA.length, normB.length); i++) {
    if (normA[i] === normB[i]) matches++;
  }
  return matches / Math.max(normA.length, normB.length);
}

/**
 * Polymarket maçını API-Football fixture ile eşleştir
 */
function matchFixture(match: FootballMatch, fixtures: ApiFootballFixture[]): ApiFootballFixture | null {
  if (!match.homeTeam || !match.awayTeam) return null;
  
  let bestMatch: ApiFootballFixture | null = null;
  let bestScore = 0;
  
  for (const fixture of fixtures) {
    const homeScore = similarity(match.homeTeam, fixture.teams.home.name);
    const awayScore = similarity(match.awayTeam, fixture.teams.away.name);
    const totalScore = (homeScore + awayScore) / 2;
    
    if (totalScore > bestScore && totalScore > 0.6) {
      bestScore = totalScore;
      bestMatch = fixture;
    }
  }
  
  return bestMatch;
}

/**
 * Ana fonksiyon - Maçları linkle
 */
export async function linkTodaysMatches(dataPath: string): Promise<number> {
  console.log('\n🔗 BUGÜNKÜ MAÇLARI LİNKLE\n');
  console.log('='.repeat(60));
  
  // 1. Bugünkü API-Football maçlarını çek
  const fixtures = await fetchTodaysFixtures();
  if (fixtures.length === 0) {
    console.log('⚠️  API-Football\'dan maç alınamadı');
    return 0;
  }
  
  // 2. Polymarket maçlarını oku
  if (!fs.existsSync(dataPath)) {
    console.error('❌ football-matches.json bulunamadı!');
    return 0;
  }
  
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const matches: FootballMatch[] = data.matches || [];
  
  console.log(`📊 Polymarket: ${matches.length} maç\n`);
  
  // 3. Eşleştir
  let linkedCount = 0;
  const today = new Date().toISOString().split('T')[0];
  
  for (const match of matches) {
    // Bugünkü maçlara bak
    if (!match.endDate || !match.endDate.startsWith(today)) continue;
    
    // Zaten linked mi?
    if (match.apiFootballId) continue;
    
    // Fixture bul
    const fixture = matchFixture(match, fixtures);
    if (fixture) {
      match.apiFootballId = fixture.fixture.id;
      match.kickoffUTC = fixture.fixture.date;
      
      // Eğer maç başladıysa skor ve dakika ekle
      if (fixture.fixture.status.elapsed !== null && fixture.fixture.status.elapsed > 0) {
        match.currentMinute = fixture.fixture.status.elapsed;
        match.homeScore = fixture.goals.home ?? 0;
        match.awayScore = fixture.goals.away ?? 0;
      }
      
      linkedCount++;
      
      console.log(`✅ ${match.title}`);
      console.log(`   → API-Football ID: ${fixture.fixture.id}`);
      console.log(`   → Kickoff: ${fixture.fixture.date}`);
      if (fixture.fixture.status.elapsed) {
        console.log(`   → Status: ${fixture.fixture.status.short} (${fixture.fixture.status.elapsed}')`);
        console.log(`   → Score: ${fixture.goals.home}-${fixture.goals.away}`);
      }
      console.log();
    }
  }
  
  // 4. Kaydet
  if (linkedCount > 0) {
    data.matches = matches;
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
    console.log(`\n✅ ${linkedCount} maç API-Football ile linklendi!`);
  } else {
    console.log('\n⚠️  Hiç maç eşleştirilemedi');
  }
  
  console.log('='.repeat(60) + '\n');
  return linkedCount;
}

// CLI usage
if (require.main === module) {
  const dataPath = path.join(__dirname, '../../data/football-matches.json');
  linkTodaysMatches(dataPath)
    .then(count => {
      console.log(`\n🎯 Toplam ${count} maç linklendi`);
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Hata:', error);
      process.exit(1);
    });
}
