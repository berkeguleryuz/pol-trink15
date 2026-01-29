/**
 * 🎯 SPORTS TRADING CONFIGURATION
 * 
 * Tüm trading parametreleri burada
 */

export const TRADING_CONFIG = {
  /**
   * POSITION SIZING
   */
  POSITION_SIZE: {
    // Pre-match value bets (konservatif)
    PRE_MATCH: 3.0,           // $3 per pre-match position
    
    // Live goal arbitrage (agresif)
    LIVE_ARBITRAGE: 3.0,      // $3 per live trade
    
    // Multiple goals in same match (scale up)
    GOAL_SCALING: {
      FIRST_GOAL: 3.0,        // $3
      SECOND_GOAL: 4.0,       // $4 (daha confident)
      THIRD_GOAL_PLUS: 5.0    // $5+ (maksimum confidence)
    }
  },

  /**
   * RISK LIMITS
   */
  LIMITS: {
    MAX_TRADES_PER_DAY: 20,        // Max 20 trade/gün
    MAX_VOLUME_PER_DAY: 1000,      // Max $1,000 günlük volume
    MAX_LOSS_PER_DAY: 100,         // Max $100 günlük zarar
    MAX_PER_MATCH: 200,            // Max $200 bir maça
    MAX_CONCURRENT_MATCHES: 8      // Max 8 maç aynı anda
  },

  /**
   * LIQUIDITY REQUIREMENTS
   */
  LIQUIDITY: {
    MIN_MARKET_LIQUIDITY: 10000,   // Min $10K market liquidity (düşürdük $3 için)
    MIN_VOLUME_24H: 2000,          // Min $2K 24h volume
    MAX_BID_ASK_SPREAD: 0.03,      // Max 3¢ spread (relaxed for smaller size)
    MIN_ORDER_SIZE: 1.0,           // Min $1 order (Polymarket minimum)
    MAX_ORDER_SIZE: 100.0          // Max $100 single order
  },

  /**
   * EXIT STRATEGY (Percentage-based, NOT fixed shares!)
   */
  EXIT: {
    // Kademeli satış - Kar hedeflerine göre pozisyonun yüzdesi
    TAKE_PROFIT_LEVELS: [
      { profitPct: 0.50, sellPct: 0.40 },  // %50 kar → Pozisyonun %40'ını sat
      { profitPct: 1.00, sellPct: 0.30 },  // %100 kar → Kalan pozisyonun %30'unu sat (~total %18)
      { profitPct: 2.00, sellPct: 0.30 }   // %200 kar → Kalan pozisyonun %30'unu sat (~total %12.6)
      // Örnek: 1000 shares → 400 sat (%50), 180 sat (%100), 126 sat (%200), 294 kalır
    ],
    
    // Live arbitrage - hızlı gir-çık (tek seferde %100)
    ARBITRAGE_EXIT_SECONDS: 20,    // 20 saniye sonra sat
    ARBITRAGE_MIN_PROFIT_PCT: 0.08, // Min %8 profit (yoksa tutmaya devam)
    ARBITRAGE_FULL_EXIT: true,      // Arbitrage'de %100 sat (kademeli değil)
    
    // Pre-match - event-based exit
    PRE_MATCH_FIRST_GOAL: true,    // İlk golde sat
    PRE_MATCH_EVAL_MINUTE: 60,     // 60. dakikada değerlendir
    
    // Emergency exits (always %100)
    REVERSE_GOAL_EXIT: true,        // Ters gol → %100 acil sat
    LOW_LIQUIDITY_EXIT: 5000        // Liquidity <$5K → %100 sat
  },

  /**
   * SLIPPAGE & EXECUTION
   */
  EXECUTION: {
    MAX_SLIPPAGE: 0.05,            // Max %5 slippage (küçük order için OK)
    ORDER_TIMEOUT_MS: 10000,       // 10 saniye order timeout
    RETRY_ATTEMPTS: 3,             // 3 kere dene
    RETRY_DELAY_MS: 2000           // 2 saniye bekle retry'lar arası
  },

  /**
   * MONITORING
   */
  MONITORING: {
    POLL_INTERVAL_MS: 3000,        // 3 saniye polling
    MATCH_DETECTION_BUFFER_MIN: 5, // Maç başlamadan 5 dakika önce hazır ol
    GOAL_DETECTION_THRESHOLD_SEC: 30 // 30 saniye içinde algıla
  }
} as const;

