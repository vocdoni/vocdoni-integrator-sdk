// Funds the integrator's wallet: publishing a >10-voter process debits it (saas-backend#706)
// and only a Stripe checkout credits it. Env: ORG_ADDRESS (0x), WALLET_CENTS (euro cents).
// Shape mirrors db.Wallet (db/types.go); integration-stack.sh asserts it via GET /wallet.
const orgAddress = process.env.ORG_ADDRESS || ''
const walletCents = process.env.WALLET_CENTS || ''
if (!/^0x[0-9a-fA-F]{40}$/.test(orgAddress)) {
  throw new Error(`ORG_ADDRESS is not a 0x address: '${orgAddress}'`)
}
if (!/^[1-9][0-9]*$/.test(walletCents)) {
  throw new Error(`WALLET_CENTS is not a positive integer: '${walletCents}'`)
}
db = db.getSiblingDB('saasdb')
db.wallets.updateOne(
  { _id: Binary.createFromHexString(orgAddress.slice(2), 0) },
  { $set: { balanceCents: NumberLong(walletCents), updatedAt: new Date() } },
  { upsert: true }
)
