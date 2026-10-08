// Funds the bootstrapped integrator's prepaid wallet in a fresh saas-backend mongo.
//
// Since saas-backend's pay-per-process pricing (#704–#707), publishing a managed
// organization's process debits its integrator's wallet whenever the census is
// above the free tier (pricing.FreeCensusSize, 10 voters). full-flow.itest.ts
// publishes 5 processes over a 100-member census, priced at €65 each, so an
// empty wallet fails the first publish with 402 {"code":40175,"error":
// "insufficient integrator wallet balance"}. Real wallets are only credited by
// a Stripe top-up checkout, which never runs against this disposable stack, so
// the balance is written here instead.
//
// Env (passed through `docker compose exec -e`):
//   ORG_ADDRESS   the integrator organization's 0x address
//   WALLET_CENTS  the balance to set, in euro cents
//
// Source of truth for the shape below: db.Wallet in saas-backend's db/types.go
// (bson tags `_id`, `balanceCents`, `updatedAt`). `_id` is the go-ethereum
// common.Address, which the mongo driver stores as a 20-byte generic binary;
// balanceCents is a pricing.Cents (int64), hence NumberLong. If either drifts,
// this script still succeeds but the API reads an empty wallet — that's what
// the post-seed assertion in scripts/integration-stack.sh (GET /wallet must
// report this balance) is for.
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
