// SPDX-License-Identifier: MIT 

pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./MockUniswapV2.sol";

import "hardhat/console.sol";

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

    // holder discounts: multi-step linear
    uint256[] private _holderDiscountValues;
    uint256[] private _holderDiscountSteps;

    // apps can set custom taxes to their users: wallet => mode => taxFee
    mapping(address => mapping(string => uint256)) private _customTaxFee;
    mapping(address => mapping(string => bool)) private _customTaxFeeEnabled;

    // OWL balances of users
    mapping(address => uint256) private _owlBalances;


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

        _taxDiscountOwl = 30000; // 30%

        // starting holder discounts (OWL: Discount%)
        // 0-5K: 0-20%
        // 5K-30K: 20-50%
        // 30K-60K: 50-80%
        // 60K+: 80%
        _holderDiscountValues = [20000, 30000, 30000]; // 20%, 50%, 80%
        _holderDiscountSteps = [5000e18, 30000e18, 60000e18]; // 5K, 35K, 95K
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
        require(taxFee >= 0 && taxFee <= 100000, "OwlRouter: tax fee must be between 0 and 100000");
        // taxFee is represented in 1e3, so 1000 = 1%
        _taxFee[mode] = taxFee;
    }

    function getTaxFee(string memory mode) external view returns (uint256) {
        return _taxFee[mode];
    }

    function setTaxDiscount(uint256 taxDiscountOwl) external onlyOwner {
        require(taxDiscountOwl >= 0 && taxDiscountOwl <= 100000, "OwlRouter: tax discount must be between 0 and 100000");
        _taxDiscountOwl = taxDiscountOwl;
    }

    function getTaxDiscount() external view returns (uint256) {
        return _taxDiscountOwl;
    }

    function setHolderDiscount(uint256[] memory holderDiscountValues, uint256[] memory holderDiscountSteps) external onlyOwner {
        require(holderDiscountValues.length == holderDiscountSteps.length, "OwlRouter: holderDiscountValues and holderDiscountSteps must have the same length");
        
        for (uint256 i = 0; i < holderDiscountValues.length; i++) {
            require(holderDiscountValues[i] >= 0 && holderDiscountValues[i] <= 100000, "OwlRouter: holderDiscountValues must be between 0 and 100000");
            require(holderDiscountSteps[i] >= 0, "OwlRouter: holderDiscountSteps must be greater than 0");
        }

        _holderDiscountValues = holderDiscountValues;
        _holderDiscountSteps = holderDiscountSteps;
    }

    function getHolderDiscount() external view returns (uint256[] memory, uint256[] memory) {
        return (_holderDiscountValues, _holderDiscountSteps);
    }

    function setCustomFee(string memory mode, uint256 taxFee) external {
        // taxFee is represented in 1e3, so 1000 = 1%
        _customTaxFee[_msgSender()][mode] = taxFee;
        _customTaxFeeEnabled[_msgSender()][mode] = true;
    }

    function getCustomFee(string memory mode) external view returns (uint256) {
        require(_customTaxFeeEnabled[_msgSender()][mode], "OwlRouter: custom tax fee is not enabled");
        return _customTaxFee[_msgSender()][mode];
    }


    // manage OWL within the contract

    function deposit(uint256 amount) external {
        IERC20(_owlAddress).safeTransferFrom(_msgSender(), address(this), amount);
        _owlBalances[_msgSender()] = _owlBalances[_msgSender()].add(amount);
    }

    function withdraw(uint256 amount) external {
        require(_owlBalances[_msgSender()] >= amount, "OwlRouter: sender does not have enough OWL balance");
        _owlBalances[_msgSender()] = _owlBalances[_msgSender()].sub(amount);
        IERC20(_owlAddress).safeTransfer(_msgSender(), amount);
    }

    function balanceOf(address wallet) external view returns (uint256) {
        return _owlBalances[wallet];
    }


    // --- check wallet's holder discount  ---

    function getMyHolderDiscount() public view returns (uint256) {
        uint256 holderDiscount = 0;
        uint256 balanceLeft = IERC20(_owlAddress).balanceOf(_msgSender());

        for (uint256 i = 0; i < _holderDiscountSteps.length; i++) {
            if (balanceLeft < _holderDiscountSteps[i]) {
                holderDiscount = holderDiscount.add(balanceLeft.mul(_holderDiscountValues[i]).div(_holderDiscountSteps[i]));
                break;
            }

            holderDiscount = holderDiscount.add(_holderDiscountValues[i]);
            balanceLeft = balanceLeft.sub(_holderDiscountSteps[i]);
        }

        return holderDiscount;
    }


    // --- tax sending functions --- 

    function _sendTaxETH(uint256 amount, string memory mode) private returns (uint256) {
        require(_taxFee[mode] >= 0, "OwlRouter: tax fee is not set");
        
        if (_taxFee[mode] == 0) {
            return 0;
        }

        uint256 taxAmount = amount.mul(_taxFee[mode]).div(100000); // 1000 == 1%
        taxAmount = taxAmount.sub(taxAmount.mul(getMyHolderDiscount()).div(100000)); // holder discount
        payable(_taxWallet).transfer(taxAmount);
        return taxAmount;
    }

    function _sendTax(address tokenAddress, uint256 amount, string memory mode) private returns (uint256) {
        require(_taxFee[mode] >= 0, "OwlRouter: tax fee is not set");

        if (_taxFee[mode] == 0) {
            return 0;
        }

        uint256 taxAmount = amount.mul(_taxFee[mode]).div(100000); // 1000 == 1%
        taxAmount = taxAmount.sub(taxAmount.mul(getMyHolderDiscount()).div(100000)); // holder discount
        IERC20(tokenAddress).safeTransferFrom(_msgSender(), _taxWallet, taxAmount);
        return taxAmount;
    }

    function _sendTaxOWL(address tokenAddress, uint256 amount, string memory mode) private returns (uint256) {
        require(_taxFee[mode] >= 0, "OwlRouter: tax fee is not set");

        if (_taxFee[mode] == 0) {
            return 0;
        }

        uint256 taxAmount = amount.mul(_taxFee[mode]).div(100000); // 1000 == 1%
        taxAmount = taxAmount.sub(taxAmount.mul(getMyHolderDiscount()).div(100000)); // holder discount
        // apply discount for paying with OWL
        taxAmount = taxAmount.sub(taxAmount.mul(_taxDiscountOwl).div(100000));

        uint256 owlAmount;
        if (tokenAddress == _owlAddress) {
            owlAmount = taxAmount;
        }
        else {
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
            owlAmount = IUniswapV2Router02(_uniswapV2RouterAddress).getAmountsOut(ethAmount, path)[1];
        }

        require(_owlBalances[_msgSender()] >= owlAmount, "OwlRouter: sender does not have enough OWL balance");

        // transfer OWL to tax wallet
        _owlBalances[_msgSender()] = _owlBalances[_msgSender()].sub(owlAmount);
        _owlBalances[_taxWallet] = _owlBalances[_taxWallet].add(owlAmount);
        return owlAmount;
    }

    function _sendTaxETHWithCustomFee(uint256 amount, string memory mode, address appWallet) private returns (uint256) {
        require(_customTaxFeeEnabled[appWallet][mode], "OwlRouter: custom tax fee is not enabled");

        if (_customTaxFee[appWallet][mode] == 0) {
            return 0;
        }

        // transfer regular tax from app wallet to tax wallet (OWL)
        uint256 taxAmount = amount.mul(_taxFee[mode]).div(100000); // 1000 == 1%

        // get amount of OWL worth of ETH
        address[] memory path = new address[](2);
        path[0] = IUniswapV2Router02(_uniswapV2RouterAddress).WETH();
        path[1] = _owlAddress;
        uint256 owlAmount = IUniswapV2Router02(_uniswapV2RouterAddress).getAmountsOut(taxAmount, path)[1];

        require(_owlBalances[appWallet] >= owlAmount, "OwlRouter: app wallet does not have enough OWL balance");

        // transfer OWL from app wallet to tax wallet
        _owlBalances[appWallet] = _owlBalances[appWallet].sub(owlAmount);
        _owlBalances[_taxWallet] = _owlBalances[_taxWallet].add(owlAmount);

        // transfer custom tax from sender to app wallet
        taxAmount = amount.mul(_customTaxFee[appWallet][mode]).div(100000); // 1000 == 1%
        payable(appWallet).transfer(taxAmount);
        return taxAmount;
    }

    function _sendTaxWithCustomFee(address tokenAddress, uint256 amount, string memory mode, address appWallet) private returns (uint256) {
        require(_customTaxFeeEnabled[appWallet][mode], "OwlRouter: custom tax fee is not enabled");

        if (_customTaxFee[appWallet][mode] == 0) {
            return 0;
        }

        // transfer regular tax from app wallet to tax wallet (OWL)
        uint256 taxAmount = amount.mul(_taxFee[mode]).div(100000); // 1000 == 1%

        // get amount of OWL worth of token
        address[] memory path = new address[](3);
        path[0] = tokenAddress;
        path[1] = IUniswapV2Router02(_uniswapV2RouterAddress).WETH();
        path[2] = _owlAddress;
        uint256 owlAmount = IUniswapV2Router02(_uniswapV2RouterAddress).getAmountsOut(taxAmount, path)[2];

        require(_owlBalances[appWallet] >= owlAmount, "OwlRouter: app wallet does not have enough OWL balance");

        // transfer OWL from app wallet to tax wallet
        _owlBalances[appWallet] = _owlBalances[appWallet].sub(owlAmount);
        _owlBalances[_taxWallet] = _owlBalances[_taxWallet].add(owlAmount);

        // transfer custom tax from sender to app wallet
        taxAmount = amount.mul(_customTaxFee[appWallet][mode]).div(100000); // 1000 == 1%
        IERC20(tokenAddress).safeTransferFrom(_msgSender(), appWallet, taxAmount);
        return taxAmount;
    }

    function _sendTaxOWLWithCustomFee(address tokenAddress, uint256 amount, string memory mode, address appWallet) private returns (uint256) {
        require(_customTaxFeeEnabled[appWallet][mode], "OwlRouter: custom tax fee is not enabled");

        if (_customTaxFee[appWallet][mode] == 0) {
            return 0;
        }

        // transfer regular tax from app wallet to tax wallet (OWL)
        uint256 taxAmount = amount.mul(_taxFee[mode]).div(100000); // 1000 == 1%

        uint256 owlAmount;

        if (tokenAddress == _owlAddress) {
            owlAmount = taxAmount;
        }
        else {
            // token is ETH
            if (tokenAddress == address(0)) {
                address[] memory path = new address[](2);
                path[0] = IUniswapV2Router02(_uniswapV2RouterAddress).WETH();
                path[1] = _owlAddress;
                owlAmount = IUniswapV2Router02(_uniswapV2RouterAddress).getAmountsOut(taxAmount, path)[1];
            }
            else {
                address[] memory path = new address[](3);
                path[0] = tokenAddress;
                path[1] = IUniswapV2Router02(_uniswapV2RouterAddress).WETH();
                path[2] = _owlAddress;
                owlAmount = IUniswapV2Router02(_uniswapV2RouterAddress).getAmountsOut(taxAmount, path)[2];
            }
        }

        require(_owlBalances[appWallet] >= owlAmount, "OwlRouter: app wallet does not have enough OWL balance");

        // transfer OWL from app to tax wallet
        _owlBalances[appWallet] = _owlBalances[appWallet].sub(owlAmount);
        _owlBalances[_taxWallet] = _owlBalances[_taxWallet].add(owlAmount);

        // transfer custom tax from sender to app wallet
        taxAmount = amount.mul(_customTaxFee[appWallet][mode]).div(100000); // 1000 == 1%
        // if token is ETH
        if (tokenAddress == address(0)) {
            address[] memory path = new address[](2);
            path[0] = IUniswapV2Router02(_uniswapV2RouterAddress).WETH();
            path[1] = _owlAddress;
            owlAmount = IUniswapV2Router02(_uniswapV2RouterAddress).getAmountsOut(taxAmount, path)[1];
        }
        else {
            address[] memory path = new address[](3);
            path[0] = tokenAddress;
            path[1] = IUniswapV2Router02(_uniswapV2RouterAddress).WETH();
            path[2] = _owlAddress;
            owlAmount = IUniswapV2Router02(_uniswapV2RouterAddress).getAmountsOut(taxAmount, path)[2];
        }

        require(_owlBalances[_msgSender()] >= owlAmount, "OwlRouter: sender does not have enough OWL balance");

        // transfer OWL to app wallet
        _owlBalances[_msgSender()] = _owlBalances[_msgSender()].sub(owlAmount);
        _owlBalances[appWallet] = _owlBalances[appWallet].add(owlAmount);
        return owlAmount;
    }


    // --- transfer functions ---

    function _transferETH(address payable recipient, bool payWithOWL, string memory mode, address appWallet) private {
        require(_msgSender().balance >= msg.value, "OwlRouter: sender does not have enough balance");

        if (payWithOWL) {
            if (appWallet == address(0)) {
                _sendTaxOWL(address(0), msg.value, mode);
            }
            else {
                _sendTaxOWLWithCustomFee(address(0), msg.value, mode, appWallet);
            }
            recipient.transfer(msg.value);
        }
        else {
            uint256 taxAmount;
            if (appWallet == address(0)) {
                taxAmount = _sendTaxETH(msg.value, mode);
            }
            else {
                taxAmount = _sendTaxETHWithCustomFee(msg.value, mode, appWallet);
            }
            recipient.transfer(msg.value.sub(taxAmount));
        }
    }

    function _transfer(address recipient, address tokenAddress, uint256 amount, bool payWithOWL, string memory mode, address appWallet) private {
        require(IERC20(tokenAddress).balanceOf(_msgSender()) >= amount, "OwlRouter: sender does not have enough balance");

        if (payWithOWL) {
            if (appWallet == address(0)) {
                _sendTaxOWL(tokenAddress, amount, mode);
            }
            else {
                _sendTaxOWLWithCustomFee(tokenAddress, amount, mode, appWallet);
            }
            IERC20(tokenAddress).safeTransferFrom(_msgSender(), recipient, amount);
        }
        else {
            uint256 taxAmount;
            if (appWallet == address(0)) {
                taxAmount = _sendTax(tokenAddress, amount, mode);
            }
            else {
                taxAmount = _sendTaxWithCustomFee(tokenAddress, amount, mode, appWallet);
            }
            IERC20(tokenAddress).safeTransferFrom(_msgSender(), recipient, amount.sub(taxAmount));
        }
    }

    function transfer(address recipient, address tokenAddress, uint256 amount, bool payWithOWL, string memory mode) external {
        _transfer(recipient, tokenAddress, amount, payWithOWL, mode, address(0));
    }

    function transferETHWithCustomFee(address payable recipient, bool payWithOWL, string memory mode, address appWallet) external payable {
        _transferETH(recipient, payWithOWL, mode, appWallet);
    }

    function transferETH(address payable recipient, bool payWithOWL, string memory mode) external payable {
        _transferETH(recipient, payWithOWL, mode, address(0));
    }

    function transferWithCustomFee(address recipient, address tokenAddress, uint256 amount, bool payWithOWL, string memory mode, address appWallet) external {
        _transfer(recipient, tokenAddress, amount, payWithOWL, mode, appWallet);
    }


    // --- swap functions ---

    function _swapETHForTokens(address tokenAddress, uint256 amountOutMin, bool payWithOWL, string memory mode, address appWallet) private {
        require(msg.value > 0, "OwlRouter: amount must be greater than 0");

        address[] memory path = new address[](2);
        path[0] = IUniswapV2Router02(_uniswapV2RouterAddress).WETH();
        path[1] = tokenAddress;

        uint256[] memory amounts = IUniswapV2Router02(_uniswapV2RouterAddress).getAmountsOut(msg.value, path);
        require(amounts[1] >= amountOutMin, "OwlRouter: amountOut is less than amountOutMin");

        if (payWithOWL) {
            if (appWallet == address(0)) {
                _sendTaxOWL(address(0), msg.value, mode);
            }
            else {
                _sendTaxOWLWithCustomFee(address(0), msg.value, mode, appWallet);
            }
            IUniswapV2Router02(_uniswapV2RouterAddress).swapExactETHForTokensSupportingFeeOnTransferTokens{value: msg.value}(amountOutMin, path, _msgSender(), block.timestamp);
        }
        else {
            uint256 taxAmount;
            if (appWallet == address(0)) {
                taxAmount = _sendTaxETH(msg.value, mode);
            }
            else {
                taxAmount = _sendTaxETHWithCustomFee(msg.value, mode, appWallet);
            }
            IUniswapV2Router02(_uniswapV2RouterAddress).swapExactETHForTokensSupportingFeeOnTransferTokens{value: msg.value.sub(taxAmount)}(amountOutMin, path, _msgSender(), block.timestamp);
        }
    }

    function _swapTokensForETH(address tokenAddress, uint256 amountIn, uint256 amountOutMin, bool payWithOWL, string memory mode, address appWallet) private {
        require(IERC20(tokenAddress).balanceOf(_msgSender()) >= amountIn, "OwlRouter: sender does not have enough balance");

        address[] memory path = new address[](2);
        path[0] = tokenAddress;
        path[1] = IUniswapV2Router02(_uniswapV2RouterAddress).WETH();

        IERC20(tokenAddress).safeTransferFrom(_msgSender(), address(this), amountIn);
        IERC20(tokenAddress).safeApprove(_uniswapV2RouterAddress, amountIn);
        
        uint256[] memory amounts = IUniswapV2Router02(_uniswapV2RouterAddress).getAmountsOut(amountIn, path);
        require(amounts[1] >= amountOutMin, "OwlRouter: amountOut is less than amountOutMin");

        if (payWithOWL) {
            if (appWallet == address(0)) {
                _sendTaxOWL(tokenAddress, amountIn, mode);
            }
            else {
                _sendTaxOWLWithCustomFee(tokenAddress, amountIn, mode, appWallet);
            }
            IUniswapV2Router02(_uniswapV2RouterAddress).swapExactTokensForETHSupportingFeeOnTransferTokens(amountIn, amountOutMin, path, _msgSender(), block.timestamp);
        }
        else {
            IUniswapV2Router02(_uniswapV2RouterAddress).swapExactTokensForETHSupportingFeeOnTransferTokens(amountIn, amountOutMin, path, address(this), block.timestamp);
            uint256 taxAmount;
            if (appWallet == address(0)) {
                taxAmount = _sendTaxETH(amounts[1], mode);
            }
            else {
                taxAmount = _sendTaxETHWithCustomFee(amounts[1], mode, appWallet);
            }
            payable(_msgSender()).transfer(amounts[1].sub(taxAmount));
        }
    }

    function _swapTokensForTokens(address tokenAddressIn, address tokenAddressOut, uint256 amountIn, uint256 amountOutMin, bool payWithOWL, string memory mode, address appWallet) private {
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
            if (appWallet == address(0)) {
                _sendTaxOWL(tokenAddressIn, amountIn, mode);
            }
            else {
                _sendTaxOWLWithCustomFee(tokenAddressIn, amountIn, mode, appWallet);
            }
            IUniswapV2Router02(_uniswapV2RouterAddress).swapExactTokensForTokensSupportingFeeOnTransferTokens(amountIn, amountOutMin, path, _msgSender(), block.timestamp);
        }
        else {
            uint256 taxAmount;
            if (appWallet == address(0)) {
                taxAmount = _sendTax(tokenAddressIn, amountIn, mode);
            }
            else {
                taxAmount = _sendTaxWithCustomFee(tokenAddressIn, amountIn, mode, appWallet);
            }
            IERC20(tokenAddressIn).safeTransferFrom(_msgSender(), address(this), amountIn.sub(taxAmount));
            IERC20(tokenAddressIn).safeApprove(_uniswapV2RouterAddress, amountIn.sub(taxAmount));
            IUniswapV2Router02(_uniswapV2RouterAddress).swapExactTokensForTokensSupportingFeeOnTransferTokens(amountIn.sub(taxAmount), amountOutMin, path, _msgSender(), block.timestamp);
        }
    }

    function swapETHForTokens(address tokenAddress, uint256 amountOutMin, bool payWithOWL, string memory mode) external payable {
        _swapETHForTokens(tokenAddress, amountOutMin, payWithOWL, mode, address(0));
    }

    function swapETHForTokensWithCustomFee(address tokenAddress, uint256 amountOutMin, bool payWithOWL, string memory mode, address appWallet) external payable {
        _swapETHForTokens(tokenAddress, amountOutMin, payWithOWL, mode, appWallet);
    }

    function swapTokensForETH(address tokenAddress, uint256 amountIn, uint256 amountOutMin, bool payWithOWL, string memory mode) external {
        _swapTokensForETH(tokenAddress, amountIn, amountOutMin, payWithOWL, mode, address(0));
    }

    function swapTokensForETHWithCustomFee(address tokenAddress, uint256 amountIn, uint256 amountOutMin, bool payWithOWL, string memory mode, address appWallet) external {
        _swapTokensForETH(tokenAddress, amountIn, amountOutMin, payWithOWL, mode, appWallet);
    }

    function swapTokensForTokens(address tokenAddressIn, address tokenAddressOut, uint256 amountIn, uint256 amountOutMin, bool payWithOWL, string memory mode) external {
        _swapTokensForTokens(tokenAddressIn, tokenAddressOut, amountIn, amountOutMin, payWithOWL, mode, address(0));
    }

    function swapTokensForTokensWithCustomFee(address tokenAddressIn, address tokenAddressOut, uint256 amountIn, uint256 amountOutMin, bool payWithOWL, string memory mode, address appWallet) external {
        _swapTokensForTokens(tokenAddressIn, tokenAddressOut, amountIn, amountOutMin, payWithOWL, mode, appWallet);
    }


    // --- default contract functions ---

    receive() external payable {}

}