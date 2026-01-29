/**
 * Real Buy/Sell Test with Approval
 * 
 * Bu test:
 * 1. Balance kontrol eder
 * 2. Market verisini çeker
 * 3. Küçük bir market order ile alım yapar (0.01 USDC)
 * 4. Position'ı kontrol eder
 * 5. Hemen satış yapar
 * 6. Kar/Zarar hesaplar
 */

import { PolymarketClient } from '../src/client';
import { getMarketBySlug, getTokenIds } from '../src/markets';
import { getBalance, getTokenBalance, displayBalance } from '../src/utils/balance';
import { buyShares, sellShares } from '../src/trading';
import { logTrade, logProfit } from '../src/utils/trade-logger';
import { logger } from '../src/utils/logger';
import { OrderType } from '@polymarket/clob-client';

// Test configuration
const TEST_CONFIG: {
  marketSlug: string;
  side: 'YES' | 'NO';
  amount: number;
  autoSell: boolean;
  waitBeforeSell: number;
} = {
  marketSlug: 'will-bitcoin-reach-130000-by-december-31-2025-911-832',
  side: 'NO',            // YES veya NO - Bitcoin 130K olmayacak (%76.5)
  amount: 1.00,          // $1.00 USDC (minimum for market orders)
  autoSell: true,        // Otomatik sat
  waitBeforeSell: 3000,  // Satıştan önce bekle (ms)
};

