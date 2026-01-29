/**
 * CLOB Orders API Test
 *
 * Test real-time order book data from CLOB API
 */

import axios from 'axios';

const CLOB_API = 'https://clob.polymarket.com';
const GAMMA_API = 'https://gamma-api.polymarket.com';

// Test with a known active market
async function testClobOrders() {
  console.log('\n' + '='.repeat(60));
  console.log('   CLOB Orders API Test');
  console.log('='.repeat(60) + '\n');

  // First, get an active BTC 15m market from Gamma
  console.log('1. Finding active BTC 15m market...\n');

  const now = Date.now();
  const currentInterval = Math.floor(now / (15 * 60 * 1000)) * (15 * 60 * 1000);
  const timestamp = Math.floor(currentInterval / 1000);
  const slug = `btc-updown-15m-${timestamp}`;

  try {
    const gammaRes = await axios.get(`${GAMMA_API}/markets?slug=${slug}`);

    if (!gammaRes.data || gammaRes.data.length === 0) {
      console.log('   No active market found, trying next interval...');
      const nextTimestamp = timestamp + 900; // +15 min
      const nextSlug = `btc-updown-15m-${nextTimestamp}`;
      const nextRes = await axios.get(`${GAMMA_API}/markets?slug=${nextSlug}`);

      if (!nextRes.data || nextRes.data.length === 0) {
        console.log('   No market found. Exiting.');
        return;
      }
      gammaRes.data = nextRes.data;
    }

    const market = gammaRes.data[0];
    console.log(`   Market: ${market.question || market.groupItemTitle}`);
    console.log(`   Slug: ${market.slug}`);
    console.log(`   Condition ID: ${market.conditionId}`);

    const tokenIds = JSON.parse(market.clobTokenIds || '[]');
    const outcomes = JSON.parse(market.outcomes || '[]');
    const prices = JSON.parse(market.outcomePrices || '[]');

    console.log(`\n   Outcomes:`);
    for (let i = 0; i < outcomes.length; i++) {
      console.log(`   - ${outcomes[i]}: ${(parseFloat(prices[i]) * 100).toFixed(1)}¢ (Token: ${tokenIds[i]?.slice(0, 20)}...)`);
    }

    // Test CLOB book endpoint (orderbook) - PUBLIC
    console.log('\n3. Testing CLOB /book endpoint (orderbook)...\n');

    for (let i = 0; i < tokenIds.length; i++) {
      const tokenId = tokenIds[i];
      const outcome = outcomes[i];

      console.log(`   ${outcome} Token: ${tokenId.slice(0, 30)}...`);

      const bookUrl = `${CLOB_API}/book?token_id=${tokenId}`;
      const bookRes = await axios.get(bookUrl);

      const { bids, asks } = bookRes.data;

      console.log(`   Bids: ${bids?.length || 0} | Asks: ${asks?.length || 0}`);

      if (bids && bids.length > 0) {
        const bestBid = bids[0];
        console.log(`   Best Bid: ${(parseFloat(bestBid.price) * 100).toFixed(1)}¢ (${bestBid.size} shares)`);
      }

      if (asks && asks.length > 0) {
        const bestAsk = asks[0];
        console.log(`   Best Ask: ${(parseFloat(bestAsk.price) * 100).toFixed(1)}¢ (${bestAsk.size} shares)`);
      }

      // Mid price
      if (bids?.length > 0 && asks?.length > 0) {
        const mid = (parseFloat(bids[0].price) + parseFloat(asks[0].price)) / 2;
        console.log(`   Mid Price: ${(mid * 100).toFixed(1)}¢`);
      }

      console.log('');
    }

    // Test CLOB prices endpoint
    console.log('4. Testing CLOB /prices endpoint...\n');

    for (const tokenId of tokenIds) {
      try {
        const priceUrl = `${CLOB_API}/price?token_id=${tokenId}`;
        const priceRes = await axios.get(priceUrl);
        console.log(`   Token ${tokenId.slice(0, 20)}...`);
        console.log(`   Price: ${JSON.stringify(priceRes.data)}`);
      } catch (e: any) {
        console.log(`   Token ${tokenId.slice(0, 20)}... Error: ${e.message}`);
      }
    }

    // Test midpoint endpoint
    console.log('\n5. Testing CLOB /midpoint endpoint...\n');

    for (let i = 0; i < tokenIds.length; i++) {
      try {
        const midUrl = `${CLOB_API}/midpoint?token_id=${tokenIds[i]}`;
        const midRes = await axios.get(midUrl);
        console.log(`   ${outcomes[i]}: ${JSON.stringify(midRes.data)}`);
      } catch (e: any) {
        console.log(`   ${outcomes[i]}: Error - ${e.message}`);
      }
    }

  } catch (error: any) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Response:', error.response.status, error.response.data);
    }
  }

  console.log('\n' + '='.repeat(60) + '\n');
}

testClobOrders();
