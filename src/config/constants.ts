/**
 * Polymarket API Endpoints and Constants
 * 
 * Official endpoints from Polymarket documentation:
 * https://docs.polymarket.com/quickstart/introduction/main
 */

// CLOB API - Central Limit Order Book
export const CLOB_API_URL = 'https://clob.polymarket.com';

// Data API - User data, holdings, on-chain activities
export const DATA_API_URL = 'https://data-api.polymarket.com';

// Gamma API - Market data
export const GAMMA_API_URL = 'https://gamma-api.polymarket.com';

// WebSocket - CLOB subscriptions
export const WSS_CLOB_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/';

// Real Time Data Socket - Crypto prices, comments
export const WSS_RTDS_URL = 'wss://ws-live-data.polymarket.com';

// Chain IDs
export enum Chain {
  POLYGON = 137,
  AMOY = 80002, // Polygon testnet
}

// Signature Types
export enum SignatureType {
  EOA = 0,           // Externally Owned Account (direct wallet)
  POLY_PROXY = 1,    // Email/Magic Link login
  POLY_GNOSIS_SAFE = 2, // MetaMask/Browser Wallet
}

// Order Types
export const ORDER_TYPES = {
  GTC: 'GTC', // Good Till Cancelled
  FOK: 'FOK', // Fill or Kill
  GTD: 'GTD', // Good Till Date
  FAK: 'FAK', // Fill and Kill
} as const;

// Asset Types
export const ASSET_TYPES = {
  COLLATERAL: 'COLLATERAL', // USDC
  CONDITIONAL: 'CONDITIONAL', // Outcome tokens
} as const;

// Default values
export const DEFAULTS = {
  CHAIN_ID: Chain.POLYGON,
  SIGNATURE_TYPE: SignatureType.POLY_GNOSIS_SAFE, // MetaMask
  FEE_RATE_BPS: 0, // 0 basis points = no fee
  MIN_TICK_SIZE: 0.01,
  MIN_ORDER_SIZE: 1,
};
