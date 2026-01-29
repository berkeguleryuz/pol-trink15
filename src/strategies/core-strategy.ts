import { TimezoneUtils } from '../utils/timezone';
import { ClobClient } from '@polymarket/clob-client';

const formatBerlinTime = () => TimezoneUtils.formatBerlinTime();

// Market info from Polymarket API
export interface MarketInfo {
  condition_id: string;
  question: string;
  slug: string;
  tokens: Array<{ token_id: string; outcome: string; price: string }>;
  outcomePrices: string[];
  liquidity: string;
  volume: string;
  end_date_iso?: string;
  category?: string;
}

export interface TradingSignal {
  action: 'BUY' | 'SELL' | 'HOLD';
  market: MarketInfo;
  reason: string;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  suggestedAmount: number; // USDC amount
  targetProfit?: number; // Expected profit percentage
  stopLoss?: number; // Stop loss percentage
}

export interface PositionAnalysis {
  currentPrice: number;
  entryPrice: number;
  profitPercent: number;
  shouldSell: boolean;
  sellPercentage: number; // 0-100, how much of position to sell
  reason: string;
}

export class CoreTradingStrategy {
  private readonly LOW_PROBABILITY_THRESHOLD = 0.15; // Buy below 15%
  private readonly HIGH_PROBABILITY_THRESHOLD = 0.85; // Sell above 85%
  private readonly MIN_PROFIT_TARGET = 0.10; // 10% minimum profit to consider selling
  private readonly SCALE_OUT_LEVELS = [
    { profit: 0.50, sellPercent: 25 }, // At 50% profit, sell 25%
    { profit: 1.00, sellPercent: 35 }, // At 100% profit, sell 35%
    { profit: 2.00, sellPercent: 40 }, // At 200% profit, sell remaining 40%
  ];

  constructor(private clobClient: ClobClient) {}

  /**
   * Analyze market and generate trading signal
   */
  analyzeMarket(market: MarketInfo, newsContext?: string): TradingSignal {
    const yesPrice = parseFloat(market.outcomePrices[0]);
    const noPrice = parseFloat(market.outcomePrices[1]);
    
    // Default HOLD signal
    let signal: TradingSignal = {
      action: 'HOLD',
      market,
      reason: 'No strong signal detected',
      confidence: 'LOW',
      suggestedAmount: 0,
    };

    // BUY LOGIC: Look for undervalued YES outcomes
    if (yesPrice < this.LOW_PROBABILITY_THRESHOLD) {
      const confidence = this.calculateBuyConfidence(yesPrice, market, newsContext);
      signal = {
        action: 'BUY',
        market,
        reason: `Low probability detected (${(yesPrice * 100).toFixed(1)}%). ${newsContext ? 'News support: ' + newsContext : 'Market undervalued.'}`,
        confidence,
        suggestedAmount: this.calculatePositionSize(confidence),
        targetProfit: 1.0, // 100% profit target
        stopLoss: 0.20, // 20% stop loss
      };
    }
    // SELL LOGIC: High probability reached
    else if (yesPrice > this.HIGH_PROBABILITY_THRESHOLD) {
      signal = {
        action: 'SELL',
        market,
        reason: `High probability reached (${(yesPrice * 100).toFixed(1)}%). Time to take profits.`,
        confidence: 'HIGH',
        suggestedAmount: 0, // Will be calculated based on position
      };
    }
    // HOLD with monitoring
    else if (yesPrice >= 0.30 && yesPrice <= 0.70) {
      signal = {
        action: 'HOLD',
        market,
        reason: `Price in neutral zone (${(yesPrice * 100).toFixed(1)}%). Waiting for clearer signal.`,
        confidence: 'MEDIUM',
        suggestedAmount: 0,
      };
    }

    return signal;
  }

