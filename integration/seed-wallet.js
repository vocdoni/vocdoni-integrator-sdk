// Funds the integrator's wallet: balanceCents, plus one walletLedger topup, which is what
// netTopUpCents (saas-backend#819) sums to lift the one-managed-org limit. Env: ORG_ADDRESS (0x),
// WALLET_CENTS (euro cents). Shapes mirror db.Wallet and db.WalletLedgerEntry (db/types.go).
const orgAddress = process.env.ORG_ADDRESS || ''
const walletCents = process.env.WALLET_CENTS || ''
if (!/^0x[0-9a-fA-F]{40}$/.test(orgAddress)) {
  throw new Error(`ORG_ADDRESS is not a 0x address: '${orgAddress}'`)
}
if (!/^[1-9][0-9]*$/.test(walletCents)) {
  throw new Error(`WALLET_CENTS is not a positive integer: '${walletCents}'`)
}
db = db.getSiblingDB('saasdb')
const orgBinary = Binary.createFromHexString(orgAddress.slice(2), 0)
db.wallets.updateOne(
  { _id: orgBinary },
  { $set: { balanceCents: NumberLong(walletCents), updatedAt: new Date() } },
  { upsert: true }
)
// Not added to balanceCents: drainWallet only posts movements still in wallet.unposted, and the
// balance is never recomputed from the ledger, so this row is a record and cannot double-count.
db.walletLedger.updateOne(
  { orgAddress: orgBinary, idempotencyKey: `itest-seed-topup-${orgAddress.slice(2).toLowerCase()}` },
  { $set: { kind: 'topup', amountCents: NumberLong(walletCents) }, $setOnInsert: { createdAt: new Date() } },
  { upsert: true }
)