async function main() {
  try {
    logger.section('REAL BUY/SELL TEST');
    
    console.log('📋 Test Configuration:');
    console.log(`   Market: ${TEST_CONFIG.marketSlug}`);
    console.log(`   Side: ${TEST_CONFIG.side}`);
    console.log(`   Amount: $${TEST_CONFIG.amount} USDC`);
    console.log(`   Auto Sell: ${TEST_CONFIG.autoSell ? 'YES' : 'NO'}\n`);
    
    // Initialize client
    logger.info('Connecting to Polymarket...');
    const client = await PolymarketClient.create();
    logger.success('Connected!');
    
    // ===== STEP 1: Check Initial Balance =====
    console.log('\n' + '='.repeat(70));
    console.log('📊 STEP 1: Checking initial balance...');
    console.log('='.repeat(70) + '\n');
    
    const initialBalance = await getBalance(client);
    displayBalance(initialBalance);
    
    const usdcBalance = parseFloat(initialBalance.usdc) / 1000000; // Convert from micro-USDC
    console.log(`💵 Available: $${usdcBalance.toFixed(2)} USDC\n`);
    
    if (usdcBalance < TEST_CONFIG.amount) {
      console.log('❌ Insufficient balance for this test!');
      console.log(`   Need: $${TEST_CONFIG.amount} USDC`);
      console.log(`   Have: $${usdcBalance.toFixed(2)} USDC\n`);
      process.exit(1);
    }
    
    // ===== STEP 2: Get Market Data =====
    console.log('\n' + '='.repeat(70));
    console.log('📈 STEP 2: Fetching market data...');
    console.log('='.repeat(70) + '\n');
    
    const market = await getMarketBySlug(TEST_CONFIG.marketSlug);
    
    if (!market) {
      console.log('❌ Market not found!');
      console.log(`   Slug: ${TEST_CONFIG.marketSlug}\n`);
      process.exit(1);
    }
    
    console.log(`✅ Market found: ${market.question}`);
    console.log(`   Liquidity: $${parseFloat(market.liquidity || '0').toLocaleString()}`);
    console.log(`   Volume 24h: $${parseFloat(market.volume || '0').toLocaleString()}\n`);
    
    // Get token IDs
    const tokenIds = getTokenIds(market);
    if (!tokenIds) {
      console.log('❌ Could not get token IDs!');
      process.exit(1);
    }
    
    const tokenId = TEST_CONFIG.side === 'YES' ? tokenIds.yes : tokenIds.no;
    console.log(`${TEST_CONFIG.side} Token ID: ${tokenId}\n`);
    
    // Check current market price
    const cleanPrice = (price: any): number => {
      if (!price) return 0;
      const str = String(price).replace(/[\[\]"]/g, '').trim();
      return parseFloat(str) || 0;
    };
    
    let currentPrice = 0;
    if (market.tokens && market.tokens.length >= 2) {
      const token = TEST_CONFIG.side === 'YES' ? market.tokens[0] : market.tokens[1];
      currentPrice = cleanPrice(token?.price);
    }
    
    console.log(`Current ${TEST_CONFIG.side} Price: $${currentPrice.toFixed(4)}\n`);
    
    // ===== STEP 3: Execute BUY Order =====
    console.log('\n' + '='.repeat(70));
    console.log('💰 STEP 3: Executing BUY order...');
    console.log('='.repeat(70) + '\n');
    
    console.log(`⚠️  WARNING: This will spend $${TEST_CONFIG.amount} USDC!\n`);
    console.log('Creating MARKET order...\n');
    
    const buyStartTime = Date.now();
    
    try {
      const buyResult = await buyShares(client, {
        tokenId: tokenId,
        amount: TEST_CONFIG.amount,
        type: 'market',
        orderType: OrderType.FOK,  // Fill or Kill
      });
      
      console.log('✅ BUY order executed!');
      console.log('Result:', JSON.stringify(buyResult, null, 2));
      
      // Estimate shares bought
      const estimatedShares = currentPrice > 0 ? TEST_CONFIG.amount / currentPrice : 0;
      
      // Log the trade
      logTrade({
        timestamp: new Date().toISOString(),
        action: 'BUY',
        marketSlug: TEST_CONFIG.marketSlug,
        marketQuestion: market.question,
        tokenId: tokenId,
        side: TEST_CONFIG.side,
        orderType: 'MARKET',
        price: currentPrice,
        size: estimatedShares,
        totalCost: TEST_CONFIG.amount,
        orderId: buyResult.orderID,
        status: 'SUCCESS',
      });
      
    } catch (error: any) {
      console.log('❌ BUY order failed!');
      console.log('Error:', error.message);
      
      if (error.response?.data) {
        console.log('API Error:', JSON.stringify(error.response.data, null, 2));
      }
      
      // Log failed trade
      logTrade({
        timestamp: new Date().toISOString(),
        action: 'BUY',
        marketSlug: TEST_CONFIG.marketSlug,
        marketQuestion: market.question,
        tokenId: tokenId,
        side: TEST_CONFIG.side,
        orderType: 'MARKET',
        price: currentPrice,
        size: 0,
        totalCost: TEST_CONFIG.amount,
        status: 'FAILED',
        error: error.message,
      });
      
      console.log('\n💡 Possible reasons:');
      console.log('   1. Allowance not set (should be automatic on first trade)');
      console.log('   2. Insufficient liquidity in orderbook');
      console.log('   3. Market price moved too much');
      console.log('   4. Network error\n');
      
      process.exit(1);
    }
    
    // ===== STEP 4: Check Token Balance =====
    console.log('\n' + '='.repeat(70));
    console.log('📊 STEP 4: Checking token balance...');
    console.log('='.repeat(70) + '\n');
    
    console.log('Waiting 3 seconds for balance to update...\n');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const tokenBalance = await getTokenBalance(client, tokenId);
    // Token balance returns micro-shares (6 decimals), need to convert
    const sharesOwned = parseFloat(tokenBalance.balance) / 1000000;
    
    console.log(`✅ ${TEST_CONFIG.side} Shares Owned: ${sharesOwned.toFixed(6)}`);
    console.log(`   Token Allowance: ${parseFloat(tokenBalance.allowance).toFixed(4)}\n`);
    
    if (sharesOwned === 0) {
      console.log('⚠️  No shares found. Order may still be processing or failed.\n');
      process.exit(1);
    }
    
    // ===== STEP 5: Sell Shares (Optional) =====
    if (TEST_CONFIG.autoSell && sharesOwned > 0) {
      console.log('\n' + '='.repeat(70));
      console.log('💸 STEP 5: Executing SELL order...');
      console.log('='.repeat(70) + '\n');
      
      console.log(`Waiting ${TEST_CONFIG.waitBeforeSell / 1000} seconds before selling...\n`);
      await new Promise(resolve => setTimeout(resolve, TEST_CONFIG.waitBeforeSell));
      
      try {
        const sellResult = await sellShares(client, {
          tokenId: tokenId,
          amount: sharesOwned,
          type: 'market',
          orderType: OrderType.FOK,
        });
        
        console.log('✅ SELL order executed!');
        console.log('Result:', JSON.stringify(sellResult, null, 2));
        
        const sellEndTime = Date.now();
        const holdingTime = Math.floor((sellEndTime - buyStartTime) / 1000);
        
        // Calculate estimated sell price and profit
        const estimatedSellPrice = currentPrice; // Approximate
        const buyPrice = currentPrice;
        const profit = (estimatedSellPrice - buyPrice) * sharesOwned;
        const profitPercent = buyPrice > 0 ? (profit / (buyPrice * sharesOwned)) * 100 : 0;
        
        // Log the sell trade
        logTrade({
          timestamp: new Date().toISOString(),
          action: 'SELL',
          marketSlug: TEST_CONFIG.marketSlug,
          marketQuestion: market.question,
          tokenId: tokenId,
          side: TEST_CONFIG.side,
          orderType: 'MARKET',
          price: estimatedSellPrice,
          size: sharesOwned,
          totalCost: estimatedSellPrice * sharesOwned,
          orderId: sellResult.orderID,
          status: 'SUCCESS',
        });
        
        // Log profit/loss
        logProfit({
          timestamp: new Date().toISOString(),
          marketSlug: TEST_CONFIG.marketSlug,
          buyPrice: buyPrice,
          sellPrice: estimatedSellPrice,
          quantity: sharesOwned,
          profit: profit,
          profitPercent: profitPercent,
          holdingTime: `${holdingTime} seconds`,
        });
        
        console.log('\n' + '='.repeat(70));
        console.log('📊 TRADE SUMMARY');
        console.log('='.repeat(70));
        console.log(`Bought:  ${sharesOwned.toFixed(4)} shares @ $${buyPrice.toFixed(4)}`);
        console.log(`Sold:    ${sharesOwned.toFixed(4)} shares @ $${estimatedSellPrice.toFixed(4)}`);
        console.log(`P/L:     $${profit.toFixed(4)} (${profitPercent > 0 ? '+' : ''}${profitPercent.toFixed(2)}%)`);
        console.log(`Time:    ${holdingTime} seconds`);
        console.log('='.repeat(70) + '\n');
        
      } catch (error: any) {
        console.log('❌ SELL order failed!');
        console.log('Error:', error.message);
        
        if (error.response?.data) {
          console.log('API Error:', JSON.stringify(error.response.data, null, 2));
        }
        
        // Log failed sell
        logTrade({
          timestamp: new Date().toISOString(),
          action: 'SELL',
          marketSlug: TEST_CONFIG.marketSlug,
          marketQuestion: market.question,
          tokenId: tokenId,
          side: TEST_CONFIG.side,
          orderType: 'MARKET',
          price: currentPrice,
          size: sharesOwned,
          totalCost: 0,
          status: 'FAILED',
          error: error.message,
        });
        
        console.log('\n⚠️  You still own the shares. Sell manually if needed.\n');
      }
    }
    
    // ===== STEP 6: Check Final Balance =====
    console.log('\n' + '='.repeat(70));
    console.log('📊 STEP 6: Checking final balance...');
    console.log('='.repeat(70) + '\n');
    
    const finalBalance = await getBalance(client);
    displayBalance(finalBalance);
    
    const finalUSDC = parseFloat(finalBalance.usdc) / 1000000;
    const usdcChange = finalUSDC - usdcBalance;
    
    console.log(`💵 Balance Change: ${usdcChange > 0 ? '+' : ''}$${usdcChange.toFixed(4)} USDC\n`);
    
    // Final summary
    console.log('\n' + '='.repeat(70));
    console.log('✅ TEST COMPLETED');
    console.log('='.repeat(70));
    console.log('\n📁 Logs saved to:');
    console.log('   - logs/trades_*.jsonl (machine-readable)');
    console.log('   - logs/readable/trades_*.txt (human-readable)');
    console.log('   - logs/profits_*.jsonl (P/L data)');
    console.log('   - logs/readable/profits_*.txt (P/L summary)\n');
    
  } catch (error: any) {
    logger.section('❌ TEST FAILED');
    console.log('\nError:', error.message);
    if (error.stack) {
      console.log('\nStack:', error.stack);
    }
    process.exit(1);
  }
}

main();
