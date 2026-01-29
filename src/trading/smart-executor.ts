import { ClobClient, Side, OrderType } from '@polymarket/clob-client';
import { TimezoneUtils } from '../utils/timezone';

/**
 * Smart Trade Executor - Instant action on events
 * Executes YES/NO trades and manages hedges
 */

export interface TradeOrder {
  market: string;
  conditionId: string;
  tokenId: string;
  side: 'BUY' | 'SELL';
  outcome: 'YES' | 'NO';
  amount: number; // USD
  price: number; // 0-1
  reason: string;
  isHedge: boolean; // If this is a hedge trade
}

export interface ExecutionResult {
  success: boolean;
  orderId?: string;
  actualPrice?: number;
  actualAmount?: number;
  error?: string;
  timestamp: Date;
}

export interface Position {
  market: string;
  conditionId: string;
  tokenId: string;
  outcome: 'YES' | 'NO';
  shares: number;
  avgEntryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  openTime: Date;
}

export class SmartExecutor {
  private client: ClobClient;
  private openPositions: Map<string, Position> = new Map();
  private executionHistory: ExecutionResult[] = [];
  private readonly MAX_SLIPPAGE = 0.05; // 5% max slippage

  constructor(client: ClobClient) {
    this.client = client;
  }

  /**
   * Execute instant trade (event-driven)
   */
  async executeInstantTrade(order: TradeOrder, dryRun: boolean = true): Promise<ExecutionResult> {
    console.log(`\n⚡ INSTANT TRADE EXECUTION`);
    console.log(`📊 Market: ${order.market}`);
    console.log(`💹 ${order.side} ${order.outcome} @ ${(order.price * 100).toFixed(1)}%`);
    console.log(`💰 Amount: $${order.amount.toFixed(2)}`);
    console.log(`📝 Reason: ${order.reason}`);
    console.log(`🔒 Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);

    if (dryRun) {
      console.log(`\n✅ DRY RUN - Trade would be executed`);
      return {
        success: true,
        orderId: `DRY_${Date.now()}`,
        actualPrice: order.price,
        actualAmount: order.amount,
        timestamp: new Date(),
      };
    }

    try {
      // Calculate shares from amount
      const shares = this.calculateShares(order.amount, order.price);

      console.log(`\n📦 Calculated shares: ${shares.toFixed(2)}`);
      console.log(`🚀 Submitting order to Polymarket...`);

      // Real order execution
      let result: ExecutionResult;
      
      if (order.side === 'BUY') {
        // Create market buy order for instant execution
        const orderObj = await this.client.createMarketOrder({
          tokenID: order.tokenId,
          amount: order.amount, // USDC amount
          side: Side.BUY,
        });

        console.log(`✅ Order created, posting to exchange...`);
        const response = await this.client.postOrder(orderObj, OrderType.FOK); // Fill or Kill

        result = {
          success: true,
          orderId: response.orderID || `ORDER_${Date.now()}`,
          actualPrice: order.price,
          actualAmount: order.amount,
          timestamp: new Date(),
        };
      } else {
        // Create market sell order
        const orderObj = await this.client.createMarketOrder({
          tokenID: order.tokenId,
          amount: shares, // Number of shares to sell
          side: Side.SELL,
        });

        console.log(`✅ Order created, posting to exchange...`);
        const response = await this.client.postOrder(orderObj, OrderType.FOK);

        result = {
          success: true,
          orderId: response.orderID || `ORDER_${Date.now()}`,
          actualPrice: order.price,
          actualAmount: order.amount,
          timestamp: new Date(),
        };
      }

      this.executionHistory.push(result);

      // Track position
      if (order.side === 'BUY') {
        this.addPosition({
          market: order.market,
          conditionId: order.conditionId,
          tokenId: order.tokenId,
          outcome: order.outcome,
          shares,
          avgEntryPrice: order.price,
          currentPrice: order.price,
          unrealizedPnL: 0,
          unrealizedPnLPercent: 0,
          openTime: new Date(),
        });
      }

      console.log(`\n✅ Trade executed successfully!`);
      console.log(`Order ID: ${result.orderId}`);

      return result;
    } catch (error: any) {
      console.error(`\n❌ Trade execution failed:`, error);
      return {
        success: false,
        error: error.message || 'Unknown error',
        timestamp: new Date(),
      };
    }
  }

  /**
   * Execute paired trade (main + hedge)
   * Example: Bayern scores → YES Bayern + NO opponent
   */
  async executePairedTrade(
    mainOrder: TradeOrder,
    hedgeOrder: TradeOrder,
    dryRun: boolean = true
  ): Promise<{
    main: ExecutionResult;
    hedge: ExecutionResult;
  }> {
    console.log(`\n🔄 PAIRED TRADE EXECUTION`);
    console.log(`Primary: ${mainOrder.side} ${mainOrder.outcome} on ${mainOrder.market}`);
    console.log(`Hedge: ${hedgeOrder.side} ${hedgeOrder.outcome} on ${hedgeOrder.market}`);

    const main = await this.executeInstantTrade(mainOrder, dryRun);
    
    // Only execute hedge if main succeeded
    let hedge: ExecutionResult;
    if (main.success) {
      hedge = await this.executeInstantTrade(hedgeOrder, dryRun);
    } else {
      hedge = {
        success: false,
        error: 'Main trade failed, hedge cancelled',
        timestamp: new Date(),
      };
    }

    return { main, hedge };
  }

  /**
   * Scale out of position (kademeli satış)
   * Sell percentage at current price
   */
  async scaleOutPosition(
    positionKey: string,
    sellPercentage: number,
    currentPrice: number,
    reason: string,
    dryRun: boolean = true
  ): Promise<ExecutionResult> {
    const position = this.openPositions.get(positionKey);
    if (!position) {
      return {
        success: false,
        error: 'Position not found',
        timestamp: new Date(),
      };
    }

    const sharesToSell = position.shares * (sellPercentage / 100);
    const sellAmount = sharesToSell * currentPrice;

    console.log(`\n📉 SCALE OUT`);
    console.log(`Position: ${position.market} (${position.outcome})`);
    console.log(`Selling: ${sellPercentage}% (${sharesToSell.toFixed(2)} shares)`);
    console.log(`Price: ${(currentPrice * 100).toFixed(1)}%`);
    console.log(`Value: $${sellAmount.toFixed(2)}`);
    console.log(`Reason: ${reason}`);

    const sellOrder: TradeOrder = {
      market: position.market,
      conditionId: position.conditionId,
      tokenId: position.tokenId,
      side: 'SELL',
      outcome: position.outcome,
      amount: sellAmount,
      price: currentPrice,
      reason,
      isHedge: false,
    };

    const result = await this.executeInstantTrade(sellOrder, dryRun);

    if (result.success) {
      // Update position
      position.shares -= sharesToSell;
      if (position.shares < 0.01) {
        this.openPositions.delete(positionKey);
        console.log(`✅ Position fully closed`);
      } else {
        console.log(`📊 Remaining shares: ${position.shares.toFixed(2)}`);
      }
    }

    return result;
  }

  /**
   * Get current price for a token
   */
  async getCurrentPrice(tokenId: string): Promise<number | null> {
    try {
      // Use lightweight price check
      const response = await fetch(`https://clob.polymarket.com/price?token_id=${tokenId}`);
      if (!response.ok) return null;

      const data: any = await response.json();
      return parseFloat(data.price || '0.5');
    } catch (error) {
      console.error(`Error fetching price for ${tokenId}:`, error);
      return null;
    }
  }

