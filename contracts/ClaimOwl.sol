// SPDX-License-Identifier: MIT 

pragma solidity 0.8.9;

import "./MerkleProof.sol";

abstract contract Context {
    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }
}

library SafeMath {
    function add(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 c = a + b;
        require(c >= a, "SafeMath: addition overflow");
        return c;
    }

    function sub(uint256 a, uint256 b) internal pure returns (uint256) {
        return sub(a, b, "SafeMath: subtraction overflow");
    }

    function sub(uint256 a, uint256 b, string memory errorMessage) internal pure returns (uint256) {
        require(b <= a, errorMessage);
        uint256 c = a - b;
        return c;
    }

    function mul(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a == 0) {
            return 0;
        }
        uint256 c = a * b;
        require(c / a == b, "SafeMath: multiplication overflow");
        return c;
    }

    function div(uint256 a, uint256 b) internal pure returns (uint256) {
        return div(a, b, "SafeMath: division by zero");
    }

    function div(uint256 a, uint256 b, string memory errorMessage) internal pure returns (uint256) {
        require(b > 0, errorMessage);
        uint256 c = a / b;
        return c;
    }

}

contract Ownable is Context {
    address private _owner;
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor () {
        address msgSender = _msgSender();
        _owner = msgSender;
        emit OwnershipTransferred(address(0), msgSender);
    }

    function owner() public view returns (address) {
        return _owner;
    }

    modifier onlyOwner() {
        require(_owner == _msgSender(), "Ownable: caller is not the owner");
        _;
    }

    function renounceOwnership() public virtual onlyOwner {
        emit OwnershipTransferred(_owner, address(0));
        _owner = address(0);
    }

}

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
}

contract ClaimOwl is Context, Ownable {
    using SafeMath for uint256;

    address private _tokenAddress;
    bytes32 private _merkleRoot;

    mapping(address => bool) private _claimedAddresses;

    constructor (
        address tokenAddress,
        bytes32 merkleRoot
    ) {
        _tokenAddress = tokenAddress;
        _merkleRoot = merkleRoot;
    }

    // function setTokenAddress(address tokenAddress) external onlyOwner {
    //     _tokenAddress = tokenAddress;
    // }

    // function setRoot(bytes32 merkleRoot) external onlyOwner {
    //     _merkleRoot = merkleRoot;
    // }

    function getMerkleRoot() public view returns (bytes32) {
        return _merkleRoot;
    }

    function claim(address account, uint256 amount, bytes32[] calldata proof) external {
        require(!_claimedAddresses[account], 'ClaimOwl: Drop already claimed.');
        require(verifyProof(account, amount, proof), 'ClaimOwl: Invalid proof.');

        uint256 tokenBalance = IERC20(_tokenAddress).balanceOf(address(this));
        require(tokenBalance >= amount, "ClaimOwl: Not enough tokens in contract");

        _claimedAddresses[account] = true;
        IERC20(_tokenAddress).transfer(account, amount);
    }

    function isClaimed(address account) public view returns (bool) {
        return _claimedAddresses[account];
    }

    function verifyProof(address account, uint256 amount, bytes32[] calldata proof) public view returns (bool) {
        bytes32 node = keccak256(abi.encodePacked(account, amount));
        return MerkleProof.verify(proof, _merkleRoot, node);
    }

    function withdraw() external onlyOwner {
        uint256 tokenBalance = IERC20(_tokenAddress).balanceOf(address(this));
        IERC20(_tokenAddress).transfer(owner(), tokenBalance);
    }

    receive() external payable {}
}