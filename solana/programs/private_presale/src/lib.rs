//! Darkbid private presale for Solana.
//!
//! Same design and same circuits as the Robinhood Chain contract:
//!  - every contribution is one identical ticket, so amounts carry no information;
//!  - buyers prove allowlist membership in zero knowledge;
//!  - after the sale ends a ticket is redeemed to any wallet with a proof that
//!    does not reveal which ticket it is.
//!
//! All 32-byte field elements are big-endian. A public key is turned into a
//! field element by zeroing its first byte (see `pubkey_to_field`).
use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

mod merkle;
mod verifier;
mod verifying_keys;

use merkle::{MerkleTree, LEVELS};

declare_id!("8Uuy6eUyQq2ncwcifwcEVfNZjCmRbzaMdGfGfQCVcYPm");

pub const SALE_SEED: &[u8] = b"sale";
pub const VAULT_SEED: &[u8] = b"vault";
pub const ELIGIBILITY_SEED: &[u8] = b"eligibility";
pub const CLAIM_SEED: &[u8] = b"claim";

/// Zeroing the top byte keeps any 32 bytes below the BN254 field size.
pub fn pubkey_to_field(key: &Pubkey) -> [u8; 32] {
    let mut out = key.to_bytes();
    out[0] = 0;
    out
}

fn u64_to_field(v: u64) -> [u8; 32] {
    let mut out = [0u8; 32];
    out[24..].copy_from_slice(&v.to_be_bytes());
    out
}

#[program]
pub mod private_presale {
    use super::*;

    #[allow(clippy::too_many_arguments)]
    pub fn initialize_sale(
        ctx: Context<InitializeSale>,
        seed: u64,
        ticket_price: u64,
        tokens_per_ticket: u64,
        max_tickets: u32,
        max_per_buyer: u16,
        allow_root: [u8; 32],
        start_time: i64,
        end_time: i64,
    ) -> Result<()> {
        require!(ticket_price > 0 && tokens_per_ticket > 0, PresaleError::BadPrice);
        require!(max_tickets > 0 && max_tickets <= 1u32 << LEVELS, PresaleError::BadMaxTickets);
        require!(max_per_buyer > 0, PresaleError::BadPerBuyerCap);
        require!(start_time < end_time, PresaleError::BadTimes);
        require!(merkle::is_field_element(&allow_root), PresaleError::NotAFieldElement);

        let sale_key = ctx.accounts.sale.key();
        let sale = &mut ctx.accounts.sale.load_init()?;
        sale.authority = ctx.accounts.authority.key();
        sale.mint = ctx.accounts.mint.key();
        sale.vault = ctx.accounts.vault.key();
        sale.seed = seed;
        sale.ticket_price = ticket_price;
        sale.tokens_per_ticket = tokens_per_ticket;
        sale.max_tickets = max_tickets;
        sale.max_per_buyer = max_per_buyer;
        sale.allow_root = allow_root;
        sale.start_time = start_time;
        sale.end_time = end_time;
        sale.sale_id = pubkey_to_field(&sale_key);
        sale.tickets_sold = 0;
        sale.unsold_withdrawn = 0;
        sale.bump = ctx.bumps.sale;
        sale.vault_bump = ctx.bumps.vault;
        sale.tree.init()?;
        Ok(())
    }

