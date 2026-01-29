import { OrderType } from '@polymarket/clob-client';
import { PolymarketClient } from '../src/client';
import { getBalance, getTokenBalance } from '../src/utils/balance';
import { sellShares } from '../src/trading';
import { logTrade, logProfit, TradeLog } from '../src/utils/trade-logger';

interface OpenPosition {
  tokenId: string;
  conditionId: string;
  shares: number;
  side: 'YES' | 'NO';
  marketSlug: string;
  marketTitle: string;
  currentPrice: number;
  estimatedValue: number;
  liquidity: number;
}

/**
 * Get all open positions from the wallet
 */
async function getOpenPositions(client: PolymarketClient): Promise<OpenPosition[]> {
  console.log('\n' + '='.repeat(70));
  console.log('🔍 Scanning wallet for open positions...');
  console.log('='.repeat(70) + '\n');

  try {
    const clobClient = client.getClient();
    
    // Get trade history to find markets we've traded
    const trades = await clobClient.getTrades();
    console.log(`Found ${trades?.length || 0} recent trades\n`);
    
    // Extract unique token IDs from trades
    const tradedTokens = new Map<string, { market: string; side: string }>();
    
    if (trades && trades.length > 0) {
      for (const trade of trades) {
        if (trade.asset_id && !tradedTokens.has(trade.asset_id)) {
          tradedTokens.set(trade.asset_id, {
            market: trade.market || 'unknown',
            side: trade.side || 'UNKNOWN',
          });
        }
      }
    }
    
    console.log(`Checking balances for ${tradedTokens.size} traded tokens...\n`);

    const positions: OpenPosition[] = [];

    for (const [tokenId, tradeInfo] of tradedTokens) {
      try {
        // Get balance for this specific token
        const tokenBalance = await getTokenBalance(client, tokenId);
        const shares = parseFloat(tokenBalance.balance) / 1000000; // Convert from micro-shares
      
        if (shares <= 0) continue;

        // Get market info using token ID
        const marketInfo = await fetch(
          `https://gamma-api.polymarket.com/markets?clob_token_ids=${tokenId}`
        );
        
        if (!marketInfo.ok) {
          console.log(`⚠️  Could not fetch market info for token ${tokenId.substring(0, 10)}...`);
          continue;
        }

        const markets: any[] = await marketInfo.json() as any[];
        if (!markets || markets.length === 0) {
          console.log(`⚠️  No market found for token ${tokenId.substring(0, 10)}...`);
          continue;
        }
        
        const market: any = markets[0];
        
        // Determine which outcome this token represents
        let side: 'YES' | 'NO' = 'YES';
        let currentPrice = 0;

        if (market.tokens && market.tokens.length >= 2) {
          const yesToken = market.tokens.find((t: any) => t.outcome === 'Yes');
          const noToken = market.tokens.find((t: any) => t.outcome === 'No');

          if (tokenId === yesToken?.token_id) {
            side = 'YES';
            currentPrice = parseFloat(yesToken.price || '0');
          } else if (tokenId === noToken?.token_id) {
            side = 'NO';
            currentPrice = parseFloat(noToken.price || '0');
          }
        }

        const estimatedValue = shares * currentPrice;

        positions.push({
          tokenId: tokenId,
          conditionId: market.conditionId || 'unknown',
          shares,
          side,
          marketSlug: market.slug || 'unknown',
          marketTitle: market.question || 'Unknown Market',
          currentPrice,
          estimatedValue,
          liquidity: parseFloat(market.liquidity || '0'),
        });

        console.log(`✅ ${side} Position: ${shares.toFixed(6)} shares`);
        console.log(`   Market: ${market.question}`);
        console.log(`   Price: $${currentPrice.toFixed(4)}`);
        console.log(`   Value: $${estimatedValue.toFixed(4)}`);
        console.log(`   Liquidity: $${parseFloat(market.liquidity || '0').toFixed(2)}\n`);

      } catch (error: any) {
        console.log(`⚠️  Could not check balance for token ${tokenId.substring(0, 10)}...: ${error.message}`);
        continue;
      }
    }

    return positions;

  } catch (error: any) {
    console.error('❌ Error fetching open positions:', error.message);
    return [];
  }
}

/**
 * Sell a position
 */
