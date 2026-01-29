import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface Config {
  privateKey: string;
  funderAddress: string;
  chainId: number;
  clobApiUrl: string;
  signatureType: number;
  apiKey?: string;
  apiSecret?: string;
  apiPassphrase?: string;
  perplexityApiKey?: string;
  footballApiKey?: string;
  defaultBuyAmount: number;
  defaultSellAmount: number;
  maxOrderSize: number;
  maxDailyVolume: number;
  logLevel: string;
}

export function loadConfig(): Config {
  const privateKey = process.env.PRIVATE_KEY;
  const funderAddress = process.env.FUNDER_ADDRESS;
  
  if (!privateKey) {
    throw new Error(
      '❌ PRIVATE_KEY not found in .env file!\n' +
      '   Please add your MetaMask private key to .env file\n' +
      '   Example: PRIVATE_KEY=your_private_key_here'
    );
  }

  if (!funderAddress) {
    throw new Error(
      '❌ FUNDER_ADDRESS not found in .env file!\n' +
      '   Please add your MetaMask wallet address to .env file\n' +
      '   This is the address where you send USDC\n' +
      '   Example: FUNDER_ADDRESS=0x1234567890abcdef...'
    );
  }

  // Remove 0x prefix if exists for private key
  const cleanPrivateKey = privateKey.startsWith('0x') 
    ? privateKey.slice(2) 
    : privateKey;

  return {
    privateKey: cleanPrivateKey,
    funderAddress: funderAddress,
    chainId: parseInt(process.env.CHAIN_ID || '137'),
    clobApiUrl: process.env.CLOB_API_URL || 'https://clob.polymarket.com',
    signatureType: parseInt(process.env.SIGNATURE_TYPE || '2'), // 2 = MetaMask/Browser Wallet
    apiKey: process.env.CLOB_API_KEY,
    apiSecret: process.env.CLOB_SECRET,
    apiPassphrase: process.env.CLOB_PASS_PHRASE,
    perplexityApiKey: process.env.PERPLEXITY_API_KEY,
    footballApiKey: process.env.FOOTBALL_API_KEY,
    defaultBuyAmount: parseFloat(process.env.DEFAULT_BUY_AMOUNT || '10'),
    defaultSellAmount: parseFloat(process.env.DEFAULT_SELL_AMOUNT || '10'),
    maxOrderSize: parseFloat(process.env.MAX_ORDER_SIZE || '100'),
    maxDailyVolume: parseFloat(process.env.MAX_DAILY_VOLUME || '500'),
    logLevel: process.env.LOG_LEVEL || 'info',
  };
}

export function validateConfig(config: Config): void {
  if (!config.privateKey) {
    throw new Error('Private key is required');
  }

  if (config.privateKey.length !== 64) {
    throw new Error(
      '❌ Invalid private key length!\n' +
      '   Expected: 64 characters (without 0x prefix)\n' +
      `   Got: ${config.privateKey.length} characters\n` +
      '   Please check your PRIVATE_KEY in .env file'
    );
  }

  if (!config.funderAddress) {
    throw new Error('Funder address is required');
  }

  if (!config.funderAddress.startsWith('0x') || config.funderAddress.length !== 42) {
    throw new Error(
      '❌ Invalid funder address format!\n' +
      '   Expected: Ethereum address starting with 0x (42 characters)\n' +
      `   Got: ${config.funderAddress}\n` +
      '   Please check your FUNDER_ADDRESS in .env file'
    );
  }

  if (config.chainId !== 137) {
    console.warn(`⚠️  Warning: Chain ID is ${config.chainId}, expected 137 (Polygon Mainnet)`);
  }

  if (config.signatureType !== 2) {
    console.warn(`⚠️  Warning: Signature type is ${config.signatureType}, expected 2 for MetaMask`);
  }
}

export const config = loadConfig();
