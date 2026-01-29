/**
 * Test 1: Connection Test
 * 
 * This script tests:
 * - Configuration loading
 * - Wallet initialization
 * - API credential creation
 * - CLOB client connection
 */

import { PolymarketClient } from '../src/client';
import { logger } from '../src/utils/logger';

async function main() {
  try {
    logger.section('POLYMARKET CONNECTION TEST');
    
    console.log('📝 This test will:');
    console.log('   1. Load configuration from .env file');
    console.log('   2. Initialize wallet from private key');
    console.log('   3. Create/derive API credentials');
    console.log('   4. Connect to Polymarket CLOB API\n');
    
    // Create and initialize client
    const client = await PolymarketClient.create();
    
    // Get wallet address
    const address = await client.getAddress();
    
    // Display results
    console.log('\n' + '='.repeat(60));
    console.log('✅ CONNECTION SUCCESSFUL!');
    console.log('='.repeat(60));
    console.log(`Wallet Address:  ${address}`);
    console.log(`Network:         Polygon (Chain ID: 137)`);
    console.log(`Signature Type:  2 (MetaMask/Browser Wallet)`);
    console.log(`API Status:      Connected`);
    console.log('='.repeat(60));
    
    console.log('\n✅ Test passed! You can now proceed to balance check.');
    console.log('   Run: npm run test:balance\n');
    
  } catch (error: any) {
    logger.section('❌ CONNECTION FAILED');
    
    console.log('\n🔍 Common issues:\n');
    
    if (error.message?.includes('PRIVATE_KEY')) {
      console.log('❌ Missing PRIVATE_KEY in .env file');
      console.log('   Solution:');
      console.log('   1. Copy .env.example to .env');
      console.log('   2. Add your MetaMask private key');
      console.log('   3. Export from MetaMask: Account Details > Export Private Key\n');
    } else if (error.message?.includes('Invalid private key')) {
      console.log('❌ Invalid private key format');
      console.log('   Solution:');
      console.log('   1. Check PRIVATE_KEY in .env');
      console.log('   2. Should be 64 characters (without 0x prefix)');
      console.log('   3. Remove any spaces or special characters\n');
    } else if (error.message?.includes('network')) {
      console.log('❌ Network connection error');
      console.log('   Solution:');
      console.log('   1. Check your internet connection');
      console.log('   2. Make sure Polymarket API is accessible');
      console.log('   3. Try again in a few seconds\n');
    } else {
      console.log('❌ Unexpected error occurred');
      console.log('   Error:', error.message);
      console.log('\n   Please check:');
      console.log('   - .env file exists and is properly configured');
      console.log('   - All required dependencies are installed (npm install)');
      console.log('   - Your network connection is working\n');
    }
    
    process.exit(1);
  }
}

main();
