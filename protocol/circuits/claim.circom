pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "./merkle.circom";

// "I own one of the tickets in the tree", without revealing which one.
//
//   commitment    = Poseidon(nullifier, secret)
//   nullifierHash = Poseidon(nullifier)
template Claim(levels) {
    // public
    signal input root;
    signal input nullifierHash;
    signal input recipient;
    signal input relayer;
    signal input fee;

    // private
    signal input nullifier;
    signal input secret;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    component commitment = Poseidon(2);
    commitment.inputs[0] <== nullifier;
    commitment.inputs[1] <== secret;

    component nh = Poseidon(1);
    nh.inputs[0] <== nullifier;
    nh.out === nullifierHash;

    component tree = MerkleTreeChecker(levels);
    tree.leaf <== commitment.out;
    tree.root <== root;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }

    // Bind the proof to the payout details so a relayer cannot change them.
    signal recipientSquare;
    signal relayerSquare;
    signal feeSquare;
    recipientSquare <== recipient * recipient;
    relayerSquare <== relayer * relayer;
    feeSquare <== fee * fee;
}

component main {public [root, nullifierHash, recipient, relayer, fee]} = Claim(16);
