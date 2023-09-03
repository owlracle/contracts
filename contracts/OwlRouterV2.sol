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

    // OWL balances of users
    mapping(address => uint256) private _owlBalances;


    constructor (
        address owlAddress,
        address uniswapV2RouterAddress
    ) {
        _owlAddress = owlAddress;
        _uniswapV2RouterAddress = uniswapV2RouterAddress;
        _taxWallet = owner();
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


    // --- External transfer functions ---

    /**
     * @dev Transfers ETH to a recipient.
     * @param recipient The recipient to transfer ETH to.
     * @param taxFee The tax fee to apply to the amount of ETH being transfered.
     * @notice The tax fee is sent to the tax wallet.
     */
    function transferETH(address payable recipient, uint256 taxFee) external payable {
        require(_msgSender().balance >= msg.value, "OwlRouter: sender does not have enough balance");
        uint256 taxAmount = _sendTax(address(0), msg.value, taxFee);
        recipient.transfer(msg.value.sub(taxAmount));
    }

    /**
     * @dev Transfers ETH to a recipient.
     * @param recipient The recipient to transfer ETH to.
     * @param tokenAddress The address of the token to transfer.
     * @param amount The amount of tokens to transfer.
     * @param taxFee The tax fee to apply to the amount of tokens being transfered.
     * @notice The tax fee is sent to the tax wallet.
     */
    function transfer(address recipient, address tokenAddress, uint256 amount, uint256 taxFee) external {
        require(IERC20(tokenAddress).balanceOf(_msgSender()) >= amount, "OwlRouter: sender does not have enough balance");
        uint256 taxAmount = _sendTax(tokenAddress, amount, taxFee);
        IERC20(tokenAddress).safeTransferFrom(_msgSender(), recipient, amount.sub(taxAmount));
    }

    /**
     * @dev Transfers ETH to a recipient with a custom fee.
     * @param recipient The recipient to transfer ETH to.
     * @param taxFee The tax fee to apply to the amount of ETH being transfered.
     * @param appWallet The wallet to receive the custom tax fee.
     * @param customFee The custom tax fee to apply to the amount of ETH being transfered.
     * @notice Same as transferETH, but the custom tax fee is sent to the app wallet instead of the tax wallet.
     * @notice The app wallet will pay the regular tax fee to the tax wallet using OWL deposited in the contract.
     */
    function transferETHWithCustomFee(address payable recipient, uint256 taxFee, address appWallet, uint256 customFee) external payable {
        require(_msgSender().balance >= msg.value, "OwlRouter: sender does not have enough balance");
        uint256 taxAmount = _sendTaxWithCustomFee(address(0), msg.value, taxFee, appWallet, customFee);
        recipient.transfer(msg.value.sub(taxAmount));
    }

    /**
     * @dev Transfers tokens to a recipient with a custom fee.
     * @param recipient The recipient to transfer tokens to.
     * @param tokenAddress The address of the token to transfer.
     * @param amount The amount of tokens to transfer.
     * @param taxFee The tax fee to apply to the amount of tokens being transfered.
     * @param appWallet The wallet to receive the custom tax fee.
     * @param customFee The custom tax fee to apply to the amount of tokens being transfered.
     * @notice Same as transfer, but the custom tax fee is sent to the app wallet instead of the tax wallet.
     * @notice The app wallet will pay the regular tax fee to the tax wallet using OWL deposited in the contract.
     */
    function transferWithCustomFee(address recipient, address tokenAddress, uint256 amount, uint256 taxFee, address appWallet, uint256 customFee) external {
        require(IERC20(tokenAddress).balanceOf(_msgSender()) >= amount, "OwlRouter: sender does not have enough balance");
        uint256 taxAmount = _sendTaxWithCustomFee(tokenAddress, amount, taxFee, appWallet, customFee);
        IERC20(tokenAddress).safeTransferFrom(_msgSender(), recipient, amount.sub(taxAmount));
    }


    // --- External swap functions ---

    /**
     * @dev Swaps ETH for tokens.
     * @param tokenAddress The address of the token to swap for.
     * @param amountOutMin The minimum amount of tokens to receive.
     * @param taxFee The tax fee to apply to the amount of ETH being swapped.
     */
    function swapETHForTokens(address tokenAddress, uint256 amountOutMin, uint256 taxFee) external payable {
        require(msg.value > 0, "OwlRouter: amount must be greater than 0");

        uint256 taxAmount = _sendTax(address(0), msg.value, taxFee);

        address[] memory path = new address[](2);
        path[0] = IUniswapV2Router02(_uniswapV2RouterAddress).WETH();
        path[1] = tokenAddress;

        uint256[] memory amounts = IUniswapV2Router02(_uniswapV2RouterAddress).getAmountsOut(msg.value.sub(taxAmount), path);
        require(amounts[1] >= amountOutMin, "OwlRouter: amountOut is less than amountOutMin");

        IUniswapV2Router02(_uniswapV2RouterAddress).swapExactETHForTokensSupportingFeeOnTransferTokens{value: msg.value.sub(taxAmount)}(amountOutMin, path, _msgSender(), block.timestamp);
    }

    /**
     * @dev Swaps tokens for ETH.
     * @param tokenAddress The address of the token to swap.
     * @param amountIn The amount of tokens to swap.
     * @param amountOutMin The minimum amount of ETH to receive.
     * @param taxFee The tax fee to apply to the amount of tokens being swapped.
     */
    function swapTokensForETH(address tokenAddress, uint256 amountIn, uint256 amountOutMin, uint256 taxFee) external {
        require(IERC20(tokenAddress).balanceOf(_msgSender()) >= amountIn, "OwlRouter: sender does not have enough balance");

        uint256 taxAmount = _sendTax(tokenAddress, amountIn, taxFee);

        address[] memory path = new address[](2);
        path[0] = tokenAddress;
        path[1] = IUniswapV2Router02(_uniswapV2RouterAddress).WETH();

        uint256[] memory amounts = IUniswapV2Router02(_uniswapV2RouterAddress).getAmountsOut(amountIn.sub(taxAmount), path);
        require(amounts[1] >= amountOutMin, "OwlRouter: amountOut is less than amountOutMin");

        IUniswapV2Router02(_uniswapV2RouterAddress).swapExactTokensForETHSupportingFeeOnTransferTokens(amountIn.sub(taxAmount), amountOutMin, path, _msgSender(), block.timestamp);
    }

    /**
     * @dev Swaps tokens for tokens.
     * @param tokenAddressIn The address of the token to swap.
     * @param tokenAddressOut The address of the token to swap for.
     * @param amountIn The amount of tokens to swap.
     * @param amountOutMin The minimum amount of tokens to receive.
     */
    function swapTokensForTokens(address tokenAddressIn, address tokenAddressOut, uint256 amountIn, uint256 amountOutMin, uint256 taxFee) external {
        require(IERC20(tokenAddressIn).balanceOf(_msgSender()) >= amountIn, "OwlRouter: sender does not have enough balance");

        uint256 taxAmount = _sendTax(tokenAddressIn, amountIn, taxFee);

        address[] memory path = new address[](3);
        path[0] = tokenAddressIn;
        path[1] = IUniswapV2Router02(_uniswapV2RouterAddress).WETH();
        path[2] = tokenAddressOut;

        uint256[] memory amounts = IUniswapV2Router02(_uniswapV2RouterAddress).getAmountsOut(amountIn.sub(taxAmount), path);
        require(amounts[2] >= amountOutMin, "OwlRouter: amountOut is less than amountOutMin");

        IUniswapV2Router02(_uniswapV2RouterAddress).swapExactTokensForTokensSupportingFeeOnTransferTokens(amountIn.sub(taxAmount), amountOutMin, path, _msgSender(), block.timestamp);
    }

    /**
     * @dev Swaps ETH for tokens with a custom fee.
     * @param tokenAddress The address of the token to swap for.
     * @param amountOutMin The minimum amount of tokens to receive.
     * @param taxFee The tax fee to apply to the amount of ETH being swapped.
     * @param appWallet The wallet to receive the custom tax fee.
     * @param customFee The custom tax fee to apply to the amount of ETH being swapped.
     * @notice Same as swapETHForTokens, but the custom tax fee is sent to the app wallet instead of the tax wallet.
     * @notice The app wallet will pay the regular tax fee to the tax wallet using OWL deposited in the contract.
     */
    function swapETHForTokensWithCustomFee(address tokenAddress, uint256 amountOutMin, uint256 taxFee, address appWallet, uint256 customFee) external payable {
        require(msg.value > 0, "OwlRouter: amount must be greater than 0");

        uint256 taxAmount = _sendTaxWithCustomFee(address(0), msg.value, taxFee, appWallet, customFee);

        address[] memory path = new address[](2);
        path[0] = IUniswapV2Router02(_uniswapV2RouterAddress).WETH();
        path[1] = tokenAddress;

        uint256[] memory amounts = IUniswapV2Router02(_uniswapV2RouterAddress).getAmountsOut(msg.value.sub(taxAmount), path);
        require(amounts[1] >= amountOutMin, "OwlRouter: amountOut is less than amountOutMin");

        IUniswapV2Router02(_uniswapV2RouterAddress).swapExactETHForTokensSupportingFeeOnTransferTokens{value: msg.value.sub(taxAmount)}(amountOutMin, path, _msgSender(), block.timestamp);
    }

    /**
     * @dev Swaps tokens for ETH with a custom fee.
     * @param tokenAddress The address of the token to swap.
     * @param amountIn The amount of tokens to swap.
     * @param amountOutMin The minimum amount of ETH to receive.
     * @param taxFee The tax fee to apply to the amount of tokens being swapped.
     * @param appWallet The wallet to receive the custom tax fee.
     * @param customFee The custom tax fee to apply to the amount of tokens being swapped.
     * @notice Same as swapTokensForETH, but the custom tax fee is sent to the app wallet instead of the tax wallet.
     * @notice The app wallet will pay the regular tax fee to the tax wallet using OWL deposited in the contract.
     */
    function swapTokensForETHWithCustomFee(address tokenAddress, uint256 amountIn, uint256 amountOutMin, uint256 taxFee, address appWallet, uint256 customFee) external {
        require(IERC20(tokenAddress).balanceOf(_msgSender()) >= amountIn, "OwlRouter: sender does not have enough balance");

        uint256 taxAmount = _sendTaxWithCustomFee(tokenAddress, amountIn, taxFee, appWallet, customFee);

        address[] memory path = new address[](2);
        path[0] = tokenAddress;
        path[1] = IUniswapV2Router02(_uniswapV2RouterAddress).WETH();

        uint256[] memory amounts = IUniswapV2Router02(_uniswapV2RouterAddress).getAmountsOut(amountIn.sub(taxAmount), path);
        require(amounts[1] >= amountOutMin, "OwlRouter: amountOut is less than amountOutMin");

        IUniswapV2Router02(_uniswapV2RouterAddress).swapExactTokensForETHSupportingFeeOnTransferTokens(amountIn.sub(taxAmount), amountOutMin, path, _msgSender(), block.timestamp); 
    }

    /**
     * @dev Swaps tokens for tokens with a custom fee.
     * @param tokenAddressIn The address of the token to swap.
     * @param tokenAddressOut The address of the token to swap for.
     * @param amountIn The amount of tokens to swap.
     * @param amountOutMin The minimum amount of tokens to receive.
     * @param taxFee The tax fee to apply to the amount of tokens being swapped.
     * @param appWallet The wallet to receive the custom tax fee.
     * @param customFee The custom tax fee to apply to the amount of tokens being swapped.
     * @notice Same as swapTokensForTokens, but the custom tax fee is sent to the app wallet instead of the tax wallet.
     * @notice The app wallet will pay the regular tax fee to the tax wallet using OWL deposited in the contract.
     */
    function swapTokensForTokensWithCustomFee(address tokenAddressIn, address tokenAddressOut, uint256 amountIn, uint256 amountOutMin, uint256 taxFee, address appWallet, uint256 customFee) external {
        require(IERC20(tokenAddressIn).balanceOf(_msgSender()) >= amountIn, "OwlRouter: sender does not have enough balance");

        uint256 taxAmount = _sendTaxWithCustomFee(tokenAddressIn, amountIn, taxFee, appWallet, customFee);

        address[] memory path = new address[](3);
        path[0] = tokenAddressIn;
        path[1] = IUniswapV2Router02(_uniswapV2RouterAddress).WETH();
        path[2] = tokenAddressOut;

        uint256[] memory amounts = IUniswapV2Router02(_uniswapV2RouterAddress).getAmountsOut(amountIn.sub(taxAmount), path);
        require(amounts[2] >= amountOutMin, "OwlRouter: amountOut is less than amountOutMin");

        IUniswapV2Router02(_uniswapV2RouterAddress).swapExactTokensForTokensSupportingFeeOnTransferTokens(amountIn.sub(taxAmount), amountOutMin, path, _msgSender(), block.timestamp);
    }


    // --- Tax fee transfer functions ---

    /**
     * @dev Sends tokens as a tax fee to the tax wallet.
     * @param tokenAddress The address of the token used in the transaction.
     * @param amount The amount of tokens used in the transaction.
     * @param taxFee The tax fee to apply to the amount of tokens being transfered.
     */
    function _sendTax(address tokenAddress, uint256 amount, uint256 taxFee) private returns (uint256) {
        uint256 taxAmount = amount.mul(taxFee).div(100000); // 1000 == 1%

        uint256 owlAmount;
        // if token is ETH
        if (tokenAddress == address(0)) {
            address[] memory path = new address[](2);
            path[0] = IUniswapV2Router02(_uniswapV2RouterAddress).WETH();
            path[1] = _owlAddress;
            owlAmount = IUniswapV2Router02(_uniswapV2RouterAddress).getAmountsOut(taxAmount, path)[1];
        }
        else {
            // token is OWL
            if (tokenAddress == _owlAddress) {
                owlAmount = taxAmount;
            }
            else {
                address[] memory path = new address[](3);
                path[0] = tokenAddress;
                path[1] = IUniswapV2Router02(_uniswapV2RouterAddress).WETH();
                path[2] = _owlAddress;
                owlAmount = IUniswapV2Router02(_uniswapV2RouterAddress).getAmountsOut(taxAmount, path)[2];
            }
        }

        // check if there is enough OWL balance
        if (_owlBalances[_msgSender()] >= owlAmount) {
            // transfer OWL from sender to tax wallet
            _owlBalances[_msgSender()] = _owlBalances[_msgSender()].sub(owlAmount);
            _owlBalances[_taxWallet] = _owlBalances[_taxWallet].add(owlAmount);
        }
        else {
            if (tokenAddress == address(0)) {
                // transfer ETH to tax wallet
                payable(_taxWallet).transfer(taxAmount);
            }
            else {
                // transfer token to tax wallet
                IERC20(tokenAddress).safeTransferFrom(_msgSender(), _taxWallet, taxAmount);
            }
        }
        return taxAmount;
    }

    /**
     * @dev Sends tokens as a tax fee to the app wallet and OWL as a tax fee to the tax wallet.
     * @param tokenAddress The address of the token used in the transaction.
     * @param amount The amount of tokens used in the transaction.
     * @param taxFee The tax fee to apply to the amount of tokens being transfered.
     * @param appWallet The wallet to receive the custom tax fee.
     * @param customFee The custom tax fee to apply to the amount of tokens being transfered.
     * @notice The app wallet will pay the regular tax fee to the tax wallet using OWL deposited in the contract.
     */
    function _sendTaxWithCustomFee(address tokenAddress, uint256 amount, uint256 taxFee, address appWallet, uint256 customFee) private returns (uint256) {
        uint256 taxAmount = amount.mul(taxFee).div(100000); // 1000 == 1%
        uint256 customAmount = amount.mul(customFee).div(100000); // 1000 == 1%

        uint256 owlAmountRegularTax;
        uint256 owlAmountCustomTax;
        // if token is ETH
        if (tokenAddress == address(0)) {
            address[] memory path = new address[](2);
            path[0] = IUniswapV2Router02(_uniswapV2RouterAddress).WETH();
            path[1] = _owlAddress;
            owlAmountRegularTax = IUniswapV2Router02(_uniswapV2RouterAddress).getAmountsOut(taxAmount, path)[1];
            owlAmountCustomTax = IUniswapV2Router02(_uniswapV2RouterAddress).getAmountsOut(customAmount, path)[1];
        }
        else {
            // token is OWL
            if (tokenAddress == _owlAddress) {
                owlAmountRegularTax = taxAmount;
                owlAmountCustomTax = customAmount;
            }
            else {
                address[] memory path = new address[](3);
                path[0] = tokenAddress;
                path[1] = IUniswapV2Router02(_uniswapV2RouterAddress).WETH();
                path[2] = _owlAddress;
                owlAmountRegularTax = IUniswapV2Router02(_uniswapV2RouterAddress).getAmountsOut(taxAmount, path)[2];
                owlAmountCustomTax = IUniswapV2Router02(_uniswapV2RouterAddress).getAmountsOut(customAmount, path)[2];
            }
        }

        require(_owlBalances[appWallet] >= owlAmountRegularTax, "OwlRouter: app wallet does not have enough OWL balance");
        
        // transfer OWL from app wallet to tax wallet
        _owlBalances[appWallet] = _owlBalances[appWallet].sub(owlAmountRegularTax);
        _owlBalances[_taxWallet] = _owlBalances[_taxWallet].add(owlAmountRegularTax);

        // check if there is enough OWL balance
        if (_owlBalances[_msgSender()] >= owlAmountCustomTax) {
            // transfer OWL from sender to app wallet
            _owlBalances[_msgSender()] = _owlBalances[_msgSender()].sub(owlAmountCustomTax);
            _owlBalances[appWallet] = _owlBalances[appWallet].add(owlAmountCustomTax);
        }
        else {
            if (tokenAddress == address(0)) {
                // transfer ETH to app wallet
                payable(appWallet).transfer(customAmount);
            }
            else {
                // transfer token to app wallet
                IERC20(tokenAddress).safeTransferFrom(_msgSender(), appWallet, customAmount);
            }
        }

        return customAmount;
    }


    // --- default contract functions ---

    receive() external payable {}

}