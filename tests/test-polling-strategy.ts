import { 
  calculatePollingInterval, 
  estimateDailyRequests,
  RateLimiter,
  MatchState 
} from '../src/config/polling-strategy';

console.log('\n' + '='.repeat(80));
console.log('   🎯 AKILLI POLLING STRATEJİSİ TESTİ');
console.log('='.repeat(80) + '\n');

// Test senaryoları
const scenarios: Array<{name: string, match: MatchState, expected: string}> = [
  {
    name: '🔵 Maç başlangıcı',
    match: { minute: 5, homeScore: 0, awayScore: 0, isHalfTime: false },
    expected: '5 sn (maç yeni başladı, sakin)'
  },
  {
    name: '⚡ İlk yarı ortası',
    match: { minute: 25, homeScore: 1, awayScore: 0, isHalfTime: false },
    expected: '4 sn (normal tempo)'
  },
  {
    name: '☕ Devre arası',
    match: { minute: 45, homeScore: 1, awayScore: 1, isHalfTime: true },
    expected: '10 sn (oyun yok)'
  },
  {
    name: '📊 İkinci yarı normal',
    match: { minute: 60, homeScore: 1, awayScore: 1, isHalfTime: false },
    expected: '2 sn (berabere, heyecanlı)'
  },
  {
    name: '🔥 Son 20 dakika - berabere',
    match: { minute: 75, homeScore: 2, awayScore: 2, isHalfTime: false },
    expected: '1 sn (KRİTİK)'
  },
  {
    name: '🚨 Son dakika - berabere',
    match: { minute: 89, homeScore: 1, awayScore: 1, isHalfTime: false },
    expected: '1 sn (ULTRA KRİTİK!)'
  },
  {
    name: '🚨 Son dakika - 1 fark',
    match: { minute: 88, homeScore: 2, awayScore: 1, isHalfTime: false },
    expected: '1 sn (son dakika, yakın skor)'
  },
  {
    name: '😴 Tek taraflı maç',
    match: { minute: 80, homeScore: 5, awayScore: 1, isHalfTime: false },
    expected: '4 sn (sonuç belli, rahat)'
  },
  {
    name: '⚽ Uzatma - berabere',
    match: { minute: 92, homeScore: 2, awayScore: 2, isHalfTime: false },
    expected: '1 sn (YÜKSEK GERİLİM)'
  }
];

console.log('📊 SENARYO TESTLERİ:\n');

scenarios.forEach((scenario, index) => {
  const interval = calculatePollingInterval(scenario.match);
  console.log(`${index + 1}. ${scenario.name}`);
  console.log(`   Durum: ${scenario.match.minute}' - ${scenario.match.homeScore}-${scenario.match.awayScore}`);
  console.log(`   ⏱️  Interval: ${interval} saniye`);
  console.log(`   💡 ${scenario.expected}\n`);
});

// Günlük request tahmini
console.log('='.repeat(80));
console.log('   📈 GÜNLÜK REQUEST TAHMİNİ');
console.log('='.repeat(80) + '\n');

const scenarios_daily = [
  { matches: 10, label: 'Az yoğun gün (10 maç)' },
  { matches: 20, label: 'Normal gün (20 maç)' },
  { matches: 30, label: 'Çok yoğun gün (30 maç)' },
  { matches: 50, label: 'Süper yoğun gün (50 maç)' }
];

scenarios_daily.forEach(scenario => {
  const estimate = estimateDailyRequests(scenario.matches);
  const status = estimate.limitUsage < 70 ? '✅' : 
                 estimate.limitUsage < 90 ? '⚠️' : '❌';
  
  console.log(`${status} ${scenario.label}:`);
  console.log(`   Total: ${estimate.total.toLocaleString()} request`);
  console.log(`   Limit kullanımı: ${estimate.limitUsage}%`);
  console.log(`   Kalan: ${(75000 - estimate.total).toLocaleString()} request\n`);
});

console.log('\n📊 Detaylı dağılım (20 maç için):\n');
const detailed = estimateDailyRequests(20);
Object.entries(detailed.breakdown).forEach(([phase, count]) => {
  const pct = ((count / detailed.total) * 100).toFixed(1);
  console.log(`   ${phase.padEnd(12)}: ${String(count).padStart(6)} req (${pct}%)`);
});

// Rate Limiter test
console.log('\n' + '='.repeat(80));
console.log('   🚦 RATE LIMITER TESTİ');
console.log('='.repeat(80) + '\n');

const limiter = new RateLimiter();

// Simülasyon: 1000 request yap
for (let i = 0; i < 1000; i++) {
  if (limiter.canMakeRequest()) {
    limiter.recordRequest();
  }
}

console.log(`✅ Test: 1000 request kaydedildi`);
console.log(`📊 Kalan: ${limiter.getRemainingRequests().toLocaleString()} request`);
console.log(`📈 Kullanım: ${limiter.getUsagePercentage().toFixed(2)}%`);
console.log(`💡 Günlük limitin ${((1000/75000)*100).toFixed(2)}% kullanıldı\n`);

// Gerçek dünya senaryosu
console.log('='.repeat(80));
console.log('   🎯 GERÇEK DÜNYA SİMÜLASYONU');
console.log('='.repeat(80) + '\n');

const realWorldMatch = {
  minute: 87,
  homeScore: 1,
  awayScore: 1,
  isHalfTime: false
};

const nextInterval = calculatePollingInterval(realWorldMatch);

console.log('📍 Canlı Maç Durumu:');
console.log(`   Real Madrid vs Barcelona - 87' (1-1)`);
console.log(`   🔥 SON DAKİKA - BERABERE MAÇTA\n`);

console.log(`⏱️  Sonraki polling: ${nextInterval} saniye`);
console.log(`💡 Neden ${nextInterval} saniye?`);
console.log(`   • 87. dakika = ULTRA kritik dönem`);
console.log(`   • Berabere skor = Gol olasılığı çok yüksek`);
console.log(`   • Sistem maksimum hıza geçti! ⚡\n`);

console.log(`📊 API Response: ~100ms`);
console.log(`⏰ Total gecikme: ${nextInterval} sn + 0.1 sn = ${(nextInterval + 0.1).toFixed(1)} saniye`);
console.log(`🎯 Gol tespit süresi: ${(nextInterval + 0.1).toFixed(1)} saniye\n`);

console.log('💰 Trade Avantajı:');
console.log(`   Rakip (5sn interval): 5.1 sn gecikme`);
console.log(`   Biz (${nextInterval}sn interval): ${(nextInterval + 0.1).toFixed(1)} sn gecikme`);
console.log(`   ⚡ ${(5.1 - (nextInterval + 0.1)).toFixed(1)} saniye DAHA HIZLIYIZ!\n`);

console.log('='.repeat(80));
console.log('   ✅ TEST TAMAMLANDI');
console.log('='.repeat(80) + '\n');
