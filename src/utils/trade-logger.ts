import fs from 'fs';
import path from 'path';

const LOGS_DIR = path.join(__dirname, '../../logs');
const READABLE_LOGS_DIR = path.join(LOGS_DIR, 'readable');

// Ensure logs directories exist
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}
if (!fs.existsSync(READABLE_LOGS_DIR)) {
  fs.mkdirSync(READABLE_LOGS_DIR, { recursive: true });
}

export interface TradeLog {
  timestamp: string;
  action: 'BUY' | 'SELL' | 'CANCEL';
  marketSlug: string;
  marketQuestion: string;
  tokenId: string;
  side: 'YES' | 'NO';
  orderType: 'MARKET' | 'LIMIT';
  price: number;
  size: number;
  totalCost: number;
  orderId?: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  error?: string;
}

export interface MarketLog {
  timestamp: string;
  marketId: string;
  slug: string;
  question: string;
  yesPrice: number;
  noPrice: number;
  liquidity: number;
  volume24h: number;
  spread: number;
  score: number;
  category?: string;
  endDate?: string;
}

export interface ProfitLog {
  timestamp: string;
  marketSlug: string;
  buyPrice: number;
  sellPrice: number;
  quantity: number;
  profit: number;
  profitPercent: number;
  holdingTime: string;
}

/**
 * Log a trade (buy/sell/cancel)
 */
export function logTrade(trade: TradeLog): void {
  const date = new Date().toISOString().split('T')[0];
  const time = new Date().toISOString().split('T')[1].split('.')[0];
  
  // JSONL for machine reading
  const jsonFilename = path.join(LOGS_DIR, `trades_${date}.jsonl`);
  fs.appendFileSync(jsonFilename, JSON.stringify(trade) + '\n');
  
  // Human-readable log
  const readableFilename = path.join(READABLE_LOGS_DIR, `trades_${date}.txt`);
  const readableEntry = [
    '='.repeat(80),
    `[${time}] ${trade.action} ${trade.side} - ${trade.status}`,
    `Market: ${trade.marketQuestion}`,
    `Slug: ${trade.marketSlug}`,
    `Type: ${trade.orderType}`,
    `Price: $${trade.price.toFixed(4)}`,
    `Size: ${trade.size.toFixed(4)} shares`,
    `Total: $${trade.totalCost.toFixed(4)} USDC`,
    trade.orderId ? `Order ID: ${trade.orderId}` : '',
    trade.error ? `Error: ${trade.error}` : '',
    '='.repeat(80),
    '',
  ].filter(l => l).join('\n');
  
  fs.appendFileSync(readableFilename, readableEntry);
  
  console.log(`\n📝 Trade logged: ${trade.action} ${trade.side} @ $${trade.price.toFixed(4)}`);
}

/**
 * Log market data
 */
export function logMarket(market: MarketLog): void {
  const date = new Date().toISOString().split('T')[0];
  
  // JSONL for machine reading
  const jsonFilename = path.join(LOGS_DIR, `markets_${date}.jsonl`);
  fs.appendFileSync(jsonFilename, JSON.stringify(market) + '\n');
  
  // Human-readable summary (only top markets)
  if (market.score >= 80) {
    const readableFilename = path.join(READABLE_LOGS_DIR, `markets_summary_${date}.txt`);
    const readableEntry = `[${market.timestamp.split('T')[1].split('.')[0]}] ${market.question} | YES: ${(market.yesPrice * 100).toFixed(1)}% | Liq: $${market.liquidity.toFixed(0)} | Score: ${market.score}/100\n`;
    fs.appendFileSync(readableFilename, readableEntry);
  }
}

/**
 * Log new markets (for monitoring new opportunities)
 */
export function logNewMarket(market: MarketLog): void {
  const filename = path.join(LOGS_DIR, 'new_markets.jsonl');
  
  const logEntry = JSON.stringify({
    ...market,
    discovered: new Date().toISOString(),
  }) + '\n';
  
  fs.appendFileSync(filename, logEntry);
  
  console.log(`\n🆕 New market discovered: ${market.question}`);
  console.log(`   Slug: ${market.slug}`);
  console.log(`   YES: $${market.yesPrice.toFixed(3)} | NO: $${market.noPrice.toFixed(3)}`);
  console.log(`   Score: ${market.score}/100\n`);
}

/**
 * Log profit/loss
 */
