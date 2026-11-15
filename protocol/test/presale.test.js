const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { MerkleTree, newIdentity, newNote, proveEligibility, proveClaim } = require("../lib/zk");

const TICKET_PRICE = ethers.parseEther("0.1");
const TOKENS_PER_TICKET = ethers.parseEther("1000");
const MAX_TICKETS = 10;
const MAX_PER_BUYER = 2;

describe("PrivatePresale", function () {
  let issuer, payer, relayer, stranger;
  let token, presale, saleId;
  let identities, allowTree, ticketTree;
  let endTime;

  beforeEach(async function () {
    [issuer, payer, relayer, stranger] = await ethers.getSigners();

    // Three allowlisted buyers; the issuer only ever sees their commitments.
    identities = [newIdentity(), newIdentity(), newIdentity()];
    allowTree = new MerkleTree(identities.map((i) => i.commitment));
    ticketTree = new MerkleTree();

    const poseidon = await (await ethers.getContractFactory("PoseidonT3")).deploy();
    const eligibilityVerifier = await (await ethers.getContractFactory("EligibilityVerifier")).deploy();
    const claimVerifier = await (await ethers.getContractFactory("ClaimVerifier")).deploy();
    token = await (await ethers.getContractFactory("MockToken")).deploy(TOKENS_PER_TICKET * BigInt(MAX_TICKETS));

    const now = await time.latest();
    endTime = now + 3600;
    const Presale = await ethers.getContractFactory("PrivatePresale", {
      libraries: { PoseidonT3: await poseidon.getAddress() },
    });
    presale = await Presale.deploy(
      await token.getAddress(),
      await eligibilityVerifier.getAddress(),
      await claimVerifier.getAddress(),
      TICKET_PRICE,
      TOKENS_PER_TICKET,
      MAX_TICKETS,
      MAX_PER_BUYER,
      allowTree.root(),
      now + 10,
      endTime
    );
    await token.transfer(await presale.getAddress(), TOKENS_PER_TICKET * BigInt(MAX_TICKETS));
    saleId = await presale.saleId();
    await time.increaseTo(now + 10);
  });

  // Buys one ticket and mirrors it into the local ticket tree.
  async function buy(identityIndex, ticketIndex, signer = payer) {
    const note = newNote();
    const { proof, nullifierHash } = await proveEligibility({
      identity: identities[identityIndex],
      allowTree,
      leafIndex: identityIndex,
      saleId,
      maxPerBuyer: MAX_PER_BUYER,
      ticketIndex,
      commitment: note.commitment,
    });
    await presale.connect(signer).contribute(proof, nullifierHash, note.commitment, { value: TICKET_PRICE });
    ticketTree.insert(note.commitment);
    return { note, leafIndex: ticketTree.leaves.length - 1 };
  }

  it("matches the off-chain tree roots", async function () {
    expect(await presale.latestRoot()).to.equal(ticketTree.root());
    await buy(0, 0);
    await buy(1, 0);
    expect(await presale.latestRoot()).to.equal(ticketTree.root());
  });

  it("pays from one wallet and claims to an unrelated wallet through a relayer", async function () {
    const { note, leafIndex } = await buy(0, 0);
    await buy(1, 0); // a second ticket so the claim is not the only one
    await time.increaseTo(endTime);

    const recipient = ethers.Wallet.createRandom().address; // never funded, never seen before
    const fee = ethers.parseEther("10");
    const { proof, root } = await proveClaim({
      note,
      ticketTree,
      leafIndex,
      recipient,
      relayer: relayer.address,
      fee,
    });

    await expect(
      presale.connect(relayer).claim(proof, root, note.nullifierHash, recipient, relayer.address, fee)
    )
      .to.emit(presale, "TicketClaimed")
      .withArgs(note.nullifierHash, recipient, relayer.address, fee);

    expect(await token.balanceOf(recipient)).to.equal(TOKENS_PER_TICKET - fee);
    expect(await token.balanceOf(relayer.address)).to.equal(fee);
    expect(await token.balanceOf(payer.address)).to.equal(0n);
  });

  it("rejects a double claim, a changed recipient and an early claim", async function () {
    const { note, leafIndex } = await buy(0, 0);
    const recipient = ethers.Wallet.createRandom().address;
    const { proof, root } = await proveClaim({
      note,
      ticketTree,
      leafIndex,
      recipient,
      relayer: ethers.ZeroAddress,
      fee: 0,
    });
    const args = [proof, root, note.nullifierHash, recipient, ethers.ZeroAddress, 0];

    await expect(presale.claim(...args)).to.be.revertedWith("sale not ended");
    await time.increaseTo(endTime);

    // A relayer cannot redirect the payout to itself.
    await expect(
      presale.claim(proof, root, note.nullifierHash, stranger.address, ethers.ZeroAddress, 0)
    ).to.be.revertedWith("bad claim proof");

    await presale.claim(...args);
    await expect(presale.claim(...args)).to.be.revertedWith("already claimed");
  });

  it("enforces the per-buyer ticket cap", async function () {
    await buy(0, 0);
    await buy(0, 1);

    // Reusing an allowance is caught on-chain.
    const note = newNote();
    const reused = await proveEligibility({
      identity: identities[0],
      allowTree,
      leafIndex: 0,
      saleId,
      maxPerBuyer: MAX_PER_BUYER,
      ticketIndex: 0,
      commitment: note.commitment,
    });
    await expect(
      presale.connect(payer).contribute(reused.proof, reused.nullifierHash, note.commitment, { value: TICKET_PRICE })
    ).to.be.revertedWith("allowance used");

    // A third allowance cannot be proven at all.
    let proved = true;
    try {
      await proveEligibility({
        identity: identities[0],
        allowTree,
        leafIndex: 0,
        saleId,
        maxPerBuyer: MAX_PER_BUYER,
        ticketIndex: 2,
        commitment: note.commitment,
      });
    } catch {
      proved = false;
    }
    expect(proved).to.equal(false);
  });

  it("rejects buyers who are not on the allowlist", async function () {
    const outsider = newIdentity();
    const fakeTree = new MerkleTree([outsider.commitment]);
    const note = newNote();
    const { proof, nullifierHash } = await proveEligibility({
      identity: outsider,
      allowTree: fakeTree, // valid proof, but against the wrong allowlist
      leafIndex: 0,
      saleId,
      maxPerBuyer: MAX_PER_BUYER,
      ticketIndex: 0,
      commitment: note.commitment,
    });
    await expect(
      presale.connect(stranger).contribute(proof, nullifierHash, note.commitment, { value: TICKET_PRICE })
    ).to.be.revertedWith("bad eligibility proof");
  });

  it("rejects a swapped commitment and a wrong payment", async function () {
    const note = newNote();
    const attackerNote = newNote();
    const { proof, nullifierHash } = await proveEligibility({
      identity: identities[2],
      allowTree,
      leafIndex: 2,
      saleId,
      maxPerBuyer: MAX_PER_BUYER,
      ticketIndex: 0,
      commitment: note.commitment,
    });

    // Front-runner copies the proof but substitutes their own commitment.
    await expect(
      presale.connect(stranger).contribute(proof, nullifierHash, attackerNote.commitment, { value: TICKET_PRICE })
    ).to.be.revertedWith("bad eligibility proof");

    await expect(
      presale.connect(payer).contribute(proof, nullifierHash, note.commitment, { value: TICKET_PRICE - 1n })
    ).to.be.revertedWith("wrong payment");
  });

  it("lets the issuer collect proceeds and unsold tokens after the sale", async function () {
    await buy(0, 0);
    await buy(1, 0);
    await expect(presale.withdrawProceeds()).to.be.revertedWith("sale not ended");
    await time.increaseTo(endTime);

    await expect(presale.connect(stranger).withdrawProceeds()).to.be.revertedWith("not issuer");
    await expect(presale.withdrawProceeds()).to.changeEtherBalance(issuer, TICKET_PRICE * 2n);

    await presale.withdrawUnsold();
    expect(await token.balanceOf(issuer.address)).to.equal(TOKENS_PER_TICKET * BigInt(MAX_TICKETS - 2));
    await expect(presale.withdrawUnsold()).to.be.revertedWith("already withdrawn");
    // Tokens for the two sold tickets stay in the contract for claims.
    expect(await token.balanceOf(await presale.getAddress())).to.equal(TOKENS_PER_TICKET * 2n);
  });
});
