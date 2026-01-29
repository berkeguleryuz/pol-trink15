import { TimezoneUtils } from '../utils/timezone';

export interface ExitLevel {
  profitTarget: number; // Profit % to reach this level
  sellPercentage: number; // % of position to sell
  description: string;
}

export interface DynamicPricingConfig {
  entryThreshold: number; // Max price to enter (default 0.05 = 5%)
  minProfitToSell: number; // Min profit % before considering sell
  exitLevels: ExitLevel[];
  trailingStopPercent?: number; // Optional trailing stop
}

export interface PricingDecision {
  action: 'ENTER' | 'EXIT_PARTIAL' | 'EXIT_FULL' | 'HOLD';
  percentage: number; // For partial exits
  reason: string;
  level?: ExitLevel;
}

export class DynamicPricingStrategy {
  private config: DynamicPricingConfig;

  constructor(customConfig?: Partial<DynamicPricingConfig>) {
    // Default kademeli satış strategy
    this.config = {
      entryThreshold: 0.05, // Enter below 5%
      minProfitToSell: 0.10, // Min 10% profit
      exitLevels: [
        {
          profitTarget: 0.50, // At 50% profit
          sellPercentage: 25, // Sell 25%
          description: 'First profit target - secure initial gains',
        },
        {
          profitTarget: 1.00, // At 100% profit (doubled)
          sellPercentage: 35, // Sell another 35%
          description: 'Major milestone - position doubled',
        },
        {
          profitTarget: 2.00, // At 200% profit (tripled)
          sellPercentage: 40, // Sell remaining 40%
          description: 'Maximum target - extraordinary gains',
        },
      ],
      ...customConfig,
    };
  }

  /**
   * Should we enter this position?
   */
  shouldEnter(currentPrice: number): PricingDecision {
    if (currentPrice <= this.config.entryThreshold) {
      return {
        action: 'ENTER',
        percentage: 100,
        reason: `Price at ${(currentPrice * 100).toFixed(1)}% (threshold: ${(this.config.entryThreshold * 100)}%). Good entry point!`,
      };
    }

    return {
      action: 'HOLD',
      percentage: 0,
      reason: `Price too high: ${(currentPrice * 100).toFixed(1)}% > ${(this.config.entryThreshold * 100)}% entry threshold`,
    };
  }

  /**
   * Should we exit (partial or full)?
   */
  shouldExit(
    entryPrice: number,
    currentPrice: number,
    alreadySoldPercentage: number = 0
  ): PricingDecision {
    const profitPercent = ((currentPrice - entryPrice) / entryPrice);

    // Not profitable enough yet
    if (profitPercent < this.config.minProfitToSell) {
      return {
        action: 'HOLD',
        percentage: 0,
        reason: `Profit ${(profitPercent * 100).toFixed(1)}% below minimum ${(this.config.minProfitToSell * 100)}%`,
      };
    }

    // Check each exit level
    for (const level of this.config.exitLevels) {
      if (profitPercent >= level.profitTarget) {
        // Calculate remaining position to sell
        const remainingSellPercentage = level.sellPercentage - alreadySoldPercentage;

        if (remainingSellPercentage > 0) {
          return {
            action: 'EXIT_PARTIAL',
            percentage: remainingSellPercentage,
            reason: `${level.description} - Target ${(level.profitTarget * 100)}% reached!`,
            level,
          };
        }
      }
    }

    // Near certainty - sell everything
    if (currentPrice >= 0.95) {
      return {
        action: 'EXIT_FULL',
        percentage: 100 - alreadySoldPercentage,
        reason: `Price at ${(currentPrice * 100).toFixed(1)}% - near certainty, close position!`,
      };
    }

    return {
      action: 'HOLD',
      percentage: 0,
      reason: `Holding for next profit level. Current: ${(profitPercent * 100).toFixed(1)}%`,
    };
  }

