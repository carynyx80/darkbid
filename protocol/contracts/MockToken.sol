// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test-only sale token.
contract MockToken is ERC20 {
    constructor(uint256 supply) ERC20("Mock Sale Token", "MOCK") {
        _mint(msg.sender, supply);
    }
}