/**
 * Helper function: Position size hesapla
 */
export function calculatePositionSize(context: {
  strategy: 'PRE_MATCH' | 'LIVE_ARBITRAGE';
  goalNumber?: number;
}): number {
  if (context.strategy === 'PRE_MATCH') {
    return TRADING_CONFIG.POSITION_SIZE.PRE_MATCH;
  }
  
  // Live arbitrage - goal number'a göre scale
  const goalNum = context.goalNumber || 1;
  
  if (goalNum === 1) {
    return TRADING_CONFIG.POSITION_SIZE.GOAL_SCALING.FIRST_GOAL;
  } else if (goalNum === 2) {
    return TRADING_CONFIG.POSITION_SIZE.GOAL_SCALING.SECOND_GOAL;
  } else {
    return TRADING_CONFIG.POSITION_SIZE.GOAL_SCALING.THIRD_GOAL_PLUS;
  }
}

/**
 * Helper function: Liquidity check
 */
export function checkLiquidity(market: {
  liquidity: number;
  volume24h: number;
  bidAskSpread: number;
}): { ok: boolean; reason?: string } {
  if (market.liquidity < TRADING_CONFIG.LIQUIDITY.MIN_MARKET_LIQUIDITY) {
    return { 
      ok: false, 
      reason: `Liquidity too low: $${market.liquidity.toFixed(0)} (min: $${TRADING_CONFIG.LIQUIDITY.MIN_MARKET_LIQUIDITY})` 
    };
  }
  
  if (market.volume24h < TRADING_CONFIG.LIQUIDITY.MIN_VOLUME_24H) {
    return { 
      ok: false, 
      reason: `Volume too low: $${market.volume24h.toFixed(0)} (min: $${TRADING_CONFIG.LIQUIDITY.MIN_VOLUME_24H})` 
    };
  }
  
  if (market.bidAskSpread > TRADING_CONFIG.LIQUIDITY.MAX_BID_ASK_SPREAD) {
    return { 
      ok: false, 
      reason: `Spread too wide: ${(market.bidAskSpread * 100).toFixed(1)}¢ (max: ${TRADING_CONFIG.LIQUIDITY.MAX_BID_ASK_SPREAD * 100}¢)` 
    };
  }
  
  return { ok: true };
}

/**
 * Helper function: Risk check
 */
export function checkRiskLimits(stats: {
  dailyTrades: number;
  dailyVolume: number;
  dailyLoss: number;
  matchVolume: number;
  concurrentMatches: number;
}): { ok: boolean; reason?: string } {
  if (stats.dailyTrades >= TRADING_CONFIG.LIMITS.MAX_TRADES_PER_DAY) {
    return { ok: false, reason: `Daily trade limit reached: ${stats.dailyTrades}` };
  }
  
  if (stats.dailyVolume >= TRADING_CONFIG.LIMITS.MAX_VOLUME_PER_DAY) {
    return { ok: false, reason: `Daily volume limit reached: $${stats.dailyVolume}` };
  }
  
  if (stats.dailyLoss >= TRADING_CONFIG.LIMITS.MAX_LOSS_PER_DAY) {
    return { ok: false, reason: `Daily loss limit reached: $${stats.dailyLoss}` };
  }
  
  if (stats.matchVolume >= TRADING_CONFIG.LIMITS.MAX_PER_MATCH) {
    return { ok: false, reason: `Match volume limit reached: $${stats.matchVolume}` };
  }
  
  if (stats.concurrentMatches >= TRADING_CONFIG.LIMITS.MAX_CONCURRENT_MATCHES) {
    return { ok: false, reason: `Concurrent matches limit: ${stats.concurrentMatches}` };
  }
  
  return { ok: true };
}

/**
 * Helper function: Calculate exit amount (PERCENTAGE-BASED!)
 */