  /**
   * Sync open positions from ClobClient
   * Fetches real positions from blockchain/CLOB
   * 
   * Note: ClobClient doesn't provide a direct "get all positions" method.
   * Position tracking is done internally via trade execution.
   * 
   * For production, you would need to:
   * 1. Store position data in a database
   * 2. Or query token balances for all known token IDs
   * 3. Or track fills via order book events
   */
  async syncPositionsFromClob(): Promise<void> {
    // Currently using internal tracking via trade execution
    // Real blockchain position sync would require additional infrastructure
    console.log(`\n📊 Position tracking: ${this.openPositions.size} positions in memory`);
  }

  /**
   * Monitor positions and auto-sell at profit targets
   */
  async monitorPositionsForExit(dryRun: boolean = true): Promise<void> {
    // Sync positions from CLOB before monitoring
    await this.syncPositionsFromClob();
    
    if (this.openPositions.size === 0) {
      console.log("\n📊 No open positions to monitor");
      return;
    }

    console.log(`\n👀 Monitoring ${this.openPositions.size} open positions...`);

    for (const [key, position] of this.openPositions.entries()) {
      const currentPrice = await this.getCurrentPrice(position.tokenId);
      if (!currentPrice) continue;

      // Update position
      position.currentPrice = currentPrice;
      position.unrealizedPnL = (currentPrice - position.avgEntryPrice) * position.shares;
      position.unrealizedPnLPercent = ((currentPrice - position.avgEntryPrice) / position.avgEntryPrice) * 100;

      console.log(`\n📊 ${position.market} (${position.outcome})`);
      console.log(`   Entry: ${(position.avgEntryPrice * 100).toFixed(1)}%`);
      console.log(`   Current: ${(currentPrice * 100).toFixed(1)}%`);
      console.log(`   P&L: $${position.unrealizedPnL.toFixed(2)} (${position.unrealizedPnLPercent.toFixed(1)}%)`);

      // Check exit conditions
      if (position.unrealizedPnLPercent >= 200) {
        // 200%+ profit → Sell 40%
        await this.scaleOutPosition(key, 40, currentPrice, '200% profit target hit', dryRun);
      } else if (position.unrealizedPnLPercent >= 100) {
        // 100%+ profit → Sell 35%
        await this.scaleOutPosition(key, 35, currentPrice, '100% profit target hit', dryRun);
      } else if (position.unrealizedPnLPercent >= 50) {
        // 50%+ profit → Sell 25%
        await this.scaleOutPosition(key, 25, currentPrice, '50% profit target hit', dryRun);
      } else if (position.unrealizedPnLPercent <= -20) {
        // -20% loss → Stop loss, close position
        await this.scaleOutPosition(key, 100, currentPrice, 'Stop loss triggered', dryRun);
      }

      // Near certainty (95%+) → Close full position
      if (currentPrice >= 0.95 && position.outcome === 'YES') {
        await this.scaleOutPosition(key, 100, currentPrice, 'Near certainty (95%+), taking profit', dryRun);
      } else if (currentPrice <= 0.05 && position.outcome === 'NO') {
        await this.scaleOutPosition(key, 100, currentPrice, 'Near certainty (95%+), taking profit', dryRun);
      }
    }
  }