async function sellPosition(
  client: PolymarketClient, 
  position: OpenPosition,
  autoSell: boolean = false
): Promise<boolean> {
  console.log('\n' + '='.repeat(70));
  console.log(`💸 Selling ${position.side} position...`);
  console.log('='.repeat(70) + '\n');

  console.log(`Market: ${position.marketTitle}`);
  console.log(`Shares: ${position.shares.toFixed(6)}`);
  console.log(`Current Price: $${position.currentPrice.toFixed(4)}`);
  console.log(`Estimated Value: $${position.estimatedValue.toFixed(4)}`);
  
  if (!autoSell) {
    console.log('\n⚠️  Set AUTO_SELL=true in config to execute sell orders\n');
    return false;
  }

  try {
    const sellResult = await sellShares(client, {
      tokenId: position.tokenId,
      amount: position.shares,
      type: 'market',
      orderType: OrderType.FOK,
    });

    if (sellResult.success) {
      console.log('✅ SELL order executed!');
      console.log(`Order ID: ${sellResult.orderID}`);
      console.log(`Taking: ${sellResult.takingAmount} USDC`);
      console.log(`Making: ${sellResult.makingAmount} shares`);
      
      if (sellResult.transactionsHashes && sellResult.transactionsHashes.length > 0) {
        console.log(`Transaction: ${sellResult.transactionsHashes[0]}`);
      }

      // Log the trade
      logTrade({
        timestamp: new Date().toISOString(),
        marketSlug: position.marketSlug,
        marketQuestion: position.marketTitle,
        tokenId: position.tokenId,
        side: position.side,
        action: 'SELL',
        orderType: 'MARKET',
        price: position.currentPrice,
        size: position.shares,
        totalCost: position.estimatedValue,
        orderId: sellResult.orderID,
        status: 'SUCCESS',
      });

      return true;
    } else {
      console.log('❌ SELL order failed!');
      console.log(`Error: ${sellResult.errorMsg || 'Unknown error'}`);
      
      logTrade({
        timestamp: new Date().toISOString(),
        marketSlug: position.marketSlug,
        marketQuestion: position.marketTitle,
        tokenId: position.tokenId,
        side: position.side,
        action: 'SELL',
        orderType: 'MARKET',
        price: position.currentPrice,
        size: position.shares,
        totalCost: position.estimatedValue,
        status: 'FAILED',
        error: sellResult.errorMsg || 'Unknown error',
      });

      return false;
    }

  } catch (error: any) {
    console.log('❌ Error executing sell order:', error.message);
    
    logTrade({
      timestamp: new Date().toISOString(),
      marketSlug: position.marketSlug,
      marketQuestion: position.marketTitle,
      tokenId: position.tokenId,
      side: position.side,
      action: 'SELL',
      orderType: 'MARKET',
      price: position.currentPrice,
      size: position.shares,
      totalCost: position.estimatedValue,
      status: 'FAILED',
      error: error.message,
    });

    return false;
  }
}

/**
 * Main function
 */
async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('  OPEN POSITIONS MANAGER');
  console.log('='.repeat(70) + '\n');

  // Configuration
  const AUTO_SELL = true; // Set to true to automatically sell positions
  const MIN_PROFIT_PERCENT = 0; // Minimum profit % to sell (0 = sell any position)
  const MIN_LIQUIDITY = 1000; // Minimum market liquidity required to sell

  console.log('📋 Configuration:');
  console.log(`   Auto Sell: ${AUTO_SELL ? 'YES' : 'NO'}`);
  console.log(`   Min Profit: ${MIN_PROFIT_PERCENT}%`);
  console.log(`   Min Liquidity: $${MIN_LIQUIDITY}\n`);

  // Initialize client
  const client = await PolymarketClient.create();

  // Get initial balance
  const initialBalance = await getBalance(client);
  console.log(`\n💰 Initial Balance: $${(parseFloat(initialBalance.usdc) / 1000000).toFixed(2)} USDC\n`);

  // Get open positions
  const positions = await getOpenPositions(client);

  if (positions.length === 0) {
    console.log('✅ No open positions found!\n');
    process.exit(0);
  }

  console.log('\n' + '='.repeat(70));
  console.log(`📊 SUMMARY: Found ${positions.length} open position(s)`);
  console.log('='.repeat(70) + '\n');

  const totalValue = positions.reduce((sum, p) => sum + p.estimatedValue, 0);
  console.log(`Total Estimated Value: $${totalValue.toFixed(4)}\n`);

  // Analyze and sell positions
  let soldCount = 0;
  let totalProfit = 0;

  for (const position of positions) {
    // Check if we should sell this position
    let shouldSell = false;
    let reason = '';

    if (position.liquidity < MIN_LIQUIDITY) {
      reason = `Low liquidity: $${position.liquidity.toFixed(2)} < $${MIN_LIQUIDITY}`;
      console.log(`⚠️  Skipping ${position.side} position: ${reason}\n`);
      continue;
    }

    // For now, sell all positions with enough liquidity
    shouldSell = true;
    reason = 'Closing position';

    if (shouldSell) {
      console.log(`📌 ${reason}`);
      const success = await sellPosition(client, position, AUTO_SELL);
      
      if (success) {
        soldCount++;
        // Note: Actual profit calculation would require knowing the buy price
        // For now we're just tracking the sell value
      }

      // Wait a bit between sells
      if (positions.indexOf(position) < positions.length - 1) {
        console.log('\nWaiting 2 seconds before next sell...\n');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  // Get final balance
  console.log('\n' + '='.repeat(70));
  console.log('📊 FINAL SUMMARY');
  console.log('='.repeat(70) + '\n');

  await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for balance update
  const finalBalance = await getBalance(client);
  
  const initialUSDC = parseFloat(initialBalance.usdc) / 1000000;
  const finalUSDC = parseFloat(finalBalance.usdc) / 1000000;
  const balanceChange = finalUSDC - initialUSDC;

  console.log(`Positions Sold: ${soldCount}/${positions.length}`);
  console.log(`Initial Balance: $${initialUSDC.toFixed(2)} USDC`);
  console.log(`Final Balance: $${finalUSDC.toFixed(2)} USDC`);
  console.log(`Change: ${balanceChange >= 0 ? '+' : ''}$${balanceChange.toFixed(4)} USDC\n`);

  console.log('✅ Position management completed!\n');
}

// Run the script
main().catch(console.error);
