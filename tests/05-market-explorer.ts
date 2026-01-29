/**
 * Market Data Explorer
 * 
 * Bu script aktif marketleri analiz eder ve trading fırsatlarını gösterir:
 * - Yüksek likidite
 * - Düşük spread
 * - Yüksek hacim
 * - Fiyat değişimleri
 */

import { PolymarketClient } from '../src/client';
import { getActiveMarkets, displayMarket, getTokenIds } from '../src/markets';
import { logger } from '../src/utils/logger';

interface MarketAnalysis {
  market: any;
  tokenIds: { yes: string; no: string } | null;
  liquidity: number;
  volume24h: number;
  spread: number;
  yesPrice: number;
  noPrice: number;
  score: number;
}

async function main() {
  try {
    logger.section('MARKET DATA EXPLORER');
    
    console.log('📊 Analyzing markets for trading opportunities...\n');
    
    // Initialize client
    logger.info('Connecting to Polymarket...');
    const client = await PolymarketClient.create();
    logger.success('Connected!');
    
    // Fetch active markets
    console.log('\n📈 Fetching active markets...\n');
    const markets = await getActiveMarkets({ 
      limit: 50,  // Get more markets
      active: true,
      closed: false 
    });
    
    console.log(`Found ${markets.length} active markets\n`);
    
    // Analyze markets
    const analyses: MarketAnalysis[] = [];
    
    for (const market of markets) {
      if (!market.enableOrderBook) continue; // Skip if order book not enabled
      
      const tokenIds = getTokenIds(market);
      if (!tokenIds) continue;
      
      const liquidity = parseFloat(market.liquidity || '0');
      const volume24h = parseFloat(market.volume || '0');
      
      // Parse price - clean malformed JSON strings
      let yesPrice = 0;
      let noPrice = 0;
      
      if (Array.isArray(market.tokens) && market.tokens.length >= 2) {
        const yesToken = market.tokens[0];
        const noToken = market.tokens[1];
        
        // Clean malformed price strings like "[\"0.023\"" or " \"0.977\"]"
        const cleanPrice = (price: any): number => {
          if (!price) return 0;
          const str = String(price).replace(/[\[\]"]/g, '').trim();
          return parseFloat(str) || 0;
        };
        
        yesPrice = cleanPrice(yesToken?.price);
        noPrice = cleanPrice(noToken?.price);
      }
      
      const spread = Math.abs((yesPrice + noPrice) - 1);
      
      // Calculate opportunity score
      let score = 0;
      score += liquidity > 10000 ? 30 : liquidity > 1000 ? 20 : 10;
      score += volume24h > 50000 ? 30 : volume24h > 10000 ? 20 : 10;
      score += spread < 0.05 ? 30 : spread < 0.1 ? 20 : 10;
      score += (yesPrice > 0.2 && yesPrice < 0.8) ? 10 : 0;
      
      analyses.push({
        market,
        tokenIds,
        liquidity,
        volume24h,
        spread,
        yesPrice,
        noPrice,
        score,
      });
    }
    
    // Sort by score
    analyses.sort((a, b) => b.score - a.score);
    
    // Display top opportunities
    console.log('\n' + '='.repeat(80));
    console.log('🎯 TOP TRADING OPPORTUNITIES (by Score)');
    console.log('='.repeat(80) + '\n');
    
    const topMarkets = analyses.slice(0, 10);
    
    topMarkets.forEach((analysis, index) => {
      const m = analysis.market;
      console.log(`\n[${index + 1}] ${m.question}`);
      console.log('─'.repeat(80));
      console.log(`Category:    ${m.category || 'N/A'}`);
      console.log(`YES Price:   $${analysis.yesPrice.toFixed(4)} (${(analysis.yesPrice * 100).toFixed(1)}%)`);
      console.log(`NO Price:    $${analysis.noPrice.toFixed(4)} (${(analysis.noPrice * 100).toFixed(1)}%)`);
      console.log(`Spread:      ${(analysis.spread * 100).toFixed(2)}%`);
      console.log(`Liquidity:   $${analysis.liquidity.toFixed(0)}`);
      console.log(`Volume 24h:  $${analysis.volume24h.toFixed(0)}`);
      console.log(`Score:       ${analysis.score}/100`);
      console.log(`Token IDs:   YES: ${analysis.tokenIds!.yes.substring(0, 20)}...`);
      console.log(`             NO:  ${analysis.tokenIds!.no.substring(0, 20)}...`);
      console.log(`End Date:    ${m.endDate || 'N/A'}`);
    });
    
    console.log('\n' + '='.repeat(80));
    console.log('📊 MARKET STATISTICS');
    console.log('='.repeat(80));
    console.log(`Total Markets:       ${markets.length}`);
    console.log(`Tradeable Markets:   ${analyses.length}`);
    console.log(`High Score (>70):    ${analyses.filter(a => a.score > 70).length}`);
    console.log(`Med Score (50-70):   ${analyses.filter(a => a.score >= 50 && a.score <= 70).length}`);
    console.log(`Low Score (<50):     ${analyses.filter(a => a.score < 50).length}`);
    console.log('='.repeat(80) + '\n');
    
    // Save detailed analysis of top market
    if (topMarkets.length > 0) {
      console.log('🔍 DETAILED ANALYSIS OF TOP MARKET:\n');
      displayMarket(topMarkets[0].market);
      
      console.log('\n💡 TRADING SUGGESTIONS:');
      const top = topMarkets[0];
      
      if (top.yesPrice < 0.3) {
        console.log(`   ✓ YES is underpriced at ${(top.yesPrice * 100).toFixed(1)}% - consider buying YES`);
      } else if (top.yesPrice > 0.7) {
        console.log(`   ✓ YES is overpriced at ${(top.yesPrice * 100).toFixed(1)}% - consider buying NO`);
      } else {
        console.log(`   → Market is balanced at ${(top.yesPrice * 100).toFixed(1)}% / ${(top.noPrice * 100).toFixed(1)}%`);
      }
      
      if (top.spread < 0.03) {
        console.log(`   ✓ Low spread (${(top.spread * 100).toFixed(2)}%) - good for trading`);
      } else {
        console.log(`   ⚠ High spread (${(top.spread * 100).toFixed(2)}%) - be careful`);
      }
      
      if (top.liquidity > 10000) {
        console.log(`   ✓ High liquidity ($${top.liquidity.toFixed(0)}) - easy to enter/exit`);
      } else {
        console.log(`   ⚠ Low liquidity ($${top.liquidity.toFixed(0)}) - may face slippage`);
      }
      
      console.log('\n   Example trades with 0.01 USDC:');
      console.log(`   - Buy YES: ~${(0.01 / top.yesPrice).toFixed(2)} shares`);
      console.log(`   - Buy NO:  ~${(0.01 / top.noPrice).toFixed(2)} shares`);
    }
    
    console.log('\n✅ Market analysis complete!');
    console.log('\n💡 Next steps:');
    console.log('   1. Review top markets above');
    console.log('   2. Check market details on https://polymarket.com');
    console.log('   3. Decide on a market to trade');
    console.log('   4. Use token IDs for buy/sell orders\n');
    
  } catch (error: any) {
    logger.section('❌ MARKET ANALYSIS FAILED');
    console.log('\nError:', error.message);
    process.exit(1);
  }
}

main();
