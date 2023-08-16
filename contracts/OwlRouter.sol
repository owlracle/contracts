// SPDX-License-Identifier: MIT 

pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./MockUniswapV2.sol";

contract OwlRouter is Context, Ownable {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;


    // address of the OWL token
    address private _owlAddress;
    // address of the uniswap v2 router
    address private _uniV2RouterAddress;
    // address of the tax wallet
    address private _taxWallet;

    // mappings of tax fee for each mode
    // number are represented in 1e3, so 1000 = 1%
    mapping(string => uint256) private _taxFee;


    constructor (
        address owlAddress,
        address uniswapV2RouterAddress
    ) {
        _uniV2RouterAddress = uniswapV2RouterAddress;
        _owlAddress = owlAddress;
        _taxWallet = owner();

        // starting tax fee
        _taxFee["transfer"] = 0; // 0%
        _taxFee["swap"] = 100; // 0.1%
        _taxFee["snipe"] = 500; // 0.5%
    }


    // --- manage tax ---

    function setTaxWallet(address taxWallet) external {
        require(_msgSender() == owner() || _msgSender() == _taxWallet, "OwlRouter: caller is not the owner or tax wallet");
        _taxWallet = taxWallet;
    }

    function setTaxFee(string memory mode, uint256 taxFee) external onlyOwner {
        // taxFee is represented in 1e3, so 1000 = 1%
        _taxFee[mode] = taxFee;
    }

    function getTaxFee(string memory mode) external view returns (uint256) {
        return _taxFee[mode];
    }


    // --- private functions to help handle routing --- 

    function _sendTaxETH(uint256 amount, string memory mode) private returns (uint256) {
        require(_taxFee[mode] >= 0, "OwlRouter: tax fee is not set");
        
        if (_taxFee[mode] == 0) {
            return 0;
        }

        uint256 taxAmount = amount.mul(_taxFee[mode]).div(100000); // 1000 == 1%
        payable(_taxWallet).transfer(taxAmount);
        return taxAmount;
    }

    function _sendTax(address tokenAddress, uint256 amount, string memory mode) private returns (uint256) {
        require(_taxFee[mode] >= 0, "OwlRouter: tax fee is not set");

        if (_taxFee[mode] == 0) {
            return 0;
        }

        uint256 taxAmount = amount.mul(_taxFee[mode]).div(100000); // 1000 == 1%
        IERC20(tokenAddress).safeTransferFrom(_msgSender(), _taxWallet, taxAmount);
        return taxAmount;
    }


    // --- swap and tranfer functions ---

    function transferETH(address payable recipient) external payable {
        require(_msgSender().balance >= msg.value, "OwlRouter: sender does not have enough balance");
        uint256 taxAmount = _sendTaxETH(msg.value, "transfer");
        recipient.transfer(msg.value.sub(taxAmount));
    }

    function transfer(address recipient, address tokenAddress, uint256 amount) external {
        require(IERC20(tokenAddress).balanceOf(_msgSender()) >= amount, "OwlRouter: sender does not have enough balance");
        uint256 taxAmount = _sendTax(tokenAddress, amount, "transfer");
        IERC20(tokenAddress).safeTransferFrom(_msgSender(), recipient, amount.sub(taxAmount));
    }


    // --- default contract functions ---

    function withdraw() external onlyOwner {
        uint256 ethBalance = address(this).balance;
        payable(owner()).transfer(ethBalance);
    }

    receive() external payable {}

}