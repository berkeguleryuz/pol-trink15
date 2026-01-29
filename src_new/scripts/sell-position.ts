/**
 * SELL POSITION
 *
 * Mevcut pozisyonları sat
 */

import { ethers } from 'ethers';
import { ClobClient, Side, OrderType } from '@polymarket/clob-client';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const GAMMA_API = 'https://gamma-api.polymarket.com';
const CLOB_URL = 'https://clob.polymarket.com';
const CHAIN_ID = 137;
const CTF_ADDRESS = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045';

const ctfAbi = [
  'function balanceOf(address owner, uint256 id) view returns (uint256)'
];

async function main() {
  console.log('\n📉 SELL POSITION\n');

  const privateKey = process.env.PRIVATE_KEY;
  const funderAddress = process.env.FUNDER_ADDRESS;

  if (!privateKey || !funderAddress) {
    console.log('❌ PRIVATE_KEY and FUNDER_ADDRESS required');
    return;
  }

  const provider = new ethers.providers.JsonRpcProvider(process.env.CHAINSTACK_HTTP_URL || 'https://polygon-rpc.com');
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log('Wallet:', wallet.address);
  console.log('Funder:', funderAddress);

  const clobClient = new ClobClient(CLOB_URL, CHAIN_ID, wallet, {
    key: process.env.POLY_API_KEY!,
    secret: process.env.POLY_SECRET!,
    passphrase: process.env.POLY_PASSPHRASE!
  }, 2, funderAddress);

  const ctf = new ethers.Contract(CTF_ADDRESS, ctfAbi, provider);

  // Find recent 15-min markets and check balances
  console.log('\n🔍 Checking positions...\n');

  const now = Date.now();
  const cryptos = ['btc', 'eth', 'sol'];
  const positions: any[] = [];

  // Check last 5 intervals
  for (let i = 0; i <= 5; i++) {
    const interval = Math.floor(now / (15 * 60 * 1000)) * (15 * 60 * 1000) - (i * 15 * 60 * 1000);
    const ts = Math.floor(interval / 1000);

    for (const crypto of cryptos) {
      const slug = `${crypto}-updown-15m-${ts}`;

      try {
        const res = await axios.get(`${GAMMA_API}/markets?slug=${slug}`, { timeout: 5000 });
        if (!res.data?.[0]) continue;

        const market = res.data[0];
        const tokenIds = JSON.parse(market.clobTokenIds || '[]');
        const outcomes = JSON.parse(market.outcomes || '[]');
        const prices = JSON.parse(market.outcomePrices || '[]');

        for (let j = 0; j < tokenIds.length; j++) {
          const balance = await ctf.balanceOf(funderAddress, tokenIds[j]);
          const shares = parseFloat(ethers.utils.formatUnits(balance, 6));

          if (shares > 0.01) {
            positions.push({
              crypto: crypto.toUpperCase(),
              outcome: outcomes[j],
              shares,
              tokenId: tokenIds[j],
              price: parseFloat(prices[j]),
              slug
            });
            console.log(`✅ ${crypto.toUpperCase()} ${outcomes[j]}: ${shares.toFixed(4)} shares @ $${parseFloat(prices[j]).toFixed(3)}`);
          }
        }
      } catch {
        continue;
      }
    }
  }

  if (positions.length === 0) {
    console.log('No positions found');
    return;
  }

  console.log(`\n📦 Found ${positions.length} position(s)\n`);

  if (!process.argv.includes('--execute')) {
    console.log('Run with --execute to sell all positions');
    return;
  }

  // Sell each position
  for (const pos of positions) {
    console.log(`\n📉 Selling ${pos.crypto} ${pos.outcome}...`);
    console.log(`   Shares: ${pos.shares.toFixed(4)}`);
    console.log(`   Token: ${pos.tokenId.slice(0, 30)}...`);

    try {
      const sellOrder = await clobClient.createMarketOrder({
        tokenID: pos.tokenId,
        amount: pos.shares,
        side: Side.SELL
      });

      const response = await clobClient.postOrder(sellOrder, OrderType.FOK);

      console.log(`   ✅ SOLD! Order ID: ${response.orderID}`);
    } catch (error: any) {
      console.log(`   ❌ Failed: ${error.message?.slice(0, 100)}`);
    }
  }

  console.log('\n✅ Done!\n');
}

main().catch(console.error);
