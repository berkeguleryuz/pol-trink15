/**
 * POLYMARKET CLIENT WRAPPER
 *
 * ClobClient initialization with wallet setup
 * MetaMask/Browser Wallet support (SIGNATURE_TYPE=2)
 * Proxy support via PROXY_URL env variable
 */

import { ClobClient, ApiKeyCreds } from '@polymarket/clob-client';
import { Wallet } from 'ethers';
import * as dotenv from 'dotenv';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

dotenv.config();

// Setup proxy if configured
const setupProxy = () => {
  const proxyUrl = process.env.PROXY_URL;
  if (!proxyUrl) return;

  console.log(`   🌐 Proxy: ${proxyUrl.replace(/\/\/.*@/, '//***@')}`);

  // Set global agent for axios/fetch
  if (proxyUrl.startsWith('socks')) {
    const agent = new SocksProxyAgent(proxyUrl);
    (global as any).proxyAgent = agent;
  } else {
    const agent = new HttpsProxyAgent(proxyUrl);
    (global as any).proxyAgent = agent;
  }

  // Set environment variables for axios
  process.env.HTTPS_PROXY = proxyUrl;
  process.env.HTTP_PROXY = proxyUrl;
};

export interface ClientConfig {
  privateKey: string;
  funderAddress: string;
  chainId: number;
  signatureType: number;
  clobApiUrl: string;
}

export class PolymarketClientWrapper {
  private clobClient: ClobClient;
  private wallet: Wallet;
  private config: ClientConfig;

  private constructor(clobClient: ClobClient, wallet: Wallet, config: ClientConfig) {
    this.clobClient = clobClient;
    this.wallet = wallet;
    this.config = config;
  }

  /**
   * Create and initialize ClobClient
   */
  static async create(): Promise<PolymarketClientWrapper> {
    console.log('\n📡 Polymarket Client başlatılıyor...');

    // Setup proxy if configured
    setupProxy();

    // Config from .env
    const config: ClientConfig = {
      privateKey: process.env.PRIVATE_KEY || '',
      funderAddress: process.env.FUNDER_ADDRESS || '',
      chainId: parseInt(process.env.CHAIN_ID || '137'),
      signatureType: parseInt(process.env.SIGNATURE_TYPE || '2'),
      clobApiUrl: process.env.CLOB_API_URL || 'https://clob.polymarket.com'
    };

    // Validate
    if (!config.privateKey || !config.funderAddress) {
      throw new Error('PRIVATE_KEY ve FUNDER_ADDRESS .env dosyasında olmalı!');
    }

    // Create wallet
    const wallet = new Wallet(config.privateKey);
    const address = await wallet.getAddress();
    console.log(`   ✅ Wallet: ${address}`);
    console.log(`   💰 Funder: ${config.funderAddress}`);
    console.log(`   🔗 Chain ID: ${config.chainId}`);
    console.log(`   🔐 Signature Type: ${config.signatureType} (MetaMask)`);

    // Temporary client for API key derivation
    const tempClient = new ClobClient(
      config.clobApiUrl,
      config.chainId,
      wallet
    );

    // Derive API credentials
    console.log('   🔑 API credentials oluşturuluyor...');
    const creds: ApiKeyCreds = await tempClient.createOrDeriveApiKey();

    // Final client with funder (MetaMask mode)
    const clobClient = new ClobClient(
      config.clobApiUrl,
      config.chainId,
      wallet,
      creds,
      config.signatureType,
      config.funderAddress
    );

    console.log('   ✅ Polymarket Client hazır!\n');
    return new PolymarketClientWrapper(clobClient, wallet, config);
  }

  /**
   * Get ClobClient instance
   */
  getClient(): ClobClient {
    return this.clobClient;
  }

  /**
   * Get wallet instance
   */
  getWallet(): Wallet {
    return this.wallet;
  }

  /**
   * Get config
   */
  getConfig(): ClientConfig {
    return this.config;
  }

  /**
   * Get wallet address
   */
  async getAddress(): Promise<string> {
    return await this.wallet.getAddress();
  }
}
