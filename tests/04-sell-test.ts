/**
 * Test 4: Sell Test
 * 
 * This script demonstrates:
 * - Checking your share positions
 * - Creating a sell order
 * - Executing the trade
 * 
 * ⚠️ NOTE: You need to own shares first (from a buy order)
 */

import { PolymarketClient } from '../src/client';
import { sellShares } from '../src/trading';
import { getOpenOrders } from '../src/utils/balance';
import { logger } from '../src/utils/logger';

async function main() {
  try {
    logger.section('POLYMARKET SELL TEST');
    
    console.log('📝 This test helps you sell shares you own.\n');
    
    // Initialize client
    logger.info('Connecting to Polymarket...');
    const client = await PolymarketClient.create();
    logger.success('Connected!');
    
    // Check open orders
    console.log('\n📊 Checking your positions...\n');
    const openOrders = await getOpenOrders(client);
    
    if (openOrders.length === 0) {
      console.log('📭 You have no open orders.\n');
      console.log('To sell shares:');
      console.log('1. You need to own shares first (buy some first)');
      console.log('2. Check your positions on https://polymarket.com/portfolio');
      console.log('3. Get the token ID of shares you want to sell\n');
      process.exit(0);
    }
    
    console.log(`Found ${openOrders.length} open order(s):\n`);
    openOrders.forEach((order, i) => {
      console.log(`[${i + 1}] ${order.side.toUpperCase()} - ${order.size} shares @ $${order.price}`);
      console.log(`    Token: ${order.asset_id}`);
      console.log(`    Order ID: ${order.id}\n`);
    });
    
    console.log('='.repeat(70));
    console.log('💡 HOW TO SELL:');
    console.log('='.repeat(70));
    console.log('1. Make sure you own shares (check portfolio)');
    console.log('2. Get the token ID of shares you want to sell');
    console.log('3. Decide how many shares to sell');
    console.log('4. Uncomment and modify the code below\n');
    
    console.log('Example code to sell shares:\n');
    console.log('```typescript');
    console.log('// Sell 5 shares at market price');
    console.log('await sellShares(client, {');
    console.log('  tokenId: \'YOUR_TOKEN_ID_HERE\',');
    console.log('  amount: 5,  // Number of shares');
    console.log('  type: \'market\',  // Market order (immediate)');
    console.log('});');
    console.log('```\n');
    
    console.log('='.repeat(70));
    console.log('⚠️  TO EXECUTE A REAL SELL:');
    console.log('='.repeat(70));
    console.log('1. Check your portfolio on Polymarket.com');
    console.log('2. Get the token ID of shares you want to sell');
    console.log('3. Edit this file (tests/04-sell-test.ts)');
    console.log('4. Uncomment the trading code below');
    console.log('5. Run the test again\n');
    
    /*
    // =====================================================
    // UNCOMMENT THE CODE BELOW TO EXECUTE A REAL SELL
    // =====================================================
    
    const tokenId = 'YOUR_TOKEN_ID_HERE'; // Replace with actual token ID
    const sellAmount = 5; // Number of shares to sell
    
    console.log(`\n💰 Selling ${sellAmount} shares...\n`);
    
    const result = await sellShares(client, {
      tokenId: tokenId,
      amount: sellAmount,
      type: 'market',
    });
    
    console.log('\n✅ Sell order executed successfully!');
    console.log('Order details:', JSON.stringify(result, null, 2));
    console.log('\n💵 Your USDC balance should be updated now!\n');
    */
    
  } catch (error: any) {
    logger.section('❌ SELL TEST FAILED');
    
    console.log('\n🔍 Error details:\n');
    console.log(error.message);
    
    console.log('\n💡 Troubleshooting:');
    console.log('   - Make sure you own shares to sell');
    console.log('   - Check your portfolio: https://polymarket.com/portfolio');
    console.log('   - Verify the token ID is correct');
    console.log('   - Make sure you have enough shares to sell\n');
    
    process.exit(1);
  }
}

main();
