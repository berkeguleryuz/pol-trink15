/**
 * AUTO CLAIMER
 *
 * - Market resolve olunca otomatik claim
 * - Hem Up hem Down varsa merge
 * - Pozisyon takibi
 */

import { ethers } from 'ethers';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// ============================================================================
// CONTRACT ADDRESSES (Polygon)
// ============================================================================

const CONTRACTS = {
  // Conditional Tokens Framework
  CTF: '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045',
  // USDC Collateral
  USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  // CTF Exchange
  EXCHANGE: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
  // Neg Risk CTF Exchange
  NEG_RISK_EXCHANGE: '0xC5d563A36AE78145C45a50134d48A1215220f80a',
  // Neg Risk Adapter
  NEG_RISK_ADAPTER: '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296'
};

// Conditional Tokens ABI (sadece ihtiyacımız olan fonksiyonlar)
const CTF_ABI = [
  'function balanceOf(address owner, uint256 id) view returns (uint256)',
  'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets) external',
  'function mergePositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] partition, uint256 amount) external',
  'function getConditionId(address oracle, bytes32 questionId, uint256 outcomeSlotCount) pure returns (bytes32)',
  'function payoutNumerators(bytes32 conditionId, uint256 index) view returns (uint256)',
  'function payoutDenominator(bytes32 conditionId) view returns (uint256)'
];

// ============================================================================
// TYPES
// ============================================================================

export interface TrackedPosition {
  tokenId: string;
  conditionId: string;
  outcome: string;       // "Up" or "Down"
  outcomeIndex: number;  // 0 or 1
  shares: number;
  avgPrice: number;
  marketSlug: string;
  marketTitle: string;
  createdAt: number;
  resolved: boolean;
  claimed: boolean;
}

export interface MarketInfo {
  conditionId: string;
  outcomes: string[];
  tokenIds: string[];
  resolved: boolean;
  winningOutcome?: string;
}

// ============================================================================
// AUTO CLAIMER CLASS
// ============================================================================

export class AutoClaimer {
  private provider: ethers.providers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private ctfContract: ethers.Contract;
  private positions: Map<string, TrackedPosition> = new Map(); // tokenId -> position
  private marketCache: Map<string, MarketInfo> = new Map(); // slug -> market info
  private checkInterval: NodeJS.Timeout | null = null;

  constructor() {
    const rpcUrl = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
    const privateKey = process.env.PRIVATE_KEY;

    if (!privateKey) {
      throw new Error('PRIVATE_KEY not set in .env');
    }

    this.provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    this.ctfContract = new ethers.Contract(CONTRACTS.CTF, CTF_ABI, this.wallet);

    console.log(`   🔐 Auto-claimer wallet: ${this.wallet.address}`);
  }

  /**
   * Start periodic checking for resolved markets
   */
  start(intervalMs: number = 60000): void {
    console.log(`   ⏰ Auto-claim check every ${intervalMs / 1000}s`);

    this.checkInterval = setInterval(() => {
      this.checkAndClaim();
    }, intervalMs);

    // Initial check after 10 seconds
    setTimeout(() => this.checkAndClaim(), 10000);
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }

  /**
   * Track a new position
   */
  async addPosition(
    tokenId: string,
    outcome: string,
    shares: number,
    avgPrice: number,
    marketSlug: string,
    marketTitle: string
  ): Promise<void> {
    // Get market info to find conditionId
    const marketInfo = await this.getMarketInfo(marketSlug);

    if (!marketInfo) {
      console.log(`   ⚠️ Could not get market info for ${marketSlug}`);
      return;
    }

    const outcomeIndex = outcome === 'Up' ? 0 : 1;

    const position: TrackedPosition = {
      tokenId,
      conditionId: marketInfo.conditionId,
      outcome,
      outcomeIndex,
      shares,
      avgPrice,
      marketSlug,
      marketTitle,
      createdAt: Date.now(),
      resolved: false,
      claimed: false
    };

    // Update existing or add new
    const existing = this.positions.get(tokenId);
    if (existing) {
      existing.shares += shares;
      existing.avgPrice = (existing.avgPrice + avgPrice) / 2; // Simple average
    } else {
      this.positions.set(tokenId, position);
    }

    console.log(`   📦 Position tracked: ${outcome} ${shares.toFixed(2)} shares @ ${avgPrice.toFixed(2)}`);
  }

  /**
   * Get market info from Polymarket API
   */
  private async getMarketInfo(slug: string): Promise<MarketInfo | null> {
    // Check cache
    if (this.marketCache.has(slug)) {
      return this.marketCache.get(slug)!;
    }

    try {
      const url = `https://gamma-api.polymarket.com/markets?slug=${slug}`;
      const response = await axios.get(url, { timeout: 10000 });

      if (response.data && response.data[0]) {
        const market = response.data[0];
        const outcomes = JSON.parse(market.outcomes || '[]');
        const tokenIds = JSON.parse(market.clobTokenIds || '[]');
        const outcomePrices = JSON.parse(market.outcomePrices || '[]');

        // Check if resolved
        let resolved = market.umaResolutionStatus === 'resolved' || market.closed;
        let winningOutcome: string | undefined;

        if (resolved) {
          for (let i = 0; i < outcomes.length; i++) {
            if (parseFloat(outcomePrices[i]) >= 0.95) {
              winningOutcome = outcomes[i];
              break;
            }
          }
        }

        const info: MarketInfo = {
          conditionId: market.conditionId,
          outcomes,
          tokenIds,
          resolved,
          winningOutcome
        };

        this.marketCache.set(slug, info);
        return info;
      }
    } catch (error) {
      console.error(`   ❌ Failed to get market info: ${error}`);
    }

    return null;
  }

