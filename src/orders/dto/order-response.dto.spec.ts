import { User, UserRole } from '../../users/entities/user.entity';
import { Order, OrderStatus } from '../entities/order.entity';
import { OrderResponseDto } from './order-response.dto';

const buyer: User = {
  id: 'c0000000-0000-4000-8000-000000000001',
  username: 'buyer',
  displayName: 'Buyer One',
  passwordHash: '$2b$10$notarealhashbutlongenoughtolooklikeone',
  role: UserRole.CUSTOMER,
  walletAddress: '0xabc',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const order: Order = {
  id: 'b0000000-0000-4000-8000-000000000001',
  buyerId: buyer.id,
  buyer,
  items: [
    {
      articleId: 'a0000000-0000-4000-8000-000000000001',
      articleName: 'Green tea',
      unitPrice: 12.5,
      quantity: 2,
    },
  ],
  total: 25,
  currency: 'USDT',
  status: OrderStatus.PAID,
  walletAddress: '0xshop',
  transactionHash: '0xdeadbeef',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

describe('OrderResponseDto', () => {
  it('never exposes the buyer password hash', () => {
    const dto = OrderResponseDto.fromEntity(order);

    expect(JSON.stringify(dto)).not.toContain(buyer.passwordHash);
    expect(dto.buyer).toEqual({
      id: buyer.id,
      username: 'buyer',
      displayName: 'Buyer One',
    });
  });

  it('keeps the buyer id when the relation was not loaded', () => {
    const dto = OrderResponseDto.fromEntity({
      ...order,
      buyer: undefined as unknown as User,
    });

    expect(dto.buyer).toBeNull();
    expect(dto.buyerId).toBe(buyer.id);
  });

  it('carries the purchase-time item snapshot', () => {
    const dto = OrderResponseDto.fromEntity(order);

    expect(dto.items).toEqual(order.items);
    expect(dto.total).toBe(25);
    expect(dto.currency).toBe('USDT');
  });
});
