/**
 * Test 2: Balance Check
 * 
 * This script tests:
 * - USDC balance retrieval
 * - Open orders listing
 * - Balance display
 */

import { PolymarketClient } from '../src/client';
import { getBalance, getOpenOrders, displayBalance, displayOpenOrders } from '../src/utils/balance';
import { logger } from '../src/utils/logger';

async function main() {
  try {
    logger.section('POLYMARKET BALANCE CHECK');
    
    console.log('📝 This test will:');
    console.log('   1. Check your USDC balance');
    console.log('   2. List any open orders');
    console.log('   3. Display wallet information\n');
    
    // Initialize client
    logger.info('Connecting to Polymarket...');
    const client = await PolymarketClient.create();
    logger.success('Connected!');
    
    // Get balance
    const balance = await getBalance(client);
    displayBalance(balance);
    
    const usdcAmount = parseFloat(balance.usdc);
    
    if (usdcAmount === 0) {
      console.log('⚠️  WARNING: Your USDC balance is 0!\n');
      console.log('To start trading, you need to:');
      console.log('1. Get USDC on Polygon network');
      console.log('2. Send it to your wallet address shown above');
      console.log('3. Wait for confirmation (usually 1-2 minutes)\n');
      console.log('💡 Recommended: Start with 10-20 USDC for testing\n');
    } else if (usdcAmount < 10) {
      console.log(`⚠️  LOW BALANCE: $${usdcAmount.toFixed(2)} USDC\n`);
      console.log('You have some USDC but it may not be enough for testing.');
      console.log('Consider adding more for comfortable testing.\n');
    } else {
      console.log(`✅ GOOD BALANCE: $${usdcAmount.toFixed(2)} USDC\n`);
      console.log('You have sufficient balance to start trading!\n');
    }
    
    // Get open orders
    const openOrders = await getOpenOrders(client);
    displayOpenOrders(openOrders);
    
    if (openOrders.length > 0) {
      const totalLocked = openOrders.reduce((sum, order) => {
        return sum + (parseFloat(order.price) * parseFloat(order.size));
      }, 0);
      
      console.log(`💼 Total locked in orders: $${totalLocked.toFixed(2)} USDC\n`);
    }
    
    console.log('✅ Balance check complete!\n');
    
    if (usdcAmount >= 10) {
      console.log('🎯 Ready to trade! Next steps:');
      console.log('   - View markets: npm run test:buy (will show available markets)');
      console.log('   - Or explore markets at https://polymarket.com\n');
    }
    
  } catch (error: any) {
    logger.section('❌ BALANCE CHECK FAILED');
    
    console.log('\n🔍 Common issues:\n');
    
    if (error.message?.includes('connection')) {
      console.log('❌ Connection error');
      console.log('   Run connection test first: npm run test:connection\n');
    } else if (error.message?.includes('unauthorized')) {
      console.log('❌ API authentication failed');
      console.log('   Try running connection test again: npm run test:connection\n');
    } else {
      console.log('❌ Unexpected error occurred');
      console.log('   Error:', error.message);
      console.log('\n   Please run: npm run test:connection\n');
    }
    
    process.exit(1);
  }
}

main();
