/**
 * Advanced Buy Test - Limit Order Test
 * 
 * Bu test:
 * 1. Limit order oluşturur (düşük fiyat)
 * 2. Order'ı kontrol eder
 * 3. Order'ı iptal eder
 * 4. Market order ile gerçek alım yapar (opsiyonel)
 */

import { PolymarketClient } from '../src/client';
import { getMarketBySlug, getTokenIds } from '../src/markets';
import { getBalance, getOpenOrders, displayBalance, displayOpenOrders } from '../src/utils/balance';
import { buyShares } from '../src/trading';
import { logTrade } from '../src/utils/trade-logger';
import { logger } from '../src/utils/logger';
import { OrderType } from '@polymarket/clob-client';

// Test configuration
const TEST_CONFIG = {
  marketSlug: 'will-bitcoin-reach-130000-by-december-31-2025-911-832',
  side: 'YES' as const,  // YES veya NO
  limitPrice: 0.10,      // Düşük fiyat - dolmayacak
  amount: 0.01,          // 0.01 USDC
  waitTime: 5000,        // 5 saniye bekle
  actuallyBuy: false,    // Gerçekten market order ile alım yap?
};

async function main() {
  try {
    logger.section('ADVANCED BUY TEST - LIMIT ORDER');
    
    console.log('📋 Test Configuration:');
    console.log(`   Market: ${TEST_CONFIG.marketSlug}`);
    console.log(`   Side: ${TEST_CONFIG.side}`);
    console.log(`   Limit Price: $${TEST_CONFIG.limitPrice}`);
    console.log(`   Amount: $${TEST_CONFIG.amount} USDC\n`);
    
    // Initialize client
    logger.info('Connecting to Polymarket...');
    const client = await PolymarketClient.create();
    logger.success('Connected!');
    
    // Check balance
    console.log('\n📊 Checking balance...\n');
    const balance = await getBalance(client);
    displayBalance(balance);
    
    const usdcBalance = parseFloat(balance.usdc);
    console.log(`💵 Actual Balance: ${usdcBalance} USDC`);
    console.log(`💵 Formatted: $${(usdcBalance / 1000000).toFixed(2)} USDC\n`);
    
    if (usdcBalance < TEST_CONFIG.amount * 1000000) {
      console.log('❌ Insufficient balance for this test!');
      process.exit(1);
    }
    
    // Get market
    console.log('📈 Fetching market data...\n');
    const market = await getMarketBySlug(TEST_CONFIG.marketSlug);
    
    if (!market) {
      console.log('❌ Market not found!');
      process.exit(1);
    }
    
    console.log(`Market: ${market.question}`);
    console.log(`Liquidity: $${parseFloat(market.liquidity || '0').toFixed(0)}`);
    console.log(`Volume: $${parseFloat(market.volume || '0').toFixed(0)}\n`);
    
    // Get token IDs
    const tokenIds = getTokenIds(market);
    
    if (!tokenIds) {
      console.log('❌ Could not get token IDs!');
      process.exit(1);
    }
    
    const tokenId = TEST_CONFIG.side === 'YES' ? tokenIds.yes : tokenIds.no;
    console.log(`${TEST_CONFIG.side} Token: ${tokenId.substring(0, 20)}...\n`);
    
    // ===== STEP 1: Create Limit Order =====
    console.log('\n' + '='.repeat(70));
    console.log('📝 STEP 1: Creating LIMIT ORDER (will not fill)...');
    console.log('='.repeat(70) + '\n');
    
    console.log(`Creating limit order:`);
    console.log(`  Side: ${TEST_CONFIG.side}`);
    console.log(`  Price: $${TEST_CONFIG.limitPrice} (intentionally low)`);
    console.log(`  Amount: $${TEST_CONFIG.amount} USDC`);
    console.log(`  Expected Shares: ~${(TEST_CONFIG.amount / TEST_CONFIG.limitPrice).toFixed(2)}\n`);
    
    const limitOrderResult = await buyShares(client, {
      tokenId: tokenId,
      amount: TEST_CONFIG.amount,
      price: TEST_CONFIG.limitPrice,
      type: 'limit',
      orderType: OrderType.GTC,  // Good Till Canceled
    });
    
    console.log('\n✅ Limit order created!');
    console.log('Order ID:', limitOrderResult.orderID);
    
    // Log the trade
    logTrade({
      timestamp: new Date().toISOString(),
      action: 'BUY',
      marketSlug: TEST_CONFIG.marketSlug,
      marketQuestion: market.question,
      tokenId: tokenId,
      side: TEST_CONFIG.side,
      orderType: 'LIMIT',
      price: TEST_CONFIG.limitPrice,
      size: TEST_CONFIG.amount / TEST_CONFIG.limitPrice,
      totalCost: TEST_CONFIG.amount,
      orderId: limitOrderResult.orderID,
      status: 'PENDING',
    });
    
    // ===== STEP 2: Check Open Orders =====
    console.log('\n' + '='.repeat(70));
    console.log('📋 STEP 2: Checking open orders...');
    console.log('='.repeat(70) + '\n');
    
    console.log(`Waiting ${TEST_CONFIG.waitTime / 1000} seconds...\n`);
    await new Promise(resolve => setTimeout(resolve, TEST_CONFIG.waitTime));
    
    const openOrders = await getOpenOrders(client);
    displayOpenOrders(openOrders);
    
    if (openOrders.length === 0) {
      console.log('⚠️  No open orders found. Order may have been filled or rejected.\n');
    }
    
    // ===== STEP 3: Cancel Order =====
    console.log('\n' + '='.repeat(70));
    console.log('❌ STEP 3: Canceling limit order...');
    console.log('='.repeat(70) + '\n');
    
    if (openOrders.length > 0) {
      const orderToCancel = openOrders[0];
      console.log(`Canceling order: ${orderToCancel.id}\n`);
      
      const clobClient = client.getClient();
      const cancelResult = await clobClient.cancelOrder({
        orderID: orderToCancel.id,
      });
      
      console.log('✅ Order canceled!');
      console.log('Cancel result:', JSON.stringify(cancelResult, null, 2));
      
      // Log the cancellation
      logTrade({
        timestamp: new Date().toISOString(),
        action: 'CANCEL',
        marketSlug: TEST_CONFIG.marketSlug,
        marketQuestion: market.question,
        tokenId: tokenId,
        side: TEST_CONFIG.side,
        orderType: 'LIMIT',
        price: TEST_CONFIG.limitPrice,
        size: 0,
        totalCost: 0,
        orderId: orderToCancel.id,
        status: 'SUCCESS',
      });
      
      // Verify cancellation
      console.log('\nVerifying cancellation...\n');
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const ordersAfterCancel = await getOpenOrders(client);
      console.log(`Open orders after cancel: ${ordersAfterCancel.length}\n`);
    } else {
      console.log('⚠️  No orders to cancel.\n');
    }
    
    // ===== STEP 4: Market Order (Optional) =====
    if (TEST_CONFIG.actuallyBuy) {
      console.log('\n' + '='.repeat(70));
      console.log('💰 STEP 4: Creating MARKET ORDER (actual buy)...');
      console.log('='.repeat(70) + '\n');
      
      console.log('⚠️  WARNING: This will spend real USDC!\n');
      console.log('Creating market order...\n');
      
      const marketOrderResult = await buyShares(client, {
        tokenId: tokenId,
        amount: TEST_CONFIG.amount,
        type: 'market',
        orderType: OrderType.FOK,  // Fill or Kill
      });
      
      console.log('\n✅ Market order executed!');
      console.log('Transaction:', JSON.stringify(marketOrderResult, null, 2));
      
      // Log the actual trade
      logTrade({
        timestamp: new Date().toISOString(),
        action: 'BUY',
        marketSlug: TEST_CONFIG.marketSlug,
        marketQuestion: market.question,
        tokenId: tokenId,
        side: TEST_CONFIG.side,
        orderType: 'MARKET',
        price: 0,  // Market price - will be filled
        size: 0,   // Will be calculated by API
        totalCost: TEST_CONFIG.amount,
        status: 'SUCCESS',
      });
      
      // Check new balance
      console.log('\n📊 Checking balance after trade...\n');
      const newBalance = await getBalance(client);
      displayBalance(newBalance);
    } else {
      console.log('\n' + '='.repeat(70));
      console.log('ℹ️  STEP 4: Market order SKIPPED (actuallyBuy = false)');
      console.log('='.repeat(70) + '\n');
      console.log('To enable real market order, set actuallyBuy = true in config.\n');
    }
    
    // Final summary
    console.log('\n' + '='.repeat(70));
    console.log('✅ ADVANCED BUY TEST COMPLETED');
    console.log('='.repeat(70));
    console.log('\nSummary:');
    console.log('  ✓ Limit order created');
    console.log('  ✓ Open orders checked');
    console.log('  ✓ Limit order canceled');
    if (TEST_CONFIG.actuallyBuy) {
      console.log('  ✓ Market order executed');
    } else {
      console.log('  ○ Market order skipped');
    }
    console.log('\nAll trades logged to: logs/trades_*.jsonl\n');
    
  } catch (error: any) {
    logger.section('❌ TEST FAILED');
    console.log('\nError:', error.message);
    if (error.response?.data) {
      console.log('API Error:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

main();
