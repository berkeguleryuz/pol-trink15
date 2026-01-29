/**
 * Derive Polymarket API credentials
 * Run once, save to .env
 */

import { ClobClient } from '@polymarket/clob-client';
import { ethers } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const privateKey = process.env.PRIVATE_KEY;

  if (!privateKey) {
    console.log('❌ PRIVATE_KEY required');
    return;
  }

  const wallet = new ethers.Wallet(privateKey);

  console.log('\n🔑 Deriving API credentials...\n');
  console.log(`Wallet: ${wallet.address}\n`);

  const client = new ClobClient(
    'https://clob.polymarket.com',
    137,
    wallet
  );

  try {
    const creds = await client.deriveApiKey();

    console.log('✅ API Credentials derived!\n');
    console.log('Add these to your .env file:\n');
    console.log('─'.repeat(50));
    console.log(`POLY_API_KEY=${creds.key}`);
    console.log(`POLY_SECRET=${creds.secret}`);
    console.log(`POLY_PASSPHRASE=${creds.passphrase}`);
    console.log('─'.repeat(50));
    console.log('');
  } catch (err: any) {
    console.log(`❌ Error: ${err.message}`);
  }
}

main().catch(console.error);