  /**
   * Calculate buy confidence based on multiple factors
   */
  private calculateBuyConfidence(
    price: number,
    market: MarketInfo,
    newsContext?: string
  ): 'LOW' | 'MEDIUM' | 'HIGH' {
    let score = 0;

    // Factor 1: How low is the price? (max 40 points)
    if (price < 0.05) score += 40;
    else if (price < 0.10) score += 30;
    else if (price < 0.15) score += 20;

    // Factor 2: Liquidity check (max 30 points)
    const liquidity = parseFloat(market.liquidity);
    if (liquidity > 50000) score += 30;
    else if (liquidity > 20000) score += 20;
    else if (liquidity > 10000) score += 10;

    // Factor 3: News support (max 30 points)
    if (newsContext) {
      if (newsContext.includes('HIGH') || newsContext.includes('POSITIVE')) score += 30;
      else if (newsContext.includes('MEDIUM')) score += 20;
      else score += 10;
    }

    // Determine confidence level
    if (score >= 70) return 'HIGH';
    if (score >= 40) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Calculate position size based on confidence
   */
  private calculatePositionSize(confidence: 'LOW' | 'MEDIUM' | 'HIGH'): number {
    const MAX_POSITION = 5.0; // $5 max per trade (25% of $20 balance)
    
    switch (confidence) {
      case 'HIGH':
        return MAX_POSITION; // $5
      case 'MEDIUM':
        return MAX_POSITION * 0.6; // $3
      case 'LOW':
        return MAX_POSITION * 0.3; // $1.5
      default:
        return 1.0;
    }
  }

  /**
   * Analyze existing position and decide if/how much to sell
   */
  analyzePosition(
    market: MarketInfo,
    entryPrice: number,
    shares: number
  ): PositionAnalysis {
    const currentPrice = parseFloat(market.outcomePrices[0]);
    const profitPercent = ((currentPrice - entryPrice) / entryPrice) * 100;

    // Default: don't sell
    let analysis: PositionAnalysis = {
      currentPrice,
      entryPrice,
      profitPercent,
      shouldSell: false,
      sellPercentage: 0,
      reason: `Current P&L: ${profitPercent > 0 ? '+' : ''}${profitPercent.toFixed(1)}%`,
    };

    // Check scale-out levels (kademeli satış)
    for (const level of this.SCALE_OUT_LEVELS) {
      if (profitPercent >= level.profit * 100) {
        analysis = {
          ...analysis,
          shouldSell: true,
          sellPercentage: level.sellPercent,
          reason: `Target ${level.profit * 100}% profit reached! Selling ${level.sellPercent}% of position.`,
        };
        break; // Use first matching level
      }
    }

    // Check if minimum profit target reached
    if (!analysis.shouldSell && profitPercent >= this.MIN_PROFIT_TARGET * 100) {
      analysis = {
        ...analysis,
        shouldSell: true,
        sellPercentage: 50, // Sell half at minimum profit
        reason: `Minimum profit target (${this.MIN_PROFIT_TARGET * 100}%) reached. Taking partial profits.`,
      };
    }

    // Check for high probability (near certainty)
    if (currentPrice > this.HIGH_PROBABILITY_THRESHOLD) {
      analysis = {
        ...analysis,
        shouldSell: true,
        sellPercentage: 100, // Sell everything
        reason: `Market probability very high (${(currentPrice * 100).toFixed(1)}%). Closing full position.`,
      };
    }

    return analysis;
  }

  /**
   * Find best trading opportunities from market list
   */
  findOpportunities(markets: MarketInfo[], newsData?: Map<string, string>): TradingSignal[] {
    const opportunities: TradingSignal[] = [];

    for (const market of markets) {
      const newsContext = newsData?.get(market.question);
      const signal = this.analyzeMarket(market, newsContext);

      if (signal.action !== 'HOLD' && signal.confidence !== 'LOW') {
        opportunities.push(signal);
      }
    }

    // Sort by confidence (HIGH first)
    return opportunities.sort((a, b) => {
      const confidenceOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
      return confidenceOrder[b.confidence] - confidenceOrder[a.confidence];
    });
  }

  /**
   * Log trading signal
   */
  logSignal(signal: TradingSignal): void {
    const emoji = signal.action === 'BUY' ? '🟢' : signal.action === 'SELL' ? '🔴' : '⏸️';
    const stars = signal.confidence === 'HIGH' ? '⭐⭐⭐' : signal.confidence === 'MEDIUM' ? '⭐⭐' : '⭐';
    
    console.log(`\n${emoji} ${signal.action} SIGNAL ${stars}`);
    console.log(`📊 [${formatBerlinTime()}] Market: ${signal.market.question}`);
    console.log(`💰 Price: ${(parseFloat(signal.market.outcomePrices[0]) * 100).toFixed(1)}%`);
    console.log(`🎯 Confidence: ${signal.confidence}`);
    console.log(`💵 Suggested Amount: $${signal.suggestedAmount.toFixed(2)}`);
    console.log(`📝 Reason: ${signal.reason}`);
    
    if (signal.targetProfit) {
      console.log(`🎯 Target Profit: ${(signal.targetProfit * 100).toFixed(0)}%`);
    }
    if (signal.stopLoss) {
      console.log(`🛑 Stop Loss: ${(signal.stopLoss * 100).toFixed(0)}%`);
    }
  }

  /**
   * Log position analysis
   */
  logPositionAnalysis(market: MarketInfo, analysis: PositionAnalysis): void {
    const emoji = analysis.profitPercent > 0 ? '📈' : '📉';
    const color = analysis.shouldSell ? '🔔' : '⏳';
    
    console.log(`\n${color} POSITION ANALYSIS ${emoji}`);
    console.log(`📊 [${formatBerlinTime()}] Market: ${market.question}`);
    console.log(`💰 Entry: ${(analysis.entryPrice * 100).toFixed(1)}% → Current: ${(analysis.currentPrice * 100).toFixed(1)}%`);
    console.log(`📊 P&L: ${analysis.profitPercent > 0 ? '+' : ''}${analysis.profitPercent.toFixed(2)}%`);
    console.log(`🎯 Action: ${analysis.shouldSell ? `SELL ${analysis.sellPercentage}%` : 'HOLD'}`);
    console.log(`📝 ${analysis.reason}`);
  }
}
