/**
 * APPROVE CTF TOKENS FOR SELLING
 *
 * CTF token'larını CLOB Exchange'e approve et
 * Bu olmadan SELL order verilemez
 */

import { ethers } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();

// Polymarket Contracts
const CTF_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const CTF_EXCHANGE = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E'; // CLOB Exchange
const NEG_RISK_CTF_EXCHANGE = '0xC5d563A36AE78145C45a50134d48A1215220f80a';

const ctfAbi = [
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function setApprovalForAll(address operator, bool approved) external'
];

async function main() {
  console.log('\n🔐 APPROVE CTF FOR SELLING\n');

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.log('❌ PRIVATE_KEY required');
    return;
  }

  const rpcUrl = process.env.CHAINSTACK_HTTP_URL || process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  // Funder (proxy) address - pozisyonların bulunduğu yer
  const funderAddress = process.env.FUNDER_ADDRESS || wallet.address;

  console.log(`Signer: ${wallet.address}`);
  console.log(`Funder: ${funderAddress}\n`);

  const ctf = new ethers.Contract(CTF_ADDRESS, ctfAbi, wallet);

  // Check current approval status
  console.log('📋 Checking approvals...\n');

  const isApprovedExchange = await ctf.isApprovedForAll(funderAddress, CTF_EXCHANGE);
  const isApprovedNegRisk = await ctf.isApprovedForAll(funderAddress, NEG_RISK_CTF_EXCHANGE);

  console.log(`CTF Exchange: ${isApprovedExchange ? '✅ Approved' : '❌ Not approved'}`);
  console.log(`Neg Risk Exchange: ${isApprovedNegRisk ? '✅ Approved' : '❌ Not approved'}\n`);

  if (isApprovedExchange && isApprovedNegRisk) {
    console.log('✅ All approvals in place!\n');
    return;
  }

  if (!process.argv.includes('--approve')) {
    console.log('Run with --approve to set approvals\n');
    return;
  }

  // Note: If funder is a proxy/safe wallet, this direct call won't work
  // Need to use RelayClient or proxy factory

  if (funderAddress.toLowerCase() !== wallet.address.toLowerCase()) {
    console.log('⚠️  Funder is different from signer!');
    console.log('   Direct approve won\'t work - need to use proxy/safe transaction');
    console.log('   Approvals should be done via Polymarket UI or RelayClient\n');
    return;
  }

  // Approve CTF Exchange
  if (!isApprovedExchange) {
    console.log('🔄 Approving CTF Exchange...');
    try {
      const tx = await ctf.setApprovalForAll(CTF_EXCHANGE, true, {
        gasLimit: 100000,
        maxFeePerGas: ethers.utils.parseUnits('50', 'gwei'),
        maxPriorityFeePerGas: ethers.utils.parseUnits('30', 'gwei')
      });
      console.log(`   TX: ${tx.hash}`);
      await tx.wait();
      console.log('   ✅ Approved!\n');
    } catch (err: any) {
      console.log(`   ❌ Error: ${err.message?.slice(0, 100)}\n`);
    }
  }

  // Approve Neg Risk Exchange
  if (!isApprovedNegRisk) {
    console.log('🔄 Approving Neg Risk Exchange...');
    try {
      const tx = await ctf.setApprovalForAll(NEG_RISK_CTF_EXCHANGE, true, {
        gasLimit: 100000,
        maxFeePerGas: ethers.utils.parseUnits('50', 'gwei'),
        maxPriorityFeePerGas: ethers.utils.parseUnits('30', 'gwei')
      });
      console.log(`   TX: ${tx.hash}`);
      await tx.wait();
      console.log('   ✅ Approved!\n');
    } catch (err: any) {
      console.log(`   ❌ Error: ${err.message?.slice(0, 100)}\n`);
    }
  }

  console.log('✅ Done!\n');
}

main().catch(console.error);
