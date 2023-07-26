// SPDX-License-Identifier: MIT 

pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ClaimOwl is Context, Ownable {
    using SafeERC20 for IERC20;

    address private _tokenAddress;
    bytes32 private _merkleRoot;

    // keeps track of who has claimed
    mapping(address => bool) private _isClaimed;

    constructor (
        address tokenAddress,
        bytes32 merkleRoot
    ) {
        require(tokenAddress != address(0), "ClaimOwl: Token address cannot be 0");
        require(merkleRoot != bytes32(0), "ClaimOwl: Merkle root cannot be 0");

        _tokenAddress = tokenAddress;
        _merkleRoot = merkleRoot;
    }

    // this function can be used to withdraw tokens back to the owner
    function withdraw() external onlyOwner {
        uint256 tokenBalance = IERC20(_tokenAddress).balanceOf(address(this));
        IERC20(_tokenAddress).safeTransfer(owner(), tokenBalance);
    }

    function withdrawETH() external onlyOwner {
        uint256 ethBalance = address(this).balance;
        payable(owner()).transfer(ethBalance);
    }

    function getRoot() external view returns (bytes32) {
        return _merkleRoot;
    }

    // check if an address has claimed
    function isClaimed(address account) external view returns (bool) {
        return _isClaimed[account];
    }

    function claim(address account, uint256 amount, bytes32[] calldata proof) external {
        require(!_isClaimed[account], 'ClaimOwl: Already claimed');
        require(_verifyProof(account, amount, proof), 'ClaimOwl: Invalid proof');

        uint256 tokenBalance = IERC20(_tokenAddress).balanceOf(address(this));
        require(tokenBalance >= amount, "ClaimOwl: Not enough funds");

        _isClaimed[account] = true;
        IERC20(_tokenAddress).safeTransfer(account, amount);
    }

    // this function is used to verify the proof before calling claim
    function _verifyProof(address account, uint256 amount, bytes32[] calldata proof) private view returns (bool) {
        bytes32 node = keccak256(abi.encodePacked(account, amount));
        return MerkleProof.verify(proof, _merkleRoot, node);
    }

    receive() external payable {}
}