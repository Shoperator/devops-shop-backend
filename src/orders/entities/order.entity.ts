import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { decimalTransformer } from '../../common/transformers/decimal.transformer';
import { OrderItem } from './order-item';

export enum OrderStatus {
  /** Created, waiting for the on-chain payment to be confirmed. */
  PENDING = 'PENDING',
  PAID = 'PAID',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
}

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'buyer_id' })
  buyer: User;

  @Column({ name: 'buyer_id' })
  buyerId: string;

  @Column({ type: 'jsonb' })
  items: OrderItem[];

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    transformer: decimalTransformer,
  })
  total: number;

  /** Defensive only: the service always writes `SHOP_CURRENCY` explicitly. */
  @Column({ length: 16, default: 'ETH' })
  currency: string;

  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.PENDING })
  status: OrderStatus;

  /** Shop wallet the payment for this order is expected on. */
  @Column({
    name: 'wallet_address',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  walletAddress: string | null;

  /**
   * Hash of the on-chain transaction that settled this order.
   *
   * Unique, so one transfer cannot settle two orders: a customer who pays once
   * and submits the same hash against a second basket is stopped by the
   * database rather than by a check that could race. PostgreSQL permits any
   * number of NULLs under a unique constraint, so unpaid orders are unaffected.
   */
  @Column({
    name: 'transaction_hash',
    type: 'varchar',
    length: 128,
    nullable: true,
    unique: true,
  })
  transactionHash: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
