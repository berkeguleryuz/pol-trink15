import { ethers } from 'ethers';
import crypto from 'crypto';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

function buildHmacSignature(secret: string, timestamp: number, method: string, requestPath: string, body?: string): string {
  let message = timestamp + method + requestPath;
  if (body) message += body;
  
  const base64Secret = Buffer.from(secret, 'base64');
  const hmac = crypto.createHmac('sha256', base64Secret);
  const sig = hmac.update(message).digest('base64');
  return sig.replace(/\+/g, '-').replace(/\//g, '_');
}

async function main() {
  console.log('\n🔍 Test /submit endpoint\n');

  const apiKey = process.env.POLY_API_KEY!;
  const secret = process.env.POLY_SECRET!;
  const passphrase = process.env.POLY_PASSPHRASE!;
  
  // Minimal valid-looking body
  const body = JSON.stringify({
    from: '0x5Cd6A140fF520ed113D92C830d2BE47Ff036dE9a',
    to: '0x4d97dcd97ec945f40cf65f87097ace5ea0476045',
    data: '0x00',
    type: 'SAFE'
  });
  
  const method = 'POST';
  const path = '/submit';
  const timestamp = Math.floor(Date.now() / 1000);
  
  const signature = buildHmacSignature(secret, timestamp, method, path, body);
  
  const headers = {
    'POLY_BUILDER_API_KEY': apiKey,
    'POLY_BUILDER_PASSPHRASE': passphrase,
    'POLY_BUILDER_SIGNATURE': signature,
    'POLY_BUILDER_TIMESTAMP': String(timestamp),
    'Content-Type': 'application/json'
  };

  console.log('Testing auth on /submit...');
  
  const url = 'https://relayer-v2.polymarket.com/submit';
  
  try {
    const res = await axios.post(url, body, { headers });
    console.log('\n✅ Response:', res.data);
  } catch (err: any) {
    console.log('\nStatus:', err.response?.status);
    console.log('Data:', JSON.stringify(err.response?.data));
  }
}

main();
