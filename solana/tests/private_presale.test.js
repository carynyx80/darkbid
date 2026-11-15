const anchor = require("@coral-xyz/anchor");
const { BN } = anchor;
const { expect } = require("chai");
const { ComputeBudgetProgram, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, SYSVAR_CLOCK_PUBKEY } = require("@solana/web3.js");
const {
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  transfer,
} = require("@solana/spl-token");
const { MerkleTree, newIdentity, newNote, proveEligibility, proveClaim } = require("../lib/zk");
const { bytesToField, fieldToBytes, pubkeyToField } = require("../lib/proof");

const TICKET_PRICE = new BN(0.1 * LAMPORTS_PER_SOL);
const TOKENS_PER_TICKET = 1_000_000_000n; // 1,000 tokens at 6 decimals
const MAX_TICKETS = 10;
const MAX_PER_BUYER = 2;
const CU = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });

describe("private_presale (Solana)", function () {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.PrivatePresale;
  const connection = provider.connection;
  const issuer = provider.wallet.payer;

  let mint;
  let seedCounter = 1;

  // The program reads the Clock sysvar, which can differ from wall-clock block times on a local validator.
  const chainTime = async () => {
    const info = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, "confirmed");
    return Number(info.data.readBigInt64LE(32)); // slot, epoch_start_timestamp, epoch, leader_schedule_epoch, unix_timestamp
  };
  const waitUntil = async (ts) => {
    while ((await chainTime()) < ts) await new Promise((r) => setTimeout(r, 1000));
  };
  const fund = async (kp, sol = 2) => {
    const sig = await connection.requestAirdrop(kp.publicKey, sol * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
  };
  const expectFail = async (promise, pattern) => {
    let err;
    try {
      await promise;
    } catch (e) {
      err = e;
    }
    expect(err, "expected the transaction to fail").to.exist;
    const text = [err.toString(), ...(err.logs || []), ...(err.transactionLogs || [])].join("\n");
    expect(text).to.match(pattern);
  };

  before(async () => {
    mint = await createMint(connection, issuer, issuer.publicKey, null, 6);
    const issuerAta = await getOrCreateAssociatedTokenAccount(connection, issuer, mint, issuer.publicKey);
    await mintTo(connection, issuer, mint, issuerAta.address, issuer, TOKENS_PER_TICKET * 1000n);
  });

  // Creates a funded sale that ends `duration` seconds from now.
  async function createSale({ duration }) {
    const identities = [newIdentity(), newIdentity(), newIdentity()];
    const allowTree = new MerkleTree(identities.map((i) => i.commitment));
    const seed = new BN(seedCounter++);
    const [sale] = PublicKey.findProgramAddressSync(
      [Buffer.from("sale"), issuer.publicKey.toBuffer(), seed.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), sale.toBuffer()], program.programId);
    const now = await chainTime();
    const endTime = now + duration;
    await program.methods
      .initializeSale(
        seed,
        TICKET_PRICE,
        new BN(TOKENS_PER_TICKET.toString()),
        MAX_TICKETS,
        MAX_PER_BUYER,
        fieldToBytes(allowTree.root()),
        new BN(now - 5),
        new BN(endTime)
      )
      .accounts({ authority: issuer.publicKey, sale, mint, vault, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
      .preInstructions([CU])
      .rpc();
    const issuerAta = getAssociatedTokenAddressSync(mint, issuer.publicKey);
    await transfer(connection, issuer, issuerAta, vault, issuer, TOKENS_PER_TICKET * BigInt(MAX_TICKETS));
    const saleId = pubkeyToField(sale.toBytes());
    return { sale, vault, identities, allowTree, ticketTree: new MerkleTree(), saleId, endTime };
  }

  const eligibilityPda = (sale, nullifier) =>
    PublicKey.findProgramAddressSync([Buffer.from("eligibility"), sale.toBuffer(), Buffer.from(fieldToBytes(nullifier))], program.programId)[0];
  const claimPda = (sale, nullifierHash) =>
    PublicKey.findProgramAddressSync([Buffer.from("claim"), sale.toBuffer(), Buffer.from(fieldToBytes(nullifierHash))], program.programId)[0];

  async function contribute(ctx, buyer, proof, nullifier, commitment) {
    return program.methods
      .contribute(proof.proofA, proof.proofB, proof.proofC, fieldToBytes(nullifier), fieldToBytes(commitment))
      .accounts({ buyer: buyer.publicKey, sale: ctx.sale, eligibilityRecord: eligibilityPda(ctx.sale, nullifier), systemProgram: SystemProgram.programId })
      .preInstructions([CU])
      .signers([buyer])
      .rpc();
  }

  async function buy(ctx, buyer, identityIndex, ticketIndex) {
    const note = newNote();
    const { proof, nullifierHash } = await proveEligibility({
      identity: ctx.identities[identityIndex],
      allowTree: ctx.allowTree,
      leafIndex: identityIndex,
      saleId: ctx.saleId,
      maxPerBuyer: MAX_PER_BUYER,
      ticketIndex,
      commitment: note.commitment,
    });
    await contribute(ctx, buyer, proof, nullifierHash, note.commitment);
    ctx.ticketTree.insert(note.commitment);
    return { note, leafIndex: ctx.ticketTree.leaves.length - 1 };
  }

  async function claim(ctx, { submitter, proof, root, note, recipient, relayer, fee, relayerToken }) {
    return program.methods
      .claim(proof.proofA, proof.proofB, proof.proofC, fieldToBytes(root), fieldToBytes(note.nullifierHash), relayer, new BN(fee.toString()))
      .accounts({
        payer: submitter.publicKey,
        sale: ctx.sale,
        vault: ctx.vault,
        mint,
        claimRecord: claimPda(ctx.sale, note.nullifierHash),
        recipient,
        recipientToken: getAssociatedTokenAddressSync(mint, recipient),
        relayerToken: relayerToken || null,
      })
      .preInstructions([CU])
      .signers([submitter])
      .rpc();
  }

  it("keeps the on-chain tree root equal to the off-chain one", async () => {
    const ctx = await createSale({ duration: 600 });
    const buyer = Keypair.generate();
    await fund(buyer);
    let state = await program.account.sale.fetch(ctx.sale);
    const latest = (s) => bytesToField(s.tree.roots[s.tree.currentRootIndex]);
    expect(latest(state)).to.equal(ctx.ticketTree.root());
    await buy(ctx, buyer, 0, 0);
    await buy(ctx, buyer, 1, 0);
    state = await program.account.sale.fetch(ctx.sale);
    expect(latest(state)).to.equal(ctx.ticketTree.root());
    expect(state.ticketsSold).to.equal(2);
  });

  it("pays from one wallet and claims to an unrelated wallet through a relayer", async () => {
    const ctx = await createSale({ duration: 25 });
    const payer = Keypair.generate();
    const relayer = Keypair.generate();
    await fund(payer);
    await fund(relayer);
    const { note, leafIndex } = await buy(ctx, payer, 0, 0);
    await buy(ctx, payer, 1, 0);
    await waitUntil(ctx.endTime + 1);

    const recipient = Keypair.generate().publicKey; // never funded, never seen before
    const relayerAta = await getOrCreateAssociatedTokenAccount(connection, relayer, mint, relayer.publicKey);
    const fee = 10_000_000n;
    const { proof, root } = await proveClaim({ note, ticketTree: ctx.ticketTree, leafIndex, recipient, relayer: relayer.publicKey, fee });
    await claim(ctx, { submitter: relayer, proof, root, note, recipient, relayer: relayer.publicKey, fee, relayerToken: relayerAta.address });

    const got = await getAccount(connection, getAssociatedTokenAddressSync(mint, recipient));
    expect(got.amount).to.equal(TOKENS_PER_TICKET - fee);
    expect((await getAccount(connection, relayerAta.address)).amount).to.equal(fee);
  });

  it("rejects an early claim, a changed recipient and a double claim", async () => {
    const ctx = await createSale({ duration: 20 });
    const buyer = Keypair.generate();
    const submitter = Keypair.generate();
    await fund(buyer);
    await fund(submitter);
    const { note, leafIndex } = await buy(ctx, buyer, 0, 0);
    const recipient = Keypair.generate().publicKey;
    const relayer = PublicKey.default;
    const { proof, root } = await proveClaim({ note, ticketTree: ctx.ticketTree, leafIndex, recipient, relayer, fee: 0n });
    const args = { submitter, proof, root, note, recipient, relayer, fee: 0n };

    await expectFail(claim(ctx, args), /SaleNotEnded|Sale has not ended/);
    await waitUntil(ctx.endTime + 1);

    // Someone submitting the claim cannot redirect it to themselves.
    await expectFail(claim(ctx, { ...args, recipient: submitter.publicKey }), /BadClaimProof|Bad claim proof/);

    await claim(ctx, args);
    await expectFail(claim(ctx, args), /already in use|0x0/);
  });

  it("enforces the per-buyer ticket cap", async () => {
    const ctx = await createSale({ duration: 600 });
    const buyer = Keypair.generate();
    await fund(buyer);
    await buy(ctx, buyer, 0, 0);
    await buy(ctx, buyer, 0, 1);

    const note = newNote();
    const reused = await proveEligibility({
      identity: ctx.identities[0],
      allowTree: ctx.allowTree,
      leafIndex: 0,
      saleId: ctx.saleId,
      maxPerBuyer: MAX_PER_BUYER,
      ticketIndex: 0,
      commitment: note.commitment,
    });
    await expectFail(contribute(ctx, buyer, reused.proof, reused.nullifierHash, note.commitment), /already in use|0x0/);

    let proved = true;
    try {
      await proveEligibility({
        identity: ctx.identities[0],
        allowTree: ctx.allowTree,
        leafIndex: 0,
        saleId: ctx.saleId,
        maxPerBuyer: MAX_PER_BUYER,
        ticketIndex: 2,
        commitment: note.commitment,
      });
    } catch {
      proved = false;
    }
    expect(proved).to.equal(false);
  });

  it("rejects buyers who are not on the allowlist", async () => {
    const ctx = await createSale({ duration: 600 });
    const outsider = newIdentity();
    const buyer = Keypair.generate();
    await fund(buyer);
    const note = newNote();
    const { proof, nullifierHash } = await proveEligibility({
      identity: outsider,
      allowTree: new MerkleTree([outsider.commitment]),
      leafIndex: 0,
      saleId: ctx.saleId,
      maxPerBuyer: MAX_PER_BUYER,
      ticketIndex: 0,
      commitment: note.commitment,
    });
    await expectFail(contribute(ctx, buyer, proof, nullifierHash, note.commitment), /BadEligibilityProof|Bad eligibility proof/);
  });

  it("rejects a proof copied onto a different commitment", async () => {
    const ctx = await createSale({ duration: 600 });
    const attacker = Keypair.generate();
    await fund(attacker);
    const note = newNote();
    const attackerNote = newNote();
    const { proof, nullifierHash } = await proveEligibility({
      identity: ctx.identities[2],
      allowTree: ctx.allowTree,
      leafIndex: 2,
      saleId: ctx.saleId,
      maxPerBuyer: MAX_PER_BUYER,
      ticketIndex: 0,
      commitment: note.commitment,
    });
    await expectFail(contribute(ctx, attacker, proof, nullifierHash, attackerNote.commitment), /BadEligibilityProof|Bad eligibility proof/);
  });

  it("lets the issuer collect proceeds and unsold tokens after the sale", async () => {
    const ctx = await createSale({ duration: 20 });
    const buyer = Keypair.generate();
    await fund(buyer);
    await buy(ctx, buyer, 0, 0);
    await buy(ctx, buyer, 1, 0);

    await expectFail(
      program.methods.withdrawProceeds().accounts({ authority: issuer.publicKey, sale: ctx.sale }).rpc(),
      /SaleNotEnded|Sale has not ended/
    );
    await waitUntil(ctx.endTime + 1);

    const stranger = Keypair.generate();
    await fund(stranger);
    await expectFail(
      program.methods.withdrawProceeds().accounts({ authority: stranger.publicKey, sale: ctx.sale }).signers([stranger]).rpc(),
      /ConstraintHasOne|has one|2001/
    );

    const before = await connection.getBalance(issuer.publicKey);
    await program.methods.withdrawProceeds().accounts({ authority: issuer.publicKey, sale: ctx.sale }).rpc();
    const after = await connection.getBalance(issuer.publicKey);
    expect(after - before).to.be.closeTo(2 * TICKET_PRICE.toNumber(), 10_000); // minus the transaction fee

    const issuerAta = getAssociatedTokenAddressSync(mint, issuer.publicKey);
    const tokensBefore = (await getAccount(connection, issuerAta)).amount;
    const unsold = () =>
      program.methods.withdrawUnsold().accounts({ authority: issuer.publicKey, sale: ctx.sale, vault: ctx.vault, authorityToken: issuerAta }).rpc();
    await unsold();
    expect((await getAccount(connection, issuerAta)).amount - tokensBefore).to.equal(TOKENS_PER_TICKET * BigInt(MAX_TICKETS - 2));
    await expectFail(unsold(), /AlreadyWithdrawn|Already withdrawn/);
    expect((await getAccount(connection, ctx.vault)).amount).to.equal(TOKENS_PER_TICKET * 2n);
  });
});
