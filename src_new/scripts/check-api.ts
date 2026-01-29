import { ClobClient } from '@polymarket/clob-client';
import { ethers } from 'ethers';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!);
  console.log('Signer address:', wallet.address);
  console.log('Funder address:', process.env.FUNDER_ADDRESS);
  
  const client = new ClobClient('https://clob.polymarket.com', 137, wallet, {
    key: process.env.POLY_API_KEY!,
    secret: process.env.POLY_SECRET!,
    passphrase: process.env.POLY_PASSPHRASE!
  });
  
  try {
    const apiKeys = await client.getApiKeys();
    console.log('\nAPI Keys:', JSON.stringify(apiKeys, null, 2));
  } catch (e: any) {
    console.log('Error:', e.message?.slice(0, 200));
  }
}

main();
