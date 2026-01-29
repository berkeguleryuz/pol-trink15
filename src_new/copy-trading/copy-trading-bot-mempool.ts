/**
 * COPY TRADING BOT - Mempool Version
 *
 * Target'ın transaction'larını mempool'dan yakalar (finalize olmadan).
 * Order'ı decode edip aynısını girer.
 *
 * Usage:
 *   npm run copy:mempool:dry   - Dry run
 *   npm run copy:mempool:live  - Live mode
 */

import { ethers } from 'ethers';
import { ClobClient, Side, OrderType } from '@polymarket/clob-client';
import * as fs from 'fs';
import * as path from 'path';
import { PolymarketClientWrapper } from '../trading/polymarket-client';
import WebSocket from 'ws';
import dotenv from 'dotenv';

dotenv.config();

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  targetWallet: '0x336848a1a1cb00348020c9457676f34d882f21cd'.toLowerCase(),
  chainstackWsUrl: process.env.CHAINSTACK_WS_URL || '',
  scale: 0.1,  // %10
  minOrderSize: 1,
  dryRun: !process.argv.includes('--live'),
  persistPath: path.join(__dirname, '../../data/copied-trades-mempool.json')
};

// Polymarket Contract Addresses (Polygon)
const POLYMARKET_CONTRACTS = {
  // CTF Exchange - ana exchange contract
  CTF_EXCHANGE: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E'.toLowerCase(),
  // Neg Risk CTF Exchange
  NEG_RISK_CTF_EXCHANGE: '0xC5d563A36AE78145C45a50134d48A1215220f80a'.toLowerCase(),
  // Neg Risk Adapter
  NEG_RISK_ADAPTER: '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296'.toLowerCase(),
  // USDC on Polygon
  USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'.toLowerCase(),
  // Conditional Tokens
  CONDITIONAL_TOKENS: '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045'.toLowerCase()
};

// CTF Exchange ABI (sadece ihtiyacımız olan fonksiyonlar)
const CTF_EXCHANGE_ABI = [
  // fillOrder - market order fill
  'function fillOrder(tuple(uint256 salt, address maker, address signer, address taker, uint256 tokenId, uint256 makerAmount, uint256 takerAmount, uint256 expiration, uint256 nonce, uint256 feeRateBps, uint8 side, uint8 signatureType, bytes signature) order, uint256 fillAmount) external',
  // fillOrders - batch fill
  'function fillOrders(tuple(uint256 salt, address maker, address signer, address taker, uint256 tokenId, uint256 makerAmount, uint256 takerAmount, uint256 expiration, uint256 nonce, uint256 feeRateBps, uint8 side, uint8 signatureType, bytes signature)[] orders, uint256[] fillAmounts) external',
  // matchOrders
  'function matchOrders(tuple(uint256 salt, address maker, address signer, address taker, uint256 tokenId, uint256 makerAmount, uint256 takerAmount, uint256 expiration, uint256 nonce, uint256 feeRateBps, uint8 side, uint8 signatureType, bytes signature) takerOrder, tuple(uint256 salt, address maker, address signer, address taker, uint256 tokenId, uint256 makerAmount, uint256 takerAmount, uint256 expiration, uint256 nonce, uint256 feeRateBps, uint8 side, uint8 signatureType, bytes signature)[] makerOrders, uint256 takerFillAmount, uint256[] makerFillAmounts) external'
];

// ============================================================================
// TYPES
// ============================================================================

interface DecodedOrder {
  tokenId: string;
  side: 'BUY' | 'SELL';
  amount: number;
  price: number;
  maker: string;
  taker: string;
}

interface PendingTx {
  hash: string;
  from: string;
  to: string;
  value: string;
  input: string;
  gasPrice: string;
  timestamp: number;
}

// ============================================================================
// MEMPOOL COPY BOT
// ============================================================================

class MempoolCopyBot {
  private provider: ethers.providers.WebSocketProvider | null = null;
  private client: ClobClient | null = null;
  private ctfInterface: ethers.utils.Interface;

  private seenTxHashes: Set<string> = new Set();
  private stats = {
    txReceived: 0,
    targetTxFound: 0,
    ordersCopied: 0,
    ordersFailed: 0,
    totalSpent: 0
  };