export function calculateExitAmount(context: {
  totalShares: number;
  remainingShares: number;
  profitPercent: number;
  strategy: 'PRE_MATCH' | 'LIVE_ARBITRAGE';
}): { sharesToSell: number; reason: string; isFullExit: boolean } {
  const { totalShares, remainingShares, profitPercent, strategy } = context;
  
  // Arbitrage: Always full exit
  if (strategy === 'LIVE_ARBITRAGE') {
    return {
      sharesToSell: remainingShares,
      reason: 'ARBITRAGE_FULL_EXIT',
      isFullExit: true
    };
  }
  
  // Find matching take-profit level
  const levels = TRADING_CONFIG.EXIT.TAKE_PROFIT_LEVELS;
  for (const level of levels) {
    if (profitPercent >= level.profitPct) {
      // Kalan pozisyonun X%'ini sat
      const sharesToSell = Math.floor(remainingShares * level.sellPct);
      
      return {
        sharesToSell: Math.max(sharesToSell, 1), // Min 1 share
        reason: `TAKE_PROFIT_${(level.profitPct * 100).toFixed(0)}PCT`,
        isFullExit: false
      };
    }
  }
  
  return {
    sharesToSell: 0,
    reason: 'NO_EXIT_TRIGGER',
    isFullExit: false
  };
}

/**
 * Helper function: Exit check
 */
export function shouldExit(context: {
  strategy: 'PRE_MATCH' | 'LIVE_ARBITRAGE';
  elapsedSeconds?: number;
  profitPercent?: number;
  goalScored?: boolean;
  minute?: number;
  reverseGoal?: boolean;
  liquidity?: number;
}): { shouldExit: boolean; reason: string; isFullExit: boolean } {
  // Emergency: Reverse goal (FULL EXIT)
  if (context.reverseGoal) {
    return { shouldExit: true, reason: 'REVERSE_GOAL', isFullExit: true };
  }
  
  // Emergency: Low liquidity (FULL EXIT)
  if (context.liquidity && context.liquidity < TRADING_CONFIG.EXIT.LOW_LIQUIDITY_EXIT) {
    return { shouldExit: true, reason: 'LOW_LIQUIDITY', isFullExit: true };
  }
  
  // Live arbitrage exits (FULL EXIT)
  if (context.strategy === 'LIVE_ARBITRAGE') {
    const elapsed = context.elapsedSeconds || 0;
    const profit = context.profitPercent || 0;
    
    // Exit after 20 seconds if profitable
    if (elapsed >= TRADING_CONFIG.EXIT.ARBITRAGE_EXIT_SECONDS) {
      if (profit >= TRADING_CONFIG.EXIT.ARBITRAGE_MIN_PROFIT_PCT) {
        return { shouldExit: true, reason: 'ARBITRAGE_PROFIT_TARGET', isFullExit: true };
      } else {
        return { shouldExit: true, reason: 'ARBITRAGE_TIMEOUT', isFullExit: true };
      }
    }
  }
  
  // Pre-match exits (KADEMELI)
  if (context.strategy === 'PRE_MATCH') {
    const profit = context.profitPercent || 0;
    
    // First goal (partial exit if profitable)
    if (context.goalScored && TRADING_CONFIG.EXIT.PRE_MATCH_FIRST_GOAL) {
      return { shouldExit: true, reason: 'FIRST_GOAL', isFullExit: false };
    }
    
    // Take-profit levels
    for (const level of TRADING_CONFIG.EXIT.TAKE_PROFIT_LEVELS) {
      if (profit >= level.profitPct) {
        return { 
          shouldExit: true, 
          reason: `TAKE_PROFIT_${(level.profitPct * 100).toFixed(0)}PCT`,
          isFullExit: false 
        };
      }
    }
    
    // 60th minute evaluation
    if (context.minute && context.minute >= TRADING_CONFIG.EXIT.PRE_MATCH_EVAL_MINUTE) {
      if (profit > 0) {
        return { shouldExit: true, reason: 'EVAL_MINUTE_PROFITABLE', isFullExit: true };
      }
    }
  }
  
  return { shouldExit: false, reason: 'HOLD', isFullExit: false };
}
