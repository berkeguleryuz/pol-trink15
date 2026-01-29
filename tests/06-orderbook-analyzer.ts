/**
 * Market Orderbook Analyzer
 * 
 * Orderbook derinliğini analiz eder:
 * - Best bid/ask prices
 * - Orderbook depth
 * - Liquidity analysis
 * - Slippage estimation
 */

import { PolymarketClient } from '../src/client';
import { getMarketBySlug, getTokenIds } from '../src/markets';
import { logger } from '../src/utils/logger';

interface OrderbookSide {
  price: string;
  size: string;
}

interface Orderbook {
  market: string;
  asset_id: string;
  bids: OrderbookSide[];
  asks: OrderbookSide[];
  timestamp: number;
}

async function analyzeOrderbook(client: PolymarketClient, tokenId: string, side: 'YES' | 'NO') {
  console.log(`\n📖 Analyzing ${side} orderbook...\n`);
  
  try {
    const orderbook = await client.getOrderbook(tokenId);
    
    if (!orderbook || (!orderbook.bids?.length && !orderbook.asks?.length)) {
      console.log(`⚠️ No orderbook data available for ${side}`);
      return null;
    }
    
    const bids = (orderbook.bids || []).slice(0, 10);
    const asks = (orderbook.asks || []).slice(0, 10);
    
    console.log(`${side} Token Orderbook:`);
    console.log('─'.repeat(60));
    
    if (asks.length > 0) {
      console.log('\n📤 ASKS (Sellers):');
      console.log('Price       | Size        | Total');
      console.log('─'.repeat(40));
      let totalAsk = 0;
      asks.forEach((ask: any) => {
        const price = parseFloat(ask.price);
        const size = parseFloat(ask.size);
        totalAsk += size;
        console.log(`$${price.toFixed(4)}   | ${size.toFixed(2)} shares | $${(price * size).toFixed(2)}`);
      });
      console.log(`\nTotal Ask Liquidity: ${totalAsk.toFixed(2)} shares ($${(totalAsk * parseFloat(asks[0].price)).toFixed(2)})`);
    }
    
    if (bids.length > 0) {
      console.log('\n📥 BIDS (Buyers):');
      console.log('Price       | Size        | Total');
      console.log('─'.repeat(40));
      let totalBid = 0;
      bids.forEach((bid: any) => {
        const price = parseFloat(bid.price);
        const size = parseFloat(bid.size);
        totalBid += size;
        console.log(`$${price.toFixed(4)}   | ${size.toFixed(2)} shares | $${(price * size).toFixed(2)}`);
      });
      console.log(`\nTotal Bid Liquidity: ${totalBid.toFixed(2)} shares ($${(totalBid * parseFloat(bids[0].price)).toFixed(2)})`);
    }
    
    // Calculate spread
    if (bids.length > 0 && asks.length > 0) {
      const bestBid = parseFloat(bids[0].price);
      const bestAsk = parseFloat(asks[0].price);
      const spread = bestAsk - bestBid;
      const spreadPct = (spread / bestAsk) * 100;
      
      console.log('\n📊 Spread Analysis:');
      console.log(`Best Bid:    $${bestBid.toFixed(4)}`);
      console.log(`Best Ask:    $${bestAsk.toFixed(4)}`);
      console.log(`Spread:      $${spread.toFixed(4)} (${spreadPct.toFixed(2)}%)`);
      console.log(`Mid Price:   $${((bestBid + bestAsk) / 2).toFixed(4)}`);
      
      // Slippage estimation for 0.01 USDC trade
      console.log('\n💸 Slippage Estimate (0.01 USDC):');
      const shares001 = 0.01 / bestAsk;
      console.log(`Buy ${shares001.toFixed(4)} shares at ~$${bestAsk.toFixed(4)}`);
      console.log(`Slippage: Minimal (< 0.1%) with this order size`);
    }
    
    return orderbook;
    
  } catch (error: any) {
    console.log(`❌ Failed to fetch orderbook: ${error.message}`);
    return null;
  }
}

async function main() {
  try {
    logger.section('ORDERBOOK ANALYZER');
    
    // Get market slug from command line or use default
    const marketSlug = process.argv[2] || 'will-donald-trump-win-the-2024-us-presidential-election';
    
    console.log(`\n🔍 Analyzing market: ${marketSlug}\n`);
    
    // Initialize client
    logger.info('Connecting to Polymarket...');
    const client = await PolymarketClient.create();
    logger.success('Connected!');
    
    // Get market
    console.log('\n📊 Fetching market data...\n');
    const market = await getMarketBySlug(marketSlug);
    
    if (!market) {
      console.log('❌ Market not found!');
      console.log('\n💡 Usage: npm run test:orderbook [market-slug]');
      console.log('   Example: npm run test:orderbook will-btc-hit-100k-in-2024');
      process.exit(1);
    }
    
    console.log('Market:', market.question);
    console.log('Category:', market.category);
    console.log('End Date:', market.endDate || 'N/A');
    console.log('Liquidity:', `$${parseFloat(market.liquidity || '0').toFixed(0)}`);
    console.log('Volume 24h:', `$${parseFloat(market.volume || '0').toFixed(0)}`);
    
    // Get token IDs
    const tokenIds = getTokenIds(market);
    
    if (!tokenIds) {
      console.log('\n❌ Could not find token IDs for this market');
      process.exit(1);
    }
    
    console.log('\n🎯 Token Information:');
    console.log(`YES Token: ${tokenIds.yes}`);
    console.log(`NO Token:  ${tokenIds.no}`);
    
    console.log(`\nYES Price: $${market.tokens[0]?.price || 'N/A'} (${(parseFloat(market.tokens[0]?.price || '0') * 100).toFixed(1)}%)`);
    console.log(`NO Price:  $${market.tokens[1]?.price || 'N/A'} (${(parseFloat(market.tokens[1]?.price || '0') * 100).toFixed(1)}%)`);
    
    // Analyze orderbooks
    console.log('\n' + '='.repeat(60));
    await analyzeOrderbook(client, tokenIds.yes, 'YES');
    
    console.log('\n' + '='.repeat(60));
    await analyzeOrderbook(client, tokenIds.no, 'NO');
    
    console.log('\n' + '='.repeat(60));
    console.log('\n💡 Trading Tips:');
    console.log('   1. Check spread - lower is better (< 2% is good)');
    console.log('   2. Look at orderbook depth - more liquidity = less slippage');
    console.log('   3. Best bid/ask shows current market prices');
    console.log('   4. With 0.01 USDC, you should have minimal slippage\n');
    
  } catch (error: any) {
    logger.section('❌ ORDERBOOK ANALYSIS FAILED');
    console.log('\nError:', error.message);
    if (error.response?.data) {
      console.log('API Error:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

main();