  /**
   * Calculate optimal position size based on price and confidence
   */
  calculatePositionSize(
    availableCapital: number,
    currentPrice: number,
    confidence: 'LOW' | 'MEDIUM' | 'HIGH'
  ): number {
    // Base size from confidence
    let baseMultiplier = 0.3; // LOW
    if (confidence === 'MEDIUM') baseMultiplier = 0.6;
    if (confidence === 'HIGH') baseMultiplier = 1.0;

    // Adjust for price (lower price = more confident)
    const priceMultiplier = 1 + (this.config.entryThreshold - currentPrice) / this.config.entryThreshold;

    // Final size (capped at available capital)
    const size = availableCapital * baseMultiplier * priceMultiplier;
    return Math.min(size, availableCapital);
  }

  /**
   * Get all exit levels
   */
  getExitLevels(): ExitLevel[] {
    return [...this.config.exitLevels];
  }

  /**
   * Get current configuration
   */
  getConfig(): DynamicPricingConfig {
    return { ...this.config };
  }

  /**
   * Log pricing decision
   */
  logDecision(decision: PricingDecision, market: string, currentPrice: number): void {
    const emoji = decision.action === 'ENTER' ? '🟢' : decision.action.includes('EXIT') ? '🔴' : '⏸️';
    
    console.log(`\n${emoji} PRICING DECISION - ${decision.action}`);
    console.log(`📊 [${TimezoneUtils.formatBerlinTime()}] ${market}`);
    console.log(`💰 Current Price: ${(currentPrice * 100).toFixed(1)}%`);
    
    if (decision.percentage > 0) {
      console.log(`📊 Execute: ${decision.percentage}% of position`);
    }
    
    console.log(`📝 Reason: ${decision.reason}`);
    
    if (decision.level) {
      console.log(`🎯 Level: ${(decision.level.profitTarget * 100)}% profit target`);
    }
  }

  /**
   * Log exit levels overview
   */
  logExitLevels(): void {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🎯 DYNAMIC EXIT STRATEGY (Kademeli Satış)`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📥 Entry Threshold: ${(this.config.entryThreshold * 100)}%`);
    console.log(`📊 Min Profit to Sell: ${(this.config.minProfitToSell * 100)}%`);
    console.log(`\n📈 Exit Levels:`);
    
    this.config.exitLevels.forEach((level, index) => {
      console.log(`  ${index + 1}. ${(level.profitTarget * 100)}% profit → Sell ${level.sellPercentage}%`);
      console.log(`     "${level.description}"`);
    });
    
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  }

  /**
   * Calculate expected exit prices for visualization
   */
  getExitPriceTargets(entryPrice: number): Array<{
    level: number;
    profitPercent: number;
    targetPrice: number;
    sellPercent: number;
    description: string;
  }> {
    return this.config.exitLevels.map((level, index) => ({
      level: index + 1,
      profitPercent: level.profitTarget * 100,
      targetPrice: entryPrice * (1 + level.profitTarget),
      sellPercent: level.sellPercentage,
      description: level.description,
    }));
  }

  /**
   * Validate pricing configuration
   */
  validateConfig(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check entry threshold
    if (this.config.entryThreshold <= 0 || this.config.entryThreshold >= 1) {
      errors.push('Entry threshold must be between 0 and 1');
    }

    // Check exit levels
    let totalSellPercentage = 0;
    let lastProfitTarget = 0;

    for (let i = 0; i < this.config.exitLevels.length; i++) {
      const level = this.config.exitLevels[i];
      
      if (level.profitTarget <= lastProfitTarget) {
        errors.push(`Exit level ${i + 1}: profit targets must be increasing`);
      }
      
      if (level.sellPercentage <= 0 || level.sellPercentage > 100) {
        errors.push(`Exit level ${i + 1}: sell percentage must be 1-100`);
      }

      totalSellPercentage += level.sellPercentage;
      lastProfitTarget = level.profitTarget;
    }

    if (totalSellPercentage !== 100) {
      errors.push(`Total sell percentage must equal 100% (currently ${totalSellPercentage}%)`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
