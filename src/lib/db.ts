import { PrismaClient, type Prisma } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const client = globalForPrisma.prisma ?? new PrismaClient();
const scope = new AsyncLocalStorage<Prisma.TransactionClient>();
export const db = new Proxy(client, {
  get(target, key) {
    const active = scope.getStore() ?? target;
    const value = Reflect.get(active, key);
    return typeof value === 'function' ? value.bind(active) : value;
  },
});
export const inDatabaseTransaction = <T>(tx: Prisma.TransactionClient, work: () => Promise<T>) => scope.run(tx, work);
export const withDatabaseTransaction = <T>(work: () => Promise<T>): Promise<T> => scope.getStore()
  ? work() : client.$transaction(tx => inDatabaseTransaction(tx, work), {timeout: 30000});
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = client;
