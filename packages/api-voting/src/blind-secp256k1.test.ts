import { mod } from '@noble/curves/abstract/modular'
import { bytesToNumberBE } from '@noble/curves/abstract/utils'
import { keccak_256 } from '@noble/hashes/sha3'
import { describe, expect, it } from 'vitest'
import { blind, blindMessageFromBundle, decompressBlindPoint, serializeBlindSignature, unblind } from './blind-secp256k1'
import { blindSign, compress, G, minimalBytes, N, salt, scalar32, verify } from './blind-secp256k1.testkit'
import { fromHex, toHex } from './hex'
import { encodeCaBundle } from './vote-transaction'
import fixture from '../testdata/blind-fixture.json'

describe('decompressBlindPoint', () => {
  it('round-trips the go-blindsecp256k1 compressed encoding', () => {
    for (const k of [1n, 2n, 3n, scalar32()]) {
      const point = G.multiply(k)
      expect(decompressBlindPoint(compress(point)).equals(point)).toBe(true)
    }
  })

  it('rejects a point that is not 33 bytes', () => {
    expect(() => decompressBlindPoint(new Uint8Array(32))).toThrow(/33 bytes/)
  })

  it('rejects a point that is not on the curve', () => {
    // x = 5: 5^3 + 7 is not a quadratic residue mod p, so no y exists.
    const bogus = new Uint8Array(33)
    bogus[31] = 5
    expect(() => decompressBlindPoint(bogus)).toThrow()
  })
})

describe('blind signature round trip', () => {
  it('produces a signature the signer’s public key verifies', () => {
    const d = scalar32()
    const q = G.multiply(d)
    const k = scalar32()
    const r = G.multiply(k)

    const m = blindMessageFromBundle(new Uint8Array([1, 2, 3, 4]))
    const { mBlinded, secret } = blind(m, decompressBlindPoint(compress(r)))
    const signature = unblind(blindSign(mBlinded, d, k), secret)

    expect(verify(m, signature, q)).toBe(true)
  })

  it('verifies against the salted key the chain derives, weight included', () => {
    // The CSP signs with d' = (d + salt) mod n; the chain verifies against
    // Q' = Q + salt*G. Both derive the salt from processId AND the authorized
    // weight, so a voter who edits the weight in its bundle gets a different
    // salt and the proof stops verifying.
    const processId = keccak_256(new Uint8Array([7])) // 32 bytes, like a real election id
    const weight = 42n
    const s = salt(processId, weight)
    const d = mod(scalar32() + s, N)
    const qSalted = G.multiply(d)

    const k = scalar32()
    const m = blindMessageFromBundle(new Uint8Array([9, 9, 9]))
    const { mBlinded, secret } = blind(m, decompressBlindPoint(compress(G.multiply(k))))
    const signature = unblind(blindSign(mBlinded, d, k), secret)

    expect(verify(m, signature, qSalted)).toBe(true)
    // Same signature, a salt derived from a different weight: rejected.
    const other = G.multiply(mod(d - s + salt(processId, 43n), N))
    expect(verify(m, signature, other)).toBe(false)
  })

  it('only ever emits a blinded message whose minimal encoding is 32 bytes', () => {
    // The signer rejects anything narrower, which is why blind() retries.
    const r = G.multiply(scalar32())
    for (let i = 0; i < 64; i++) {
      const { mBlinded } = blind(blindMessageFromBundle(new Uint8Array([i])), r)
      expect(minimalBytes(mBlinded).length).toBe(32)
      expect(mBlinded).toBeLessThan(N)
    }
  })
})

describe('go-blindsecp256k1 fixture', () => {
  // The round-trip tests above prove the math is self-consistent; they cannot
  // prove it agrees with Go, because both halves are written here. These do:
  // every value comes from testdata/blind-fixture.go, run against the real
  // arnaucube/go-blindsecp256k1 and vocdoni-node's saltedkey, and is compared
  // byte for byte. This is the test that fails on a flipped endianness or a
  // dropped leading zero.
  const hexToBigint = (hex: string) => BigInt(`0x${hex}`)
  // The address the fixture's CA bundle was built for.
  const address = '7c0ea1a94b4a4d3f8a7f39a9e4e6f0c4e4f2a1b3'

  it('builds the same CA bundle bytes', () => {
    expect(toHex(encodeCaBundle({ processId: fixture.processId, address, weight: fixture.weight }))).toBe(
      fixture.bundle
    )
  })

  it('derives the same salt from the process id and the authorized weight', () => {
    expect(salt(fromHex(fixture.processId), hexToBigint(fixture.weight))).toBe(hexToBigint(fixture.salt))
  })

  it('hashes the bundle to the same m, and m to the same h', () => {
    const m = blindMessageFromBundle(fromHex(fixture.bundle))
    expect(m).toBe(hexToBigint(fixture.m))
    expect(bytesToNumberBE(keccak_256(minimalBytes(m)))).toBe(hexToBigint(fixture.h))
  })

  it('decodes tokenR and F, and re-encodes them identically', () => {
    const r = decompressBlindPoint(fromHex(fixture.tokenR))
    expect(r.equals(G.multiply(hexToBigint(fixture.k)))).toBe(true)
    expect(toHex(compress(r))).toBe(fixture.tokenR)

    // F = aR + bG, the blinding step's public output.
    const f = decompressBlindPoint(fromHex(fixture.f))
    expect(f.equals(r.multiply(hexToBigint(fixture.a)).add(G.multiply(hexToBigint(fixture.b))))).toBe(true)
    expect(toHex(compress(f))).toBe(fixture.f)
  })

  it('signs the same blinded message with the salted key', () => {
    expect(blindSign(hexToBigint(fixture.mBlinded), hexToBigint(fixture.saltedPrivKey), hexToBigint(fixture.k))).toBe(
      hexToBigint(fixture.sBlind)
    )
  })

  it('unblinds and serializes to the same 96 proof bytes', () => {
    const signature = unblind(hexToBigint(fixture.sBlind), {
      a: hexToBigint(fixture.a),
      b: hexToBigint(fixture.b),
      f: decompressBlindPoint(fromHex(fixture.f)),
    })
    expect(toHex(serializeBlindSignature(signature))).toBe(fixture.signature)
    expect(verify(hexToBigint(fixture.m), signature, decompressBlindPoint(fromHex(fixture.saltedPubKey)))).toBe(true)
  })
})

describe('serializeBlindSignature', () => {
  it('emits S | F.X | F.Y as 32-byte little-endian scalars', () => {
    const f = G.multiply(scalar32())
    const bytes = serializeBlindSignature({ s: 0x0102n, f })

    expect(bytes.length).toBe(96)
    // 0x0102 little-endian is 02 01 then zero padding — not 00 ... 01 02.
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x02, 0x01, 0, 0])

    const { x, y } = f.toAffine()
    expect(bytesToNumberBE(bytes.subarray(32, 64).reverse())).toBe(x)
    expect(bytesToNumberBE(bytes.subarray(64, 96).reverse())).toBe(y)
  })
})
