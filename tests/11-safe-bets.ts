/**
 * Find Safe Bets (High Probability Markets)
 * Markets with >80% probability on one side
 */

import { PolymarketClient } from '../src/client';
import { getActiveMarkets, getTokenIds } from '../src/markets';
import { logger } from '../src/utils/logger';

async function main() {
  try {
    logger.section('SAFE BET FINDER (>80% Probability)');
    
    const client = await PolymarketClient.create();
    
    console.log('\n🔍 Scanning for high-probability markets...\n');
    
    const markets = await getActiveMarkets({ limit: 200 });
    
    interface SafeBet {
      market: any;
      side: 'YES' | 'NO';
      probability: number;
      price: number;
      liquidity: number;
      volume: number;
      score: number;
    }
    
    const safeBets: SafeBet[] = [];
    
    for (const market of markets) {
      if (!market.enableOrderBook) continue;
      
      const tokenIds = getTokenIds(market);
      if (!tokenIds) continue;
      
      const liquidity = parseFloat(market.liquidity || '0');
      const volume = parseFloat(market.volume || '0');
      
      if (liquidity < 25000 || volume < 50000) continue;
      
      // Parse prices
      let yesPrice = 0;
      let noPrice = 0;
      
      if (Array.isArray(market.tokens) && market.tokens.length >= 2) {
        const cleanPrice = (price: any): number => {
          if (!price) return 0;
          const str = String(price).replace(/[\[\]"]/g, '').trim();
          return parseFloat(str) || 0;
        };
        
        yesPrice = cleanPrice(market.tokens[0]?.price);
        noPrice = cleanPrice(market.tokens[1]?.price);
      }
      
      // Find safe bets (>80% probability)
      if (yesPrice >= 0.80) {
        const spread = Math.abs((yesPrice + noPrice) - 1);
        const score = liquidity > 100000 ? 100 : liquidity > 50000 ? 90 : 80;
        
        safeBets.push({
          market,
          side: 'YES',
          probability: yesPrice * 100,
          price: yesPrice,
          liquidity,
          volume,
          score,
        });
      }
      
      if (noPrice >= 0.80) {
        const spread = Math.abs((yesPrice + noPrice) - 1);
        const score = liquidity > 100000 ? 100 : liquidity > 50000 ? 90 : 80;
        
        safeBets.push({
          market,
          side: 'NO',
          probability: noPrice * 100,
          price: noPrice,
          liquidity,
          volume,
          score,
        });
      }
    }
    
    // Sort by probability (highest first)
    safeBets.sort((a, b) => b.probability - a.probability);
    
    console.log('='.repeat(80));
    console.log('🎯 SAFE BETS (>80% Probability)');
    console.log('='.repeat(80));
    console.log(`Found: ${safeBets.length} safe opportunities\n`);
    
    if (safeBets.length === 0) {
      console.log('⚠️  No safe bets found with current criteria.\n');
      process.exit(0);
    }
    
    // Display top 10
    const top = safeBets.slice(0, 10);
    
    top.forEach((bet, index) => {
      const m = bet.market;
      console.log(`[${index + 1}] ${m.question}`);
      console.log('─'.repeat(80));
      console.log(`Slug:        ${m.slug}`);
      console.log(`Safe Side:   ${bet.side} @ $${bet.price.toFixed(4)} (${bet.probability.toFixed(1)}% probability)`);
      console.log(`Liquidity:   $${bet.liquidity.toLocaleString()}`);
      console.log(`Volume 24h:  $${bet.volume.toLocaleString()}`);
      console.log(`Score:       ${bet.score}/100`);
      console.log(`End Date:    ${m.endDate || 'N/A'}`);
      
      // Calculate potential return
      const investAmount = 1.00; // $1 USDC
      const shares = investAmount / bet.price;
      const potentialReturn = shares * 1.0; // If wins, each share = $1
      const profit = potentialReturn - investAmount;
      const profitPercent = (profit / investAmount) * 100;
      
      console.log(`\n💰 If you invest $${investAmount.toFixed(2)}:`);
      console.log(`   Shares:           ${shares.toFixed(4)}`);
      console.log(`   If wins:          $${potentialReturn.toFixed(4)}`);
      console.log(`   Profit:           $${profit.toFixed(4)} (+${profitPercent.toFixed(1)}%)`);
      console.log(`   Win Probability:  ${bet.probability.toFixed(1)}%`);
      console.log(`   Expected Value:   $${((potentialReturn * (bet.probability / 100)) - investAmount).toFixed(4)}`);
      console.log('');
    });
    
    console.log('='.repeat(80));
    console.log('💡 RECOMMENDATION');
    console.log('='.repeat(80));
    
    if (top.length > 0) {
      const best = top[0];
      console.log(`\n🎯 Best Safe Bet: ${best.market.question}`);
      console.log(`   Side: ${best.side}`);
      console.log(`   Probability: ${best.probability.toFixed(1)}%`);
      console.log(`   Price: $${best.price.toFixed(4)}`);
      console.log(`   Liquidity: $${best.liquidity.toLocaleString()}`);
      
      console.log(`\n   Trade command:`);
      console.log(`   Edit tests/09-real-trade-test.ts and set:`);
      console.log(`   - marketSlug: "${best.market.slug}"`);
      console.log(`   - side: "${best.side}"`);
      console.log(`   - amount: 1.00`);
      console.log(`\n   Then run: npm run trade:real\n`);
    }
    
  } catch (error: any) {
    logger.section('❌ SCAN FAILED');
    console.log('\nError:', error.message);
    process.exit(1);
  }
}

main();
