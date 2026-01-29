import { ethers } from 'ethers';
import { Interface } from 'ethers/lib/utils';
import { RelayClient, RelayerTxType } from '@polymarket/builder-relayer-client';
import { BuilderConfig } from '@polymarket/builder-signing-sdk';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const CTF_ADDRESS = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045';
const USDCe_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const GAMMA_API = 'https://gamma-api.polymarket.com';

const ctfInterface = new Interface([
  'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint[] indexSets)',
  'function balanceOf(address owner, uint256 id) view returns (uint256)'
]);

async function main() {
  console.log('\n🔄 GASLESS CLAIM DEBUG\n');

  const provider = new ethers.providers.JsonRpcProvider(process.env.CHAINSTACK_HTTP_URL || 'https://polygon-rpc.com');
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
  const funderAddress = process.env.FUNDER_ADDRESS!;
  const ctfRead = new ethers.Contract(CTF_ADDRESS, ctfInterface, provider);

  console.log('Signer:', wallet.address);
  console.log('Safe:', funderAddress);

  const builderConfig = new BuilderConfig({
    localBuilderCreds: {
      key: process.env.POLY_API_KEY!,
      secret: process.env.POLY_SECRET!,
      passphrase: process.env.POLY_PASSPHRASE!
    }
  });

  const relayClient = new RelayClient(
    'https://relayer-v2.polymarket.com/',
    137,
    wallet,
    builderConfig,
    RelayerTxType.SAFE
  );

  // Find one claimable position
  console.log('\n🔍 Finding claimable...\n');

  const now = Date.now();
  const cryptos = ['btc', 'eth', 'sol'];
  let testTx: any = null;
  let foundCrypto = '';
  let foundOutcome = '';

  for (let i = 1; i <= 10 && !testTx; i++) {
    const interval = Math.floor(now / (15 * 60 * 1000)) * (15 * 60 * 1000) - (i * 15 * 60 * 1000);
    const ts = Math.floor(interval / 1000);

    for (const crypto of cryptos) {
      const slug = crypto + '-updown-15m-' + ts;
      try {
        const res = await axios.get(GAMMA_API + '/markets?slug=' + slug, { timeout: 5000 });
        if (!res.data?.[0]) continue;

        const market = res.data[0];
        const endTime = new Date(market.endDate || market.endDateIso).getTime();
        if (endTime > now) continue;

        const conditionId = market.conditionId;
        const tokenIds = JSON.parse(market.clobTokenIds || '[]');
        const outcomes = JSON.parse(market.outcomes || '[]');
        const prices = JSON.parse(market.outcomePrices || '[]');

        let winnerIndex = -1;
        for (let j = 0; j < prices.length; j++) {
          if (parseFloat(prices[j]) >= 0.95) {
            winnerIndex = j;
            break;
          }
        }

        if (winnerIndex === -1) continue;

        const balance = await ctfRead.balanceOf(funderAddress, tokenIds[winnerIndex]);
        const balanceNum = parseFloat(ethers.utils.formatUnits(balance, 6));

        if (balanceNum > 0.01) {
          foundCrypto = crypto.toUpperCase();
          foundOutcome = outcomes[winnerIndex];
          console.log('Found: ' + foundCrypto + ' ' + foundOutcome + ': ' + balanceNum.toFixed(2) + ' shares');
          testTx = {
            to: CTF_ADDRESS,
            data: ctfInterface.encodeFunctionData('redeemPositions', [
              USDCe_ADDRESS,
              ethers.constants.HashZero,
              conditionId,
              [1, 2]
            ]),
            value: '0'
          };
          break;
        }
      } catch {}
    }
  }

  if (!testTx) {
    console.log('No claimable found');
    return;
  }

  console.log('\n🚀 Executing via RelayClient...');
  console.log('TX to:', testTx.to);

  try {
    const response = await relayClient.execute([testTx], 'Test claim');
    console.log('\n✅ Response:', JSON.stringify(response, null, 2));

    if (response.wait) {
      console.log('\nWaiting for confirmation...');
      const result = await response.wait();
      console.log('Result:', result);
    }
  } catch (err: any) {
    console.log('\n❌ Error:', err.message);
    if (err.response) {
      console.log('Response data:', err.response.data);
    }
  }
}

main().catch(console.error);