  constructor() {
    this.ctfInterface = new ethers.utils.Interface(CTF_EXCHANGE_ABI);
  }

  async start(): Promise<void> {
    console.log('\n' + '='.repeat(60));
    console.log('   MEMPOOL COPY BOT - Pre-finalization');
    console.log('='.repeat(60));
    console.log(`   Mode: ${CONFIG.dryRun ? '🧪 DRY RUN' : '🔴 LIVE'}`);
    console.log(`   Target: ${CONFIG.targetWallet}`);
    console.log(`   Scale: ${(CONFIG.scale * 100).toFixed(0)}%`);
    console.log(`   Chainstack: ${CONFIG.chainstackWsUrl ? '✅ Connected' : '❌ Missing'}`);
    console.log('='.repeat(60) + '\n');

    if (!CONFIG.chainstackWsUrl) {
      console.error('❌ CHAINSTACK_WS_URL not set in .env');
      process.exit(1);
    }

    // Init Polymarket client
    if (!CONFIG.dryRun) {
      console.log('📡 Initializing Polymarket client...');
      const wrapper = await PolymarketClientWrapper.create();
      this.client = wrapper.getClient();
      console.log('   ✅ Client ready\n');
    }

    // Connect to Chainstack
    await this.connectMempool();

    console.log('🚀 Monitoring mempool... (Ctrl+C to stop)\n');
  }

  private async connectMempool(): Promise<void> {
    console.log('   🔌 Connecting to Chainstack...');

    this.provider = new ethers.providers.WebSocketProvider(CONFIG.chainstackWsUrl);

    // Test connection
    const network = await this.provider.getNetwork();
    console.log(`   ✅ Connected to ${network.name} (chainId: ${network.chainId})\n`);

    // Subscribe to pending transactions
    this.provider.on('pending', async (txHash: string) => {
      await this.handlePendingTx(txHash);
    });

    // Handle disconnection
    this.provider._websocket.on('close', () => {
      console.log('   ⚠️ WebSocket disconnected, reconnecting...');
      setTimeout(() => this.connectMempool(), 3000);
    });
  }

  private async handlePendingTx(txHash: string): Promise<void> {
    // Skip if already seen
    if (this.seenTxHashes.has(txHash)) return;
    this.seenTxHashes.add(txHash);

    // Keep set size manageable
    if (this.seenTxHashes.size > 10000) {
      const arr = Array.from(this.seenTxHashes);
      this.seenTxHashes = new Set(arr.slice(-5000));
    }

    this.stats.txReceived++;

    try {
      // Get transaction details
      const tx = await this.provider!.getTransaction(txHash);
      if (!tx) return;

      // Check if from target wallet
      const from = tx.from?.toLowerCase();
      if (from !== CONFIG.targetWallet) return;

      this.stats.targetTxFound++;
      const now = new Date().toLocaleTimeString('tr-TR', { hour12: false });

      console.log(`\n[${now}] ⚡ TARGET TX DETECTED!`);
      console.log(`   Hash: ${txHash}`);
      console.log(`   To: ${tx.to}`);
      console.log(`   Value: ${ethers.utils.formatEther(tx.value)} MATIC`);

      // Check if it's a Polymarket contract interaction
      const to = tx.to?.toLowerCase();
      if (to === POLYMARKET_CONTRACTS.CTF_EXCHANGE ||
          to === POLYMARKET_CONTRACTS.NEG_RISK_CTF_EXCHANGE) {

        console.log(`   📊 POLYMARKET ORDER DETECTED!`);
        await this.decodeAndCopy(tx);
      } else if (to === POLYMARKET_CONTRACTS.USDC) {
        console.log(`   💰 USDC Transfer (approval or transfer)`);
      } else {
        console.log(`   ℹ️ Other contract interaction`);
      }

    } catch (error) {
      // Transaction might be dropped or replaced
    }
  }

