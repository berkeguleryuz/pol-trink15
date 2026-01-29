/**
 * PROXY WALLET CLAIM
 * https://github.com/Polymarket/examples/tree/main/examples/proxyWallet
 */

import { ethers } from 'ethers';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// Constants from Polymarket
const PROXY_WALLET_FACTORY_ADDRESS = '0xaB45c5A4B0c941a2F231C04C3f49182e1A254052';
const CONDITIONAL_TOKENS_FRAMEWORK_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const NEG_RISK_ADAPTER_ADDRESS = '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296';
const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const GAMMA_API = 'https://gamma-api.polymarket.com';

// ABIs
const proxyFactoryAbi = [
  'function proxy((address to, uint8 typeCode, bytes data, uint256 value)[] calls) external payable'
];

const ctfAbi = [
  'function balanceOf(address owner, uint256 id) view returns (uint256)'
];

// Encode functions
function encodeRedeem(collateralAddress: string, conditionId: string): string {
  const iface = new ethers.utils.Interface([
    'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets)'
  ]);
  return iface.encodeFunctionData('redeemPositions', [
    collateralAddress,
    ethers.constants.HashZero,
    conditionId,
    [1, 2]
  ]);
}

function encodeRedeemNegRisk(conditionId: string, amounts: string[]): string {
  const iface = new ethers.utils.Interface([
    'function redeemPositions(bytes32 conditionId, uint256[] amounts)'
  ]);
  return iface.encodeFunctionData('redeemPositions', [conditionId, amounts]);
}

async function main() {
  console.log('\n🔄 PROXY WALLET CLAIM\n');

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.log('❌ PRIVATE_KEY required');
    return;
  }

  const rpcUrl = process.env.CHAINSTACK_HTTP_URL || process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  const funderAddress = process.env.FUNDER_ADDRESS;
  if (!funderAddress) {
    console.log('❌ FUNDER_ADDRESS required');
    return;
  }

  console.log(`Signer: ${wallet.address}`);
  console.log(`Proxy: ${funderAddress}\n`);

  // Contracts
  const factory = new ethers.Contract(PROXY_WALLET_FACTORY_ADDRESS, proxyFactoryAbi, wallet);
  const ctf = new ethers.Contract(CONDITIONAL_TOKENS_FRAMEWORK_ADDRESS, ctfAbi, provider);

  // Check MATIC
  const maticBalance = await provider.getBalance(wallet.address);
  console.log(`MATIC: ${ethers.utils.formatEther(maticBalance)}\n`);

  // Find claimable
  console.log('🔍 Searching...\n');

  const now = Date.now();
  const cryptos = ['btc', 'eth', 'sol', 'xrp'];
  const claimable: any[] = [];

  for (let i = 1; i <= 20; i++) {
    const interval = Math.floor(now / (15 * 60 * 1000)) * (15 * 60 * 1000) - (i * 15 * 60 * 1000);
    const ts = Math.floor(interval / 1000);

    for (const crypto of cryptos) {
      const slug = `${crypto}-updown-15m-${ts}`;

      try {
        const res = await axios.get(`${GAMMA_API}/markets?slug=${slug}`, { timeout: 5000 });
        if (!res.data?.[0]) continue;

        const market = res.data[0];
        // Gamma API "closed" flag geç güncelleniyor, fiyata bak
        const endTime = new Date(market.endDate || market.endDateIso).getTime();
        if (endTime > Date.now()) continue; // Henüz bitmemiş

        const conditionId = market.conditionId;
        const tokenIds = JSON.parse(market.clobTokenIds || '[]');
        const outcomes = JSON.parse(market.outcomes || '[]');
        const prices = JSON.parse(market.outcomePrices || '[]');
        const negRisk = market.negRisk === true;

        // Find winner
        let winnerIndex = -1;
        for (let j = 0; j < prices.length; j++) {
          if (parseFloat(prices[j]) >= 0.95) {
            winnerIndex = j;
            break;
          }
        }

        if (winnerIndex === -1) continue;

        // Check balance on proxy wallet
        const balance = await ctf.balanceOf(funderAddress, tokenIds[winnerIndex]);
        const balanceNum = parseFloat(ethers.utils.formatUnits(balance, 6));

        if (balanceNum > 0.1) {
          console.log(`✅ ${crypto.toUpperCase()} ${outcomes[winnerIndex]}: ${balanceNum.toFixed(2)} shares`);
          console.log(`   negRisk: ${negRisk}, condition: ${conditionId.slice(0, 20)}...`);
          claimable.push({
            crypto: crypto.toUpperCase(),
            conditionId,
            balance: balanceNum,
            outcome: outcomes[winnerIndex],
            negRisk
          });
        }

      } catch {
        continue;
      }
    }
  }

  if (claimable.length === 0) {
    console.log('\nNo claimable positions.');
    return;
  }

  console.log(`\n📦 Found ${claimable.length} claimable\n`);

  if (!process.argv.includes('--claim')) {
    console.log('Run with --claim to execute\n');
    return;
  }

  // Claim each via proxy factory
  for (const item of claimable) {
    console.log(`\n🚀 Claiming ${item.crypto} ${item.outcome}...`);

    try {
      // Encode redeem call
      const data = item.negRisk
        ? encodeRedeemNegRisk(item.conditionId, ['1000000', '1000000']) // 1 USDC worth
        : encodeRedeem(USDC_ADDRESS, item.conditionId);

      const to = item.negRisk ? NEG_RISK_ADAPTER_ADDRESS : CONDITIONAL_TOKENS_FRAMEWORK_ADDRESS;

      const proxyTxn = {
        to: to,
        typeCode: 1,
        data: data,
        value: 0
      };

      console.log(`   Target: ${to.slice(0, 20)}...`);
      console.log(`   negRisk: ${item.negRisk}`);

      const tx = await factory.proxy([proxyTxn], {
        gasPrice: ethers.utils.parseUnits('50', 'gwei'),
        gasLimit: 500000
      });

      console.log(`   TX: ${tx.hash}`);
      await tx.wait();
      console.log(`   ✅ Claimed!`);
    } catch (err: any) {
      console.log(`   ❌ Error: ${err.message?.slice(0, 150)}`);
    }
  }

  console.log('\n✅ Done!\n');
}

main().catch(console.error);