    /// Buy one ticket. `commitment` = Poseidon(nullifier, secret), kept by the buyer.
    pub fn contribute(
        ctx: Context<Contribute>,
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
        eligibility_nullifier: [u8; 32],
        commitment: [u8; 32],
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let (inputs, ticket_price) = {
            let sale = ctx.accounts.sale.load()?;
            require!(now >= sale.start_time && now < sale.end_time, PresaleError::SaleNotOpen);
            require!(sale.tickets_sold < sale.max_tickets, PresaleError::SoldOut);
            require!(
                commitment != [0u8; 32] && merkle::is_field_element(&commitment),
                PresaleError::NotAFieldElement
            );
            (
                [sale.allow_root, eligibility_nullifier, sale.sale_id, u64_to_field(sale.max_per_buyer as u64), commitment],
                sale.ticket_price,
            )
        };
        verifier::verify(&verifying_keys::ELIGIBILITY_VK, &proof_a, &proof_b, &proof_c, &inputs)
            .map_err(|_| error!(PresaleError::BadEligibilityProof))?;

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.sale.to_account_info(),
                },
            ),
            ticket_price,
        )?;

        let leaf_index = {
            let mut sale = ctx.accounts.sale.load_mut()?;
            sale.tickets_sold += 1;
            sale.tree.insert(commitment)?
        };
        ctx.accounts.eligibility_record.bump = ctx.bumps.eligibility_record;

        emit!(TicketPurchased { sale: ctx.accounts.sale.key(), commitment, leaf_index });
        Ok(())
    }

    /// Redeem one ticket to `recipient`. Anyone may submit it (for example a
    /// relayer); the proof fixes the recipient, relayer and fee.
    pub fn claim(
        ctx: Context<Claim>,
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
        root: [u8; 32],
        nullifier_hash: [u8; 32],
        relayer: Pubkey,
        fee: u64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let (authority, seed, bump, tokens_per_ticket) = {
            let sale = ctx.accounts.sale.load()?;
            require!(now >= sale.end_time, PresaleError::SaleNotEnded);
            require!(fee <= sale.tokens_per_ticket, PresaleError::FeeTooHigh);
            require!(sale.tree.is_known_root(&root), PresaleError::UnknownRoot);
            (sale.authority, sale.seed, sale.bump, sale.tokens_per_ticket)
        };

        let inputs = [
            root,
            nullifier_hash,
            pubkey_to_field(&ctx.accounts.recipient.key()),
            pubkey_to_field(&relayer),
            u64_to_field(fee),
        ];
        verifier::verify(&verifying_keys::CLAIM_VK, &proof_a, &proof_b, &proof_c, &inputs)
            .map_err(|_| error!(PresaleError::BadClaimProof))?;

        ctx.accounts.claim_record.bump = ctx.bumps.claim_record;

        let seed = seed.to_le_bytes();
        let bump = [bump];
        let signer: &[&[&[u8]]] = &[&[SALE_SEED, authority.as_ref(), &seed, &bump]];
        let to_recipient = tokens_per_ticket - fee;

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.recipient_token.to_account_info(),
                    authority: ctx.accounts.sale.to_account_info(),
                },
                signer,
            ),
            to_recipient,
        )?;

        if fee > 0 {
            let relayer_token = ctx.accounts.relayer_token.as_ref().ok_or(error!(PresaleError::MissingRelayerAccount))?;
            require_keys_eq!(relayer_token.owner, relayer, PresaleError::WrongRelayerAccount);
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: relayer_token.to_account_info(),
                        authority: ctx.accounts.sale.to_account_info(),
                    },
                    signer,
                ),
                fee,
            )?;
        }

        emit!(TicketClaimed { sale: ctx.accounts.sale.key(), nullifier_hash, recipient: ctx.accounts.recipient.key(), relayer, fee });
        Ok(())
    }

    /// Issuer collects the SOL raised once the sale is over.
    pub fn withdraw_proceeds(ctx: Context<IssuerOnly>) -> Result<()> {
        let end_time = ctx.accounts.sale.load()?.end_time;
        require!(Clock::get()?.unix_timestamp >= end_time, PresaleError::SaleNotEnded);
        let sale_info = ctx.accounts.sale.to_account_info();
        let rent_floor = Rent::get()?.minimum_balance(sale_info.data_len());
        let amount = sale_info.lamports().saturating_sub(rent_floor);
        **sale_info.try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.authority.to_account_info().try_borrow_mut_lamports()? += amount;
        Ok(())
    }

    /// Issuer takes back the tokens for tickets that were never sold.
    pub fn withdraw_unsold(ctx: Context<WithdrawUnsold>) -> Result<()> {
        let (amount, authority, seed, bump) = {
            let mut sale = ctx.accounts.sale.load_mut()?;
            require!(Clock::get()?.unix_timestamp >= sale.end_time, PresaleError::SaleNotEnded);
            require!(sale.unsold_withdrawn == 0, PresaleError::AlreadyWithdrawn);
            require_keys_eq!(ctx.accounts.authority_token.mint, sale.mint, PresaleError::WrongMint);
            sale.unsold_withdrawn = 1;
            ((sale.max_tickets - sale.tickets_sold) as u64 * sale.tokens_per_ticket, sale.authority, sale.seed, sale.bump)
        };
        let seed = seed.to_le_bytes();
        let bump = [bump];
        let signer: &[&[&[u8]]] = &[&[SALE_SEED, authority.as_ref(), &seed, &bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.authority_token.to_account_info(),
                    authority: ctx.accounts.sale.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;
        Ok(())
    }
}

// ---------------------------------------------------------------- accounts

/// Zero-copy: read in place, because it is too large to copy onto the 4 KB stack.
/// Fields are ordered so the C layout has no padding.
#[account(zero_copy)]
pub struct Sale {
    pub seed: u64,
    pub ticket_price: u64,
    pub tokens_per_ticket: u64,
    pub start_time: i64,
    pub end_time: i64,
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub allow_root: [u8; 32],
    pub sale_id: [u8; 32],
    pub tree: MerkleTree,
    pub max_tickets: u32,
    pub tickets_sold: u32,
    pub max_per_buyer: u16,
    pub unsold_withdrawn: u8,
    pub bump: u8,
    pub vault_bump: u8,
    pub _padding: [u8; 3],
}

impl Sale {
    pub const SPACE: usize = 8 + std::mem::size_of::<Sale>();
}

/// Existence of this account marks one allowlist allowance as spent.
#[account]
pub struct NullifierRecord {
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct InitializeSale<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = Sale::SPACE,
        seeds = [SALE_SEED, authority.key().as_ref(), &seed.to_le_bytes()],
        bump
    )]
    pub sale: AccountLoader<'info, Sale>,
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        payer = authority,
        seeds = [VAULT_SEED, sale.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = sale
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(proof_a: [u8; 64], proof_b: [u8; 128], proof_c: [u8; 64], eligibility_nullifier: [u8; 32])]
pub struct Contribute<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut)]
    pub sale: AccountLoader<'info, Sale>,
    /// Fails to initialise if this allowance was already used.
    #[account(
        init,
        payer = buyer,
        space = 8 + 1,
        seeds = [ELIGIBILITY_SEED, sale.key().as_ref(), &eligibility_nullifier],
        bump
    )]
    pub eligibility_record: Account<'info, NullifierRecord>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(proof_a: [u8; 64], proof_b: [u8; 128], proof_c: [u8; 64], root: [u8; 32], nullifier_hash: [u8; 32])]
