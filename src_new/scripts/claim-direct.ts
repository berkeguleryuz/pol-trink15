/**
 * DIRECT CLAIM - Polymarket Official Example
 * https://github.com/Polymarket/conditional-token-examples
 */

import { ethers } from "ethers";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const CTF_ADDRESS = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";
const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const GAMMA_API = "https://gamma-api.polymarket.com";

const ctfAbi = [
  "function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets) external",
  "function balanceOf(address owner, uint256 id) view returns (uint256)",
];

async function main() {
  console.log("\n🔄 DIRECT CLAIM\n");

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.log("❌ PRIVATE_KEY required");
    return;
  }

  const rpcUrl = process.env.POLYGON_RPC_URL || "https://polygon-rpc.com";
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const ctf = new ethers.Contract(CTF_ADDRESS, ctfAbi, wallet);

  // Check both signer and funder for balances
  const funderAddress = process.env.FUNDER_ADDRESS || wallet.address;

  console.log(`Signer: ${wallet.address}`);
  console.log(`Funder: ${funderAddress}\n`);

  // Check MATIC balance for gas
  const maticBalance = await provider.getBalance(wallet.address);
  console.log(`MATIC: ${ethers.utils.formatEther(maticBalance)}\n`);

  if (maticBalance.lt(ethers.utils.parseEther("0.01"))) {
    console.log("❌ Need MATIC for gas!");
    return;
  }

  // Find claimable positions
  console.log("🔍 Searching...\n");

  const now = Date.now();
  const cryptos = ["btc", "eth", "sol", "xrp"];
  const claimable: any[] = [];

  for (let i = 1; i <= 20; i++) {
    const interval =
      Math.floor(now / (15 * 60 * 1000)) * (15 * 60 * 1000) -
      i * 15 * 60 * 1000;
    const ts = Math.floor(interval / 1000);

    for (const crypto of cryptos) {
      const slug = `${crypto}-updown-15m-${ts}`;

      try {
        const res = await axios.get(`${GAMMA_API}/markets?slug=${slug}`, {
          timeout: 5000,
        });
        if (!res.data?.[0]) continue;

        const market = res.data[0];
        if (!market.closed) continue;

        const conditionId = market.conditionId;
        const tokenIds = JSON.parse(market.clobTokenIds || "[]");
        const outcomes = JSON.parse(market.outcomes || "[]");
        const prices = JSON.parse(market.outcomePrices || "[]");

        // Find winner
        let winnerIndex = -1;
        for (let j = 0; j < prices.length; j++) {
          if (parseFloat(prices[j]) >= 0.95) {
            winnerIndex = j;
            break;
          }
        }

        if (winnerIndex === -1) continue;

        // Check balance on SIGNER (not funder)
        const balance = await ctf.balanceOf(
          wallet.address,
          tokenIds[winnerIndex],
        );
        const balanceNum = parseFloat(ethers.utils.formatUnits(balance, 6));

        if (balanceNum > 0.1) {
          console.log(
            `✅ ${crypto.toUpperCase()} ${outcomes[winnerIndex]}: ${balanceNum.toFixed(2)} shares (SIGNER)`,
          );
          claimable.push({
            crypto: crypto.toUpperCase(),
            conditionId,
            balance: balanceNum,
            outcome: outcomes[winnerIndex],
          });
        }

        // Also check funder
        if (funderAddress !== wallet.address) {
          const funderBalance = await ctf.balanceOf(
            funderAddress,
            tokenIds[winnerIndex],
          );
          const funderBalanceNum = parseFloat(
            ethers.utils.formatUnits(funderBalance, 6),
          );

          if (funderBalanceNum > 0.1) {
            console.log(
              `📦 ${crypto.toUpperCase()} ${outcomes[winnerIndex]}: ${funderBalanceNum.toFixed(2)} shares (FUNDER - need relay)`,
            );
          }
        }
      } catch {
        continue;
      }
    }
  }

  if (claimable.length === 0) {
    console.log("\nNo claimable on SIGNER wallet.");
    console.log("If positions are on FUNDER, need RelayClient with API creds.");
    return;
  }

  console.log(`\n📦 Found ${claimable.length} claimable on SIGNER\n`);

  if (!process.argv.includes("--claim")) {
    console.log("Run with --claim to execute\n");
    return;
  }

  // Claim each
  for (const item of claimable) {
    console.log(`\n🚀 Claiming ${item.crypto} ${item.outcome}...`);

    try {
      const tx = await ctf.redeemPositions(
        USDC_ADDRESS,
        ethers.constants.HashZero,
        item.conditionId,
        [1, 2], // Both outcomes
        {
          gasLimit: 300000,
          maxFeePerGas: ethers.utils.parseUnits("1000", "gwei"),
          maxPriorityFeePerGas: ethers.utils.parseUnits("750", "gwei"),
        },
      );

      console.log(`   TX: ${tx.hash}`);
      await tx.wait();
      console.log(`   ✅ Claimed!`);
    } catch (err: any) {
      console.log(`   ❌ Error: ${err.message?.slice(0, 100)}`);
    }
  }

  console.log("\n✅ Done!\n");
}

main().catch(console.error);
