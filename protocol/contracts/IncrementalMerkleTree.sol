// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";

/// @notice Append-only Poseidon Merkle tree with a short history of roots.
abstract contract IncrementalMerkleTree {
    uint256 internal constant FIELD_SIZE =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint32 public constant LEVELS = 16;
    uint32 public constant ROOT_HISTORY_SIZE = 32;

    uint256[LEVELS] public zeros;
    uint256[LEVELS] public filledSubtrees;
    uint256[ROOT_HISTORY_SIZE] public roots;
    uint32 public currentRootIndex;
    uint32 public nextIndex;

    constructor() {
        uint256 current = 0; // empty leaf
        for (uint32 i = 0; i < LEVELS; i++) {
            zeros[i] = current;
            filledSubtrees[i] = current;
            current = PoseidonT3.hash([current, current]);
        }
        roots[0] = current;
    }

    function _insert(uint256 leaf) internal returns (uint32 index) {
        index = nextIndex;
        require(index < uint32(1) << LEVELS, "tree full");

        uint32 idx = index;
        uint256 current = leaf;
        for (uint32 i = 0; i < LEVELS; i++) {
            if (idx % 2 == 0) {
                filledSubtrees[i] = current;
                current = PoseidonT3.hash([current, zeros[i]]);
            } else {
                current = PoseidonT3.hash([filledSubtrees[i], current]);
            }
            idx /= 2;
        }

        currentRootIndex = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        roots[currentRootIndex] = current;
        nextIndex = index + 1;
    }

    function isKnownRoot(uint256 root) public view returns (bool) {
        if (root == 0) return false;
        uint32 i = currentRootIndex;
        do {
            if (roots[i] == root) return true;
            i = i == 0 ? ROOT_HISTORY_SIZE - 1 : i - 1;
        } while (i != currentRootIndex);
        return false;
    }

    function latestRoot() public view returns (uint256) {
        return roots[currentRootIndex];
    }
}