  /**
   * Calculate shares from amount and price
   */
  private calculateShares(amount: number, price: number): number {
    return amount / price;
  }

  /**
   * Add position to tracking
   */
  private addPosition(position: Position): void {
    const key = `${position.conditionId}_${position.outcome}`;
    
    const existing = this.openPositions.get(key);
    if (existing) {
      // Average down/up
      const totalShares = existing.shares + position.shares;
      const totalCost = (existing.shares * existing.avgEntryPrice) + (position.shares * position.avgEntryPrice);
      existing.avgEntryPrice = totalCost / totalShares;
      existing.shares = totalShares;
    } else {
      this.openPositions.set(key, position);
    }

    console.log(`\n📈 Position added/updated: ${key}`);
  }

  /**
   * Get all open positions
   */
  getOpenPositions(): Position[] {
    return Array.from(this.openPositions.values());
  }

  /**
   * Get portfolio summary
   */
  getPortfolioSummary(): {
    totalPositions: number;
    totalUnrealizedPnL: number;
    totalValue: number;
    positions: Position[];
  } {
    const positions = this.getOpenPositions();
    const totalUnrealizedPnL = positions.reduce((sum, p) => sum + p.unrealizedPnL, 0);
    const totalValue = positions.reduce((sum, p) => sum + (p.shares * p.currentPrice), 0);

    return {
      totalPositions: positions.length,
      totalUnrealizedPnL,
      totalValue,
      positions,
    };
  }

  /**
   * Clear execution history (keep last 100)
   */
  cleanupHistory(): void {
    if (this.executionHistory.length > 100) {
      this.executionHistory = this.executionHistory.slice(-100);
    }
  }
}
