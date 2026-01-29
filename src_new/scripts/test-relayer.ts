import { ethers } from 'ethers';
import { RelayClient, RelayerTxType } from '@polymarket/builder-relayer-client';
import { BuilderConfig } from '@polymarket/builder-signing-sdk';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  console.log('\n🔍 Testing RelayClient Authentication\n');

  const provider = new ethers.providers.JsonRpcProvider(process.env.CHAINSTACK_HTTP_URL || 'https://polygon-rpc.com');
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
  const funderAddress = process.env.FUNDER_ADDRESS!;
  
  console.log('Signer:', wallet.address);
  console.log('Safe:', funderAddress);
  console.log('API Key:', process.env.POLY_API_KEY?.slice(0, 20) + '...');

  const builderConfig = new BuilderConfig({
    localBuilderCreds: {
      key: process.env.POLY_API_KEY!,
      secret: process.env.POLY_SECRET!,
      passphrase: process.env.POLY_PASSPHRASE!
    }
  });

  console.log('\nBuilderConfig valid:', builderConfig.isValid());

  const relayClient = new RelayClient(
    'https://relayer-v2.polymarket.com/',
    137,
    wallet,
    builderConfig,
    RelayerTxType.SAFE
  );

  // Test 1: Get nonce
  try {
    console.log('\n1. Testing getNonce...');
    const nonce = await relayClient.getNonce(funderAddress, 'SAFE');
    console.log('   Nonce:', nonce);
  } catch (e: any) {
    console.log('   Error:', e.message?.slice(0, 150));
  }

  // Test 2: Get relay payload  
  try {
    console.log('\n2. Testing getRelayPayload...');
    const payload = await relayClient.getRelayPayload(funderAddress, 'SAFE');
    console.log('   Payload:', JSON.stringify(payload).slice(0, 150));
  } catch (e: any) {
    console.log('   Error:', e.message?.slice(0, 150));
  }

  // Test 3: Check if safe is deployed
  try {
    console.log('\n3. Testing getDeployed...');
    const deployed = await relayClient.getDeployed(funderAddress);
    console.log('   Deployed:', deployed);
  } catch (e: any) {
    console.log('   Error:', e.message?.slice(0, 150));
  }
}

main().catch(console.error);
