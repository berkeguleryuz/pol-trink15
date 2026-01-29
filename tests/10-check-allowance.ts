/**
 * Check Real Balance and Set Allowance
 */

import { PolymarketClient } from '../src/client';
import { getBalance } from '../src/utils/balance';
import { logger } from '../src/utils/logger';

async function main() {
  try {
    logger.section('BALANCE & ALLOWANCE CHECK');
    
    const client = await PolymarketClient.create();
    const clobClient = client.getClient();
    
    console.log('\n📊 Checking USDC balance and allowance...\n');
    
    // Get balance
    const balance = await getBalance(client);
    
    console.log('Raw Balance Data:');
    console.log(`  USDC Balance: ${balance.usdc}`);
    console.log(`  Allowance: ${balance.allowance}`);
    console.log(`  Address: ${balance.address}\n`);
    
    // Convert to readable format
    const usdcBalance = parseFloat(balance.usdc);
    const allowance = parseFloat(balance.allowance);
    
    console.log('Formatted:');
    console.log(`  USDC: ${usdcBalance} (${(usdcBalance / 1000000).toFixed(2)} USDC)`);
    console.log(`  Allowance: ${allowance} (${(allowance / 1000000).toFixed(2)} USDC)\n`);
    
    // Check if we need to set allowance
    if (allowance < usdcBalance) {
      console.log('⚠️  Allowance is ZERO!\n');
      console.log('💡 IMPORTANT: Allowance must be set before trading.');
      console.log('   Options:');
      console.log('   1. Make your first trade on polymarket.com (recommended)');
      console.log('   2. Or use limit orders (GTC) instead of market orders');
      console.log('   3. Allowance will be set automatically on first successful trade\n');
    } else {
      console.log('✅ Allowance is sufficient!\n');
    }
    
    // Check if balance is real
    console.log('='.repeat(70));
    console.log('🔍 BALANCE ANALYSIS');
    console.log('='.repeat(70));
    
    if (usdcBalance === 19990206) {
      console.log('⚠️  This looks like a TEST/DEMO balance ($19.99)');
      console.log('   Real trading may not work with this balance.');
      console.log('   You need to:');
      console.log('   1. Check your wallet on Polygon');
      console.log('   2. Make sure you have real USDC');
      console.log('   3. Bridge USDC to Polygon if needed\n');
    } else if (usdcBalance > 0) {
      console.log(`✅ You have ${(usdcBalance / 1000000).toFixed(2)} USDC\n`);
    } else {
      console.log('❌ No USDC balance found!\n');
    }
    
    // Also check real wallet balance on Polygon
    console.log('='.repeat(70));
    console.log('💡 TIP: Check your real balance');
    console.log('='.repeat(70));
    console.log(`Polygon Scan: https://polygonscan.com/address/${balance.address}`);
    console.log(`Check USDC: https://polygonscan.com/token/0x2791bca1f2de4661ed88a30c99a7a9449aa84174?a=${balance.address}\n`);
    
  } catch (error: any) {
    logger.section('❌ CHECK FAILED');
    console.log('\nError:', error.message);
    process.exit(1);
  }
}

main();
