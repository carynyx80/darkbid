#!/usr/bin/env bash
# Compiles the circuits, runs a LOCAL DEV-ONLY trusted setup, and exports
# the Solidity verifiers. A real launch needs a public multi-party ceremony.
set -euo pipefail
cd "$(dirname "$0")/.."

B=build/circuits
mkdir -p "$B" contracts/verifiers
PTAU="$B/pot14_final.ptau"

if [ ! -f "$PTAU" ]; then
  npx snarkjs powersoftau new bn128 14 "$B/pot_0.ptau"
  npx snarkjs powersoftau contribute "$B/pot_0.ptau" "$B/pot_1.ptau" --name=dev -e="$(openssl rand -hex 32)"
  npx snarkjs powersoftau prepare phase2 "$B/pot_1.ptau" "$PTAU"
  rm -f "$B/pot_0.ptau" "$B/pot_1.ptau"
fi

build() {
  local c="$1" name="$2"
  npx circom2 "circuits/$c.circom" --r1cs --wasm -o "$B"
  npx snarkjs groth16 setup "$B/$c.r1cs" "$PTAU" "$B/${c}_0.zkey"
  npx snarkjs zkey contribute "$B/${c}_0.zkey" "$B/$c.zkey" --name=dev -e="$(openssl rand -hex 32)"
  rm -f "$B/${c}_0.zkey"
  npx snarkjs zkey export verificationkey "$B/$c.zkey" "$B/${c}_vkey.json"
  npx snarkjs zkey export solidityverifier "$B/$c.zkey" "contracts/verifiers/${name}Verifier.sol"
  sed -i.bak "s/contract Groth16Verifier/contract ${name}Verifier/" "contracts/verifiers/${name}Verifier.sol"
  rm -f "contracts/verifiers/${name}Verifier.sol.bak"
}

build eligibility Eligibility
build claim Claim
echo "circuits built"
