import * as fs from 'fs';
import * as path from 'path';

interface MatchData {
  id: string;
  slug: string;
  title: string;
  endDate: string;
  matchDate: string;
  volume24hr?: number;
  liquidity?: number;
  sport?: string;
}

interface FootballMatch extends MatchData {
  kickoffTime: string; // Berlin/Europe saati (UTC+1)
  kickoffUTC: string;  // Orijinal UTC
  status: 'upcoming' | 'soon' | 'live' | 'finished';
  minutesUntilKickoff?: number;
}

/**
 * Futbol sporları listesi
 */
const FOOTBALL_SPORTS = [
  'EPL',      // English Premier League
  'LAL',      // La Liga
  'BUN',      // Bundesliga
  'SEA',      // Serie A
  'FL1',      // French Ligue 1
  'UEL',      // UEFA Europa League
  'UCL',      // UEFA Champions League
  'COL',      // Conference League
  'POR',      // Portuguese Liga
  'ERE',      // Eredivisie (Netherlands)
  'SPL',      // Saudi Pro League
  'TUR',      // Turkish Super Lig
  'BRA',      // Brasileiro
  'ARG',      // Argentina Liga
  'MEX',      // Liga MX
  'MLS',      // MLS
  'RUS',      // Russian Premier League
  'DEN',      // Danish Superliga
  'NOR',      // Norwegian Eliteserien
  'SHE',      // Scottish Premiership
  'AUS',      // Australian A-League
  'JAP',      // J-League
  'KOR',      // K-League
  'CSA',      // South Africa
  'ELC',      // English League Championship
  'FIF',      // FIFA (World Cup, etc.)
];

/**
 * UTC zamanı Berlin/Europe saatine çevir (UTC+1)
 */
