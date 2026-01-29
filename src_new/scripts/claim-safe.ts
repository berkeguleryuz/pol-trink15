/**
 * SAFE WALLET CLAIM
 * Polymarket examples'dan: https://github.com/Polymarket/examples
 */

import { ethers, BigNumber, Contract, Wallet } from "ethers";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

// Constants
const CTF_ADDRESS = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";
const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const NEG_RISK_ADAPTER = "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296";
const GAMMA_API = "https://gamma-api.polymarket.com";

// Safe ABI (minimal)
const safeAbi = [
  "function nonce() view returns (uint256)",
  "function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)",
];

const ctfAbi = [
  "function balanceOf(address owner, uint256 id) view returns (uint256)",
];

// Types
enum OperationType {
  Call = 0,
  DelegateCall = 1,
}

interface SafeTransaction {
  to: string;
  value: string;
  data: string;
  operation: OperationType;
}

// Helper functions from Polymarket examples
function joinHexData(hexData: string[]): string {
  return `0x${hexData
    .map((hex) => {
      const stripped = hex.replace(/^0x/, "");
      return stripped.length % 2 === 0 ? stripped : "0" + stripped;
    })
    .join("")}`;
}

function abiEncodePacked(...params: { type: string; value: any }[]): string {
  return joinHexData(
    params.map(({ type, value }) => {
      const encoded = ethers.utils.defaultAbiCoder.encode([type], [value]);

      if (type === "bytes" || type === "string") {
        const bytesLength = parseInt(encoded.slice(66, 130), 16);
        return encoded.slice(130, 130 + 2 * bytesLength);
      }

      let typeMatch = type.match(/^(?:u?int\d*|bytes\d+|address)\[\]$/);
      if (typeMatch) {
        return encoded.slice(130);
      }

      if (type.startsWith("bytes")) {
        const bytesLength = parseInt(type.slice(5));
        return encoded.slice(2, 2 + 2 * bytesLength);
      }

      typeMatch = type.match(/^u?int(\d*)$/);
      if (typeMatch) {
        if (typeMatch[1] !== "") {
          const bytesLength = parseInt(typeMatch[1]) / 8;
          return encoded.slice(-2 * bytesLength);
        }
        return encoded.slice(-64);
      }

      if (type === "address") {
        return encoded.slice(-40);
      }

      throw new Error(`unsupported type ${type}`);
    }),
  );
}

async function signTransactionHash(signer: Wallet, message: string) {
  const messageArray = ethers.utils.arrayify(message);
  let sig = await signer.signMessage(messageArray);
  let sigV = parseInt(sig.slice(-2), 16);

  switch (sigV) {
    case 0:
    case 1:
      sigV += 31;
      break;
    case 27:
    case 28:
      sigV += 4;
      break;
    default:
      throw new Error("Invalid signature");
  }

  sig = sig.slice(0, -2) + sigV.toString(16);

  return {
    r: BigNumber.from("0x" + sig.slice(2, 66)).toString(),
    s: BigNumber.from("0x" + sig.slice(66, 130)).toString(),
    v: BigNumber.from("0x" + sig.slice(130, 132)).toString(),
  };
}

async function signAndExecuteSafeTransaction(
  signer: Wallet,
  safe: Contract,
  txn: SafeTransaction,
  overrides?: ethers.Overrides,
) {
  if (!overrides) overrides = {};

  const nonce = await safe.nonce();
  const safeTxGas = "0";
  const baseGas = "0";
  const gasPrice = "0";
  const gasToken = ethers.constants.AddressZero;
  const refundReceiver = ethers.constants.AddressZero;

  const txHash = await safe.getTransactionHash(
    txn.to,
    txn.value,
    txn.data,
    txn.operation,
    safeTxGas,
    baseGas,
    gasPrice,
    gasToken,
    refundReceiver,
    nonce,
  );

  const rsvSignature = await signTransactionHash(signer, txHash);
  const packedSig = abiEncodePacked(
    { type: "uint256", value: rsvSignature.r },
    { type: "uint256", value: rsvSignature.s },
    { type: "uint8", value: rsvSignature.v },
  );

  return safe.execTransaction(
    txn.to,
    txn.value,
    txn.data,
    txn.operation,
    safeTxGas,
    baseGas,
    gasPrice,
    gasToken,
    refundReceiver,
    packedSig,
    overrides,
  );
}

// Encode functions
function encodeRedeem(collateralAddress: string, conditionId: string): string {
  const iface = new ethers.utils.Interface([
    "function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets)",
  ]);
  return iface.encodeFunctionData("redeemPositions", [
    collateralAddress,
    ethers.constants.HashZero,
    conditionId,
    [1, 2],
  ]);
}

