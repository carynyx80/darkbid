//! Groth16 verification through Solana's alt_bn128 syscalls.
//! `proof_a` must already be negated by the client (see solana/lib/proof.js).
use groth16_solana::groth16::{Groth16Verifier, Groth16Verifyingkey};

pub fn verify<const N: usize>(
    vk: &Groth16Verifyingkey,
    proof_a: &[u8; 64],
    proof_b: &[u8; 128],
    proof_c: &[u8; 64],
    public_inputs: &[[u8; 32]; N],
) -> Result<(), ()> {
    let mut verifier = Groth16Verifier::new(proof_a, proof_b, proof_c, public_inputs, vk).map_err(|_| ())?;
    verifier.verify().map_err(|_| ())
}