pub struct Claim<'info> {
    /// Whoever submits the claim pays for the new accounts; usually the relayer.
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(has_one = vault, has_one = mint)]
    pub sale: AccountLoader<'info, Sale>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    /// Fails to initialise if this ticket was already claimed.
    #[account(
        init,
        payer = payer,
        space = 8 + 1,
        seeds = [CLAIM_SEED, sale.key().as_ref(), &nullifier_hash],
        bump
    )]
    pub claim_record: Account<'info, NullifierRecord>,
    /// CHECK: any wallet; it is bound into the claim proof.
    pub recipient: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = recipient
    )]
    pub recipient_token: Account<'info, TokenAccount>,
    /// Receives the relayer fee; required when the fee is above zero.
    #[account(mut, token::mint = mint)]
    pub relayer_token: Option<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct IssuerOnly<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority)]
    pub sale: AccountLoader<'info, Sale>,
}

#[derive(Accounts)]
pub struct WithdrawUnsold<'info> {
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority, has_one = vault)]
    pub sale: AccountLoader<'info, Sale>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::authority = authority)]
    pub authority_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

// ---------------------------------------------------------------- events & errors

#[event]
pub struct TicketPurchased {
    pub sale: Pubkey,
    pub commitment: [u8; 32],
    pub leaf_index: u32,
}

#[event]
pub struct TicketClaimed {
    pub sale: Pubkey,
    pub nullifier_hash: [u8; 32],
    pub recipient: Pubkey,
    pub relayer: Pubkey,
    pub fee: u64,
}

#[error_code]
pub enum PresaleError {
    #[msg("Bad price")]
    BadPrice,
    #[msg("Bad max tickets")]
    BadMaxTickets,
    #[msg("Bad per-buyer cap")]
    BadPerBuyerCap,
    #[msg("Bad times")]
    BadTimes,
    #[msg("Value is not a field element")]
    NotAFieldElement,
    #[msg("Sale is not open")]
    SaleNotOpen,
    #[msg("Sold out")]
    SoldOut,
    #[msg("Bad eligibility proof")]
    BadEligibilityProof,
    #[msg("Sale has not ended")]
    SaleNotEnded,
    #[msg("Fee too high")]
    FeeTooHigh,
    #[msg("Unknown root")]
    UnknownRoot,
    #[msg("Bad claim proof")]
    BadClaimProof,
    #[msg("Relayer token account is required when the fee is above zero")]
    MissingRelayerAccount,
    #[msg("Relayer token account does not belong to the relayer")]
    WrongRelayerAccount,
    #[msg("Already withdrawn")]
    AlreadyWithdrawn,
    #[msg("Merkle tree is full")]
    TreeFull,
    #[msg("Token account has the wrong mint")]
    WrongMint,
    #[msg("Poseidon hash failed")]
    HashFailed,
}
