/**
 * TEST BUY & SELL
 *
 * 1. Find an active 15-min crypto market
 * 2. Buy $1 worth of tokens
 * 3. Try to sell the position
 */

import { ethers } from 'ethers';
import { ClobClient, Side, OrderType } from '@polymarket/clob-client';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const GAMMA_API = 'https://gamma-api.polymarket.com';
const CLOB_URL = 'https://clob.polymarket.com';
const CHAIN_ID = 137;

async function main() {
  console.log('\n🧪 TEST BUY & SELL\n');

  const privateKey = process.env.PRIVATE_KEY;
  const funderAddress = process.env.FUNDER_ADDRESS;

  if (!privateKey || !funderAddress) {
    console.log('❌ PRIVATE_KEY and FUNDER_ADDRESS required');
    return;
  }

  // Setup wallet and CLOB client
  const provider = new ethers.providers.JsonRpcProvider(process.env.CHAINSTACK_HTTP_URL || 'https://polygon-rpc.com');
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log('Wallet:', wallet.address);
  console.log('Funder:', funderAddress);

  // Initialize CLOB client with API credentials
  const clobClient = new ClobClient(CLOB_URL, CHAIN_ID, wallet, {
    key: process.env.POLY_API_KEY!,
    secret: process.env.POLY_SECRET!,
    passphrase: process.env.POLY_PASSPHRASE!
  }, 2, funderAddress); // signatureType=2, funder address

  // Find an active 15-min market
  console.log('\n🔍 Finding active 15-min market...\n');

  const now = Date.now();
  const cryptos = ['btc', 'eth', 'sol'];
  let targetMarket: any = null;
  let targetTokenId = '';
  let targetPrice = 0;
  let targetOutcome = '';

  for (const crypto of cryptos) {
    // Current interval (not yet ended)
    const currentInterval = Math.floor(now / (15 * 60 * 1000)) * (15 * 60 * 1000);
    const ts = Math.floor(currentInterval / 1000);
    const slug = `${crypto}-updown-15m-${ts}`;

    try {
      const res = await axios.get(`${GAMMA_API}/markets?slug=${slug}`, { timeout: 5000 });
      if (!res.data?.[0]) continue;

      const market = res.data[0];
      const endTime = new Date(market.endDate || market.endDateIso).getTime();

      // Check if market is still active (not ended)
      if (endTime > now && market.active) {
        const tokenIds = JSON.parse(market.clobTokenIds || '[]');
        const outcomes = JSON.parse(market.outcomes || '[]');
        const prices = JSON.parse(market.outcomePrices || '[]');

        // Find the cheaper outcome (usually "Down")
        const downIndex = outcomes.findIndex((o: string) => o.toLowerCase() === 'down');
        if (downIndex !== -1) {
          targetMarket = market;
          targetTokenId = tokenIds[downIndex];
          targetPrice = parseFloat(prices[downIndex]);
          targetOutcome = outcomes[downIndex];

          console.log(`✅ Found: ${crypto.toUpperCase()} Up or Down`);
          console.log(`   Slug: ${slug}`);
          console.log(`   Ends: ${new Date(endTime).toLocaleTimeString()}`);
          console.log(`   ${targetOutcome} price: $${targetPrice.toFixed(3)}`);
          console.log(`   Token ID: ${targetTokenId.slice(0, 20)}...`);
          break;
        }
      }
    } catch (e) {
      continue;
    }
  }

  if (!targetMarket) {
    console.log('❌ No active market found');
    return;
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 1: BUY $1 worth
  // ═══════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(50));
  console.log('📈 STEP 1: BUY $1');
  console.log('═'.repeat(50));

  const buyAmount = 1; // $1 USDC
  let boughtShares = 0;
  let buyOrderId = '';

  try {
    console.log(`\nCreating market buy order...`);
    console.log(`   Token: ${targetTokenId.slice(0, 30)}...`);
    console.log(`   Amount: $${buyAmount}`);
    console.log(`   Side: BUY`);

    const buyOrder = await clobClient.createMarketOrder({
      tokenID: targetTokenId,
      amount: buyAmount,
      side: Side.BUY
    });

    console.log(`\nPosting order (FOK)...`);
    const buyResponse = await clobClient.postOrder(buyOrder, OrderType.FOK);

    console.log(`\n✅ BUY SUCCESS!`);
    console.log(`   Order ID: ${buyResponse.orderID}`);
    console.log(`   Status: ${buyResponse.status}`);

    buyOrderId = buyResponse.orderID;
    boughtShares = buyAmount / targetPrice; // Approximate shares

    // Wait a moment for order to settle
    await new Promise(r => setTimeout(r, 2000));

  } catch (error: any) {
    console.log(`\n❌ BUY FAILED: ${error.message}`);

    if (error.response?.data) {
      console.log('   Response:', JSON.stringify(error.response.data).slice(0, 200));
    }
    return;
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 2: Check position
  // ═══════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(50));
  console.log('📊 STEP 2: CHECK POSITION');
  console.log('═'.repeat(50));

  console.log(`\nBought approximately ${boughtShares.toFixed(4)} shares at $${targetPrice.toFixed(3)}`);

  // ═══════════════════════════════════════════════════════════════
  // STEP 3: SELL position
  // ═══════════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(50));
  console.log('📉 STEP 3: SELL');
  console.log('═'.repeat(50));

  if (!process.argv.includes('--sell')) {
    console.log('\n⚠️  Run with --sell to execute sell');
    console.log(`   npx ts-node src_new/scripts/test-buy-sell.ts --sell`);
    return;
  }

  try {
    console.log(`\nCreating market sell order...`);
    console.log(`   Token: ${targetTokenId.slice(0, 30)}...`);
    console.log(`   Shares: ${boughtShares.toFixed(4)}`);
    console.log(`   Side: SELL`);

    const sellOrder = await clobClient.createMarketOrder({
      tokenID: targetTokenId,
      amount: boughtShares,
      side: Side.SELL
    });

    console.log(`\nPosting sell order (FOK)...`);
    const sellResponse = await clobClient.postOrder(sellOrder, OrderType.FOK);

    console.log(`\n✅ SELL SUCCESS!`);
    console.log(`   Order ID: ${sellResponse.orderID}`);
    console.log(`   Status: ${sellResponse.status}`);

  } catch (error: any) {
    console.log(`\n❌ SELL FAILED: ${error.message}`);

    if (error.response?.data) {
      console.log('   Response:', JSON.stringify(error.response.data).slice(0, 300));
    }
  }

  console.log('\n✅ Test complete!\n');
}

main().catch(console.error);
