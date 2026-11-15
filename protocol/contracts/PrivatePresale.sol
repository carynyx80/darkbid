// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IncrementalMerkleTree} from "./IncrementalMerkleTree.sol";

interface IEligibilityVerifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[5] calldata pubSignals
    ) external view returns (bool);
}

interface IClaimVerifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[5] calldata pubSignals
    ) external view returns (bool);
}

/// @title PrivatePresale
/// @notice Fixed-price presale where the link between the wallet that pays
///         and the wallet that receives tokens is hidden from everyone,
///         including the issuer.
///
///  - Every contribution is one identical "ticket" (same price, same token
///    amount), so amounts carry no information.
///  - Buyers prove allowlist membership in zero knowledge, so nobody learns
///    which allowlist entry bought.
///  - After the sale ends, a ticket is redeemed to any address with a
///    zero-knowledge proof that does not reveal which ticket it is.
contract PrivatePresale is IncrementalMerkleTree, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Proof {
        uint256[2] a;
        uint256[2][2] b;
        uint256[2] c;
    }

    IERC20 public immutable token;
    address public immutable issuer;
    IEligibilityVerifier public immutable eligibilityVerifier;
    IClaimVerifier public immutable claimVerifier;

    uint256 public immutable ticketPrice; // wei per ticket
    uint256 public immutable tokensPerTicket;
    uint32 public immutable maxTickets;
    uint16 public immutable maxPerBuyer; // tickets per allowlist identity
    uint256 public immutable allowRoot; // Merkle root of Poseidon(identitySecret)
    uint64 public immutable startTime;
    uint64 public immutable endTime;
    uint256 public immutable saleId;

    uint32 public ticketsSold;
    bool public unsoldWithdrawn;

    mapping(uint256 => bool) public eligibilityNullifierUsed;
    mapping(uint256 => bool) public claimNullifierUsed;
    mapping(uint256 => bool) public commitmentUsed;

    event TicketPurchased(uint256 indexed commitment, uint32 leafIndex);
    event TicketClaimed(uint256 nullifierHash, address indexed recipient, address indexed relayer, uint256 fee);

    constructor(
        IERC20 token_,
        IEligibilityVerifier eligibilityVerifier_,
        IClaimVerifier claimVerifier_,
        uint256 ticketPrice_,
        uint256 tokensPerTicket_,
        uint32 maxTickets_,
        uint16 maxPerBuyer_,
        uint256 allowRoot_,
        uint64 startTime_,
        uint64 endTime_
    ) {
        require(ticketPrice_ > 0 && tokensPerTicket_ > 0, "bad price");
        require(maxTickets_ > 0 && maxTickets_ <= uint32(1) << LEVELS, "bad max tickets");
        require(maxPerBuyer_ > 0, "bad per-buyer cap");
        require(startTime_ < endTime_, "bad times");

        token = token_;
        issuer = msg.sender;
        eligibilityVerifier = eligibilityVerifier_;
        claimVerifier = claimVerifier_;
        ticketPrice = ticketPrice_;
        tokensPerTicket = tokensPerTicket_;
        maxTickets = maxTickets_;
        maxPerBuyer = maxPerBuyer_;
        allowRoot = allowRoot_;
        startTime = startTime_;
        endTime = endTime_;
        saleId = uint256(keccak256(abi.encode(block.chainid, address(this)))) % FIELD_SIZE;
    }

    /// @notice Buy one ticket. `commitment` = Poseidon(nullifier, secret),
    ///         kept by the buyer and needed later to claim.
    function contribute(Proof calldata proof, uint256 eligibilityNullifier, uint256 commitment)
        external
        payable
        nonReentrant
    {
        require(block.timestamp >= startTime && block.timestamp < endTime, "sale not open");
        require(msg.value == ticketPrice, "wrong payment");
        require(ticketsSold < maxTickets, "sold out");
        require(commitment != 0 && commitment < FIELD_SIZE, "bad commitment");
        require(!commitmentUsed[commitment], "commitment used");
        require(!eligibilityNullifierUsed[eligibilityNullifier], "allowance used");

        require(
            eligibilityVerifier.verifyProof(
                proof.a,
                proof.b,
                proof.c,
                [allowRoot, eligibilityNullifier, saleId, uint256(maxPerBuyer), commitment]
            ),
            "bad eligibility proof"
        );

        eligibilityNullifierUsed[eligibilityNullifier] = true;
        commitmentUsed[commitment] = true;
        ticketsSold += 1;

        uint32 index = _insert(commitment);
        emit TicketPurchased(commitment, index);
    }

    /// @notice Redeem one ticket for tokens, to any address. Anyone (for
    ///         example a relayer) may submit this; the proof fixes the
    ///         recipient, relayer and fee.
    function claim(
        Proof calldata proof,
        uint256 root,
        uint256 nullifierHash,
        address recipient,
        address relayer,
        uint256 fee
    ) external nonReentrant {
        require(block.timestamp >= endTime, "sale not ended");
        require(fee <= tokensPerTicket, "fee too high");
        require(!claimNullifierUsed[nullifierHash], "already claimed");
        require(isKnownRoot(root), "unknown root");

        require(
            claimVerifier.verifyProof(
                proof.a,
                proof.b,
                proof.c,
                [root, nullifierHash, uint256(uint160(recipient)), uint256(uint160(relayer)), fee]
            ),
            "bad claim proof"
        );

        claimNullifierUsed[nullifierHash] = true;

        token.safeTransfer(recipient, tokensPerTicket - fee);
        if (fee > 0) token.safeTransfer(relayer, fee);
        emit TicketClaimed(nullifierHash, recipient, relayer, fee);
    }

    /// @notice Issuer collects the funds raised once the sale is over.
    function withdrawProceeds() external nonReentrant {
        require(msg.sender == issuer, "not issuer");
        require(block.timestamp >= endTime, "sale not ended");
        (bool ok, ) = issuer.call{value: address(this).balance}("");
        require(ok, "transfer failed");
    }

    /// @notice Issuer takes back tokens for tickets that were never sold.
    function withdrawUnsold() external nonReentrant {
        require(msg.sender == issuer, "not issuer");
        require(block.timestamp >= endTime, "sale not ended");
        require(!unsoldWithdrawn, "already withdrawn");
        unsoldWithdrawn = true;
        token.safeTransfer(issuer, uint256(maxTickets - ticketsSold) * tokensPerTicket);
    }
}
