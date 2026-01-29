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
  console.log('\n🔍 Test with exact RelayClient body format\n');

  const apiKey = process.env.POLY_API_KEY!;
  const secret = process.env.POLY_SECRET!;
  const passphrase = process.env.POLY_PASSPHRASE!;
  
  // Exact format from RelayClient output
  const bodyObj = {
    from: '0x5Cd6A140fF520ed113D92C830d2BE47Ff036dE9a',
    to: '0xA238CBeb142c10Ef7Ad8442C6D1f9E89e07e7761',
    proxyWallet: '0xeFb18ef08BCd56fD2a4E2fE7C39FBD6344e11a21',
    data: '0x00',
    nonce: '19',
    signature: '0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    signatureParams: {
      gasPrice: '0',
      operation: '0',
      safeTxnGas: '0',
      baseGas: '0',
      gasToken: '0x0000000000000000000000000000000000000000',
      refundReceiver: '0x0000000000000000000000000000000000000000'
    },
    type: 'SAFE',
    metadata: 'Test'
  };
  
  const body = JSON.stringify(bodyObj);
  
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

  console.log('Body length:', body.length);
  console.log('Signature:', signature);
  
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
