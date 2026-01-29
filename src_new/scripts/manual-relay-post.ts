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
  console.log('\n🔍 Manual POST Relay Test\n');

  const apiKey = process.env.POLY_API_KEY!;
  const secret = process.env.POLY_SECRET!;
  const passphrase = process.env.POLY_PASSPHRASE!;
  
  // Simple test body
  const body = JSON.stringify({ test: 'data' });
  
  const method = 'POST';
  const path = '/execute';
  const timestamp = Math.floor(Date.now() / 1000);
  
  const signature = buildHmacSignature(secret, timestamp, method, path, body);
  
  const headers = {
    'POLY_BUILDER_API_KEY': apiKey,
    'POLY_BUILDER_PASSPHRASE': passphrase,
    'POLY_BUILDER_SIGNATURE': signature,
    'POLY_BUILDER_TIMESTAMP': String(timestamp),
    'Content-Type': 'application/json'
  };

  console.log('Body:', body);
  console.log('Signature input:', timestamp + method + path + body);
  
  const url = 'https://relayer-v2.polymarket.com/execute';
  
  try {
    const res = await axios.post(url, body, { headers });
    console.log('\n✅ Response:', res.data);
  } catch (err: any) {
    console.log('\n❌ Error:', err.response?.status, err.response?.data);
  }
}

main();
