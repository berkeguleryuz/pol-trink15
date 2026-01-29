import { ClobClient, ApiKeyCreds } from '@polymarket/clob-client';
import { Wallet } from 'ethers';
import { config, validateConfig } from '../config';
import { logger } from '../utils/logger';

export class PolymarketClient {
  private clobClient: ClobClient;
  private wallet: Wallet;
  private initialized: boolean = false;

  private constructor(clobClient: ClobClient, wallet: Wallet) {
    this.clobClient = clobClient;
    this.wallet = wallet;
    this.initialized = true;
  }

  /**
   * Create and initialize a new Polymarket client
   */
  static async create(): Promise<PolymarketClient> {
    try {
      logger.section('Initializing Polymarket Client');
      
      // Validate configuration
      validateConfig(config);
      logger.info('✓ Configuration validated');

      // Create wallet from private key
      const wallet = new Wallet(config.privateKey);
      const address = await wallet.getAddress();
      logger.info(`✓ Wallet loaded: ${address}`);
      logger.info(`✓ Funder address: ${config.funderAddress}`);
      logger.info(`✓ Chain ID: ${config.chainId}`);
      logger.info(`✓ Signature Type: ${config.signatureType} (MetaMask/Browser Wallet)`);

      // Create temporary CLOB client for API key generation
      const tempClient = new ClobClient(
        config.clobApiUrl,
        config.chainId,
        wallet
      );

      // Create or derive API credentials
      logger.info('Creating/deriving API credentials...');
      const creds: ApiKeyCreds = await tempClient.createOrDeriveApiKey();
      logger.info('✓ API credentials created/derived');

      // Create the final client with credentials and funder
      // For MetaMask/Browser Wallet, we need to provide the funder address
      const clobClient = new ClobClient(
        config.clobApiUrl,
        config.chainId,
        wallet,
        creds,
        config.signatureType,
        config.funderAddress  // Important: funder address for MetaMask
      );

      logger.success('Polymarket client initialized successfully!');
      
      return new PolymarketClient(clobClient, wallet);
    } catch (error: any) {
      logger.failure('Failed to initialize Polymarket client');
      
      if (error.message?.includes('PRIVATE_KEY') || error.message?.includes('FUNDER_ADDRESS')) {
        logger.error('Configuration error:', error);
      } else if (error.message?.includes('Invalid private key')) {
        logger.error('Invalid private key format. Please check your .env file');
      } else if (error.message?.includes('funder address')) {
        logger.error('Invalid funder address. Please check your FUNDER_ADDRESS in .env file');
      } else {
        logger.error('Initialization error:', error);
      }
      
      throw error;
    }
  }

  /**
   * Get the underlying ClobClient instance
   */
  getClient(): ClobClient {
    if (!this.initialized) {
      throw new Error('Client not initialized. Call PolymarketClient.create() first.');
    }
    return this.clobClient;
  }

  /**
   * Get wallet address
   */
  async getAddress(): Promise<string> {
    return await this.wallet.getAddress();
  }

  /**
   * Get wallet instance
   */
  getWallet(): Wallet {
    return this.wallet;
  }

  /**
   * Check if client is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get orderbook for a token
   */
  async getOrderbook(tokenId: string) {
    if (!this.initialized) {
      throw new Error('Client not initialized');
    }
    return await this.clobClient.getOrderBook(tokenId);
  }

  /**
   * Get all open orders
   */
  async getOpenOrders() {
    if (!this.initialized) {
      throw new Error('Client not initialized');
    }
    return await this.clobClient.getOpenOrders();
  }

  /**
   * Get trade history
   */
  async getTradeHistory() {
    if (!this.initialized) {
      throw new Error('Client not initialized');
    }
    return await this.clobClient.getTrades();
  }
}