  /**
   * Check positions and claim/merge if needed
   */
  async checkAndClaim(): Promise<void> {
    const positions = Array.from(this.positions.values());
    const unclaimed = positions.filter(p => !p.claimed);

    if (unclaimed.length === 0) return;

    console.log(`\n🔍 Checking ${unclaimed.length} positions for claim/merge...`);

    // Group by market slug
    const byMarket: Map<string, TrackedPosition[]> = new Map();
    for (const pos of unclaimed) {
      const list = byMarket.get(pos.marketSlug) || [];
      list.push(pos);
      byMarket.set(pos.marketSlug, list);
    }

    for (const [slug, marketPositions] of byMarket) {
      // Refresh market info
      this.marketCache.delete(slug); // Clear cache to get fresh data
      const marketInfo = await this.getMarketInfo(slug);

      if (!marketInfo) continue;

      // Check if both Up and Down positions exist (merge opportunity)
      const upPos = marketPositions.find(p => p.outcome === 'Up');
      const downPos = marketPositions.find(p => p.outcome === 'Down');

      if (upPos && downPos) {
        // Can merge
        const mergeAmount = Math.min(upPos.shares, downPos.shares);
        if (mergeAmount > 0.01) {
          await this.mergePositions(marketInfo, mergeAmount, upPos, downPos);
        }
      }

      // Check if resolved and claim
      if (marketInfo.resolved && marketInfo.winningOutcome) {
        for (const pos of marketPositions) {
          if (pos.outcome === marketInfo.winningOutcome && !pos.claimed) {
            await this.claimPosition(pos, marketInfo);
          } else if (pos.outcome !== marketInfo.winningOutcome) {
            // Lost position
            pos.claimed = true;
            pos.resolved = true;
            console.log(`   ❌ Lost: ${pos.outcome} (${pos.shares.toFixed(2)} shares)`);
          }
        }
      }
    }
  }

  /**
   * Merge positions (both Up and Down)
   */
  private async mergePositions(
    marketInfo: MarketInfo,
    amount: number,
    upPos: TrackedPosition,
    downPos: TrackedPosition
  ): Promise<void> {
    console.log(`\n🔄 Merging ${amount.toFixed(2)} shares...`);

    try {
      // Convert to wei (CTF uses 1e18)
      const amountWei = ethers.utils.parseUnits(amount.toFixed(6), 18);

      // Partition for binary market: [1, 2] means outcome 0 and outcome 1
      const partition = [1, 2];

      const tx = await this.ctfContract.mergePositions(
        CONTRACTS.USDC,
        ethers.constants.HashZero, // parentCollectionId (root)
        marketInfo.conditionId,
        partition,
        amountWei,
        { gasLimit: 300000 }
      );

      console.log(`   📤 Merge TX: ${tx.hash}`);
      await tx.wait();
      console.log(`   ✅ Merge successful!`);

      // Update positions
      upPos.shares -= amount;
      downPos.shares -= amount;

      if (upPos.shares <= 0.01) {
        upPos.claimed = true;
      }
      if (downPos.shares <= 0.01) {
        downPos.claimed = true;
      }

    } catch (error) {
      console.error(`   ❌ Merge failed: ${error}`);
    }
  }

  /**
   * Claim a winning position
   */
  private async claimPosition(pos: TrackedPosition, marketInfo: MarketInfo): Promise<void> {
    console.log(`\n💰 Claiming ${pos.outcome} (${pos.shares.toFixed(2)} shares)...`);

    try {
      // Check on-chain balance first
      const balance = await this.ctfContract.balanceOf(this.wallet.address, pos.tokenId);
      const balanceNum = parseFloat(ethers.utils.formatUnits(balance, 18));

      if (balanceNum < 0.01) {
        console.log(`   ⚠️ No balance to claim (${balanceNum})`);
        pos.claimed = true;
        return;
      }

      // IndexSets: [1] for outcome 0, [2] for outcome 1
      const indexSets = [pos.outcomeIndex === 0 ? 1 : 2];

      const tx = await this.ctfContract.redeemPositions(
        CONTRACTS.USDC,
        ethers.constants.HashZero, // parentCollectionId
        marketInfo.conditionId,
        indexSets,
        { gasLimit: 300000 }
      );

      console.log(`   📤 Claim TX: ${tx.hash}`);
      await tx.wait();

      const payout = balanceNum; // 1 share = 1 USDC if won
      console.log(`   ✅ Claimed $${payout.toFixed(2)} USDC!`);

      pos.claimed = true;
      pos.resolved = true;

    } catch (error) {
      console.error(`   ❌ Claim failed: ${error}`);
    }
  }

  /**
   * Get summary of positions
   */
  getSummary(): { total: number; pending: number; claimed: number } {
    const positions = Array.from(this.positions.values());
    return {
      total: positions.length,
      pending: positions.filter(p => !p.claimed).length,
      claimed: positions.filter(p => p.claimed).length
    };
  }
}