export function logProfit(profit: ProfitLog): void {
  const date = new Date().toISOString().split('T')[0];
  const time = new Date().toISOString().split('T')[1].split('.')[0];
  
  // JSONL for machine reading
  const jsonFilename = path.join(LOGS_DIR, `profits_${date}.jsonl`);
  fs.appendFileSync(jsonFilename, JSON.stringify(profit) + '\n');
  
  // Human-readable log
  const emoji = profit.profit > 0 ? '💰 PROFIT' : '📉 LOSS';
  const readableFilename = path.join(READABLE_LOGS_DIR, `profits_${date}.txt`);
  const readableEntry = [
    '='.repeat(80),
    `[${time}] ${emoji}`,
    `Market: ${profit.marketSlug}`,
    `Buy Price: $${profit.buyPrice.toFixed(4)}`,
    `Sell Price: $${profit.sellPrice.toFixed(4)}`,
    `Quantity: ${profit.quantity.toFixed(4)} shares`,
    `Profit/Loss: $${profit.profit.toFixed(4)} (${profit.profitPercent > 0 ? '+' : ''}${profit.profitPercent.toFixed(2)}%)`,
    `Holding Time: ${profit.holdingTime}`,
    '='.repeat(80),
    '',
  ].join('\n');
  
  fs.appendFileSync(readableFilename, readableEntry);
  
  console.log(`\n${emoji}: ${profit.profitPercent > 0 ? '+' : ''}${profit.profitPercent.toFixed(2)}%`);
  console.log(`   Market: ${profit.marketSlug}`);
  console.log(`   Buy: $${profit.buyPrice.toFixed(4)} → Sell: $${profit.sellPrice.toFixed(4)}`);
  console.log(`   Profit: $${profit.profit.toFixed(4)}\n`);
}

/**
 * Get all trades for a specific market
 */
export function getMarketTrades(marketSlug: string): TradeLog[] {
  const trades: TradeLog[] = [];
  const files = fs.readdirSync(LOGS_DIR).filter(f => f.startsWith('trades_'));
  
  for (const file of files) {
    const content = fs.readFileSync(path.join(LOGS_DIR, file), 'utf-8');
    const lines = content.trim().split('\n').filter(l => l);
    
    for (const line of lines) {
      const trade = JSON.parse(line) as TradeLog;
      if (trade.marketSlug === marketSlug) {
        trades.push(trade);
      }
    }
  }
  
  return trades.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

/**
 * Calculate total profit/loss
 */
export function getTotalProfitLoss(): { totalProfit: number; totalTrades: number; winRate: number } {
  const files = fs.readdirSync(LOGS_DIR).filter(f => f.startsWith('profits_'));
  
  let totalProfit = 0;
  let totalTrades = 0;
  let wins = 0;
  
  for (const file of files) {
    const content = fs.readFileSync(path.join(LOGS_DIR, file), 'utf-8');
    const lines = content.trim().split('\n').filter(l => l);
    
    for (const line of lines) {
      const profit = JSON.parse(line) as ProfitLog;
      totalProfit += profit.profit;
      totalTrades++;
      if (profit.profit > 0) wins++;
    }
  }
  
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  
  return { totalProfit, totalTrades, winRate };
}

/**
 * Display profit/loss summary
 */
export function displayProfitSummary(): void {
  const { totalProfit, totalTrades, winRate } = getTotalProfitLoss();
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 PROFIT/LOSS SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total Trades:    ${totalTrades}`);
  console.log(`Total P/L:       $${totalProfit.toFixed(4)}`);
  console.log(`Win Rate:        ${winRate.toFixed(1)}%`);
  console.log(`Avg per Trade:   $${totalTrades > 0 ? (totalProfit / totalTrades).toFixed(4) : '0.0000'}`);
  console.log('='.repeat(60) + '\n');
}

/**
 * Track known markets to detect new ones
 */
let knownMarketIds = new Set<string>();

export function initializeKnownMarkets(marketIds: string[]): void {
  knownMarketIds = new Set(marketIds);
  console.log(`\n📊 Tracking ${knownMarketIds.size} markets for changes\n`);
}

export function checkForNewMarkets(markets: MarketLog[]): MarketLog[] {
  const newMarkets: MarketLog[] = [];
  
  for (const market of markets) {
    if (!knownMarketIds.has(market.marketId)) {
      newMarkets.push(market);
      knownMarketIds.add(market.marketId);
      logNewMarket(market);
    }
  }
  
  return newMarkets;
}
