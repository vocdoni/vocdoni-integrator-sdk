import nacl from 'tweetnacl'
import { ProofCA_Type, SignedTx, Tx, VoteEnvelope } from '@vocdoni/proto/vochain'
import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils'
import { BallotEncryptor } from './ballot-encryptor'
import { EphemeralSigner } from './ephemeral-signer'
import { fromHex, strip0x, toHex } from './hex'
import { buildVoteTransaction } from './vote-transaction'

const PROCESS_ID = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2'
const CHAIN_ID = 'test'
const CSP_SIG = 'ab'.repeat(64) // placeholder 64-byte CSP signature

function decodeVote(hex: string): { vote: VoteEnvelope; signedTx: ReturnType<typeof SignedTx.decode> } {
  const signedTx = SignedTx.decode(fromHex(hex))
  const tx = Tx.decode(signedTx.tx)
  if (tx.payload?.$case !== 'vote') throw new Error('expected a vote payload')
  return { vote: tx.payload.vote, signedTx }
}

function recoverAddress(message: Uint8Array, sig: Uint8Array): string {
  const recovery = sig[64] > 1 ? sig[64] - 27 : sig[64]
  const prefix = utf8ToBytes(`\x19Ethereum Signed Message:\n${message.length}`)
  const digest = keccak_256(concatBytes(prefix, message))
  const signature = secp256k1.Signature.fromCompact(sig.slice(0, 64)).addRecoveryBit(recovery)
  const pub = signature.recoverPublicKey(digest).toRawBytes(false)
  return '0x' + toHex(keccak_256(pub.slice(1)).slice(-20))
}

describe('buildVoteTransaction', () => {
  const signer = new EphemeralSigner(new Uint8Array(32).fill(9))

  it('builds a SignedTx with a CA proof reconstructing the signed CAbundle', () => {
    const out = buildVoteTransaction({
      processId: PROCESS_ID,
      choices: [1, 0, 2],
      chainId: CHAIN_ID,
      signer,
      cspSignature: CSP_SIG,
      cspWeight: '2a',
    })
    const { vote } = decodeVote(out)

    expect(toHex(vote.processId)).toBe(PROCESS_ID)
    if (vote.proof?.payload?.$case !== 'ca') throw new Error('expected a CA proof')
    const ca = vote.proof.payload.ca
    expect(ca.type).toBe(ProofCA_Type.ECDSA_PIDSALTED)
    expect(toHex(ca.signature)).toBe(CSP_SIG)
    expect(toHex(ca.bundle!.processId)).toBe(PROCESS_ID)
    expect(toHex(ca.bundle!.address)).toBe(strip0x(signer.address))
    expect(toHex(ca.bundle!.voteWeight!)).toBe('2a')
  })

  it('carries a plain JSON vote package when unencrypted', () => {
    const out = buildVoteTransaction({
      processId: PROCESS_ID,
      choices: [3, 1],
      chainId: CHAIN_ID,
      signer,
      cspSignature: CSP_SIG,
    })
    const { vote } = decodeVote(out)
    const pkg = JSON.parse(new TextDecoder().decode(vote.votePackage))
    expect(pkg.votes).toEqual([3, 1])
    expect(typeof pkg.nonce).toBe('string')
    expect(vote.encryptionKeyIndexes).toEqual([])
  })

  it('signs the tx so the signature recovers to the ephemeral address (EIP-191)', () => {
    const out = buildVoteTransaction({
      processId: PROCESS_ID,
      choices: [1],
      chainId: CHAIN_ID,
      signer,
      cspSignature: CSP_SIG,
    })
    const { vote, signedTx } = decodeVote(out)
    expect(vote).toBeDefined()
    const hash = toHex(keccak_256(signedTx.tx))
    const message = utf8ToBytes(
      `You are signing a Vocdoni transaction of type VOTE for process ID ${strip0x(PROCESS_ID)}.\n\n` +
        `The hash of this transaction is ${hash} and the destination chain is ${CHAIN_ID}.`,
    )
    expect(recoverAddress(message, signedTx.signature!)).toBe(signer.address)
  })

  it('seals the vote package for secretUntilTheEnd elections', () => {
    const recipient = nacl.box.keyPair()
    const out = buildVoteTransaction({
      processId: PROCESS_ID,
      choices: [2],
      chainId: CHAIN_ID,
      signer,
      cspSignature: CSP_SIG,
      encryptionKeys: [{ index: 0, key: toHex(recipient.publicKey) }],
    })
    const { vote } = decodeVote(out)
    expect(vote.encryptionKeyIndexes).toEqual([0])
    const opened = BallotEncryptor.open(vote.votePackage, recipient.publicKey, recipient.secretKey)
    const pkg = JSON.parse(new TextDecoder().decode(opened))
    expect(pkg.votes).toEqual([2])
  })

  it('carries the memo as UTF-8 envelope bytes, absent by default', () => {
    const base = { processId: PROCESS_ID, choices: [1], chainId: CHAIN_ID, signer, cspSignature: CSP_SIG }

    const { vote: without } = decodeVote(buildVoteTransaction(base))
    expect(without.memo).toBeUndefined()

    const { vote: withMemo } = decodeVote(buildVoteTransaction({ ...base, memo: 'Other: neither ★' }))
    expect(new TextDecoder().decode(withMemo.memo!)).toBe('Other: neither ★')
  })

  it('rejects a memo over 256 UTF-8 bytes — bytes, not characters', () => {
    const base = { processId: PROCESS_ID, choices: [1], chainId: CHAIN_ID, signer, cspSignature: CSP_SIG }

    // 100 characters, but '€' is 3 UTF-8 bytes → 300 bytes.
    expect(() => buildVoteTransaction({ ...base, memo: '€'.repeat(100) })).toThrow('caps it at 256')
    // 256 single-byte characters is exactly at the cap.
    expect(() => buildVoteTransaction({ ...base, memo: 'a'.repeat(256) })).not.toThrow()
  })

  it('carries the metadata hash as raw envelope bytes, absent by default', () => {
    const base = { processId: PROCESS_ID, choices: [1], chainId: CHAIN_ID, signer, cspSignature: CSP_SIG }
    const hash = 'c0ffee'.repeat(10) + 'beef'

    const { vote: without } = decodeVote(buildVoteTransaction(base))
    expect(without.metadataHash).toBeUndefined()

    const { vote: empty } = decodeVote(buildVoteTransaction({ ...base, metadataHash: '' }))
    expect(empty.metadataHash).toBeUndefined()

    const { vote: withHash } = decodeVote(buildVoteTransaction({ ...base, metadataHash: hash }))
    expect(toHex(withHash.metadataHash!)).toBe(hash)

    const { vote: prefixed } = decodeVote(buildVoteTransaction({ ...base, metadataHash: `0x${hash}` }))
    expect(toHex(prefixed.metadataHash!)).toBe(hash)
  })

  it('rejects a metadata hash that is not 32 bytes', () => {
    const base = { processId: PROCESS_ID, choices: [1], chainId: CHAIN_ID, signer, cspSignature: CSP_SIG }
    expect(() => buildVoteTransaction({ ...base, metadataHash: 'ab'.repeat(31) })).toThrow('is 32')
  })
})
