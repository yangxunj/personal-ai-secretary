// Trusted platform code assigns policy; model arguments cannot bypass transactions.
// Slow read-only I/O retains a durable audit without holding a SQL write transaction.
const externalReads = new WeakSet<object>();
export function externalRead<T extends object>(definition:T):T {
  externalReads.add(definition);return definition;
}
export function isExternalRead(definition:object):boolean {return externalReads.has(definition);}
