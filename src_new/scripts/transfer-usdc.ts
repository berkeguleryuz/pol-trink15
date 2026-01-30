/**
 * USDC Transfer Script
 *
 * Transfers USDC from PRIVATE_KEY wallet to FUNDER_ADDRESS
 *
 * Usage:
 *   npx ts-node src_new/scripts/transfer-usdc.ts
 *   npx ts-node src_new/scripts/transfer-usdc.ts --amount=5
 */

import { ethers, Wallet, Contract } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

// Polygon Native USDC contract
const USDC_CONTRACT = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const USDC_DECIMALS = 6;

// ERC20 ABI (minimal for transfer)
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

// Polygon RPC endpoints
const RPC_URLS = ["https://polygon-bor-rpc.publicnode.com", process.env.RPC_URL].filter(
  Boolean,
) as string[];

async function getWorkingProvider(): Promise<ethers.providers.JsonRpcProvider> {
  for (const rpc of RPC_URLS) {
    try {
      const provider = new ethers.providers.JsonRpcProvider(rpc);
      await provider.getBlockNumber(); // Test connection
      console.log(`   ✅ Connected to: ${rpc}`);
      return provider;
    } catch {
      console.log(`   ❌ Failed: ${rpc}`);
    }
  }
  throw new Error("All RPC endpoints failed");
}

async function main() {
  console.log("\n" + "=".repeat(50));
  console.log("   USDC TRANSFER SCRIPT");
  console.log("=".repeat(50) + "\n");

  // Load config
  const privateKey = process.env.PRIVATE_KEY;
  const toAddress = process.env.FUNDER_ADDRESS;

  if (!privateKey || !toAddress) {
    console.error("❌ PRIVATE_KEY and FUNDER_ADDRESS must be set in .env");
    process.exit(1);
  }

  // Parse amount from CLI or default to all
  const amountArg = process.argv.find((arg) => arg.startsWith("--amount="));
  const specifiedAmount = amountArg
    ? parseFloat(amountArg.split("=")[1])
    : null;

  // Connect to Polygon
  console.log("🔌 Connecting to Polygon...");
  const provider = await getWorkingProvider();

  // Create wallet
  const wallet = new Wallet(privateKey, provider);
  const fromAddress = await wallet.getAddress();

  console.log(`\n   From: ${fromAddress}`);
  console.log(`   To:   ${toAddress}`);

  // Connect to USDC contract
  const usdc = new Contract(USDC_CONTRACT, ERC20_ABI, wallet);

  // Check balances
  const usdcBalance = await usdc.balanceOf(fromAddress);
  const maticBalance = await provider.getBalance(fromAddress);

  const usdcAmount = parseFloat(
    ethers.utils.formatUnits(usdcBalance, USDC_DECIMALS),
  );
  const maticAmount = parseFloat(ethers.utils.formatEther(maticBalance));

  console.log(`\n   💰 USDC Balance: $${usdcAmount.toFixed(2)}`);
  console.log(`   ⛽ MATIC Balance: ${maticAmount.toFixed(4)} MATIC`);

  if (usdcAmount <= 0) {
    console.log("\n❌ No USDC to transfer");
    process.exit(1);
  }

  if (maticAmount < 0.01) {
    console.log("\n⚠️ Warning: Low MATIC balance for gas fees");
  }

  // Determine transfer amount
  const transferAmount = specifiedAmount
    ? Math.min(specifiedAmount, usdcAmount)
    : usdcAmount;

  const transferAmountWei = ethers.utils.parseUnits(
    transferAmount.toFixed(USDC_DECIMALS),
    USDC_DECIMALS,
  );

  console.log(`\n   📤 Transferring: $${transferAmount.toFixed(2)} USDC`);

  // Get current gas price and nonce
  let gasPrice = await provider.getGasPrice();
  const nonce = await provider.getTransactionCount(fromAddress, "pending");

  // Cap gas price at 500 gwei max
  const maxGasPrice = ethers.utils.parseUnits("700", "gwei");
  if (gasPrice.gt(maxGasPrice)) {
    console.log(
      `   ⚠️ Gas price too high: ${ethers.utils.formatUnits(gasPrice, "gwei")} gwei`,
    );
    console.log(`   📉 Capping at 200 gwei`);
    gasPrice = maxGasPrice;
  }

  console.log(
    `   ⛽ Gas Price: ${ethers.utils.formatUnits(gasPrice, "gwei")} gwei`,
  );
  console.log(`   🔢 Nonce: ${nonce}`);

  // Estimate gas
  const gasLimit = await usdc.estimateGas.transfer(
    toAddress,
    transferAmountWei,
  );
  console.log(`   📊 Gas Limit: ${gasLimit.toString()}`);

  // Confirm
  console.log("\n" + "-".repeat(50));
  console.log("   Press Ctrl+C within 5 seconds to cancel...");
  console.log("-".repeat(50));

  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Execute transfer with explicit nonce
  console.log("\n🚀 Sending transaction...");

  try {
    const tx = await usdc.transfer(toAddress, transferAmountWei, {
      gasLimit: gasLimit.mul(120).div(100), // Add 20% buffer
      gasPrice: gasPrice.mul(110).div(100), // Add 10% for faster confirmation
      nonce: nonce,
    });

    console.log(`   📝 TX Hash: ${tx.hash}`);
    console.log("   ⏳ Waiting for confirmation...");

    const receipt = await tx.wait();

    if (receipt.status === 1) {
      console.log(`\n✅ SUCCESS!`);
      console.log(`   Block: ${receipt.blockNumber}`);
      console.log(`   Gas Used: ${receipt.gasUsed.toString()}`);
      console.log(`   🔗 https://polygonscan.com/tx/${tx.hash}`);
    } else {
      console.log("\n❌ Transaction failed");
    }
  } catch (error: any) {
    console.error("\n❌ Transfer failed:", error.message);

    if (error.message.includes("nonce")) {
      console.log("\n💡 Nonce error - trying with latest nonce...");

      // Retry with fresh nonce
      const freshNonce = await provider.getTransactionCount(
        fromAddress,
        "latest",
      );
      console.log(`   Fresh nonce: ${freshNonce}`);

      const tx = await usdc.transfer(toAddress, transferAmountWei, {
        gasLimit: gasLimit.mul(120).div(100),
        gasPrice: gasPrice.mul(120).div(100),
        nonce: freshNonce,
      });

      console.log(`   📝 TX Hash: ${tx.hash}`);
      const receipt = await tx.wait();

      if (receipt.status === 1) {
        console.log(`\n✅ SUCCESS on retry!`);
        console.log(`   🔗 https://polygonscan.com/tx/${tx.hash}`);
      }
    }
  }

  // Final balance check
  const finalBalance = await usdc.balanceOf(fromAddress);
  console.log(
    `\n   Final USDC Balance: $${ethers.utils.formatUnits(finalBalance, USDC_DECIMALS)}`,
  );
}

main().catch(console.error);
