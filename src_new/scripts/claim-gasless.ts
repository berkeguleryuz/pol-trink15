/**
 * GASLESS AUTO-CLAIM
 *
 * Polymarket RelayClient ile gasless claim
 * Docs: https://docs.polymarket.com/developers/market-makers/inventory#payout
 */

import { ethers } from 'ethers';
import { Interface } from 'ethers/lib/utils';
import { RelayClient, RelayerTxType } from '@polymarket/builder-relayer-client';
import { BuilderConfig } from '@polymarket/builder-signing-sdk';
import { ClobClient } from '@polymarket/clob-client';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// Contract addresses (Polygon Mainnet)
const CTF_ADDRESS = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045';
const USDCe_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const RELAYER_URL = 'https://relayer-v2.polymarket.com/';
const CLOB_URL = 'https://clob.polymarket.com';
const GAMMA_API = 'https://gamma-api.polymarket.com';
const CHAIN_ID = 137;

const ctfInterface = new Interface([
  'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint[] indexSets)',
  'function balanceOf(address owner, uint256 id) view returns (uint256)'
]);

async function main() {
  console.log('\n🔄 GASLESS AUTO-CLAIM\n');

  const privateKey = process.env.PRIVATE_KEY;
  const funderAddress = process.env.FUNDER_ADDRESS;

  if (!privateKey || !funderAddress) {
    console.log('❌ PRIVATE_KEY and FUNDER_ADDRESS required');
    return;
  }

  // Setup
  const provider = new ethers.providers.JsonRpcProvider(process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com');
  const wallet = new ethers.Wallet(privateKey, provider);
  const ctfRead = new ethers.Contract(CTF_ADDRESS, ctfInterface, provider);

  console.log(`Signer: ${wallet.address}`);
  console.log(`Funder: ${funderAddress}\n`);

  // Initialize RelayClient with BuilderConfig (Builder API credentials from polymarket.com/settings?tab=builder)
  const apiKey = process.env.POLY_BUILDER_API_KEY || process.env.POLYMARKET_BUILDER_API_KEY;
  const apiSecret = process.env.POLY_BUILDER_SECRET || process.env.POLYMARKET_BUILDER_SECRET;
  const passphrase = process.env.POLY_BUILDER_PASSPHRASE || process.env.POLYMARKET_BUILDER_PASSPHRASE;

  if (!apiKey || !apiSecret || !passphrase) {
    console.log('❌ Builder API keys required in .env');
    console.log('   Get them from: https://polymarket.com/settings?tab=builder');
    console.log('');
    console.log('   POLY_BUILDER_API_KEY=...');
    console.log('   POLY_BUILDER_SECRET=...');
    console.log('   POLY_BUILDER_PASSPHRASE=...');
    return;
  }

  console.log('Using Builder API Key:', apiKey.slice(0, 12) + '...');

  const builderConfig = new BuilderConfig({
    localBuilderCreds: {
      key: apiKey,
      secret: apiSecret,
      passphrase: passphrase
    }
  });

  const relayClient = new RelayClient(
    RELAYER_URL,
    CHAIN_ID,
    wallet,
    builderConfig,
    RelayerTxType.SAFE
  );

  // Initialize CLOB client for checking market resolution
  const clobClient = new ClobClient(CLOB_URL, CHAIN_ID, wallet);

  // Find claimable positions
  console.log('🔍 Searching for claimable positions...\n');

  const now = Date.now();
  const cryptos = ['btc', 'eth', 'sol']; // XRP removed
  const claimableTxs: any[] = [];

  // Check last 20 intervals (5 hours)
  for (let i = 1; i <= 20; i++) {
    const interval = Math.floor(now / (15 * 60 * 1000)) * (15 * 60 * 1000) - (i * 15 * 60 * 1000);
    const ts = Math.floor(interval / 1000);

    for (const crypto of cryptos) {
      const slug = `${crypto}-updown-15m-${ts}`;

      try {
        // Get market info from Gamma
        const gammaRes = await axios.get(`${GAMMA_API}/markets?slug=${slug}`, { timeout: 5000 });
        if (!gammaRes.data?.[0]) continue;

        const market = gammaRes.data[0];
        const conditionId = market.conditionId;
        const outcomes = JSON.parse(market.outcomes || '[]');
        const tokenIds = JSON.parse(market.clobTokenIds || '[]');

        // Check if market is resolved via CLOB API
        let isResolved = false;
        let winnerIndex = -1;

        try {
          const clobMarket = await clobClient.getMarket(conditionId);
          if (clobMarket.closed) {
            isResolved = true;
            const winnerToken = clobMarket.tokens?.find((t: any) => t.winner);
            if (winnerToken) {
              winnerIndex = outcomes.findIndex((o: string) => o.toLowerCase() === winnerToken.outcome?.toLowerCase());
            }
          }
        } catch {
          // Fallback: check Gamma prices
          const prices = JSON.parse(market.outcomePrices || '[]');
          for (let j = 0; j < prices.length; j++) {
            if (parseFloat(prices[j]) >= 0.99) {
              isResolved = true;
              winnerIndex = j;
              break;
            }
          }
        }

        if (!isResolved) continue;

        // Check balance on funder wallet
        for (let j = 0; j < tokenIds.length; j++) {
          const balance = await ctfRead.balanceOf(funderAddress, tokenIds[j]);
          const balanceNum = parseFloat(ethers.utils.formatUnits(balance, 6));

          if (balanceNum > 0.01 && j === winnerIndex) {
            console.log(`✅ ${crypto.toUpperCase()} ${outcomes[j]}: ${balanceNum.toFixed(2)} shares`);
            console.log(`   Condition: ${conditionId.slice(0, 20)}...`);

            // Add redeem transaction
            claimableTxs.push({
              to: CTF_ADDRESS,
              data: ctfInterface.encodeFunctionData('redeemPositions', [
                USDCe_ADDRESS,
                ethers.constants.HashZero,
                conditionId,
                [1, 2] // Both outcomes
              ]),
              value: '0'
            });
          }
        }
      } catch {
        continue;
      }
    }
  }

  if (claimableTxs.length === 0) {
    console.log('No claimable positions found.');
    return;
  }

  console.log(`\n📦 Found ${claimableTxs.length} positions to claim`);

  if (!process.argv.includes('--claim')) {
    console.log('Run with --claim to execute\n');
    return;
  }

  // Execute batch claim via RelayClient (gasless)
  console.log('\n🚀 Executing gasless claim...');

  try {
    const response = await relayClient.execute(claimableTxs, 'Batch claim winning positions');
    console.log('📤 Submitted to relayer');

    if (response.wait) {
      const result = await response.wait();
      console.log(`✅ Claimed! TX: ${result?.transactionHash}`);
    } else {
      console.log('✅ Submitted! Check portfolio for confirmation.');
    }
  } catch (err: any) {
    console.log(`❌ Error: ${err.message?.slice(0, 200)}`);
  }

  console.log('');
}

main().catch(console.error);
