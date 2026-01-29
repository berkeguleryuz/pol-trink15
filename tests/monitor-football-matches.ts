import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

interface FootballMatch {
  id: string;
  slug: string;
  title: string;
  endDate: string;
  matchDate: string;
  kickoffTime: string;
  kickoffUTC: string;
  status: 'upcoming' | 'soon' | 'live' | 'finished';
  minutesUntilKickoff?: number;
  volume24hr?: number;
  liquidity?: number;
  sport?: string;
}

interface LiveMatch extends FootballMatch {
  apiFootballId?: number;
  homeTeam: string;
  awayTeam: string;
  currentMinute?: number;
  score?: {
    home: number;
    away: number;
  };
  events?: any[];
}

/**
 * Futbol maçlarını yükle
 */
function loadFootballMatches(): FootballMatch[] {
  const dataPath = path.join(__dirname, '..', 'data', 'football-matches.json');
  
  if (!fs.existsSync(dataPath)) {
    console.error('❌ football-matches.json bulunamadı!');
    console.error('   Önce: npx ts-node tests/filter-football-matches.ts');
    return [];
  }
  
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  return data.matches || [];
}

/**
 * UTC zamanı Berlin saatine çevir (UTC+1)
 */
function convertToBerlinTime(utcDateString: string): string {
  const date = new Date(utcDateString);
  const berlinDate = new Date(date.getTime() + (1 * 60 * 60 * 1000));
  
  const year = berlinDate.getUTCFullYear();
  const month = String(berlinDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(berlinDate.getUTCDate()).padStart(2, '0');
  const hours = String(berlinDate.getUTCHours()).padStart(2, '0');
  const minutes = String(berlinDate.getUTCMinutes()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

/**
 * Maç durumunu güncelle
 */
function updateMatchStatus(match: FootballMatch): FootballMatch {
  const now = new Date();
  const kickoff = new Date(match.kickoffUTC);
  const diffMs = kickoff.getTime() - now.getTime();
  const minutesUntilKickoff = Math.floor(diffMs / (1000 * 60));
  
  let status: 'upcoming' | 'soon' | 'live' | 'finished';
  
  if (minutesUntilKickoff < -120) {
    status = 'finished';
  } else if (minutesUntilKickoff < 0) {
    status = 'live';
  } else if (minutesUntilKickoff < 30) {
    status = 'soon';
  } else {
    status = 'upcoming';
  }
  
  return {
    ...match,
    status,
    minutesUntilKickoff
  };
}

/**
 * API-Football'dan canlı maçları çek
 */
async function fetchLiveMatches(): Promise<any[]> {
  try {
    const response = await axios.get('https://v3.football.api-sports.io/fixtures', {
      params: {
        live: 'all'
      },
      headers: {
        'x-apisports-key': process.env.FOOTBALL_API_KEY || 'c4dcf7c91bmshd3e4324b3adfdcep157e50jsn4bf5b7c8d74a'
      },
      timeout: 5000
    });
    
    if (response.data && response.data.response) {
      return response.data.response;
    }
    
    return [];
  } catch (error: any) {
    console.error('⚠️  API-Football hatası:', error.message);
    return [];
  }
}

/**
 * Takım isimlerini normalize et
 */
function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^fc-|^afc-|^sc-|^cf-/g, '') // FC, AFC, SC, CF prefix'lerini kaldır
    .replace(/-fc$|-afc$|-sc$|-cf$/g, ''); // Suffix'leri kaldır
}

/**
 * Slug'dan takım isimlerini çıkar
 */
function extractTeamsFromSlug(slug: string): { home: string; away: string } | null {
  // Format: league-team1-team2-YYYY-MM-DD
  const parts = slug.split('-');
  
  if (parts.length < 5) return null;
  
  // Son 3 part tarih (YYYY-MM-DD)
  const withoutDate = parts.slice(0, -3);
  
  // İlk part lig
  const withoutLeague = withoutDate.slice(1);
  
  if (withoutLeague.length < 2) return null;
  
  // Takımları ayır (genelde ilk yarı home, ikinci yarı away)
  const mid = Math.floor(withoutLeague.length / 2);
  const home = withoutLeague.slice(0, mid).join('-');
  const away = withoutLeague.slice(mid).join('-');
  
  return { home, away };
}

/**
 * Polymarket maçını API-Football canlı maçlarıyla eşleştir
 */
function matchPolymarketWithLive(polyMatch: FootballMatch, liveMatches: any[]): LiveMatch | null {
  const teams = extractTeamsFromSlug(polyMatch.slug);
  if (!teams) return null;
  
  const polyHome = normalizeTeamName(teams.home);
  const polyAway = normalizeTeamName(teams.away);
  
  for (const liveMatch of liveMatches) {
    const apiHome = normalizeTeamName(liveMatch.teams.home.name);
    const apiAway = normalizeTeamName(liveMatch.teams.away.name);
    
    // Fuzzy match
    if (
      (apiHome.includes(polyHome) || polyHome.includes(apiHome)) &&
      (apiAway.includes(polyAway) || polyAway.includes(apiAway))
    ) {
      return {
        ...polyMatch,
        apiFootballId: liveMatch.fixture.id,
        homeTeam: liveMatch.teams.home.name,
        awayTeam: liveMatch.teams.away.name,
        currentMinute: liveMatch.fixture.status.elapsed,
        score: {
          home: liveMatch.goals.home || 0,
          away: liveMatch.goals.away || 0
        },
        events: liveMatch.events || []
      };
    }
  }
  
  return null;
}

/**
 * Ana monitoring döngüsü
 */
async function monitorMatches() {
  console.log('\n' + '='.repeat(80));
  console.log('⚽ POLYMARKET FUTBOL MAÇLARI - CANLI TAKİP SİSTEMİ');
  console.log('='.repeat(80));
  console.log(`🕐 Berlin Saati: ${convertToBerlinTime(new Date().toISOString())}`);
  console.log('='.repeat(80));
  
  // Maçları yükle
  let matches = loadFootballMatches();
  
  if (matches.length === 0) {
    console.error('\n❌ Futbol maçı bulunamadı!');
    return;
  }
  
  console.log(`\n📊 Toplam ${matches.length} futbol maçı yüklendi\n`);
  
  // Durumları güncelle
  matches = matches.map(updateMatchStatus);
  
  // Duruma göre grupla
  const liveMatches = matches.filter(m => m.status === 'live');
  const soonMatches = matches.filter(m => m.status === 'soon');
  const upcomingToday = matches.filter(m => {
    const today = new Date().toISOString().split('T')[0];
    return m.matchDate === today && m.status === 'upcoming';
  });
  
  console.log('📊 DURUM:');
  console.log(`   🔴 Canlı (LIVE):        ${liveMatches.length} maç`);
  console.log(`   🟡 Yakında (0-30 dk):   ${soonMatches.length} maç`);
  console.log(`   🟢 Bugün (30+ dk):      ${upcomingToday.length} maç`);
  console.log(`   📅 Gelecek günler:      ${matches.filter(m => m.status === 'upcoming' && m.matchDate !== new Date().toISOString().split('T')[0]).length} maç\n`);
  
  // Yakında başlayacak maçlar
  if (soonMatches.length > 0) {
    console.log('='.repeat(80));
    console.log('🟡 YAKINDA BAŞLAYACAK MAÇLAR (0-30 DAKİKA)');
    console.log('='.repeat(80));
    
    soonMatches.forEach((match, index) => {
      console.log(`\n${index + 1}. ${match.sport} - ${match.title}`);
      console.log(`   🔗 ${match.slug}`);
      console.log(`   ⚽ Başlama: ${match.kickoffTime} (Berlin)`);
      console.log(`   ⏱️  ${match.minutesUntilKickoff} dakika kaldı`);
      console.log(`   💰 Volume: $${(match.volume24hr || 0).toLocaleString()}`);
      console.log(`   💧 Liquidity: $${(match.liquidity || 0).toLocaleString()}`);
      console.log(`   🎯 Aksiyon: MAÇ BAŞLADIĞINDA HEMEN TRADE BAŞLAT!`);
    });
  }
  
  // Canlı maçlar için API-Football kontrolü
  if (liveMatches.length > 0) {
    console.log('\n='.repeat(80));
    console.log('🔴 CANLI MAÇLAR - API-FOOTBALL KONTROLÜ');
    console.log('='.repeat(80));
    console.log('\n⏳ API-Football\'dan canlı maçlar getiriliyor...\n');
    
    const apiLiveMatches = await fetchLiveMatches();
    console.log(`✅ ${apiLiveMatches.length} canlı maç bulundu API-Football\'da\n`);
    
    let matchedCount = 0;
    
    for (const polyMatch of liveMatches) {
      const liveMatch = matchPolymarketWithLive(polyMatch, apiLiveMatches);
      
      if (liveMatch) {
        matchedCount++;
        console.log('='.repeat(80));
        console.log(`🎯 EŞLEŞTİ! ${liveMatch.sport} - ${liveMatch.title}`);
        console.log('='.repeat(80));
        console.log(`   🔗 Polymarket Slug: ${liveMatch.slug}`);
        console.log(`   ⚽ API-Football ID: ${liveMatch.apiFootballId}`);
        console.log(`   🏆 Maç: ${liveMatch.homeTeam} vs ${liveMatch.awayTeam}`);
        console.log(`   ⏱️  Dakika: ${liveMatch.currentMinute}'`);
        console.log(`   📊 Skor: ${liveMatch.score?.home} - ${liveMatch.score?.away}`);
        console.log(`   💰 Volume: $${(liveMatch.volume24hr || 0).toLocaleString()}`);
        console.log(`   💧 Liquidity: $${(liveMatch.liquidity || 0).toLocaleString()}`);
        console.log(`   🎯 AKSİYON: HEMEN TRADE BAŞLAT! GOL TAKİBİ AKTİF!`);
        
        // Son olayları göster
        if (liveMatch.events && liveMatch.events.length > 0) {
          console.log('\n   📝 Son Olaylar:');
          liveMatch.events.slice(-5).forEach((event: any) => {
            const icon = event.type === 'Goal' ? '⚽' : event.type === 'Card' ? '🟨' : '📌';
            console.log(`      ${icon} ${event.time.elapsed}' - ${event.type}: ${event.player.name} (${event.team.name})`);
          });
        }
      }
    }
    
    if (matchedCount === 0) {
      console.log('⚠️  Polymarket\'te canlı olan maçlar API-Football\'da bulunamadı');
      console.log('   Bu maçlar başlamış olabilir ama API henüz tespit etmemiş.');
      console.log('   Veya maç slug eşleştirmesi başarısız olmuş olabilir.\n');
      
      liveMatches.forEach((match, index) => {
        console.log(`${index + 1}. ${match.sport} - ${match.title}`);
        console.log(`   🔗 ${match.slug}`);
        console.log(`   ⚽ ${Math.abs(match.minutesUntilKickoff || 0)} dk önce başladı\n`);
      });
    }
  }
  
  // Bugün oynanacak maçlar
  if (upcomingToday.length > 0) {
    console.log('\n='.repeat(80));
    console.log('🟢 BUGÜN OYNANACAK DİĞER MAÇLAR (İLK 5)');
    console.log('='.repeat(80));
    
    upcomingToday.slice(0, 5).forEach((match, index) => {
      const hours = Math.floor((match.minutesUntilKickoff || 0) / 60);
      const mins = (match.minutesUntilKickoff || 0) % 60;
      
      console.log(`\n${index + 1}. ${match.sport} - ${match.title}`);
      console.log(`   🔗 ${match.slug}`);
      console.log(`   ⚽ Başlama: ${match.kickoffTime} (Berlin)`);
      console.log(`   ⏱️  ${hours} saat ${mins} dakika kaldı`);
      if ((match.volume24hr || 0) > 1000) {
        console.log(`   💰 Volume: $${(match.volume24hr || 0).toLocaleString()}`);
      }
    });
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('✅ Tarama tamamlandı!');
  console.log('='.repeat(80));
  console.log('\n💡 ÖNERİ:');
  console.log('   - Yakında başlayacak maçlar varsa (🟡) → 5 dk\'da bir kontrol et');
  console.log('   - Canlı maç varsa (🔴) → API-Football\'dan 2 saniyede bir gol takibi yap');
  console.log('   - Gol olduğunda → Anında Polymarket\'te alım/satım yap!');
  console.log('\n📂 Dosyalar:');
  console.log('   - data/football-matches.json → Tüm futbol maçları');
  console.log('   - src/bot/production-sports-bot.ts → Trading bot entegrasyonu\n');
}

// Çalıştır
monitorMatches().catch(console.error);
