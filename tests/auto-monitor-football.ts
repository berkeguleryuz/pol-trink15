import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * UTC zamanı Berlin saatine çevir (UTC+1)
 */
function convertToBerlinTime(date: Date): string {
  const berlinDate = new Date(date.getTime() + (1 * 60 * 60 * 1000));
  
  const year = berlinDate.getUTCFullYear();
  const month = String(berlinDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(berlinDate.getUTCDate()).padStart(2, '0');
  const hours = String(berlinDate.getUTCHours()).padStart(2, '0');
  const minutes = String(berlinDate.getUTCMinutes()).padStart(2, '0');
  const seconds = String(berlinDate.getUTCSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Polymarket maçlarını güncelle (30 dakikada bir)
 */
let lastPolyfundUpdate = 0;
const POLYFUND_UPDATE_INTERVAL = 30 * 60 * 1000; // 30 dakika

async function updatePolyfundMatches() {
  const now = Date.now();
  
  if (now - lastPolyfundUpdate < POLYFUND_UPDATE_INTERVAL) {
    return; // Henüz erken
  }
  
  console.log('\n🔄 Polymarket maçları güncelleniyor...');
  
  try {
    await execAsync('npx ts-node tests/scrape-polyfund-matches.ts');
    lastPolyfundUpdate = now;
    console.log('✅ Polymarket maçları güncellendi\n');
  } catch (error: any) {
    console.error('❌ Polymarket güncelleme hatası:', error.message);
  }
}

/**
 * Futbol maçlarını filtrele
 */
async function filterFootballMatches() {
  console.log('⚽ Futbol maçları filtreleniyor...');
  
  try {
    await execAsync('npx ts-node tests/filter-football-matches.ts');
    console.log('✅ Futbol maçları filtrelendi\n');
  } catch (error: any) {
    console.error('❌ Filtreleme hatası:', error.message);
  }
}

/**
 * Maçları monitor et
 */
async function monitorMatches() {
  console.log('📡 Maçlar kontrol ediliyor...\n');
  
  try {
    await execAsync('npx ts-node tests/monitor-football-matches.ts');
  } catch (error: any) {
    console.error('❌ Monitoring hatası:', error.message);
  }
}

/**
 * Ana döngü
 */
async function mainLoop() {
  console.log('\n' + '='.repeat(100));
  console.log('⚽ POLYMARKET FUTBOL MAÇLARI - OTOMATİK TAKİP SİSTEMİ BAŞLATILDI');
  console.log('='.repeat(100));
  console.log(`🕐 Berlin Saati: ${convertToBerlinTime(new Date())}`);
  console.log('='.repeat(100));
  console.log('\n💡 SİSTEM BİLGİSİ:');
  console.log('   ✅ Her 5 dakikada bir maçlar kontrol edilecek');
  console.log('   ✅ Her 30 dakikada bir Polymarket güncellenecek');
  console.log('   ✅ Maçlar başlamadan 30 dk önce "YAKINDA" uyarısı verilecek');
  console.log('   ✅ Maç başladığında "CANLI" durumuna geçecek ve trade başlatılacak');
  console.log('\n🛑 DURDURMAK İÇİN: Ctrl+C\n');
  
  // İlk güncelleme
  console.log('🚀 İlk güncelleme başlatılıyor...\n');
  await updatePolyfundMatches();
  await filterFootballMatches();
  await monitorMatches();
  
  // Döngü başlat (5 dakika)
  const CHECK_INTERVAL = 5 * 60 * 1000; // 5 dakika
  let iteration = 1;
  
  setInterval(async () => {
    console.log('\n\n');
    console.log('='.repeat(100));
    console.log(`🔄 KONTROL #${iteration} - ${convertToBerlinTime(new Date())}`);
    console.log('='.repeat(100));
    
    // Polymarket güncellemesi (30 dk'da bir)
    await updatePolyfundMatches();
    
    // Futbol filtresi
    await filterFootballMatches();
    
    // Monitoring
    await monitorMatches();
    
    console.log('\n⏳ Sonraki kontrol 5 dakika sonra...');
    
    iteration++;
  }, CHECK_INTERVAL);
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Sistem durduruluyor...');
  console.log('👋 Görüşmek üzere!\n');
  process.exit(0);
});

// Başlat
mainLoop().catch(error => {
  console.error('\n❌ Kritik hata:', error);
  process.exit(1);
});
