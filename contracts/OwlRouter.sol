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

    // discount on fee when paying tax with OWL
    uint256 private _taxDiscountOwl;

    constructor (
        address owlAddress,
        address uniswapV2RouterAddress
    ) {
        _owlAddress = owlAddress;
        _uniswapV2RouterAddress = uniswapV2RouterAddress;
        _taxWallet = owner();

        // starting tax fee
        _taxFee["transfer"] = 0; // 0%
        _taxFee["swap"] = 500; // 0.5%
        _taxFee["snipe"] = 1000; // 1%

        _taxDiscountOwl = 30; // 30%

    }


    // --- manage tax ---

    function setTaxWallet(address taxWallet) external {
        require(_msgSender() == owner() || _msgSender() == _taxWallet, "OwlRouter: caller is not the owner or tax wallet");
        _taxWallet = taxWallet;
    }

    function getTaxWallet() external view returns (address) {
        return _taxWallet;
    }

    function setTaxFee(string memory mode, uint256 taxFee) external onlyOwner {
        // taxFee is represented in 1e3, so 1000 = 1%
        _taxFee[mode] = taxFee;
    }

    function getTaxFee(string memory mode) external view returns (uint256) {
        return _taxFee[mode];
    }

    function setTaxDiscount(uint256 taxDiscountOwl) external onlyOwner {
        _taxDiscountOwl = taxDiscountOwl;
    }

    function getTaxDiscount() external view returns (uint256) {
        return _taxDiscountOwl;
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

        // apply discount for paying with OWL
        taxAmount = taxAmount.sub(taxAmount.mul(_taxDiscountOwl).div(100));

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


    // --- transfer functions ---

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


    // --- swap functions ---

    function swapETHForTokens(address tokenAddress, uint256 amountOutMin, bool payWithOWL) external payable {
        require(msg.value > 0, "OwlRouter: amount must be greater than 0");

        address[] memory path = new address[](2);
        path[0] = IUniswapV2Router02(_uniswapV2RouterAddress).WETH();
        path[1] = tokenAddress;

        uint256[] memory amounts = IUniswapV2Router02(_uniswapV2RouterAddress).getAmountsOut(msg.value, path);
        require(amounts[1] >= amountOutMin, "OwlRouter: amountOut is less than amountOutMin");

        if (payWithOWL) {
            _sendTaxOWL(address(0), msg.value, "swap");
            IUniswapV2Router02(_uniswapV2RouterAddress).swapExactETHForTokensSupportingFeeOnTransferTokens{value: msg.value}(amountOutMin, path, _msgSender(), block.timestamp);
        }
        else {
            uint256 taxAmount = _sendTaxETH(msg.value, "swap");
            IUniswapV2Router02(_uniswapV2RouterAddress).swapExactETHForTokensSupportingFeeOnTransferTokens{value: msg.value.sub(taxAmount)}(amountOutMin, path, _msgSender(), block.timestamp);
        }
    }

    function swapTokensForETH(address tokenAddress, uint256 amountIn, uint256 amountOutMin, bool payWithOWL) external {
        require(IERC20(tokenAddress).balanceOf(_msgSender()) >= amountIn, "OwlRouter: sender does not have enough balance");

        address[] memory path = new address[](2);
        path[0] = tokenAddress;
        path[1] = IUniswapV2Router02(_uniswapV2RouterAddress).WETH();

        IERC20(tokenAddress).safeTransferFrom(_msgSender(), address(this), amountIn);
        IERC20(tokenAddress).safeApprove(_uniswapV2RouterAddress, amountIn);
        
        uint256[] memory amounts = IUniswapV2Router02(_uniswapV2RouterAddress).getAmountsOut(amountIn, path);
        require(amounts[1] >= amountOutMin, "OwlRouter: amountOut is less than amountOutMin");

        if (payWithOWL) {
            _sendTaxOWL(tokenAddress, amountIn, "swap");
            IUniswapV2Router02(_uniswapV2RouterAddress).swapExactTokensForETHSupportingFeeOnTransferTokens(amountIn, amountOutMin, path, _msgSender(), block.timestamp);
        }
        else {
            IUniswapV2Router02(_uniswapV2RouterAddress).swapExactTokensForETHSupportingFeeOnTransferTokens(amountIn, amountOutMin, path, address(this), block.timestamp);
            uint256 taxAmount = _sendTaxETH(amounts[1], "swap");
            payable(_msgSender()).transfer(amounts[1].sub(taxAmount));
        }
    }

    function swapTokensForTokens(address tokenAddressIn, address tokenAddressOut, uint256 amountIn, uint256 amountOutMin, bool payWithOWL) external {
        require(IERC20(tokenAddressIn).balanceOf(_msgSender()) >= amountIn, "OwlRouter: sender does not have enough balance");

        address[] memory path = new address[](3);
        path[0] = tokenAddressIn;
        path[1] = IUniswapV2Router02(_uniswapV2RouterAddress).WETH();
        path[2] = tokenAddressOut;


        if (payWithOWL) {
            IERC20(tokenAddressIn).safeTransferFrom(_msgSender(), address(this), amountIn);
            IERC20(tokenAddressIn).safeApprove(_uniswapV2RouterAddress, amountIn);
            uint256[] memory amounts = IUniswapV2Router02(_uniswapV2RouterAddress).getAmountsOut(amountIn, path);
            require(amounts[2] >= amountOutMin, "OwlRouter: amountOut is less than amountOutMin");
            _sendTaxOWL(tokenAddressIn, amountIn, "swap");
            IUniswapV2Router02(_uniswapV2RouterAddress).swapExactTokensForTokensSupportingFeeOnTransferTokens(amountIn, amountOutMin, path, _msgSender(), block.timestamp);
        }
        else {
            uint256 taxAmount = _sendTax(tokenAddressIn, amountIn, "swap");
            IERC20(tokenAddressIn).safeTransferFrom(_msgSender(), address(this), amountIn.sub(taxAmount));
            IERC20(tokenAddressIn).safeApprove(_uniswapV2RouterAddress, amountIn.sub(taxAmount));
            IUniswapV2Router02(_uniswapV2RouterAddress).swapExactTokensForTokensSupportingFeeOnTransferTokens(amountIn.sub(taxAmount), amountOutMin, path, _msgSender(), block.timestamp);
        }
    }


    // --- default contract functions ---

    function withdraw() external onlyOwner {
        uint256 ethBalance = address(this).balance;
        payable(owner()).transfer(ethBalance);
    }

    receive() external payable {}

}