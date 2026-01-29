import { PolymarketClient } from '../client';
import { logger } from '../utils/logger';

// AssetType enum from @polymarket/clob-client
export enum AssetType {
  COLLATERAL = 'COLLATERAL',
  CONDITIONAL = 'CONDITIONAL',
}

export interface Balance {
  usdc: string;
  allowance: string;
  address: string;
}

export interface OpenOrder {
  id: string;
  market: string;
  asset_id: string;
  price: string;
  size: string;
  side: string;
  type: string;
  created_at: string;
}

/**
 * Get USDC balance and allowance
 */
export async function getBalance(client: PolymarketClient): Promise<Balance> {
  try {
    const address = await client.getAddress();
    const clobClient = client.getClient();
    
    logger.info('Fetching USDC balance...');
    
    // Get USDC (collateral) balance and allowance
    const balanceData = await clobClient.getBalanceAllowance({
      asset_type: AssetType.COLLATERAL
    });
    
    logger.debug('Balance data:', balanceData);
    
    return {
      usdc: balanceData.balance || '0',
      allowance: balanceData.allowance || '0',
      address: address,
    };
  } catch (error: any) {
    logger.error('Failed to fetch balance', error);
    throw error;
  }
}

/**
 * Get balance for a specific token (shares)
 */
export async function getTokenBalance(
  client: PolymarketClient,
  tokenId: string
): Promise<{ balance: string; allowance: string }> {
  try {
    const clobClient = client.getClient();
    
    logger.info(`Fetching balance for token: ${tokenId.substring(0, 10)}...`);
    
    const balanceData = await clobClient.getBalanceAllowance({
      asset_type: AssetType.CONDITIONAL,
      token_id: tokenId,
    });
    
    return {
      balance: balanceData.balance || '0',
      allowance: balanceData.allowance || '0',
    };
  } catch (error: any) {
    logger.error('Failed to fetch token balance', error);
    throw error;
  }
}

/**
 * Get open orders
 */
export async function getOpenOrders(client: PolymarketClient): Promise<OpenOrder[]> {
  try {
    logger.info('Fetching open orders...');
    const clobClient = client.getClient();
    
    const orders = await clobClient.getOpenOrders();
    
    if (!orders || orders.length === 0) {
      logger.info('No open orders found');
      return [];
    }
    
    logger.info(`Found ${orders.length} open order(s)`);
    return orders as any as OpenOrder[];
  } catch (error: any) {
    logger.error('Failed to fetch open orders', error);
    throw error;
  }
}

/**
 * Display balance information
 */
export function displayBalance(balance: Balance): void {
  console.log('\n' + '='.repeat(50));
  console.log('💰 Wallet Balance');
  console.log('='.repeat(50));
  console.log(`Address:   ${balance.address}`);
  console.log(`USDC:      $${parseFloat(balance.usdc).toFixed(2)}`);
  console.log(`Allowance: $${parseFloat(balance.allowance).toFixed(2)}`);
  console.log('='.repeat(50) + '\n');
  
  const usdcAmount = parseFloat(balance.usdc);
  const allowanceAmount = parseFloat(balance.allowance);
  
  if (allowanceAmount < usdcAmount) {
    console.log('⚠️  WARNING: Allowance is less than balance!');
    console.log('   You may need to set allowance for trading.');
    console.log('   This is usually done automatically on first trade.\n');
  }
}

/**
 * Display open orders
 */
export function displayOpenOrders(orders: OpenOrder[]): void {
  if (orders.length === 0) {
    console.log('\n📋 No open orders\n');
    return;
  }

  console.log('\n' + '='.repeat(80));
  console.log('📋 Open Orders');
  console.log('='.repeat(80));
  
  orders.forEach((order, index) => {
    console.log(`\n[${index + 1}] Order ID: ${order.id}`);
    console.log(`    Side:     ${order.side.toUpperCase()}`);
    console.log(`    Price:    $${order.price}`);
    console.log(`    Size:     ${order.size}`);
    console.log(`    Type:     ${order.type}`);
    console.log(`    Created:  ${order.created_at}`);
  });
  
  console.log('\n' + '='.repeat(80) + '\n');
}

/**
 * Check if user has sufficient balance for an order
 */
export async function checkSufficientBalance(
  client: PolymarketClient,
  requiredAmount: number
): Promise<boolean> {
  try {
    const balance = await getBalance(client);
    const availableBalance = parseFloat(balance.usdc);
    
    if (availableBalance < requiredAmount) {
      logger.warn(`Insufficient balance: ${availableBalance} < ${requiredAmount}`);
      return false;
    }
    
    logger.info(`✓ Sufficient balance: ${availableBalance} >= ${requiredAmount}`);
    return true;
  } catch (error: any) {
    logger.error('Failed to check balance', error);
    return false;
  }
}
