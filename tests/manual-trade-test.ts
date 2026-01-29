/**
 * MANUEL TRADE TEST
 * Token ID'leri polymarket-matches.json'dan alıp gerçek trade yapıyoruz
 * $1 ile test ediyoruz
 */

import { PolymarketClientWrapper } from '../src_new/trading/polymarket-client';
import { ClobClient, Side, OrderType } from '@polymarket/clob-client';
import * as fs from 'fs';
import * as path from 'path';

interface MarketOutcome {
  question: string;
  outcomes: string;
  clobTokenIds: string;
  conditionId: string;
}

interface MatchData {
  slug: string;
  title: string;
  markets?: MarketOutcome[];
}

async function buyToken(client: ClobClient, tokenId: string, amount: number, description: string): Promise<void> {
  console.log(`\n� ${description}`);
  console.log(`   Token ID: ${tokenId.slice(0, 20)}...`);
  console.log(`   Amount: $${amount}`);
  
  try {
    // Create market buy order
    const orderObj = await client.createMarketOrder({
      tokenID: tokenId,
      amount: amount, // USDC
      side: Side.BUY
    });

    // Post order (Fill or Kill)
    const response = await client.postOrder(orderObj, OrderType.FOK);

    console.log(`   ✅ Order executed!`);
    console.log(`   � Order ID: ${response.orderID}`);
    
  } catch (error: any) {
    console.error(`   ❌ Failed: ${error.message}`);
  }
}

async function main() {
  console.log('\n💰 MANUEL TRADE TEST');
  console.log('='.repeat(80));
  
  // 1. Match verisini yükle
  console.log('\n🔍 Match verisi yükleniyor...');
  const dataPath = path.join(__dirname, '../data/polymarket-matches.json');
  const jsonData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const match: MatchData = jsonData.matches.find((m: MatchData) => m.slug === 'spl-qad-kho-2025-11-06');

  if (!match) {
    console.error('❌ Match bulunamadı: spl-qad-kho-2025-11-06');
    return;
  }

  console.log(`   ✅ Match: ${match.title}`);
  console.log(`   📊 Markets: ${match.markets?.length || 0}`);
  
  if (!match.markets || match.markets.length === 0) {
    console.error('❌ Bu maçta market yok!');
    return;
  }

  // Markets'leri tanımlayalım
  const homeWinMarket = match.markets.find(m => m.question.includes('Al Qadisiyah') && m.question.includes('win'));
  const drawMarket = match.markets.find(m => m.question.includes('draw'));
  const awayWinMarket = match.markets.find(m => m.question.includes('Al Kholood') && m.question.includes('win'));

  if (!homeWinMarket || !drawMarket || !awayWinMarket) {
    console.error('❌ Markets parse edilemedi!');
    console.log('Available markets:');
    match.markets.forEach(m => console.log(`  - ${m.question}`));
    return;
  }

  console.log('\n📊 MARKETS:');
  console.log(`   1. ${homeWinMarket.question}`);
  console.log(`   2. ${drawMarket.question}`);
  console.log(`   3. ${awayWinMarket.question}\n`);

  // 2. Client başlat
  console.log('� Polymarket client başlatılıyor...');
  const clientWrapper = await PolymarketClientWrapper.create();
  const client = clientWrapper.getClient();
  console.log('   ✅ Client hazır - LIVE MODE ACTIVE!\n');

  // 3. GOL SONRASI STRATEJİ (Al Qadisiyah 1-0 önde)
  console.log('⚽ GOL SONRASI POZİSYONLAR:');
  console.log('   Skor: 1-0 (Al Qadisiyah önde)');
  console.log('   Strateji: Gol atan takım kazanır (YES), Diğerleri (NO)');
  console.log('='.repeat(80));

  // Parse token IDs
  const homeTokens = JSON.parse(homeWinMarket.clobTokenIds); // [YES, NO]
  const drawTokens = JSON.parse(drawMarket.clobTokenIds);     // [YES, NO]
  const awayTokens = JSON.parse(awayWinMarket.clobTokenIds);  // [YES, NO]

  // Pozisyon 1: Al Qadisiyah KAZANIR (YES) - Gol atan takım
  await buyToken(
    client,
    homeTokens[0], // YES token
    1,
    '1️⃣  Al Qadisiyah KAZANIR (YES) - Gol atan takım'
  );

  // Pozisyon 2: BERABERE (NO) - Gol atıldı, beraberlik azaldı
  await buyToken(
    client,
    drawTokens[1], // NO token
    1,
    '2️⃣  BERABERE BİTER (NO) - Gol atıldı'
  );

  // Pozisyon 3: Al Kholood KAZANIR (NO) - Karşı takım kazanmayacak
  await buyToken(
    client,
    awayTokens[1], // NO token
    1,
    '3️⃣  Al Kholood KAZANIR (NO) - Karşı takım geride'
  );

  console.log('\n' + '='.repeat(80));
  console.log('✅ TEST TAMAMLANDI');
  console.log('💰 Toplam harcama: $3 (3 x $1)');
  console.log('='.repeat(80) + '\n');
}

main().catch(console.error);
