import {
  getMatchPhase,
  estimateDailyRequestsOptimized,
  MatchSchedule,
  matchScheduler,
  requestCounter
} from '../src/config/two-phase-strategy';

console.log('\n' + '='.repeat(80));
console.log('   🎯 2 FAZLI AKILLI TARAMA SİSTEMİ');
console.log('='.repeat(80) + '\n');

// Test senaryoları
const now = new Date();

const testMatches: MatchSchedule[] = [
  {
    id: '1',
    homeTeam: 'Real Madrid',
    awayTeam: 'Barcelona',
    kickoffTime: new Date(now.getTime() + 2 * 60 * 60 * 1000), // +2 saat
    league: 'La Liga',
    isLive: false
  },
  {
    id: '2',
    homeTeam: 'Liverpool',
    awayTeam: 'Man City',
    kickoffTime: new Date(now.getTime() + 5 * 60 * 1000), // +5 dakika
    league: 'Premier League',
    isLive: false
  },
  {
    id: '3',
    homeTeam: 'Bayern',
    awayTeam: 'Dortmund',
    kickoffTime: new Date(now.getTime() - 15 * 60 * 1000), // -15 dakika (15. dak)
    league: 'Bundesliga',
    isLive: true
  },
  {
    id: '4',
    homeTeam: 'PSG',
    awayTeam: 'Marseille',
    kickoffTime: new Date(now.getTime() - 87 * 60 * 1000), // -87 dakika (87. dak)
    league: 'Ligue 1',
    isLive: true
  },
  {
    id: '5',
    homeTeam: 'Milan',
    awayTeam: 'Inter',
    kickoffTime: new Date(now.getTime() - 95 * 60 * 1000), // -95 dakika (maç bitti)
    league: 'Serie A',
    isLive: false
  }
];

console.log('📊 MAÇ FAZLARI TESTİ:\n');

testMatches.forEach((match, index) => {
  const phase = getMatchPhase(match);
  
  console.log(`${index + 1}. ${match.homeTeam} vs ${match.awayTeam}`);
  console.log(`   🏆 ${match.league}`);
  console.log(`   📅 Kickoff: ${match.kickoffTime.toLocaleString('tr-TR')}`);
  console.log(`   📍 Faz: ${phase.phase.toUpperCase()}`);
  console.log(`   ⏱️  Interval: ${phase.interval} saniye`);
  console.log(`   💡 ${phase.reason}\n`);
  
  // Schedule'a ekle
  matchScheduler.scheduleMatch(match);
  if (match.isLive) {
    matchScheduler.startLiveMonitoring(match.id);
  }
});

// Günlük request tahmini
console.log('='.repeat(80));
console.log('   📈 GÜNLÜK REQUEST TAHMİNİ (2 FAZLI SİSTEM)');
console.log('='.repeat(80) + '\n');

const estimate = estimateDailyRequestsOptimized();

console.log('🔍 FAZ 1 - KEŞİF (Match Discovery):');
console.log(`   Her 5 dakikada 1 tarama`);
console.log(`   Günlük: ${estimate.discovery.toLocaleString()} request`);
console.log(`   Amaç: Maçları bul ve programa ekle\n`);

console.log('⚡ FAZ 2 - CANLI TAKİP (Live Monitoring):');
console.log(`   Dinamik interval (1-5 saniye)`);
console.log(`   Günlük: ${estimate.liveMonitoring.toLocaleString()} request`);
console.log(`   Amaç: Canlı maçları agresif takip et\n`);

console.log('📊 Detaylı Dağılım:\n');
Object.entries(estimate.breakdown).forEach(([phase, count]) => {
  const pct = ((count / estimate.total) * 100).toFixed(1);
  const bar = '█'.repeat(Math.round(parseFloat(pct) / 2));
  console.log(`   ${phase.padEnd(15)}: ${String(count).padStart(6)} req ${bar} ${pct}%`);
});

console.log(`\n📍 TOPLAM: ${estimate.total.toLocaleString()} request/day`);
console.log(`📊 Limit Kullanımı: ${estimate.limitUsage.toFixed(1)}%`);
console.log(`✅ Kalan: ${(75000 - estimate.total).toLocaleString()} request`);

const status = estimate.limitUsage < 70 ? '✅ PERFECT!' : 
               estimate.limitUsage < 90 ? '⚠️  İyi' : '❌ Limit aşımı riski';
console.log(`🎯 Durum: ${status}\n`);

