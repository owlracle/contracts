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
    // uniswap v2 router address
    address private _uniswapV2RouterAddress;
    // address of the tax wallet
    address private _taxWallet;

    // mappings of tax fee for each mode
    // number are represented in 1e3, so 1000 = 1%
    mapping(string => uint256) private _taxFee;


    constructor (
        address owlAddress,
        address uniswapV2RouterAddress
    ) {
        _owlAddress = owlAddress;
        _uniswapV2RouterAddress = uniswapV2RouterAddress;
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

    function _sendTaxOWL(address tokenAddress, uint256 amount, string memory mode) private returns (uint256) {
        require(_taxFee[mode] >= 0, "OwlRouter: tax fee is not set");

        if (_taxFee[mode] == 0) {
            return 0;
        }

        uint256 taxAmount = amount.mul(_taxFee[mode]).div(100000); // 1000 == 1%

        // if token is ETH
        uint256 ethAmount;
        address[] memory path = new address[](2);
        if (tokenAddress != address(0)) {
            // get amount of ETH worth of tokens
            path[0] = tokenAddress;
            path[1] = IUniswapV2Router02(_uniswapV2RouterAddress).WETH();
            ethAmount = IUniswapV2Router02(_uniswapV2RouterAddress).getAmountsOut(taxAmount, path)[1];
        }
        else {
            ethAmount = taxAmount;
        }

        // get amount of OWL worth of ETH
        path[0] = IUniswapV2Router02(_uniswapV2RouterAddress).WETH();
        path[1] = _owlAddress;
        uint256 owlAmount = IUniswapV2Router02(_uniswapV2RouterAddress).getAmountsOut(ethAmount, path)[1];

        require(IERC20(_owlAddress).balanceOf(_msgSender()) >= owlAmount, "OwlRouter: sender does not have enough OWL balance");

        // transfer OWL to tax wallet
        IERC20(_owlAddress).safeTransferFrom(_msgSender(), _taxWallet, owlAmount);
        return owlAmount;
    }


    // --- swap and tranfer functions ---

    function transferETH(address payable recipient, bool payWithOWL) external payable {
        require(_msgSender().balance >= msg.value, "OwlRouter: sender does not have enough balance");

        if (payWithOWL) {
            _sendTaxOWL(address(0), msg.value, "transfer");
            recipient.transfer(msg.value);
        }
        else {
            uint256 taxAmount = _sendTaxETH(msg.value, "transfer");
            recipient.transfer(msg.value.sub(taxAmount));
        }
    }

    function transfer(address recipient, address tokenAddress, uint256 amount, bool payWithOWL) external {
        require(IERC20(tokenAddress).balanceOf(_msgSender()) >= amount, "OwlRouter: sender does not have enough balance");

        if (tokenAddress == _owlAddress) {
            payWithOWL = false;
        }
        
        if (payWithOWL) {
            _sendTaxOWL(tokenAddress, amount, "transfer");
            IERC20(tokenAddress).safeTransferFrom(_msgSender(), recipient, amount);
        }
        else {
            uint256 taxAmount = _sendTax(tokenAddress, amount, "transfer");
            IERC20(tokenAddress).safeTransferFrom(_msgSender(), recipient, amount.sub(taxAmount));
        }
    }


    // --- default contract functions ---

    function withdraw() external onlyOwner {
        uint256 ethBalance = address(this).balance;
        payable(owner()).transfer(ethBalance);
    }

    receive() external payable {}

}