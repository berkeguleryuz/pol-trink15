/**
 * Complete Market Scanner
 * 
 * Tüm marketleri tarar ve:
 * - Filtreleme kriterleri uygular
 * - Yeni marketleri tespit eder
 * - Loglar
 * - Detaylı raporlama yapar
 */

import { PolymarketClient } from '../src/client';
import { getActiveMarkets, getTokenIds } from '../src/markets';
import { logger } from '../src/utils/logger';
import {
  filterMarketsByCriteria,
  getCriteriaPreset,
  displayCriteria,
  MarketCriteria,
} from '../src/utils/market-criteria';
import {
  logMarket,
  initializeKnownMarkets,
  checkForNewMarkets,
  MarketLog,
} from '../src/utils/trade-logger';

// Configuration
const SCAN_CONFIG = {
  limit: 200,              // Fetch up to 200 markets
  criteriaPreset: 'balanced', // conservative, balanced, aggressive, crypto, politics, economy
  logAllMarkets: true,     // Log all markets to file
  showTop: 20,             // Show top N markets
};

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
    logger.section('COMPLETE MARKET SCANNER');
    
    console.log('⚙️  Configuration:');
    console.log(`   Fetch Limit: ${SCAN_CONFIG.limit} markets`);
    console.log(`   Criteria: ${SCAN_CONFIG.criteriaPreset}`);
    console.log(`   Show Top: ${SCAN_CONFIG.showTop}\n`);
    
    // Initialize client
    logger.info('Connecting to Polymarket...');
    const client = await PolymarketClient.create();
    logger.success('Connected!');
    
    // Fetch ALL active markets
    console.log('\n📊 Fetching all active markets...\n');
    const markets = await getActiveMarkets({ 
      limit: SCAN_CONFIG.limit,
      active: true,
      closed: false 
    });
    
    console.log(`✅ Found ${markets.length} active markets\n`);
    
    // Analyze markets
    console.log('🔍 Analyzing markets...\n');
    const analyses: MarketAnalysis[] = [];
    const marketLogs: MarketLog[] = [];
    
    for (const market of markets) {
      if (!market.enableOrderBook) continue;
      
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
      score += liquidity > 100000 ? 30 : liquidity > 50000 ? 25 : liquidity > 10000 ? 20 : 10;
      score += volume24h > 1000000 ? 30 : volume24h > 100000 ? 25 : volume24h > 10000 ? 20 : 10;
      score += spread < 0.02 ? 30 : spread < 0.05 ? 25 : spread < 0.1 ? 20 : 10;
      score += (yesPrice > 0.1 && yesPrice < 0.9) ? 10 : 5;
      
      const analysis = {
        market,
        tokenIds,
        liquidity,
        volume24h,
        spread,
        yesPrice,
        noPrice,
        score,
      };
      
      analyses.push(analysis);
      
      // Create market log
      marketLogs.push({
        timestamp: new Date().toISOString(),
        marketId: market.id,
        slug: market.slug,
        question: market.question,
        yesPrice,
        noPrice,
        liquidity,
        volume24h,
        spread,
        score,
        category: market.category,
        endDate: market.endDate,
      });
    }
    
    console.log(`✅ Analyzed ${analyses.length} tradeable markets\n`);
    
    // Initialize known markets and check for new ones
    initializeKnownMarkets(marketLogs.map(m => m.marketId));
    
    // Log all markets if enabled
    if (SCAN_CONFIG.logAllMarkets) {
      console.log('💾 Logging all markets...\n');
      marketLogs.forEach(m => logMarket(m));
      console.log(`✅ Logged ${marketLogs.length} markets\n`);
    }
    
    // Apply filtering criteria
    const criteria = getCriteriaPreset(SCAN_CONFIG.criteriaPreset);
    displayCriteria(criteria);
    
    console.log('🔎 Applying filters...\n');
    const filtered = filterMarketsByCriteria(analyses, criteria);
    
    console.log(`✅ ${filtered.length} markets passed filters\n`);
    
    // Sort by score
    filtered.sort((a, b) => b.score - a.score);
    
    // Display statistics
    console.log('='.repeat(80));
    console.log('📈 MARKET STATISTICS');
    console.log('='.repeat(80));
    console.log(`Total Markets:          ${markets.length}`);
    console.log(`Tradeable Markets:      ${analyses.length}`);
    console.log(`After Filters:          ${filtered.length}`);
    console.log(`Pass Rate:              ${((filtered.length / analyses.length) * 100).toFixed(1)}%`);
    console.log('\nScore Distribution:');
    console.log(`  Excellent (90-100):   ${filtered.filter(a => a.score >= 90).length}`);
    console.log(`  Good (70-89):         ${filtered.filter(a => a.score >= 70 && a.score < 90).length}`);
    console.log(`  Fair (50-69):         ${filtered.filter(a => a.score >= 50 && a.score < 70).length}`);
    console.log(`  Poor (<50):           ${filtered.filter(a => a.score < 50).length}`);
    console.log('\nLiquidity Distribution:');
    console.log(`  High (>$100K):        ${filtered.filter(a => a.liquidity > 100000).length}`);
    console.log(`  Medium ($50K-$100K):  ${filtered.filter(a => a.liquidity >= 50000 && a.liquidity <= 100000).length}`);
    console.log(`  Low (<$50K):          ${filtered.filter(a => a.liquidity < 50000).length}`);
    console.log('='.repeat(80) + '\n');
    
    // Display top markets
    console.log('='.repeat(80));
    console.log(`🏆 TOP ${SCAN_CONFIG.showTop} TRADING OPPORTUNITIES`);
    console.log('='.repeat(80) + '\n');
    
    const topMarkets = filtered.slice(0, SCAN_CONFIG.showTop);
    
    topMarkets.forEach((analysis, index) => {
      const m = analysis.market;
      console.log(`[${index + 1}] ${m.question}`);
      console.log('─'.repeat(80));
      console.log(`Slug:        ${m.slug}`);
      console.log(`Category:    ${m.category || 'N/A'}`);
      console.log(`YES Price:   $${analysis.yesPrice.toFixed(4)} (${(analysis.yesPrice * 100).toFixed(1)}%)`);
      console.log(`NO Price:    $${analysis.noPrice.toFixed(4)} (${(analysis.noPrice * 100).toFixed(1)}%)`);
      console.log(`Spread:      ${(analysis.spread * 100).toFixed(2)}%`);
      console.log(`Liquidity:   $${analysis.liquidity.toLocaleString()}`);
      console.log(`Volume 24h:  $${analysis.volume24h.toLocaleString()}`);
      console.log(`Score:       ${analysis.score}/100`);
      console.log(`End Date:    ${m.endDate || 'N/A'}`);
      console.log(`Token IDs:   YES: ${analysis.tokenIds!.yes.substring(0, 15)}...`);
      console.log(`             NO:  ${analysis.tokenIds!.no.substring(0, 15)}...`);
      console.log('');
    });
    
    console.log('='.repeat(80));
    console.log('💡 RECOMMENDATIONS');
    console.log('='.repeat(80));
    
    if (topMarkets.length > 0) {
      const best = topMarkets[0];
      console.log(`\n🎯 Best Opportunity: ${best.market.question}`);
      console.log(`   Slug: ${best.market.slug}`);
      console.log(`   Score: ${best.score}/100`);
      console.log(`   Liquidity: $${best.liquidity.toLocaleString()}`);
      
      if (best.yesPrice < 0.3) {
        console.log(`   → YES is undervalued at ${(best.yesPrice * 100).toFixed(1)}%`);
      } else if (best.yesPrice > 0.7) {
        console.log(`   → YES is overvalued at ${(best.yesPrice * 100).toFixed(1)}%`);
      } else {
        console.log(`   → Market is balanced`);
      }
      
      console.log(`\n   Test trade command:`);
      console.log(`   npm run test:buy -- ${best.market.slug}\n`);
    } else {
      console.log('\n⚠️  No markets match the current criteria.');
      console.log('   Try using "aggressive" preset for more opportunities.\n');
    }
    
    console.log('='.repeat(80));
    console.log('✅ SCAN COMPLETE');
    console.log('='.repeat(80));
    console.log(`\nLogs saved to: logs/markets_*.jsonl`);
    console.log(`Next scan will detect new markets automatically.\n`);
    
  } catch (error: any) {
    logger.section('❌ SCAN FAILED');
    console.log('\nError:', error.message);
    if (error.stack) {
      console.log('\nStack:', error.stack);
    }
    process.exit(1);
  }
}

main();
