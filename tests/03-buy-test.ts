/**
 * Test 3: Buy Test
 * 
 * This script demonstrates:
 * - Finding active markets
 * - Creating a small buy order
 * - Executing the trade
 * 
 * ⚠️ WARNING: This will use REAL USDC!
 * Start with a small amount (e.g., 1-2 USDC) for testing.
 */

import { PolymarketClient } from '../src/client';
import { getActiveMarkets, displayMarket, getTokenIds } from '../src/markets';
import { buyShares } from '../src/trading';
import { checkSufficientBalance } from '../src/utils/balance';
import { logger } from '../src/utils/logger';

async function main() {
  try {
    logger.section('POLYMARKET BUY TEST');
    
    console.log('⚠️  WARNING: This test will execute a REAL trade with REAL money!');
    console.log('   Make sure you understand what you\'re doing.\n');
    
    // Initialize client
    logger.info('Connecting to Polymarket...');
    const client = await PolymarketClient.create();
    logger.success('Connected!');
    
    // Fetch some active markets
    console.log('\n📊 Fetching active markets...\n');
    const markets = await getActiveMarkets({ limit: 5, active: true });
    
    if (markets.length === 0) {
      console.log('❌ No active markets found. Try again later.\n');
      process.exit(1);
    }
    
    // Display first market as example
    console.log('Here is an example market:\n');
    displayMarket(markets[0]);
    
    console.log('\n' + '='.repeat(70));
    console.log('💡 HOW TO BUY:');
    console.log('='.repeat(70));
    console.log('1. Choose a market from https://polymarket.com');
    console.log('2. Get the token ID (YES or NO)');
    console.log('3. Decide how much USDC to spend');
    console.log('4. Uncomment and modify the code below\n');
    
    // Example buy code (COMMENTED OUT FOR SAFETY)
    console.log('Example code to buy shares:\n');
    console.log('```typescript');
    console.log('// Get token IDs for this market');
    console.log('const tokenIds = getTokenIds(markets[0]);');
    console.log('if (tokenIds) {');
    console.log('  // Buy YES shares for 2 USDC');
    console.log('  await buyShares(client, {');
    console.log('    tokenId: tokenIds.yes,');
    console.log('    amount: 2,  // $2 USDC');
    console.log('    type: \'market\',  // Market order (immediate)');
    console.log('  });');
    console.log('}');
    console.log('```\n');
    
    console.log('='.repeat(70));
    console.log('⚠️  TO EXECUTE A REAL TRADE:');
    console.log('='.repeat(70));
    console.log('1. Find a market you want to trade on');
    console.log('2. Get the token ID from the market');
    console.log('3. Edit this file (tests/03-buy-test.ts)');
    console.log('4. Uncomment the trading code below');
    console.log('5. Run the test again\n');
    
    /*
    // =====================================================
    // UNCOMMENT THE CODE BELOW TO EXECUTE A REAL TRADE
    // =====================================================
    
    // Example: Buy YES shares on first market
    const tokenIds = getTokenIds(markets[0]);
    
    if (!tokenIds) {
      console.log('❌ Could not get token IDs for this market');
      process.exit(1);
    }
    
    const buyAmount = 1; // $1 USDC (CHANGE THIS)
    
    // Check balance
    const hasBalance = await checkSufficientBalance(client, buyAmount);
    if (!hasBalance) {
      console.log('❌ Insufficient balance for this trade');
      process.exit(1);
    }
    
    console.log(`\n💰 Buying YES shares for $${buyAmount} USDC...\n`);
    
    const result = await buyShares(client, {
      tokenId: tokenIds.yes,  // or tokenIds.no for NO shares
      amount: buyAmount,
      type: 'market',
    });
    
    console.log('\n✅ Trade executed successfully!');
    console.log('Order details:', JSON.stringify(result, null, 2));
    console.log('\n🎉 Congratulations! You just made your first trade on Polymarket!\n');
    */
    
  } catch (error: any) {
    logger.section('❌ BUY TEST FAILED');
    
    console.log('\n🔍 Error details:\n');
    console.log(error.message);
    
    console.log('\n💡 Troubleshooting:');
    console.log('   - Check your USDC balance: npm run test:balance');
    console.log('   - Make sure the market is active');
    console.log('   - Verify the token ID is correct');
    console.log('   - Start with a small amount (1-2 USDC)\n');
    
    process.exit(1);
  }
}

main();
