// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@prb/math/contracts/PRBMathUD60x18.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./OwlToken.sol";

contract OwlFarm is Ownable {
    using PRBMathUD60x18 for uint256;

    // total lp staking in the pool
    mapping(address => uint256) public stakingBalance;
    // is the address staking in the pool?
    mapping(address => bool) public isStaking;
    // time since last harvest
    mapping(address => uint256) public startTime;
    // rewards awaiting to be claimed
    mapping(address => uint256) public unrealizedBalance;
    // total lp staked balance
    uint256 public totalLpBalance;
    // total owl in the contract
    uint256 public totalOwlBalance;
    // Owl token reward each second
    uint256 public yield;

    IERC20 public lpToken;
    OwlToken public owlToken;

    event Stake(address indexed from, uint256 amount);
    event Unstake(address indexed from, uint256 amount);
    event YieldWithdraw(address indexed to, uint256 amount);
    event FillContract(address indexed from, uint256 amount);

    constructor(
        IERC20 _lpToken,
        OwlToken _owlToken,
        uint256 _yield
        ) {
            lpToken = _lpToken;
            owlToken = _owlToken;
            totalLpBalance = 0;
            totalOwlBalance = 0;
            yield = _yield;
        }

    function stake(uint256 amount) public {
        require(
            amount > 0 &&
            lpToken.balanceOf(msg.sender) >= amount, 
            "You cannot stake zero tokens");
            
        if(isStaking[msg.sender] == true){
            uint256 toTransfer = calculateYieldTotal(msg.sender);
            unrealizedBalance[msg.sender] += toTransfer;
        }

        lpToken.transferFrom(msg.sender, address(this), amount);
        stakingBalance[msg.sender] += amount;
        totalLpBalance += amount;
        startTime[msg.sender] = block.timestamp;
        isStaking[msg.sender] = true;
        emit Stake(msg.sender, amount);
    }

    function unstake(uint256 amount) public {
        require(
            isStaking[msg.sender] = true &&
            stakingBalance[msg.sender] >= amount, 
            "Nothing to unstake"
        );
        uint256 yieldTransfer = calculateYieldTotal(msg.sender);
        startTime[msg.sender] = block.timestamp;
        uint256 balTransfer = amount;
        amount = 0;
        stakingBalance[msg.sender] -= balTransfer;
        totalLpBalance -= balTransfer;
        unrealizedBalance[msg.sender] += yieldTransfer;
        lpToken.transfer(msg.sender, balTransfer);
        if(stakingBalance[msg.sender] == 0){
            isStaking[msg.sender] = false;
        }
        emit Unstake(msg.sender, balTransfer);
    }

    function calculateYieldTime(address user) public view returns(uint256){
        uint256 end = block.timestamp;
        uint256 totalTime = end - startTime[user];
        return totalTime;
    }

    function setLpToken(IERC20 _lpToken) public onlyOwner {
        lpToken = _lpToken;
    }

    function setReward(uint256 _yield) public onlyOwner {
        yield = _yield;
    }

    // this logic is still flawed. overflow
    function calculateYieldTotal(address user) public view returns(uint256) {
        // must make this changeable by owner in the future
        uint256 formattedYield = yield + 1e18;
        uint256 time = PRBMathUD60x18.fromUint( calculateYieldTime(user) );
        uint256 depletePerc = formattedYield.pow(time) - 1e18;
        uint256 poolRatio = stakingBalance[user].div(totalLpBalance);
        uint256 rewardPerc = depletePerc.mul(poolRatio);
        uint256 rawYield = rewardPerc.mul(totalOwlBalance);
        return rawYield;
    } 

    function withdrawYield() public {
        uint256 toTransfer = calculateYieldTotal(msg.sender);

        require(
            toTransfer > 0 ||
            unrealizedBalance[msg.sender] > 0,
            "Nothing to withdraw"
            );

        require(totalOwlBalance >= toTransfer, "Contract does not have enought tokens");
            
        if(unrealizedBalance[msg.sender] != 0){
            uint256 oldBalance = unrealizedBalance[msg.sender];
            unrealizedBalance[msg.sender] = 0;
            toTransfer += oldBalance;
        }

        startTime[msg.sender] = block.timestamp;
        totalOwlBalance -= toTransfer;
        owlToken.transfer(msg.sender, toTransfer);
        emit YieldWithdraw(msg.sender, toTransfer);
    }

    function fillContract(uint256 amount) public {
        require(
            amount > 0 &&
            lpToken.balanceOf(msg.sender) >= amount, 
            "You do not have enough tokens");
            
        owlToken.transferFrom(msg.sender, address(this), amount);
        totalOwlBalance += amount;
        emit FillContract(msg.sender, amount);
    } 
}