function encodeRedeemNegRisk(conditionId: string, amounts: string[]): string {
  const iface = new ethers.utils.Interface([
    "function redeemPositions(bytes32 conditionId, uint256[] amounts)",
  ]);
  return iface.encodeFunctionData("redeemPositions", [conditionId, amounts]);
}

async function main() {
  console.log("\n🔐 SAFE WALLET CLAIM\n");

  const privateKey = process.env.PRIVATE_KEY;
  const safeAddress = process.env.FUNDER_ADDRESS;

  if (!privateKey || !safeAddress) {
    console.log("❌ PRIVATE_KEY and FUNDER_ADDRESS required");
    return;
  }

  const rpcUrl =
    process.env.CHAINSTACK_HTTP_URL ||
    process.env.POLYGON_RPC_URL ||
    "https://polygon-rpc.com";
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log(`Signer: ${wallet.address}`);
  console.log(`Safe: ${safeAddress}\n`);

  // Check MATIC balance
  const maticBalance = await provider.getBalance(wallet.address);
  console.log(`MATIC: ${ethers.utils.formatEther(maticBalance)}\n`);

  if (maticBalance.lt(ethers.utils.parseEther("0.01"))) {
    console.log("❌ Need MATIC for gas!");
    return;
  }

  // Contracts
  const safe = new ethers.Contract(safeAddress, safeAbi, wallet);
  const ctf = new ethers.Contract(CTF_ADDRESS, ctfAbi, provider);

  // Find claimable
  console.log("🔍 Searching...\n");

  const now = Date.now();
  const cryptos = ["btc", "eth", "sol"]; // XRP removed
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
        const endTime = new Date(market.endDate || market.endDateIso).getTime();
        if (endTime > now) continue; // Not ended yet

        const conditionId = market.conditionId;
        const tokenIds = JSON.parse(market.clobTokenIds || "[]");
        const outcomes = JSON.parse(market.outcomes || "[]");
        const prices = JSON.parse(market.outcomePrices || "[]");
        const negRisk = market.negRisk === true;

        // Find winner (price >= 0.95)
        let winnerIndex = -1;
        for (let j = 0; j < prices.length; j++) {
          if (parseFloat(prices[j]) >= 0.95) {
            winnerIndex = j;
            break;
          }
        }

        if (winnerIndex === -1) continue;

        // Check balance on Safe wallet
        const balance = await ctf.balanceOf(safeAddress, tokenIds[winnerIndex]);
        const balanceNum = parseFloat(ethers.utils.formatUnits(balance, 6));

        if (balanceNum > 0.1) {
          console.log(
            `✅ ${crypto.toUpperCase()} ${outcomes[winnerIndex]}: ${balanceNum.toFixed(2)} shares`,
          );
          console.log(
            `   negRisk: ${negRisk}, condition: ${conditionId.slice(0, 20)}...`,
          );
          claimable.push({
            crypto: crypto.toUpperCase(),
            conditionId,
            balance: balanceNum,
            outcome: outcomes[winnerIndex],
            negRisk,
          });
        }
      } catch {
        continue;
      }
    }
  }

  if (claimable.length === 0) {
    console.log("\nNo claimable positions found.");
    return;
  }

  console.log(`\n📦 Found ${claimable.length} claimable\n`);

  if (!process.argv.includes("--claim")) {
    console.log("Run with --claim to execute\n");
    return;
  }

  // Claim each via Safe
  for (const item of claimable) {
    console.log(`\n🚀 Claiming ${item.crypto} ${item.outcome}...`);

    try {
      const data = item.negRisk
        ? encodeRedeemNegRisk(item.conditionId, ["1000000000", "1000000000"])
        : encodeRedeem(USDC_ADDRESS, item.conditionId);

      const to = item.negRisk ? NEG_RISK_ADAPTER : CTF_ADDRESS;

      const safeTxn: SafeTransaction = {
        to: to,
        value: "0",
        data: data,
        operation: OperationType.Call,
      };

      console.log(`   Target: ${to.slice(0, 20)}...`);

      const tx = await signAndExecuteSafeTransaction(wallet, safe, safeTxn, {
        gasLimit: 250000,
        maxFeePerGas: ethers.utils.parseUnits("1000", "gwei"),
        maxPriorityFeePerGas: ethers.utils.parseUnits("750", "gwei"),
      });

      console.log(`   TX: ${tx.hash}`);
      await tx.wait();
      console.log(`   ✅ Claimed!`);
    } catch (err: any) {
      console.log(`   ❌ Error: ${err.message?.slice(0, 150)}`);
    }
  }

  console.log("\n✅ Done!\n");
}

main().catch(console.error);
