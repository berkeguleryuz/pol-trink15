/**
 * COPY TRADING BOT - Type Definitions
 *
 * Target wallet trade'lerini kopyalamak icin tipler
 */

/**
 * Polymarket Data API trade response
 */
export interface PolymarketTrade {
  transactionHash: string;
  side: 'BUY' | 'SELL';
  asset: string;           // Token ID
  size: string;            // Trade size (string number)
  price: string;           // Trade price (string number)
  timestamp: string;       // ISO timestamp
  title: string;           // Market title
  slug: string;            // Market slug
  outcome: string;         // "Yes" | "No" | "Up" | "Down" etc
}

/**
 * Copy trading bot configuration
 */
export interface CopyTradingConfig {
  targetWallet: string;
  pollIntervalMs: number;
  fixedAmount: number;
  copyBuysOnly: boolean;
  dryRun: boolean;
  enableTelegram: boolean;
  maxRetries: number;
  dataApiUrl: string;
  persistPath: string;
}

/**
 * Copied trade record for persistence
 */
export interface CopiedTradeRecord {
  transactionHash: string;
  copiedAt: string;
  orderId?: string;
  status: 'success' | 'failed' | 'skipped';
  error?: string;
  // ROI tracking fields
  tokenId?: string;
  marketSlug?: string;
  marketTitle?: string;
  outcome?: string;         // "Up" | "Down" etc
  buyPrice?: number;        // Price we bought at
  amount?: number;          // Amount we spent ($1)
  resolved?: boolean;       // Market resolved?
  won?: boolean;            // Did we win?
  payout?: number;          // Actual payout (1 if won, 0 if lost)
  profit?: number;          // Profit/loss
}

/**
 * Bot statistics
 */
export interface CopyTradingStats {
  startedAt: Date;
  tradesDetected: number;
  tradesCopied: number;
  tradesFailed: number;
  tradesSkipped: number;
  totalSpent: number;
  lastPollAt?: Date;
  lastTradeAt?: Date;
  // ROI tracking
  tradesResolved: number;
  tradesWon: number;
  tradesLost: number;
  totalPayout: number;
  totalProfit: number;
}

/**
 * Order execution result
 */
export interface OrderResult {
  success: boolean;
  orderId?: string;
  error?: string;
  executionTimeMs: number;
}
