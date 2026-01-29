import { LiveScore6TradingBot } from '../src/bot/livescore-trading-bot';
import { PolymarketClient } from '../src/client';
import { buyShares, sellShares } from '../src/trading';
import { getBalance } from '../src/utils/balance';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * 🧪 TEST TRADE: Bot'u SLUG yöntemi ile test et + GERÇEK trade yap
 * 
 * Adımlar:
 * 1. Bot'u başlat (SLUG yöntemi ile LIVE maçları bul)
 * 2. Eğer Polymarket'te maç varsa -> TEST TRADE yap
 * 3. Alım ve satımı test et
 * 4. Bot'u durdur
 */

async function testTradeWithBot() {
  console.log('🧪 TEST TRADE - LIVESCORE BOT WITH SLUG METHOD\n');
  console.log('='.repeat(70));
  console.log('');
  
  const bot = new LiveScore6TradingBot();
  
  try {
    // 1. Bot'u başlat (sadece initialize, monitoring loop başlatma)
    console.log('📡 Step 1: Initializing bot and finding LIVE matches...\n');
    
    // Bot'un initialize metodunu çağır
    await (bot as any).initializeMatches();
    
    const trackedMatches = (bot as any).trackedMatches;
    
    if (trackedMatches.size === 0) {
      console.log('\n❌ No matches found on Polymarket.');
      console.log('💡 Try again during Premier League, Champions League, or Brasileirão games.\n');
      return;
    }
    
    console.log('\n✅ Found matches with Polymarket markets!\n');
    console.log('='.repeat(70));
    
    // 2. İlk maçı seç ve test trade yap
    const firstMatch: any = Array.from(trackedMatches.values())[0];
    const firstMarket: any = firstMatch.polymarketMatches[0];
    
    console.log('\n🎯 TEST TRADE TARGET:\n');
    console.log(`⚽ Match: ${firstMatch.homeTeam} vs ${firstMatch.awayTeam}`);
    console.log(`📊 Score: ${firstMatch.lastScore.home}-${firstMatch.lastScore.away}`);
    console.log(`📌 Market: ${firstMarket.question}`);
    console.log(`💰 Liquidity: $${Math.round(parseFloat(firstMarket.liquidity || 0))}`);
    console.log(`📈 Best Bid: ${firstMarket.bestBid || 'N/A'}`);
    console.log(`📉 Best Ask: ${firstMarket.bestAsk || 'N/A'}`);
    console.log('');
    
    // 3. Polymarket Client oluştur
    const privateKey = process.env.PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY || '';
    
    if (!privateKey) {
      console.log('❌ PRIVATE_KEY not found in .env\n');
      return;
    }
    
    const client = await PolymarketClient.create();
    
    console.log('✅ Client initialized\n');
    
    // 4. Balance kontrolü
    const balanceInfo = await getBalance(client);
    const balance = parseFloat(balanceInfo.usdc);
    console.log(`💵 Wallet Balance: $${balance.toFixed(2)} USDC\n`);
    
    if (balance < 2) {
      console.log('❌ Insufficient balance. Need at least $2 USDC for test trade.\n');
      return;
    }
    
    // 5. Token ID'leri al (YES ve NO)
    const clobTokenIds = JSON.parse(firstMarket.clobTokenIds || '[]');
    if (clobTokenIds.length < 2) {
      console.log('❌ Cannot find token IDs for this market\n');
      return;
    }
    
    const yesTokenId = clobTokenIds[0];
    const noTokenId = clobTokenIds[1];
    
    // 6. TEST TRADE - Küçük miktar ($1)
    console.log('='.repeat(70));
    console.log('\n🔵 EXECUTING TEST BUY ORDER\n');
    
    const testAmount = 1; // $1 test
    const useYes = parseFloat(firstMarket.bestAsk || 0.5) < 0.5;
    const tokenId = useYes ? yesTokenId : noTokenId;
    
    console.log(`📝 Order Details:`);
    console.log(`   Amount: $${testAmount} USDC`);
    console.log(`   Outcome: ${useYes ? 'YES' : 'NO'}`);
    console.log(`   Token ID: ${tokenId.substring(0, 20)}...`);
    console.log('');
    
    // BUY
    const buyResult = await buyShares(client, {
      tokenId,
      amount: testAmount,
      type: 'market'
    });
    
    console.log('✅ BUY ORDER SUCCESSFUL!\n');
    console.log(`   Order ID: ${buyResult.orderID || 'N/A'}`);
    console.log('');
    
    // 7. 10 saniye bekle, sonra SELL
    console.log('⏳ Waiting 10 seconds before selling...\n');
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    console.log('🔴 EXECUTING TEST SELL ORDER\n');
    
    // Basit sell - API'den pozisyonu almadan trade et
    // Polymarket FOK (fill or kill) kullanacak, eğer share yoksa reject edecek
    console.log(`📝 Selling (market order will auto-detect position)\n`);
    
    // SELL
    const sellResult = await sellShares(client, {
      tokenId,
      amount: testAmount, // CLOB client otomatik position size'ı kullanır
      type: 'market'
    });
    
    console.log('✅ SELL ORDER SUCCESSFUL!\n');
    console.log(`   Order ID: ${sellResult.orderID || 'N/A'}`);
    console.log('');
    
    // 8. Final balance
    const finalBalanceInfo = await getBalance(client);
    const finalBalance = parseFloat(finalBalanceInfo.usdc);
    const profit = finalBalance - balance;
    
    console.log('='.repeat(70));
    console.log('\n📊 TEST TRADE SUMMARY\n');
    console.log(`   Initial Balance: $${balance.toFixed(2)}`);
    console.log(`   Final Balance: $${finalBalance.toFixed(2)}`);
    console.log(`   Profit/Loss: ${profit >= 0 ? '+' : ''}$${profit.toFixed(4)}`);
    console.log('');
    console.log('✅ TEST TRADE COMPLETED SUCCESSFULLY!\n');
    console.log('🚀 Bot is ready for live trading!\n');
    
  } catch (error: any) {
    console.error('\n❌ TEST TRADE ERROR:', error.message);
    console.error(error.stack);
  }
  
  console.log('\n='.repeat(70));
  console.log('🏁 Test completed\n');
}

testTradeWithBot().catch(console.error);
