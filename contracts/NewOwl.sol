// SPDX-License-Identifier: MIT 

pragma solidity 0.8.9;

abstract contract Context {
    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }
}

interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
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

contract NewOwl is Context, IERC20, Ownable {
    using SafeMath for uint256;
    mapping (address => uint256) private _balances;
    mapping (address => mapping (address => uint256)) private _allowances;
    mapping (address => bool) private _isExcludedFromFee;
    mapping (address => bool) private _isExcludedFromMaxWalletSize;
    address payable private _taxWallet;

    // 1% transfer tax
    uint256 private constant _transferTax = 1;
    // 50% of tax is burned
    uint256 private constant _burnFee = 50;
    // max 2% of total supply per wallet
    uint256 private constant _maxWalletSizeRate = 2;

    uint8 private constant _decimals = 18;
    string private constant _name = unicode"Owlracle";
    string private constant _symbol = unicode"OWL";

    // 1M total supply
    uint256 private _totalSupply = 1000000 * 10**_decimals;
    uint256 private _burnedTokens = 0;
    uint256 private _maxWalletSize = _totalSupply.mul(_maxWalletSizeRate).div(100);

    constructor () {
        _taxWallet = payable(_msgSender());
        _balances[_msgSender()] = _totalSupply;
        _isExcludedFromFee[owner()] = true;
        _isExcludedFromFee[address(this)] = true;
        _isExcludedFromFee[_taxWallet] = true;

        emit Transfer(address(0), _msgSender(), _totalSupply);
    }

    function name() public pure returns (string memory) {
        return _name;
    }

    function symbol() public pure returns (string memory) {
        return _symbol;
    }

    function decimals() public pure returns (uint8) {
        return _decimals;
    }

    function totalSupply() public view override returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) public view override returns (uint256) {
        return _balances[account];
    }

    function transfer(address recipient, uint256 amount) public override returns (bool) {
        _transfer(_msgSender(), recipient, amount);
        return true;
    }

    function allowance(address owner, address spender) public view override returns (uint256) {
        return _allowances[owner][spender];
    }

    function approve(address spender, uint256 amount) public override returns (bool) {
        _approve(_msgSender(), spender, amount);
        return true;
    }

    function maxWalletSize() public view returns (uint256) {
        return _maxWalletSize;
    }

    function burnedTokens() public view returns (uint256) {
        return _burnedTokens;
    }

    function transferFrom(address sender, address recipient, uint256 amount) public override returns (bool) {
        _transfer(sender, recipient, amount);
        _approve(sender, _msgSender(), _allowances[sender][_msgSender()].sub(amount, "ERC20: transfer amount exceeds allowance"));
        return true;
    }

    function excludeFromFee(address account) public onlyOwner {
        _isExcludedFromFee[account] = true;
    }

    // this needs to be called for the liquidity pool
    function excludeFromMaxWalletSize(address account) public onlyOwner {
        _isExcludedFromMaxWalletSize[account] = true;
    }

    function setTaxWallet(address payable account) public onlyOwner {
        _isExcludedFromFee[_taxWallet] = false;
        _taxWallet = account;
        _isExcludedFromFee[_taxWallet] = true;
    }

    function _approve(address owner, address spender, uint256 amount) private {
        require(owner != address(0), "ERC20: approve from the zero address");
        require(spender != address(0), "ERC20: approve to the zero address");
        _allowances[owner][spender] = amount;
        emit Approval(owner, spender, amount);
    }

    function _transfer(address from, address to, uint256 amount) private {
        require(from != address(0), "ERC20: transfer from the zero address");
        require(to != address(0), "ERC20: transfer to the zero address");
        require(balanceOf(from) >= amount, "Insufficient balance");
        
        uint256 feeAmount=0;
        if (!_isExcludedFromFee[from] && !_isExcludedFromFee[to]) {
            // calculate tax amount
            feeAmount = amount.mul(_transferTax).div(100);

            // a single wallet cannot hold more than _maxWalletSize
            if (!_isExcludedFromMaxWalletSize[to]) {
                require(balanceOf(to) + amount <= _maxWalletSize, "Exceeds the maxWalletSize.");
            }
        }

        if(feeAmount > 0){
            _payFee(feeAmount);
        }

        _balances[from]=_balances[from].sub(amount);
        _balances[to]=_balances[to].add(amount.sub(feeAmount));
        emit Transfer(from, to, amount.sub(feeAmount));
    }

    function _payFee(uint256 amount) private {
        // burn designated amount
        uint256 burnAmount = amount.mul(_burnFee).div(100);
        _totalSupply = _totalSupply.sub(burnAmount);
        _burnedTokens = _burnedTokens.add(burnAmount);

        // update max wallet size
        _maxWalletSize = _totalSupply.mul(_maxWalletSizeRate).div(100);

        // send the rest to tax wallet
        _balances[_taxWallet] = _balances[_taxWallet].add(amount.sub(burnAmount));
        emit Transfer(_msgSender(), _taxWallet, amount.sub(burnAmount));
    }

    receive() external payable {}
}