// Minimal type shims for the heavy ZK dependencies, which ship no TypeScript
// types. Only the surface we use is declared.

declare module 'snarkjs' {
  export const groth16: {
    fullProve(
      input: object,
      wasm: Uint8Array | string,
      zkey: Uint8Array | string,
    ): Promise<{
      proof: {
        pi_a: string[]
        pi_b: string[][]
        pi_c: string[]
        protocol: string
        curve: string
      }
      publicSignals: string[]
    }>
    verify(
      vkey: Record<string, unknown>,
      publicSignals: string[],
      proof: Record<string, unknown>,
    ): Promise<boolean>
  }
}
