import { PolymarketSportsClient } from '../src/integrations/polymarket-sports';

/**
 * Test: SLUG ile event arama
 * 
 * https://polymarket.com/event/bra-sao-fla-2025-11-05
 */

async function testSlugSearch() {
  const client = new PolymarketSportsClient();
  
  console.log('🔍 Testing SLUG search for São Paulo vs Flamengo\n');
  
  const event = await client.searchEventBySlug('bra-sao-fla-2025-11-05');
  
  if (!event) {
    console.log('❌ Event NOT found!\n');
    return;
  }
  
  console.log('✅ EVENT FOUND!\n');
  console.log(`📌 Title: ${event.title}`);
  console.log(`🔴 LIVE: ${event.live ? 'YES' : 'NO'}`);
  console.log(`⚽ Score: ${event.score || 'N/A'}`);
  console.log(`⏱️  Minute: ${event.elapsed || 'N/A'}'`);
  console.log(`🏟️  Period: ${event.period || 'N/A'}`);
  console.log(`📅 Start Date: ${event.startDate}`);
  console.log(`📅 End Date: ${event.endDate}`);
  console.log(`🎰 Markets: ${event.markets?.length || 0}`);
  
  if (event.markets && event.markets.length > 0) {
    console.log('\n📊 Markets:\n');
    event.markets.forEach((market: any, i: number) => {
      console.log(`${i + 1}. ${market.question}`);
      console.log(`   💰 Liquidity: $${Math.round(parseFloat(market.liquidity || 0))}`);
      console.log(`   📈 Best Bid: ${market.bestBid || 'N/A'}`);
      console.log(`   📉 Best Ask: ${market.bestAsk || 'N/A'}`);
      console.log('');
    });
  }
}

testSlugSearch().catch(console.error);
