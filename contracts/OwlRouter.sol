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
    mapping(string => bool) private _taxFeeEnabled;

    // discount on fee when paying tax with OWL
    uint256 private _taxDiscountOwl;

    // holder discounts: multi-step linear
    uint256[] private _holderDiscountValues;
    uint256[] private _holderDiscountSteps;

    // apps can set custom taxes to their users: wallet => mode => taxFee
    mapping(address => mapping(string => uint256)) private _customTaxFee;
    mapping(address => mapping(string => string)) private _customTaxFeeMode;
    mapping(address => mapping(string => bool)) private _customTaxFeeEnabled;

    // OWL balances of users
    mapping(address => uint256) private _owlBalances;

    // referral system
    mapping(address => address) private _referrals;
    uint256 private _referralBonus;


    constructor (
        address owlAddress,
        address uniswapV2RouterAddress,
        string[] memory modes,
        uint256[] memory taxFees,
        uint256 taxDiscountOwl,
        uint256[] memory holderDiscountValues,
        uint256[] memory holderDiscountSteps,
        uint256 referralBonus
    ) {
        _owlAddress = owlAddress;
        _uniswapV2RouterAddress = uniswapV2RouterAddress;
        _taxWallet = owner();

        // starting tax fee
        for (uint256 i = 0; i < modes.length; i++) {
            require(taxFees[i] >= 0 && taxFees[i] <= 100000, "OwlRouter: tax fee must be between 0 and 100000");
            _taxFee[modes[i]] = taxFees[i];
            _taxFeeEnabled[modes[i]] = true;
        }

        _taxDiscountOwl = taxDiscountOwl;
        _holderDiscountValues = holderDiscountValues;
        _holderDiscountSteps = holderDiscountSteps;
        _referralBonus = referralBonus;
    }


    // --- Tax management functions --- 

    /**
     * @dev Sets the address of the tax wallet.
     * @param taxWallet The address of the new tax wallet.
     * @notice This function can only be called by the owner or the current tax wallet.
     * @notice The tax wallet is the address that receives the tax fees for each transaction.
    */
    function setTaxWallet(address taxWallet) external {
        require(_msgSender() == owner() || _msgSender() == _taxWallet, "OwlRouter: caller is not the owner or tax wallet");
        _taxWallet = taxWallet;
    }

    /**
     * @dev Returns the address of the tax wallet.
     * @return The address of the tax wallet.
    */
    function getTaxWallet() external view returns (address) {
        return _taxWallet;
    }

    /**
     * @dev Sets the fee for a specific mode.
     * @param mode The mode to set the fee for.
     * @param taxFee The fee to set.
     * @notice This function can only be called by the owner.
     * @notice The fee is represented in 1e3, so 1000 = 1%.
     * @notice The fee is applied to the amount of tokens being transfered/swapped.
    */
    function setTaxFee(string memory mode, uint256 taxFee) external onlyOwner {
        require(taxFee >= 0 && taxFee <= 100000, "OwlRouter: tax fee must be between 0 and 100000");
        // taxFee is represented in 1e3, so 1000 = 1%
        _taxFee[mode] = taxFee;
        _taxFeeEnabled[mode] = true;
    }

    /**
     * @dev Disables the fee for a specific mode.
     * @param mode The mode to disable the fee for.
     * @notice This function can only be called by the owner.
     * @notice The fee is represented in 1e3, so 1000 = 1%.
     * @notice This can be used to disable all custom fees based on this original mode.
    */
    function disableTaxFee(string memory mode) external onlyOwner {
        _taxFeeEnabled[mode] = false;
    }

    /**
     * @dev Returns the fee for a specific mode.
     * @param mode The mode to get the fee for.
     * @return The fee for the specified mode.
     * @notice The fee is represented in 1e3, so 1000 = 1%.
    */
    function getTaxFee(string memory mode) external view returns (uint256) {
        require(_taxFeeEnabled[mode], "OwlRouter: invalid mode");
        return _taxFee[mode];
    }

    /**
     * @dev Sets the fee discount when paying with OWL.
     * @param taxDiscountOwl The fee discount to set.
     * @notice The fee discount is represented in 1e3, so 1000 = 1%.
    */
    function setTaxDiscount(uint256 taxDiscountOwl) external onlyOwner {
        require(taxDiscountOwl >= 0 && taxDiscountOwl <= 100000, "OwlRouter: tax discount must be between 0 and 100000");
        _taxDiscountOwl = taxDiscountOwl;
    }

    /**
     * @dev Returns the fee discount when paying with OWL.
     * @return The fee discount when paying with OWL.
     * @notice The fee discount is represented in 1e3, so 1000 = 1%.
    */
    function getTaxDiscount() external view returns (uint256) {
        return _taxDiscountOwl;
    }

    /**
     * @dev Sets the holder discounts.
     * @param holderDiscountValues The holder discount values to set.
     * @param holderDiscountSteps The holder discount steps to set.
     * @notice Values are represented in 1e3, so 1000 = 1%.
     * @notice Steps are represented in 1e18, so 1e18 = 1 OWL.
     * @notice The holder discount is applied to the tax fees.
     * @notice The holder discount is calculated using a multi-step linear function.
     * @notice Example: [20000, 30000, 30000] and [5000e18, 30000e18, 60000e18] means:
     * - 0-5K: 0-20%
     * - 5K-30K: 20-50%
     * - 30K-60K: 50-80%
     * - 60K+: 80%
    */
    function setHolderDiscount(uint256[] memory holderDiscountValues, uint256[] memory holderDiscountSteps) external onlyOwner {
        require(holderDiscountValues.length == holderDiscountSteps.length, "OwlRouter: holderDiscountValues and holderDiscountSteps must have the same length");
        
        for (uint256 i = 0; i < holderDiscountValues.length; i++) {
            require(holderDiscountValues[i] >= 0 && holderDiscountValues[i] <= 100000, "OwlRouter: holderDiscountValues must be between 0 and 100000");
            require(holderDiscountSteps[i] >= 0, "OwlRouter: holderDiscountSteps must be greater than 0");
        }

        _holderDiscountValues = holderDiscountValues;
        _holderDiscountSteps = holderDiscountSteps;
    }

    /**
     * @dev Returns the holder discounts.
     * @return The holder discount values and steps.
     * @notice Values are represented in 1e3, so 1000 = 1%.
     * @notice Steps are represented in 1e18, so 1e18 = 1 OWL.
    */
    function getHolderDiscount() external view returns (uint256[] memory, uint256[] memory) {
        return (_holderDiscountValues, _holderDiscountSteps);
    }

    /**
     * @dev Sets the custom fee for a specific mode. The custom fee is used by apps using the Owlracle API.
     * @param mode The mode to set the fee for.
     * @param taxFee The fee to set.
     * @notice The fee is represented in 1e3, so 1000 = 1%.
     * @notice The fee is applied to the amount of tokens being transfered/swapped to the wallet calling the Owlracle API.
     * @notice The app wallet will pay the regular tax fee to the tax wallet.
    */
    function setCustomFee(string memory mode, string memory originalMode, uint256 taxFee) external {
        require(taxFee >= 0 && taxFee <= 100000, "OwlRouter: tax fee must be between 0 and 100000");
        require(_taxFeeEnabled[originalMode], "OwlRouter: invalid original mode");
        // taxFee is represented in 1e3, so 1000 = 1%
        _customTaxFee[_msgSender()][mode] = taxFee;
        _customTaxFeeMode[_msgSender()][mode] = originalMode;
        _customTaxFeeEnabled[_msgSender()][mode] = true;
    }

    /**
     * @dev Returns the custom fee for a specific mode.
     * @param mode The mode to get the fee for.
     * @return The fee for the specified mode.
     * @notice The fee is represented in 1e3, so 1000 = 1%.
    */
    function getCustomFee(string memory mode) external view returns (uint256) {
        require(_customTaxFeeEnabled[_msgSender()][mode], "OwlRouter: invalid mode");
        require(_taxFeeEnabled[_customTaxFeeMode[_msgSender()][mode]], "OwlRouter: invalid original mode");
        return _customTaxFee[_msgSender()][mode];
    }

    /**
     * @dev Sets the referral bonus.
     * @param referralBonus The referral bonus to set.
     * @notice The referral bonus is represented in 1e3, so 1000 = 1%.
     * @notice The referrer will receive the referral bonus of the tax fee when their referee pays the tax fee with OWL.
     * @notice The referee will receive the referral bonus as tax discount when they pay the tax fee with OWL.
    */
    function setReferralBonus(uint256 referralBonus) external onlyOwner {
        require(referralBonus >= 0 && referralBonus <= 100000, "OwlRouter: referral bonus must be between 0 and 100000");
        _referralBonus = referralBonus;
    }

    /**
     * @dev Returns the referral bonus.
     * @return The referral bonus.
     * @notice The referral bonus is represented in 1e3, so 1000 = 1%.
    */
    function getReferralBonus() external view returns (uint256) {
        return _referralBonus;
    }

    /**
     * @dev Set a wallet as the referrer for the sender.
     * @param referral The wallet to set as the referrer.
     */
    function setReferral(address referral) external {
        _referrals[_msgSender()] = referral;
    }

    /**
     * @dev Returns the referrer for a wallet.
     * @param wallet The wallet to get the referrer for.
     * @return The referrer for the specified wallet.
     */
    function getReferral(address wallet) external view returns (address) {
        return _referrals[wallet];
    }


    // --- Contract OWL balance management functions ---

    /**
     * @dev Deposits OWL tokens to the contract.
     * @param amount The amount of OWL tokens to deposit.
     * @notice The OWL tokens are used to pay the tax fees.
     */
    function deposit(uint256 amount) external {
        IERC20(_owlAddress).safeTransferFrom(_msgSender(), address(this), amount);
        _owlBalances[_msgSender()] = _owlBalances[_msgSender()].add(amount);
    }

    /**
     * @dev Withdraws OWL tokens from the contract.
     * @param amount The amount of OWL tokens to withdraw.
     */
    function withdraw(uint256 amount) external {
        require(_owlBalances[_msgSender()] >= amount, "OwlRouter: sender does not have enough OWL balance");
        _owlBalances[_msgSender()] = _owlBalances[_msgSender()].sub(amount);
        IERC20(_owlAddress).safeTransfer(_msgSender(), amount);
    }

    /**
     * @dev Returns the OWL balance of a wallet which has been deposited to the contract.
     * @param wallet The wallet to get the OWL balance for.
     * @return The OWL balance of the specified wallet.
     */
    function balanceOf(address wallet) external view returns (uint256) {
        return _owlBalances[wallet];
    }

    /**
     * @dev Returns the discount for the sender based on their OWL balance.
     * @return The discount for the sender based on their OWL balance.
     * @notice The discount is represented in 1e3, so 1000 = 1%.
     * @notice The discount is applied to the tax fee when paying with OWL.
     */
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


    // --- External transfer functions ---

    /**
     * @dev Transfers ETH to a recipient.
     * @param recipient The recipient to transfer ETH to.
     * @param payWithOWL Whether to pay the tax fee with OWL.
     * @param mode The mode to use for the tax fee.
     * @notice If payWithOwl is false, the tax fee is applied to the amount of ETH being transfered, otherwise it is applied to the amount of OWL deposited to the contract.
     * @notice The tax fee is sent to the tax wallet.
     * @notice The mode must be previously set by the owner.
     */
    function transferETH(address payable recipient, bool payWithOWL, string memory mode) external payable {
        _transferETH(recipient, payWithOWL, mode, address(0));
    }

    /**
     * @dev Transfers ETH to a recipient.
     * @param recipient The recipient to transfer ETH to.
     * @param payWithOWL Whether to pay the tax fee with OWL.
     * @param mode The mode to use for the tax fee.
     * @notice If payWithOwl is false, the tax fee is applied to the amount of tokens being transfered, otherwise it is applied to the amount of OWL deposited to the contract.
     * @notice The tax fee is sent to the tax wallet.
     * @notice The mode must be previously set by the owner.
     */
    function transfer(address recipient, address tokenAddress, uint256 amount, bool payWithOWL, string memory mode) external {
        _transfer(recipient, tokenAddress, amount, payWithOWL, mode, address(0));
    }

    /**
     * @dev Transfers ETH to a recipient with a custom fee.
     * @param recipient The recipient to transfer ETH to.
     * @param payWithOWL Whether to pay the tax fee with OWL.
     * @param mode The mode to use for the tax fee.
     * @param appWallet The wallet to receive the custom tax fee.
     * @notice Same as transferETH, but the custom tax fee is sent to the app wallet instead of the tax wallet.
     * @notice The app wallet will pay the regular tax fee to the tax wallet using OWL deposited in the contract.
     * @notice There is no pay with OWL or holder discounts when paying the custom tax fee.
     */
    function transferETHWithCustomFee(address payable recipient, bool payWithOWL, string memory mode, address appWallet) external payable {
        _transferETH(recipient, payWithOWL, mode, appWallet);
    }

    /**
     * @dev Transfers tokens to a recipient with a custom fee.
     * @param recipient The recipient to transfer tokens to.
     * @param tokenAddress The address of the token to transfer.
     * @param amount The amount of tokens to transfer.
     * @param payWithOWL Whether to pay the tax fee with OWL.
     * @param mode The mode to use for the tax fee.
     * @param appWallet The wallet to receive the custom tax fee.
     * @notice Same as transfer, but the custom tax fee is sent to the app wallet instead of the tax wallet.
     * @notice The app wallet will pay the regular tax fee to the tax wallet using OWL deposited in the contract.
     * @notice There is no pay with OWL or holder discounts when paying the custom tax fee.
     */
    function transferWithCustomFee(address recipient, address tokenAddress, uint256 amount, bool payWithOWL, string memory mode, address appWallet) external {
        _transfer(recipient, tokenAddress, amount, payWithOWL, mode, appWallet);
    }


    // --- External swap functions ---

    /**
     * @dev Swaps ETH for tokens.
     * @param tokenAddress The address of the token to swap for.
     * @param amountOutMin The minimum amount of tokens to receive.
     * @param payWithOWL Whether to pay the tax fee with OWL.
     * @param mode The mode to use for the tax fee.
     * @notice The mode must be previously set by the owner.
     */
    function swapETHForTokens(address tokenAddress, uint256 amountOutMin, bool payWithOWL, string memory mode) external payable {
        _swapETHForTokens(tokenAddress, amountOutMin, payWithOWL, mode, address(0));
    }

    /**
     * @dev Swaps tokens for ETH.
     * @param tokenAddress The address of the token to swap.
     * @param amountIn The amount of tokens to swap.
     * @param amountOutMin The minimum amount of ETH to receive.
     * @param payWithOWL Whether to pay the tax fee with OWL.
     * @param mode The mode to use for the tax fee.
     * @notice The mode must be previously set by the owner.
     */
    function swapTokensForETH(address tokenAddress, uint256 amountIn, uint256 amountOutMin, bool payWithOWL, string memory mode) external {
        _swapTokensForETH(tokenAddress, amountIn, amountOutMin, payWithOWL, mode, address(0));
    }

    /**
     * @dev Swaps tokens for tokens.
     * @param tokenAddressIn The address of the token to swap.
     * @param tokenAddressOut The address of the token to swap for.
     * @param amountIn The amount of tokens to swap.
     * @param amountOutMin The minimum amount of tokens to receive.
     * @param payWithOWL Whether to pay the tax fee with OWL.
     * @param mode The mode to use for the tax fee.
     * @notice The mode must be previously set by the owner.
     */
    function swapTokensForTokens(address tokenAddressIn, address tokenAddressOut, uint256 amountIn, uint256 amountOutMin, bool payWithOWL, string memory mode) external {
        _swapTokensForTokens(tokenAddressIn, tokenAddressOut, amountIn, amountOutMin, payWithOWL, mode, address(0));
    }

    /**
     * @dev Swaps ETH for tokens with a custom fee.
     * @param tokenAddress The address of the token to swap for.
     * @param amountOutMin The minimum amount of tokens to receive.
     * @param payWithOWL Whether to pay the tax fee with OWL.
     * @param mode The mode to use for the tax fee.
     * @param appWallet The wallet to receive the custom tax fee.
     * @notice Same as swapETHForTokens, but the custom tax fee is sent to the app wallet instead of the tax wallet.
     * @notice The app wallet will pay the regular tax fee to the tax wallet using OWL deposited in the contract.
     * @notice There is no pay with OWL or holder discounts when paying the custom tax fee.
     */
    function swapETHForTokensWithCustomFee(address tokenAddress, uint256 amountOutMin, bool payWithOWL, string memory mode, address appWallet) external payable {
        _swapETHForTokens(tokenAddress, amountOutMin, payWithOWL, mode, appWallet);
    }

    /**
     * @dev Swaps tokens for ETH with a custom fee.
     * @param tokenAddress The address of the token to swap.
     * @param amountIn The amount of tokens to swap.
     * @param amountOutMin The minimum amount of ETH to receive.
     * @param payWithOWL Whether to pay the tax fee with OWL.
     * @param mode The mode to use for the tax fee.
     * @param appWallet The wallet to receive the custom tax fee.
     * @notice Same as swapTokensForETH, but the custom tax fee is sent to the app wallet instead of the tax wallet.
     * @notice The app wallet will pay the regular tax fee to the tax wallet using OWL deposited in the contract.
     * @notice There is no pay with OWL or holder discounts when paying the custom tax fee.
     */
    function swapTokensForETHWithCustomFee(address tokenAddress, uint256 amountIn, uint256 amountOutMin, bool payWithOWL, string memory mode, address appWallet) external {
        _swapTokensForETH(tokenAddress, amountIn, amountOutMin, payWithOWL, mode, appWallet);
    }

    /**
     * @dev Swaps tokens for tokens with a custom fee.
     * @param tokenAddressIn The address of the token to swap.
     * @param tokenAddressOut The address of the token to swap for.
     * @param amountIn The amount of tokens to swap.
     * @param amountOutMin The minimum amount of tokens to receive.
     * @param payWithOWL Whether to pay the tax fee with OWL.
     * @param mode The mode to use for the tax fee.
     * @param appWallet The wallet to receive the custom tax fee.
     * @notice Same as swapTokensForTokens, but the custom tax fee is sent to the app wallet instead of the tax wallet.
     * @notice The app wallet will pay the regular tax fee to the tax wallet using OWL deposited in the contract.
     * @notice There is no pay with OWL or holder discounts when paying the custom tax fee.
     */
    function swapTokensForTokensWithCustomFee(address tokenAddressIn, address tokenAddressOut, uint256 amountIn, uint256 amountOutMin, bool payWithOWL, string memory mode, address appWallet) external {
        _swapTokensForTokens(tokenAddressIn, tokenAddressOut, amountIn, amountOutMin, payWithOWL, mode, appWallet);
    }


    // --- Private transfer functions ---

    /**
     * @dev Private function to transfer ETH to a recipient.
     * @param recipient The recipient to transfer ETH to.
     * @param payWithOWL Whether to pay the tax fee with OWL.
     * @param mode The mode to use for the tax fee.
     * @param appWallet The wallet to receive the custom tax fee.
     */
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

    /**
     * @dev Private function to transfer tokens to a recipient.
     * @param recipient The recipient to transfer tokens to.
     * @param tokenAddress The address of the token to transfer.
     * @param amount The amount of tokens to transfer.
     * @param payWithOWL Whether to pay the tax fee with OWL.
     * @param mode The mode to use for the tax fee.
     * @param appWallet The wallet to receive the custom tax fee.
     */
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


    // --- Private swap functions ---

    /**
     * @dev Swaps ETH for tokens.
     * @param tokenAddress The address of the token to swap for.
     * @param amountOutMin The minimum amount of tokens to receive.
     * @param payWithOWL Whether to pay the tax fee with OWL.
     * @param mode The mode to use for the tax fee.
     * @param appWallet The wallet to receive the custom tax fee.
     */
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

    /**
     * @dev Swaps tokens for ETH.
     * @param tokenAddress The address of the token to swap.
     * @param amountIn The amount of tokens to swap.
     * @param amountOutMin The minimum amount of ETH to receive.
     * @param payWithOWL Whether to pay the tax fee with OWL.
     * @param mode The mode to use for the tax fee.
     * @param appWallet The wallet to receive the custom tax fee.
     */
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

    /**
     * @dev Swaps tokens for tokens.
     * @param tokenAddressIn The address of the token to swap.
     * @param tokenAddressOut The address of the token to swap for.
     * @param amountIn The amount of tokens to swap.
     * @param amountOutMin The minimum amount of tokens to receive.
     * @param payWithOWL Whether to pay the tax fee with OWL.
     * @param mode The mode to use for the tax fee.
     * @param appWallet The wallet to receive the custom tax fee.
     */
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


    // --- Tax fee transfer functions ---

    /**
     * @dev Sends ETH as a tax fee to the tax wallet.
     * @param amount The amount of ETH used in the transaction.
     * @param mode The mode to use for the tax fee.
     * @notice The mode must be previously set by the owner.
     * @notice Holder discounts are applied.
     */
    function _sendTaxETH(uint256 amount, string memory mode) private returns (uint256) {
        require(_taxFeeEnabled[mode], "OwlRouter: invalid mode");
        
        if (_taxFee[mode] == 0) {
            return 0;
        }

        uint256 taxAmount = amount.mul(_taxFee[mode]).div(100000); // 1000 == 1%
        taxAmount = taxAmount.sub(taxAmount.mul(getMyHolderDiscount()).div(100000)); // holder discount
        payable(_taxWallet).transfer(taxAmount);
        return taxAmount;
    }

    /**
     * @dev Sends tokens as a tax fee to the tax wallet.
     * @param tokenAddress The address of the token used in the transaction.
     * @param amount The amount of tokens used in the transaction.
     * @param mode The mode to use for the tax fee.
     * @notice The mode must be previously set by the owner.
     * @notice Holder discounts are applied.
     */
    function _sendTax(address tokenAddress, uint256 amount, string memory mode) private returns (uint256) {
        require(_taxFeeEnabled[mode], "OwlRouter: invalid mode");

        if (_taxFee[mode] == 0) {
            return 0;
        }

        uint256 taxAmount = amount.mul(_taxFee[mode]).div(100000); // 1000 == 1%
        taxAmount = taxAmount.sub(taxAmount.mul(getMyHolderDiscount()).div(100000)); // holder discount
        IERC20(tokenAddress).safeTransferFrom(_msgSender(), _taxWallet, taxAmount);
        return taxAmount;
    }

    /**
     * @dev Sends OWL as a tax fee to the tax wallet.
     * @param tokenAddress The address of the token used in the transaction.
     * @param amount The amount of tokens used in the transaction.
     * @param mode The mode to use for the tax fee.
     * @notice The mode must be previously set by the owner.
     * @notice Holder discounts are applied.
     * @notice Pay with OWL discount is applied.
     * @notice The OWL balance of the sender is used to pay the tax fee, and the OWL balance of the tax wallet is increased. No actual OWL tokens are transfered.
     * @notice The referral bonus is applied.
     */
    function _sendTaxOWL(address tokenAddress, uint256 amount, string memory mode) private returns (uint256) {
        require(_taxFeeEnabled[mode], "OwlRouter: invalid mode");

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
        // transfer referral bonus to referrer and sender
        uint256 taxAfter = _processReferral(owlAmount);
        _owlBalances[_taxWallet] = _owlBalances[_taxWallet].add(taxAfter);
        return owlAmount;
    }

    /**
     * @dev Sends ETH as a tax fee to the app wallet and OWL as a tax fee to the tax wallet.
     * @param amount The amount of ETH used in the transaction.
     * @param mode The mode to use for the tax fee.
     * @param appWallet The wallet to receive the custom tax fee.
     * @notice The mode must be previously set by the owner.
     * @notice The app wallet will pay the regular tax fee to the tax wallet using OWL deposited in the contract.
     */
    function _sendTaxETHWithCustomFee(uint256 amount, string memory mode, address appWallet) private returns (uint256) {
        require(_customTaxFeeEnabled[appWallet][mode], "OwlRouter: invalid mode");

        _chargeAppWallet(address(0), appWallet, amount, mode);
        
        if (_customTaxFee[appWallet][mode] == 0) {
            return 0;
        }

        // transfer custom tax from sender to app wallet
        uint256 taxAmount = amount.mul(_customTaxFee[appWallet][mode]).div(100000); // 1000 == 1%
        payable(appWallet).transfer(taxAmount);
        return taxAmount;
    }

    /**
     * @dev Sends tokens as a tax fee to the app wallet and OWL as a tax fee to the tax wallet.
     * @param tokenAddress The address of the token used in the transaction.
     * @param amount The amount of tokens used in the transaction.
     * @param mode The mode to use for the tax fee.
     * @param appWallet The wallet to receive the custom tax fee.
     * @notice The mode must be previously set by the owner.
     * @notice The app wallet will pay the regular tax fee to the tax wallet using OWL deposited in the contract.
     */
    function _sendTaxWithCustomFee(address tokenAddress, uint256 amount, string memory mode, address appWallet) private returns (uint256) {
        require(_customTaxFeeEnabled[appWallet][mode], "OwlRouter: invalid mode");

        _chargeAppWallet(tokenAddress, appWallet, amount, mode);

        if (_customTaxFee[appWallet][mode] == 0) {
            return 0;
        }

        // transfer custom tax from sender to app wallet
        uint256 taxAmount = amount.mul(_customTaxFee[appWallet][mode]).div(100000); // 1000 == 1%
        IERC20(tokenAddress).safeTransferFrom(_msgSender(), appWallet, taxAmount);
        return taxAmount;
    }

    /**
     * @dev Sends OWL as a tax fee to the app wallet and OWL as a tax fee to the tax wallet.
     * @param tokenAddress The address of the token used in the transaction.
     * @param amount The amount of tokens used in the transaction.
     * @param mode The mode to use for the tax fee.
     * @param appWallet The wallet to receive the custom tax fee.
     * @notice The mode must be previously set by the owner.
     * @notice The app wallet will pay the regular tax fee to the tax wallet using OWL deposited in the contract.
     */
    function _sendTaxOWLWithCustomFee(address tokenAddress, uint256 amount, string memory mode, address appWallet) private returns (uint256) {
        require(_customTaxFeeEnabled[appWallet][mode], "OwlRouter: invalid mode");

        _chargeAppWallet(tokenAddress, appWallet, amount, mode);

        if (_customTaxFee[appWallet][mode] == 0) {
            return 0;
        }

        // transfer custom tax from sender to app wallet
        uint256 taxAmount = amount.mul(_customTaxFee[appWallet][mode]).div(100000); // 1000 == 1%
        uint256 owlAmount;

        if (tokenAddress == _owlAddress) {
            owlAmount = taxAmount;
        }
        else {
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
        }

        require(_owlBalances[_msgSender()] >= owlAmount, "OwlRouter: sender does not have enough OWL balance");

        // transfer OWL to app wallet
        _owlBalances[_msgSender()] = _owlBalances[_msgSender()].sub(owlAmount);
        _owlBalances[appWallet] = _owlBalances[appWallet].add(owlAmount);
        return owlAmount;
    }

    /**
     * @dev Charges the app wallet with the tax fee.
     * @param tokenAddress The address of the token used in the transaction.
     * @param appWallet The wallet to charge the tax fee to.
     * @param amount The amount of tokens used in the transaction.
     * @param mode The mode to use for the tax fee.
     * @notice The mode must be previously set by the owner.
     * @notice The app wallet will pay the regular tax fee to the tax wallet using OWL deposited in the contract.
     */
    function _chargeAppWallet(address tokenAddress, address appWallet, uint256 amount, string memory mode) private {
        require(_customTaxFeeEnabled[appWallet][mode], "OwlRouter: invalid mode");
        mode = _customTaxFeeMode[appWallet][mode];
        require(_taxFeeEnabled[mode], "OwlRouter: invalid mode");
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

        // transfer OWL from app wallet to tax wallet
        _owlBalances[appWallet] = _owlBalances[appWallet].sub(owlAmount);
        _owlBalances[_taxWallet] = _owlBalances[_taxWallet].add(owlAmount);
    }

    /**
     * @dev Processes the referral fee.
     * @param amount The amount of tokens that will be paid as a tax fee.
     * @notice The referral fee is split in half and sent to the referrer and the sender.
     * @notice The bonus is sent to OWL balance in the contract.
     * @return This can only be called when using OWL to pay the tax fee and with no custom fee.
     */
    function _processReferral(uint256 amount) private returns (uint256) {
        address referrer = _referrals[_msgSender()];
        if (referrer == address(0)) {
            return amount;
        }

        uint256 referralDiscount = amount.mul(_referralBonus).div(100000); // 1000 == 1%
        _owlBalances[referrer] = _owlBalances[referrer].add(referralDiscount.div(2));
        _owlBalances[_msgSender()] = _owlBalances[_msgSender()].add(referralDiscount.div(2));
        return amount.sub(referralDiscount);
    }

    // --- default contract functions ---

    receive() external payable {}

}