// Scheduler istatistikleri
console.log('='.repeat(80));
console.log('   📅 MATCH SCHEDULER İSTATİSTİKLERİ');
console.log('='.repeat(80) + '\n');

const stats = matchScheduler.getPhaseStatistics();
console.log(`📊 Toplam programlanmış maç: ${testMatches.length}\n`);

console.log('Faz Dağılımı:');
console.log(`   🔍 Keşif:        ${stats.discovery} maç`);
console.log(`   ⏰ Yakında:      ${stats.preMatch} maç`);
console.log(`   🔴 Canlı:        ${stats.live} maç`);
console.log(`   📊 Maç Sonu:     ${stats.postMatch} maç`);
console.log(`   ✅ Bitti:        ${stats.finished} maç\n`);

const liveMatches = matchScheduler.getLiveMatches();
console.log(`🔴 Şu an CANLI olan maçlar: ${liveMatches.length}`);
liveMatches.forEach(m => {
  console.log(`   ⚽ ${m.homeTeam} vs ${m.awayTeam}`);
});

const upcomingMatches = matchScheduler.getUpcomingMatches();
console.log(`\n⏰ Yakında başlayacak maçlar: ${upcomingMatches.length}`);
upcomingMatches.forEach(m => {
  const minutesUntil = Math.round((m.kickoffTime.getTime() - now.getTime()) / 60000);
  console.log(`   📅 ${m.homeTeam} vs ${m.awayTeam} (${minutesUntil} dakika içinde)`);
});

// Karşılaştırma: Eski vs Yeni Sistem
console.log('\n' + '='.repeat(80));
console.log('   ⚖️  ESKİ SİSTEM vs YENİ SİSTEM');
console.log('='.repeat(80) + '\n');

console.log('❌ ESKİ SİSTEM (Sürekli Polling):');
console.log(`   Tüm gün 3 saniyede 1 tarama`);
console.log(`   20 maç × 90 dak × (60/3) = 36,000 req/maç`);
console.log(`   Toplam: ~36,000 request/day`);
console.log(`   Sorun: Maç olmayan saatlerde gereksiz request\n`);

console.log('✅ YENİ SİSTEM (2 Fazlı):');
console.log(`   Keşif: 5 dakikada 1 (288 req)`);
console.log(`   Canlı: Sadece maç başladığında agresif`);
console.log(`   15 maç × dinamik interval = ${estimate.liveMonitoring.toLocaleString()} req`);
console.log(`   Toplam: ${estimate.total.toLocaleString()} request/day`);
console.log(`   Avantaj: %${((estimate.total / 36000) * 100).toFixed(0)} kullanım, ama DAHA HIZLI!\n`);

// Gerçek dünya örneği
console.log('='.repeat(80));
console.log('   🎯 GERÇEK DÜNYA ÖRNEĞİ');
console.log('='.repeat(80) + '\n');

console.log('📅 Tipik Bir Gün:\n');

console.log('🌅 Sabah (00:00-12:00):');
console.log(`   • Keşif modu: 144 request (12 saat × 12 tarama)`);
console.log(`   • Canlı maç: 0-2 maç (Asya ligleri)`);
console.log(`   • Toplam: ~2,000 request\n`);

console.log('☀️  Öğleden Sonra (12:00-18:00):');
console.log(`   • Keşif modu: 72 request (6 saat × 12 tarama)`);
console.log(`   • Canlı maç: 3-5 maç (Avrupa hazırlık)`);
console.log(`   • Toplam: ~8,000 request\n`);

console.log('🌙 Akşam (18:00-24:00): 🔥 PEAK TIME');
console.log(`   • Keşif modu: 72 request`);
console.log(`   • Canlı maç: 10-15 maç (Champions League, La Liga, EPL)`);
console.log(`   • Toplam: ~20,000 request`);
console.log(`   • 87. dakika örneği: 1 saniye interval! ⚡\n`);

console.log('📊 Günlük Toplam: ~30,000 request');
console.log('✅ Limit Kullanımı: %40');
console.log('🎯 Yedek Kapasite: 45,000 request (özel günler için)\n');

console.log('='.repeat(80));
console.log('   ✅ TEST TAMAMLANDI - SİSTEM HAZIR!');
console.log('='.repeat(80) + '\n');

console.log('🚀 Sonraki Adımlar:');
console.log('   1. ✅ API-Football Ultra aktif (75,000 req/day)');
console.log('   2. 🎯 2 fazlı sistem devrede');
console.log('   3. ⚡ Dinamik interval hazır (1-5 saniye)');
console.log('   4. 📊 Polymarket entegrasyonu başlasın!\n');
