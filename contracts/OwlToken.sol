// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract OwlToken is ERC20 {

    constructor(
        uint256 _totalAmount
    ) ERC20("Foo", "BAR") {
        _mint(msg.sender, _totalAmount);
    }

}