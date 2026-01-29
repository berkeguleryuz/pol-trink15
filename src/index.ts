/**
 * PolyBuy - Polymarket Trading Bot
 * 
 * Main export file
 */

// Client
export { PolymarketClient } from './client';

// Markets
export {
  getActiveMarkets,
  getMarketBySlug,
  searchMarkets,
  getTokenIds,
  displayMarket,
  type Market,
  type MarketFilters,
} from './markets';

// Trading
export {
  buyShares,
  sellShares,
  cancelOrder,
  cancelAllMarketOrders,
  type BuyOrderParams,
  type SellOrderParams,
} from './trading';

// Utils
export {
  getBalance,
  getTokenBalance,
  getOpenOrders,
  displayBalance,
  displayOpenOrders,
  checkSufficientBalance,
  AssetType,
  type Balance,
  type OpenOrder,
} from './utils/balance';

export { logger } from './utils/logger';

// WebSocket (placeholder for future implementation)
export {
  PolymarketWebSocket,
  connectToCLOB,
  connectToRTDS,
  pollMarketPrices,
  type MarketUpdate,
  type OrderbookUpdate,
} from './utils/websocket';

// Config
export { config } from './config';

// Constants
export {
  CLOB_API_URL,
  DATA_API_URL,
  GAMMA_API_URL,
  WSS_CLOB_URL,
  WSS_RTDS_URL,
  Chain,
  SignatureType,
  ORDER_TYPES,
  ASSET_TYPES,
  DEFAULTS,
} from './config/constants';
