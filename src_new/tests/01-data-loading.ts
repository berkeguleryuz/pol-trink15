/**
 * TEST 01 - DATA LOADING
 * football-matches.json yükleme ve doğrulama testi
 */

import { MatchManager } from '../core/match-manager';
import { MatchStatus } from '../core/types';

async function test01DataLoading() {
  console.log('\n' + '='.repeat(80));
  console.log('TEST 01 - DATA LOADING');
  console.log('='.repeat(80) + '\n');

  const manager = new MatchManager();

  // 1. Maçları yükle
  console.log('1️⃣  Maçları yüklüyorum...');
  const matches = await manager.loadMatches();
  
  if (matches.length === 0) {
    console.error('❌ HATA: Maç yüklenemedi!');
    console.error('   football-matches.json dosyası var mı kontrol et');
    console.error('   Önce: npx ts-node tests/filter-football-matches.ts');
    return false;
  }

  console.log(`✅ ${matches.length} maç yüklendi\n`);

  // 2. Durum kontrolü
  console.log('2️⃣  Durum analizi...');
  const upcoming = manager.getMatchesByStatus(MatchStatus.UPCOMING);
  const soon = manager.getMatchesByStatus(MatchStatus.SOON);
  const live = manager.getMatchesByStatus(MatchStatus.LIVE);
  const finished = manager.getMatchesByStatus(MatchStatus.FINISHED);

  console.log(`   🟢 Upcoming (30+ dk):  ${upcoming.length}`);
  console.log(`   🟡 Soon (0-30 dk):     ${soon.length}`);
  console.log(`   🔴 Live:               ${live.length}`);
  console.log(`   ⚫ Finished:           ${finished.length}\n`);

  // 3. Bugünkü maçlar
  console.log('3️⃣  Bugünkü maçlar...');
  const today = manager.getTodayMatches();
  console.log(`   📅 Bugün ${today.length} maç var\n`);

  if (today.length > 0) {
    console.log('   İlk 3 maç:');
    today.slice(0, 3).forEach((m, i) => {
      console.log(`   ${i + 1}. ${m.kickoffTime} - ${m.title || m.slug}`);
    });
  }

  console.log('\n✅ TEST 01 BAŞARILI!\n');
  return true;
}

// Çalıştır
test01DataLoading()
  .then(success => process.exit(success ? 0 : 1))
  .catch(error => {
    console.error('\n❌ TEST HATASI:', error);
    process.exit(1);
  });
