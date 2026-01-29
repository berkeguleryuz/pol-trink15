/**
 * MANUAL CLAIM SCRIPT
 *
 * Polymarket'te kazanılan pozisyonları manuel claim et
 */

import { ethers } from 'ethers';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const GAMMA_API = 'https://gamma-api.polymarket.com';

// Contract addresses
const CONTRACTS = {
  CTF: '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045',
  USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
};

const CTF_ABI = [
  'function balanceOf(address owner, uint256 id) view returns (uint256)',
  'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets) external',
  'function payoutNumerators(bytes32 conditionId, uint256 index) view returns (uint256)',
  'function payoutDenominator(bytes32 conditionId) view returns (uint256)'
];

const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log(`   ${C.bold}MANUAL CLAIM SCRIPT${C.reset}`);
  console.log('='.repeat(60) + '\n');

  // Setup provider and wallet
  const rpcUrl = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
  const privateKey = process.env.PRIVATE_KEY;

  if (!privateKey) {
    console.log('❌ PRIVATE_KEY not set in .env');
    return;
  }

  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const ctf = new ethers.Contract(CONTRACTS.CTF, CTF_ABI, wallet);

  // Use funder address for balance checks (proxy wallet holds the positions)
  const funderAddress = process.env.FUNDER_ADDRESS || wallet.address;

  console.log(`🔐 Signer: ${wallet.address}`);
  console.log(`💰 Funder (positions): ${funderAddress}\n`);

  // Find recent 15-min markets
  const now = Date.now();
  const cryptos = ['btc', 'eth', 'sol', 'xrp'];

  // Check last 16 intervals (last 4 hours)
  const intervals: number[] = [];
  for (let i = 0; i <= 16; i++) {
    const interval = Math.floor(now / (15 * 60 * 1000)) * (15 * 60 * 1000) - (i * 15 * 60 * 1000);
    intervals.push(Math.floor(interval / 1000));
  }

  console.log('🔍 Checking recent markets for claimable positions...\n');

  for (const crypto of cryptos) {
    for (const ts of intervals) {
      const slug = `${crypto}-updown-15m-${ts}`;

      try {
        const res = await axios.get(`${GAMMA_API}/markets?slug=${slug}`, { timeout: 5000 });

        if (!res.data || res.data.length === 0) continue;

        const market = res.data[0];
        const outcomes = JSON.parse(market.outcomes || '[]');
        const tokenIds = JSON.parse(market.clobTokenIds || '[]');
        const prices = JSON.parse(market.outcomePrices || '[]');

        // Check if resolved
        const isClosed = market.closed === true;
        const endTime = new Date(market.endDate || market.endDateIso);
        const isEnded = endTime.getTime() < now;

        if (!isEnded) continue;

        // Find winning outcome (price = 1 or very high)
        let winningOutcome: string | null = null;
        let winningIndex = -1;

        for (let i = 0; i < outcomes.length; i++) {
          const price = parseFloat(prices[i]);
          if (price >= 0.95) {
            winningOutcome = outcomes[i];
            winningIndex = i;
            break;
          }
        }

        // Check balance for each token
        for (let i = 0; i < tokenIds.length; i++) {
          const tokenId = tokenIds[i];
          const outcome = outcomes[i];

          const balance = await ctf.balanceOf(funderAddress, tokenId);
          const balanceNum = parseFloat(ethers.utils.formatUnits(balance, 6));

          if (balanceNum > 0.01) {
            const isWinner = outcome === winningOutcome;
            const color = isWinner ? C.green : C.red;
            const emoji = isWinner ? '✅' : '❌';

            console.log(`${emoji} ${C.bold}${crypto.toUpperCase()}${C.reset} ${endTime.toLocaleTimeString()}`);
            console.log(`   Outcome: ${color}${outcome}${C.reset} | Balance: ${balanceNum.toFixed(2)} shares`);
            console.log(`   Winner: ${winningOutcome || 'Unknown'} | Closed: ${isClosed}`);
            console.log(`   Token: ${tokenId.slice(0, 20)}...`);
            console.log(`   Condition: ${market.conditionId}`);

            if (isWinner && isClosed) {
              console.log(`   ${C.yellow}→ CLAIMABLE!${C.reset}`);

              // Auto claim if --claim flag
              const shouldClaim = process.argv.includes('--claim');

              if (shouldClaim) {
                console.log('   🔄 Claiming...');

                try {
                  // Get current gas price and add buffer for Polygon
                  const feeData = await provider.getFeeData();
                  const maxFeePerGas = feeData.maxFeePerGas?.mul(2) || ethers.utils.parseUnits('100', 'gwei');
                  const maxPriorityFeePerGas = ethers.utils.parseUnits('50', 'gwei');

                  // Redeem both outcomes [1, 2] - only winners pay out
                  const tx = await ctf.redeemPositions(
                    CONTRACTS.USDC,
                    ethers.constants.HashZero,
                    market.conditionId,
                    [1, 2],  // Both YES and NO
                    {
                      gasLimit: 300000,
                      maxFeePerGas,
                      maxPriorityFeePerGas
                    }
                  );

                  console.log(`   📤 TX: ${tx.hash}`);
                  const receipt = await tx.wait();
                  console.log(`   ${C.green}✅ Claimed! Gas used: ${receipt.gasUsed.toString()}${C.reset}`);
                } catch (err: any) {
                  console.log(`   ${C.red}❌ Error: ${err.message?.slice(0, 200)}${C.reset}`);
                }
              } else {
                console.log(`   ${C.cyan}Run with --claim to auto-claim${C.reset}`);
              }
            }
            console.log('');
          }
        }

      } catch {
        continue;
      }
    }
  }

  console.log('='.repeat(60) + '\n');
}

main().catch(console.error);
