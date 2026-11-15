//! Append-only Poseidon Merkle tree with a short root history, matching
//! protocol/contracts/IncrementalMerkleTree.sol and the circom circuits.
use anchor_lang::prelude::*;
use solana_poseidon::{hashv, Endianness, Parameters};

use crate::PresaleError;

pub const LEVELS: u32 = 16;
pub const ROOT_HISTORY_SIZE: usize = 32;

/// BN254 scalar field modulus, big-endian.
const FIELD_MODULUS: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d, 0x28, 0x33, 0xe8,
    0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

pub fn is_field_element(v: &[u8; 32]) -> bool {
    v < &FIELD_MODULUS
}

pub fn hash_pair(left: &[u8; 32], right: &[u8; 32]) -> Result<[u8; 32]> {
    hashv(Parameters::Bn254X5, Endianness::BigEndian, &[left, right])
        .map(|h| h.to_bytes())
        .map_err(|_| error!(PresaleError::HashFailed))
}

#[zero_copy]
pub struct MerkleTree {
    pub next_index: u32,
    pub current_root_index: u32,
    pub zeros: [[u8; 32]; LEVELS as usize],
    pub filled_subtrees: [[u8; 32]; LEVELS as usize],
    pub roots: [[u8; 32]; ROOT_HISTORY_SIZE],
}

impl MerkleTree {
    pub fn init(&mut self) -> Result<()> {
        let mut current = [0u8; 32];
        for i in 0..LEVELS as usize {
            self.zeros[i] = current;
            self.filled_subtrees[i] = current;
            current = hash_pair(&current, &current)?;
        }
        for r in self.roots.iter_mut() {
            *r = [0u8; 32];
        }
        self.roots[0] = current;
        self.current_root_index = 0;
        self.next_index = 0;
        Ok(())
    }

    pub fn insert(&mut self, leaf: [u8; 32]) -> Result<u32> {
        let index = self.next_index;
        require!(index < 1u32 << LEVELS, PresaleError::TreeFull);
        let mut idx = index;
        let mut current = leaf;
        for i in 0..LEVELS as usize {
            if idx % 2 == 0 {
                self.filled_subtrees[i] = current;
                current = hash_pair(&current, &self.zeros[i])?;
            } else {
                current = hash_pair(&self.filled_subtrees[i], &current)?;
            }
            idx /= 2;
        }
        self.current_root_index = (self.current_root_index + 1) % ROOT_HISTORY_SIZE as u32;
        self.roots[self.current_root_index as usize] = current;
        self.next_index = index + 1;
        Ok(index)
    }

    pub fn is_known_root(&self, root: &[u8; 32]) -> bool {
        root != &[0u8; 32] && self.roots.iter().any(|r| r == root)
    }

    pub fn latest_root(&self) -> [u8; 32] {
        self.roots[self.current_root_index as usize]
    }
}
