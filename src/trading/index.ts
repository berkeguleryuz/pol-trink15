import { OrderType, Side } from '@polymarket/clob-client';
import { PolymarketClient } from '../client';
import { logger } from '../utils/logger';
import { Market } from '../markets';

export interface BuyOrderParams {
  tokenId: string;
  amount: number; // USDC amount
  price?: number; // For limit orders
  type?: 'market' | 'limit';
  orderType?: OrderType; // GTC, FOK, FAK
}

export interface SellOrderParams {
  tokenId: string;
  amount: number; // Number of shares
  price?: number; // For limit orders
  type?: 'market' | 'limit';
  orderType?: OrderType;
}

/**
 * Buy shares (YES or NO) on a market
 */
export async function buyShares(
  client: PolymarketClient,
  params: BuyOrderParams
): Promise<any> {
  try {
    const {
      tokenId,
      amount,
      price,
      type = 'market',
      orderType = OrderType.FOK, // Fill or Kill by default
    } = params;

    logger.section('Buy Order');
    logger.info(`Token ID: ${tokenId}`);
    logger.info(`Amount: $${amount} USDC`);
    logger.info(`Type: ${type.toUpperCase()}`);
    logger.info(`Order Type: ${orderType}`);

    const clobClient = client.getClient();

    if (type === 'market') {
      // Market buy order
      logger.info('Creating market buy order...');
      
      const order = await clobClient.createMarketOrder({
        tokenID: tokenId,
        amount: amount,
        side: Side.BUY,
      });

      logger.info('✓ Market buy order created');
      logger.info('Posting order to exchange...');

      const response = await clobClient.postOrder(order, orderType);
      
      logger.success('✓ Buy order executed successfully!');
      logger.info(`Order ID: ${response.orderID || 'N/A'}`);
      
      return response;
    } else if (type === 'limit' && price) {
      // Limit buy order
      logger.info(`Price: $${price}`);
      logger.info('Creating limit buy order...');

      const size = amount / price; // Calculate share amount
      
      const order = await clobClient.createOrder({
        tokenID: tokenId,
        price: price,
        side: Side.BUY,
        size: size,
        feeRateBps: 0, // Fee rate in basis points (0 = no fee)
      });

      logger.info('✓ Limit buy order created');
      logger.info('Posting order to exchange...');

      const response = await clobClient.postOrder(order, OrderType.GTC);
      
      logger.success('✓ Limit buy order placed successfully!');
      logger.info(`Order ID: ${response.orderID || 'N/A'}`);
      
      return response;
    } else {
      throw new Error('Invalid order type or missing price for limit order');
    }
  } catch (error: any) {
    logger.failure('Buy order failed');
    
    if (error.message?.includes('not enough balance')) {
      logger.error('❌ Insufficient USDC balance');
      logger.info('Please add more USDC to your wallet');
    } else if (error.message?.includes('invalid signature')) {
      logger.error('❌ Invalid signature');
      logger.info('Please check your private key and signature type in .env');
    } else if (error.message?.includes('allowance')) {
      logger.error('❌ Allowance not set');
      logger.info('You may need to set USDC allowance for the exchange contract');
    } else {
      logger.error('Error details:', error);
    }
    
    throw error;
  }
}

/**
 * Sell shares (YES or NO) on a market
 */
export async function sellShares(
  client: PolymarketClient,
  params: SellOrderParams
): Promise<any> {
  try {
    const {
      tokenId,
      amount,
      price,
      type = 'market',
      orderType = OrderType.FOK,
    } = params;

    logger.section('Sell Order');
    logger.info(`Token ID: ${tokenId}`);
    logger.info(`Amount: ${amount} shares`);
    logger.info(`Type: ${type.toUpperCase()}`);
    logger.info(`Order Type: ${orderType}`);

    const clobClient = client.getClient();

    if (type === 'market') {
      // Market sell order
      logger.info('Creating market sell order...');
      
      const order = await clobClient.createMarketOrder({
        tokenID: tokenId,
        amount: amount,
        side: Side.SELL,
      });

      logger.info('✓ Market sell order created');
      logger.info('Posting order to exchange...');

      const response = await clobClient.postOrder(order, orderType);
      
      logger.success('✓ Sell order executed successfully!');
      logger.info(`Order ID: ${response.orderID || 'N/A'}`);
      
      return response;
    } else if (type === 'limit' && price) {
      // Limit sell order
      logger.info(`Price: $${price}`);
      logger.info('Creating limit sell order...');

      const order = await clobClient.createOrder({
        tokenID: tokenId,
        price: price,
        side: Side.SELL,
        size: amount,
        feeRateBps: 0, // Fee rate in basis points (0 = no fee)
      });

      logger.info('✓ Limit sell order created');
      logger.info('Posting order to exchange...');

      const response = await clobClient.postOrder(order, OrderType.GTC);
      
      logger.success('✓ Limit sell order placed successfully!');
      logger.info(`Order ID: ${response.orderID || 'N/A'}`);
      
      return response;
    } else {
      throw new Error('Invalid order type or missing price for limit order');
    }
  } catch (error: any) {
    logger.failure('Sell order failed');
    
    if (error.message?.includes('not enough balance')) {
      logger.error('❌ Insufficient share balance');
      logger.info('You don\'t have enough shares to sell');
    } else if (error.message?.includes('invalid signature')) {
      logger.error('❌ Invalid signature');
      logger.info('Please check your private key and signature type in .env');
    } else {
      logger.error('Error details:', error);
    }
    
    throw error;
  }
}

/**
 * Cancel an order
 */
export async function cancelOrder(
  client: PolymarketClient,
  orderId: string
): Promise<void> {
  try {
    logger.info(`Cancelling order: ${orderId}`);
    const clobClient = client.getClient();
    
    await clobClient.cancelOrder({ orderID: orderId });
    logger.success('✓ Order cancelled successfully');
  } catch (error: any) {
    logger.error('Failed to cancel order', error);
    throw error;
  }
}

/**
 * Cancel all orders for a market
 */
export async function cancelAllMarketOrders(
  client: PolymarketClient,
  marketId: string
): Promise<void> {
  try {
    logger.info(`Cancelling all orders for market: ${marketId}`);
    const clobClient = client.getClient();
    
    await clobClient.cancelMarketOrders({ market: marketId });
    logger.success('✓ All market orders cancelled');
  } catch (error: any) {
    logger.error('Failed to cancel market orders', error);
    throw error;
  }
}
