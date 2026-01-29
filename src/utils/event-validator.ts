import { TimezoneUtils } from '../utils/timezone';

/**
 * Event Validation System
 * Ensures we only trade on FRESH, RELEVANT, ACTIVE events
 */

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  warnings?: string[];
}

export class EventValidator {
  private readonly MAX_EVENT_AGE = 2 * 60 * 1000; // 2 minutes
  private readonly MIN_CONFIDENCE = 60; // 60% minimum confidence
  private readonly BLACKLIST_KEYWORDS = [
    'yesterday',
    'last week',
    'last month',
    'ago',
    'previously',
    'earlier',
    'past',
  ];

  /**
   * Validate event before trading
   */
  validateEvent(event: {
    timestamp: Date;
    confidence: number;
    reason: string;
    market: string;
  }): ValidationResult {
    const warnings: string[] = [];

    // 1. Check timestamp freshness
    const age = Date.now() - event.timestamp.getTime();
    if (age > this.MAX_EVENT_AGE) {
      return {
        valid: false,
        reason: `Event too old: ${(age / 1000).toFixed(0)}s (max 120s)`,
      };
    }

    if (age > 60 * 1000) {
      warnings.push(`Event is ${(age / 1000).toFixed(0)}s old (consider caution)`);
    }

    // 2. Check confidence level
    if (event.confidence < this.MIN_CONFIDENCE) {
      return {
        valid: false,
        reason: `Confidence too low: ${event.confidence}% (min ${this.MIN_CONFIDENCE}%)`,
      };
    }

    if (event.confidence < 70) {
      warnings.push(`Confidence is low: ${event.confidence}%`);
    }

    // 3. Check for historical language in reason
    const reasonLower = event.reason.toLowerCase();
    for (const keyword of this.BLACKLIST_KEYWORDS) {
      if (reasonLower.includes(keyword)) {
        return {
          valid: false,
          reason: `Historical language detected: "${keyword}" - only trading CURRENT events`,
        };
      }
    }

    // 4. Check for real-time indicators
    const realtimeKeywords = [
      'breaking',
      'just',
      'now',
      'live',
      'happening',
      'current',
      'scores',
      'leads',
    ];

    const hasRealtimeIndicator = realtimeKeywords.some(kw => reasonLower.includes(kw));
    if (!hasRealtimeIndicator) {
      warnings.push('No real-time indicators found (breaking, just, now, etc.)');
    }

    return {
      valid: true,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Validate market is tradeable
   */
  validateMarket(market: {
    question: string;
    yesPrice: number;
    noPrice: number;
    liquidity: number;
    closed?: boolean;
    active?: boolean;
  }): ValidationResult {
    const warnings: string[] = [];

    // 1. Check if market is closed
    if (market.closed === true || market.active === false) {
      return {
        valid: false,
        reason: 'Market is CLOSED or RESOLVED - cannot trade',
      };
    }

    // 2. Check liquidity
    if (market.liquidity < 1000) {
      return {
        valid: false,
        reason: `Liquidity too low: $${market.liquidity.toFixed(0)} (min $1,000)`,
      };
    }

    if (market.liquidity < 5000) {
      warnings.push(`Low liquidity: $${market.liquidity.toFixed(0)}`);
    }

    // 3. Check prices are reasonable
    if (market.yesPrice < 0.01 || market.yesPrice > 0.99) {
      warnings.push(`Extreme YES price: ${(market.yesPrice * 100).toFixed(1)}%`);
    }

    if (market.noPrice < 0.01 || market.noPrice > 0.99) {
      warnings.push(`Extreme NO price: ${(market.noPrice * 100).toFixed(1)}%`);
    }

    // 4. Check prices sum to ~1.0
    const priceSum = market.yesPrice + market.noPrice;
    if (Math.abs(priceSum - 1.0) > 0.05) {
      warnings.push(`Price sum unusual: ${(priceSum * 100).toFixed(1)}% (expected 100%)`);
    }

    return {
      valid: true,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Validate market timing (not expired/resolved)
   */
  validateMarketTiming(marketQuestion: string): ValidationResult {
    const questionLower = marketQuestion.toLowerCase();

    // Check for past year references
    const currentYear = new Date().getFullYear();
    const pastYears = [currentYear - 1, currentYear - 2, currentYear - 3];
    
    for (const year of pastYears) {
      if (questionLower.includes(year.toString())) {
        return {
          valid: false,
          reason: `Market refers to past year ${year} - event already happened`,
        };
      }
    }

    // Check for completed timeframes
    const completedTimeframes = [
      'january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december',
      'q1', 'q2', 'q3', 'q4',
    ];

    const currentMonth = new Date().getMonth(); // 0-11
    const currentQuarter = Math.floor(currentMonth / 3) + 1; // 1-4

    for (const timeframe of completedTimeframes) {
      if (!questionLower.includes(timeframe)) continue;

      // Check if month is in the past
      const months = ['january', 'february', 'march', 'april', 'may', 'june',
                      'july', 'august', 'september', 'october', 'november', 'december'];
      const monthIndex = months.indexOf(timeframe);
      
      if (monthIndex !== -1 && monthIndex < currentMonth) {
        return {
          valid: false,
          reason: `Market timeframe (${timeframe}) has passed`,
        };
      }

      // Check if quarter is in the past
      if (timeframe.startsWith('q')) {
        const quarter = parseInt(timeframe.substring(1));
        if (quarter < currentQuarter) {
          return {
            valid: false,
            reason: `Market quarter (${timeframe.toUpperCase()}) has passed`,
          };
        }
      }
    }

    return { valid: true };
  }

  /**
   * Full validation pipeline
   */
  fullValidation(
    event: {
      timestamp: Date;
      confidence: number;
      reason: string;
      market: string;
    },
    market: {
      question: string;
      yesPrice: number;
      noPrice: number;
      liquidity: number;
      closed?: boolean;
      active?: boolean;
    }
  ): ValidationResult {
    console.log(`\n🔍 VALIDATION PIPELINE`);
    console.log(`📊 [${TimezoneUtils.formatBerlinTime()}]`);

    // Step 1: Validate event
    console.log(`\n1️⃣ Validating event...`);
    const eventResult = this.validateEvent(event);
    if (!eventResult.valid) {
      console.log(`   ❌ ${eventResult.reason}`);
      return eventResult;
    }
    console.log(`   ✅ Event valid`);
    if (eventResult.warnings) {
      eventResult.warnings.forEach(w => console.log(`   ⚠️  ${w}`));
    }

    // Step 2: Validate market
    console.log(`\n2️⃣ Validating market...`);
    const marketResult = this.validateMarket(market);
    if (!marketResult.valid) {
      console.log(`   ❌ ${marketResult.reason}`);
      return marketResult;
    }
    console.log(`   ✅ Market valid`);
    if (marketResult.warnings) {
      marketResult.warnings.forEach(w => console.log(`   ⚠️  ${w}`));
    }

    // Step 3: Validate timing
    console.log(`\n3️⃣ Validating market timing...`);
    const timingResult = this.validateMarketTiming(market.question);
    if (!timingResult.valid) {
      console.log(`   ❌ ${timingResult.reason}`);
      return timingResult;
    }
    console.log(`   ✅ Timing valid`);

    console.log(`\n✅ ALL VALIDATIONS PASSED\n`);
    
    // Aggregate warnings
    const allWarnings = [
      ...(eventResult.warnings || []),
      ...(marketResult.warnings || []),
    ];

    return {
      valid: true,
      warnings: allWarnings.length > 0 ? allWarnings : undefined,
    };
  }
}