function convertToBerlinTime(utcDateString: string): string {
  const date = new Date(utcDateString);
  
  // Berlin/Europe saati için UTC+1 ekle
  const berlinDate = new Date(date.getTime() + (1 * 60 * 60 * 1000));
  
  // Format: 2025-11-06 20:00 (Berlin)
  const year = berlinDate.getUTCFullYear();
  const month = String(berlinDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(berlinDate.getUTCDate()).padStart(2, '0');
  const hours = String(berlinDate.getUTCHours()).padStart(2, '0');
  const minutes = String(berlinDate.getUTCMinutes()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

/**
 * Maç durumunu belirle
 */
function getMatchStatus(kickoffUTC: string): {
  status: 'upcoming' | 'soon' | 'live' | 'finished';
  minutesUntilKickoff: number;
} {
  const now = new Date();
  const kickoff = new Date(kickoffUTC);
  const diffMs = kickoff.getTime() - now.getTime();
  const minutesUntilKickoff = Math.floor(diffMs / (1000 * 60));
  
  let status: 'upcoming' | 'soon' | 'live' | 'finished';
  
  if (minutesUntilKickoff < -120) {
    // 2 saatten fazla geçti → Bitmiş
    status = 'finished';
  } else if (minutesUntilKickoff < 0) {
    // Başladı ama 2 saat geçmedi → Canlı
    status = 'live';
  } else if (minutesUntilKickoff < 30) {
    // 30 dakikadan az kaldı → Yakında başlıyor
    status = 'soon';
  } else {
    // Henüz erken
    status = 'upcoming';
  }
  
  return { status, minutesUntilKickoff };
}

/**
 * Sadece futbol maçlarını filtrele
 */
function filterFootballMatches(): FootballMatch[] {
  const dataPath = path.join(__dirname, '..', 'data', 'polymarket-matches.json');
  
  if (!fs.existsSync(dataPath)) {
    console.error('❌ Polymarket matches dosyası bulunamadı!');
    console.error('   Önce: npx ts-node tests/scrape-polyfund-matches.ts');
    return [];
  }
  
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const allMatches: MatchData[] = data.matches || [];
  
  console.log(`\n📊 Toplam ${allMatches.length} maç yüklendi`);
  
  // Sadece futbol maçlarını filtrele
  const footballMatches = allMatches.filter(match => {
    return FOOTBALL_SPORTS.includes(match.sport || '');
  });
  
  console.log(`⚽ ${footballMatches.length} futbol maçı bulundu\n`);
  
  // Berlin saati ve status ekle
  const enrichedMatches: FootballMatch[] = footballMatches.map(match => {
    const berlinTime = convertToBerlinTime(match.endDate);
    const { status, minutesUntilKickoff } = getMatchStatus(match.endDate);
    
    return {
      ...match,
      kickoffTime: berlinTime,
      kickoffUTC: match.endDate,
      status,
      minutesUntilKickoff
    };
  });
  
  // Zamana göre sırala (en yakın maçlar önce)
  enrichedMatches.sort((a, b) => {
    return new Date(a.kickoffUTC).getTime() - new Date(b.kickoffUTC).getTime();
  });
  
  return enrichedMatches;
}

/**
 * Maçları kaydet
 */
function saveFootballMatches(matches: FootballMatch[]): void {
  const dataPath = path.join(__dirname, '..', 'data', 'football-matches.json');
  
  const saveData = {
    updatedAt: new Date().toISOString(),
    berlinTime: convertToBerlinTime(new Date().toISOString()),
    totalMatches: matches.length,
    matches
  };
  
  fs.writeFileSync(dataPath, JSON.stringify(saveData, null, 2));
  console.log(`💾 ${matches.length} futbol maçı kaydedildi: ${dataPath}\n`);
}

/**
 * İstatistikleri yazdır
 */
function printStatistics(matches: FootballMatch[]): void {
  console.log('='.repeat(80));
  console.log('⚽ FUTBOL MAÇLARI İSTATİSTİKLERİ');
  console.log('='.repeat(80));
  
  // Duruma göre grupla
  const byStatus = {
    live: matches.filter(m => m.status === 'live'),
    soon: matches.filter(m => m.status === 'soon'),
    upcoming: matches.filter(m => m.status === 'upcoming'),
    finished: matches.filter(m => m.status === 'finished')
  };
  
  console.log('\n📊 DURUM:');
  console.log(`   🔴 Canlı (LIVE):        ${byStatus.live.length} maç`);
  console.log(`   🟡 Yakında (0-30 dk):   ${byStatus.soon.length} maç`);
  console.log(`   🟢 Gelecek (30+ dk):    ${byStatus.upcoming.length} maç`);
  console.log(`   ⚫ Bitmiş:              ${byStatus.finished.length} maç`);
  
  // Lige göre grupla
  const byLeague: { [league: string]: number } = {};
  matches.forEach(match => {
    const league = match.sport || 'UNKNOWN';
    byLeague[league] = (byLeague[league] || 0) + 1;
  });
  
  console.log('\n🏆 LİGLERE GÖRE:');
  Object.entries(byLeague)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([league, count]) => {
      console.log(`   ${league}: ${count} maç`);
    });
  
  // Güne göre grupla
  const byDate: { [date: string]: number } = {};
  matches.forEach(match => {
    byDate[match.matchDate] = (byDate[match.matchDate] || 0) + 1;
  });
  
  console.log('\n📅 TARIHLERE GÖRE:');
  Object.entries(byDate)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([date, count]) => {
      const dateObj = new Date(date);
      const dayName = dateObj.toLocaleDateString('tr-TR', { weekday: 'long' });
      const isToday = date === new Date().toISOString().split('T')[0];
      console.log(`   ${date} (${dayName}): ${count} maç ${isToday ? '← BUGÜN' : ''}`);
    });
  
  console.log('\n' + '='.repeat(80));
}

/**
 * Canlı ve yaklaşan maçları göster
 */
function printLiveAndUpcoming(matches: FootballMatch[]): void {
  const liveMatches = matches.filter(m => m.status === 'live');
  const soonMatches = matches.filter(m => m.status === 'soon');
  const upcomingToday = matches.filter(m => {
    const today = new Date().toISOString().split('T')[0];
    return m.matchDate === today && m.status === 'upcoming';
  });
  
  if (liveMatches.length > 0) {
    console.log('\n' + '='.repeat(80));
    console.log('🔴 CANLI MAÇLAR (ŞU ANDA OYNANIYOR!)');
    console.log('='.repeat(80));
    
    liveMatches.forEach((match, index) => {
      console.log(`\n${index + 1}. ${match.sport} - ${match.title}`);
      console.log(`   🔗 ${match.slug}`);
      console.log(`   ⚽ Başlama: ${match.kickoffTime} (Berlin)`);
      console.log(`   ⏱️  ${Math.abs(match.minutesUntilKickoff || 0)} dakika önce başladı`);
      if (match.volume24hr) {
        console.log(`   💰 Volume: $${match.volume24hr.toLocaleString()}`);
      }
      if (match.liquidity) {
        console.log(`   💧 Liquidity: $${match.liquidity.toLocaleString()}`);
      }
    });
  }
  
  if (soonMatches.length > 0) {
    console.log('\n' + '='.repeat(80));
    console.log('🟡 YAKINDA BAŞLAYACAK MAÇLAR (0-30 DAKİKA)');
    console.log('='.repeat(80));
    
    soonMatches.forEach((match, index) => {
      console.log(`\n${index + 1}. ${match.sport} - ${match.title}`);
      console.log(`   🔗 ${match.slug}`);
      console.log(`   ⚽ Başlama: ${match.kickoffTime} (Berlin)`);
      console.log(`   ⏱️  ${match.minutesUntilKickoff} dakika kaldı`);
      if (match.volume24hr) {
        console.log(`   💰 Volume: $${match.volume24hr.toLocaleString()}`);
      }
      if (match.liquidity) {
        console.log(`   💧 Liquidity: $${match.liquidity.toLocaleString()}`);
      }
    });
  }
  
  if (upcomingToday.length > 0) {
    console.log('\n' + '='.repeat(80));
    console.log('🟢 BUGÜN OYNANACAK DİĞER MAÇLAR');
    console.log('='.repeat(80));
    
    upcomingToday.slice(0, 10).forEach((match, index) => {
      console.log(`\n${index + 1}. ${match.sport} - ${match.title}`);
      console.log(`   🔗 ${match.slug}`);
      console.log(`   ⚽ Başlama: ${match.kickoffTime} (Berlin)`);
      console.log(`   ⏱️  ${Math.floor((match.minutesUntilKickoff || 0) / 60)} saat ${(match.minutesUntilKickoff || 0) % 60} dakika kaldı`);
      if (match.volume24hr && match.volume24hr > 1000) {
        console.log(`   💰 Volume: $${match.volume24hr.toLocaleString()}`);
      }
    });
    
    if (upcomingToday.length > 10) {
      console.log(`\n   ... ve ${upcomingToday.length - 10} maç daha`);
    }
  }
  
  console.log('\n' + '='.repeat(80));
}

/**
 * Ana fonksiyon
 */
async function main() {
  console.log('\n⚽ FUTBOL MAÇLARI FİLTRESİ');
  console.log('='.repeat(80));
  console.log('🕐 Şu anki Berlin saati: ' + convertToBerlinTime(new Date().toISOString()));
  console.log('='.repeat(80));
  
  // Futbol maçlarını filtrele
  const footballMatches = filterFootballMatches();
  
  if (footballMatches.length === 0) {
    console.error('\n❌ Futbol maçı bulunamadı!');
    return;
  }
  
  // Kaydet
  saveFootballMatches(footballMatches);
  
  // İstatistikleri göster
  printStatistics(footballMatches);
  
  // Canlı ve yaklaşan maçları göster
  printLiveAndUpcoming(footballMatches);
  
  console.log('\n✅ Tamamlandı!\n');
  console.log('📂 Futbol maçları: data/football-matches.json');
  console.log('💡 Bot entegrasyonu için bu dosyayı kullan!\n');
}

// Çalıştır
main();
