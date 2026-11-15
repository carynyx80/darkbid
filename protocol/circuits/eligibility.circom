pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "./merkle.circom";

// "I am on the allowlist and this is one of my permitted tickets",
// without revealing which allowlist entry is mine.
//
//   allowlist leaf = Poseidon(identitySecret)
//   nullifierHash  = Poseidon(identitySecret, saleId, ticketIndex)
//
// ticketIndex < maxPerBuyer, so each identity can produce at most
// maxPerBuyer distinct nullifiers per sale.
template Eligibility(levels) {
    // public
    signal input allowRoot;
    signal input nullifierHash;
    signal input saleId;
    signal input maxPerBuyer;
    signal input commitment; // ticket commitment this proof is bound to

    // private
    signal input identitySecret;
    signal input ticketIndex;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    component leaf = Poseidon(1);
    leaf.inputs[0] <== identitySecret;

    component tree = MerkleTreeChecker(levels);
    tree.leaf <== leaf.out;
    tree.root <== allowRoot;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }

    // Range-bound both operands so LessThan is sound.
    component idxBits = Num2Bits(16);
    idxBits.in <== ticketIndex;
    component maxBits = Num2Bits(16);
    maxBits.in <== maxPerBuyer;
    component lt = LessThan(16);
    lt.in[0] <== ticketIndex;
    lt.in[1] <== maxPerBuyer;
    lt.out === 1;

    component nh = Poseidon(3);
    nh.inputs[0] <== identitySecret;
    nh.inputs[1] <== saleId;
    nh.inputs[2] <== ticketIndex;
    nh.out === nullifierHash;

    // Bind the proof to the commitment so it cannot be swapped in the mempool.
    signal commitmentSquare;
    commitmentSquare <== commitment * commitment;
}

component main {public [allowRoot, nullifierHash, saleId, maxPerBuyer, commitment]} = Eligibility(16);