  private async decodeAndCopy(tx: ethers.providers.TransactionResponse): Promise<void> {
    try {
      // Decode transaction input
      const decoded = this.ctfInterface.parseTransaction({ data: tx.data });

      console.log(`   Function: ${decoded.name}`);

      if (decoded.name === 'fillOrder' || decoded.name === 'fillOrders') {
        const orders = decoded.name === 'fillOrder'
          ? [decoded.args.order]
          : decoded.args.orders;

        for (const order of orders) {
          const tokenId = order.tokenId.toString();
          const makerAmount = parseFloat(ethers.utils.formatUnits(order.makerAmount, 6)); // USDC has 6 decimals
          const takerAmount = parseFloat(ethers.utils.formatUnits(order.takerAmount, 6));
          const side = order.side === 0 ? 'BUY' : 'SELL';

          // Calculate price
          const price = side === 'BUY'
            ? takerAmount / makerAmount  // Paying takerAmount to get makerAmount shares
            : makerAmount / takerAmount; // Getting makerAmount USDC for takerAmount shares

          const value = side === 'BUY' ? takerAmount : makerAmount;

          console.log(`\n   📈 ORDER DETAILS:`);
          console.log(`      Token ID: ${tokenId.slice(0, 20)}...`);
          console.log(`      Side: ${side}`);
          console.log(`      Value: $${value.toFixed(2)}`);
          console.log(`      Price: ${price.toFixed(4)}`);

          // Copy the order
          await this.copyOrder(tokenId, side, value, price);
        }
      } else if (decoded.name === 'matchOrders') {
        console.log(`   Match orders detected - extracting taker order...`);
        const takerOrder = decoded.args.takerOrder;
        const tokenId = takerOrder.tokenId.toString();
        const side = takerOrder.side === 0 ? 'BUY' : 'SELL';
        const takerAmount = parseFloat(ethers.utils.formatUnits(takerOrder.takerAmount, 6));

        await this.copyOrder(tokenId, side as 'BUY' | 'SELL', takerAmount, 0);
      }

    } catch (error) {
      console.log(`   ⚠️ Could not decode: ${error}`);
    }
  }

  private async copyOrder(tokenId: string, side: 'BUY' | 'SELL', targetValue: number, price: number): Promise<void> {
    let ourAmount = targetValue * CONFIG.scale;
    if (ourAmount < CONFIG.minOrderSize) {
      ourAmount = CONFIG.minOrderSize;
    }

    console.log(`\n   🚀 COPYING: ${side} $${ourAmount.toFixed(2)} (target: $${targetValue.toFixed(2)})`);

    if (CONFIG.dryRun) {
      console.log(`   ✅ [DRY RUN] Would place order`);
      this.stats.ordersCopied++;
      this.stats.totalSpent += ourAmount;
      return;
    }

    if (!this.client) {
      console.log(`   ❌ Client not initialized`);
      return;
    }

    try {
      const order = await this.client.createMarketOrder({
        tokenID: tokenId,
        amount: ourAmount,
        side: side === 'BUY' ? Side.BUY : Side.SELL
      });

      const response = await this.client.postOrder(order, OrderType.FOK);

      this.stats.ordersCopied++;
      this.stats.totalSpent += ourAmount;
      console.log(`   ✅ Order placed: ${response.orderID || response.id}`);

    } catch (error) {
      this.stats.ordersFailed++;
      console.log(`   ❌ Failed: ${error}`);
    }
  }

  stop(): void {
    console.log('\n🛑 Stopping...');

    if (this.provider) {
      this.provider.removeAllListeners();
      this.provider._websocket.close();
    }

    console.log('\n' + '='.repeat(60));
    console.log('   📊 FINAL STATS');
    console.log('='.repeat(60));
    console.log(`   TX received: ${this.stats.txReceived}`);
    console.log(`   Target TX found: ${this.stats.targetTxFound}`);
    console.log(`   Orders copied: ${this.stats.ordersCopied}`);
    console.log(`   Orders failed: ${this.stats.ordersFailed}`);
    console.log(`   Total spent: $${this.stats.totalSpent.toFixed(2)}`);
    console.log('='.repeat(60) + '\n');
  }
}

// ============================================================================
// MAIN
// ============================================================================

const bot = new MempoolCopyBot();

process.on('SIGINT', () => {
  bot.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  bot.stop();
  process.exit(0);
});

bot.start().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
