const { ethers } = require('hardhat');
const { expect } = require('chai');
const { takeSnapshot } = require('@nomicfoundation/hardhat-network-helpers');


describe('NewOwl', () => {
    
    let owner;
    let user1;
    let user2;
    let owlToken;
    let startingState;
    const uniswapV2RouterAddress = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
    const uniswapV2FactoryAddress = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';

    before(async() => {
        const OwlToken = await ethers.getContractFactory('NewOwl');
        [ owner, user1, user2 ] = await ethers.getSigners();
        owlToken = await OwlToken.deploy();

        startingState = await takeSnapshot();
    })

    beforeEach(async() => {
        await startingState.restore();
    })

    describe('Deployment', async() => {
        it('should initialize', async() => {
            expect(await owlToken).to.be.ok
        });

        it('Should assign the total supply of tokens to the owner', async function () {
            const ownerBalance = await owlToken.balanceOf(owner.address);
            expect(await owlToken.totalSupply()).to.equal(ownerBalance);
        });
    })

    describe('Transfer', async() => {
        it('should transfer tokens', async() => {
            const amount = ethers.utils.parseEther('1');
            await owlToken.transfer(user1.address, amount);
            expect(await owlToken.balanceOf(user1.address)).to.equal(amount);
        });

        it('should not transfer tokens if sender does not have enough', async() => {
            const amount = ethers.utils.parseEther('10');
            await expect(owlToken.connect(user1).transfer(owner.address, amount)).to.be.revertedWith('Insufficient balance');
        });

        it('should transfer right amount of tokens from owner', async() => {
            const amount = ethers.utils.parseEther('1');
            await owlToken.transfer(user1.address, amount);
            expect(await owlToken.balanceOf(user1.address)).to.equal(amount);
        });

        it('should discount fee, send it to taxWallet and burn', async() => {
            let startingSupply = await owlToken.totalSupply();
            const amount = ethers.utils.parseEther('1');
            await owlToken.transfer(user1.address, amount);
            let taxWalletStartingBalance = await owlToken.balanceOf(owner.address);
            
            await owlToken.connect(user1).transfer(user2.address, amount);

            let user2Balance = await owlToken.balanceOf(user2.address);
            let taxWalletTax = (await owlToken.balanceOf(owner.address)).sub(taxWalletStartingBalance);
            
            let taxFee = ethers.utils.parseEther('1');
            let burnFee = ethers.utils.parseEther('50');

            let tax = amount.mul(taxFee).div(ethers.utils.parseEther('100'));
            let burnAmount = tax.mul(burnFee).div(ethers.utils.parseEther('100'));
            let remainingTax = tax.sub(burnAmount);

            let currentSupply = await owlToken.totalSupply();
            let burnedTokens = await owlToken.burnedTokens();
            expect(burnedTokens).to.equal(burnAmount);

            // starting supply matches current supply + burned amount
            expect(startingSupply).to.equal(currentSupply.add(burnedTokens));

            // discount from user2
            expect(user2Balance).to.equal(amount.sub(tax));
            
            // tax wallet still have their right share
            expect(taxWalletTax).to.equal(remainingTax);
        });

        it('should not allow wallet holding more than 2% of total supply (single transfer)', async() => {
            const totalSupply = await owlToken.totalSupply();
            const maxAmount = totalSupply.mul(ethers.utils.parseEther('2')).div(ethers.utils.parseEther('100'));
            const beyondMaxAmount = maxAmount.add(1);
            
            await owlToken.transfer(user1.address, beyondMaxAmount);

            await expect(
                owlToken.connect(user1).transfer(user2.address, beyondMaxAmount)
            ).to.be.revertedWith('Exceeds the maxWalletSize.');
        });

        it('should not allow wallet holding more than 2% of total supply (multiple transfers)', async() => {
            const totalSupply = await owlToken.totalSupply();
            await owlToken.transfer(user1.address, totalSupply);
            let initialAmount = totalSupply.mul(ethers.utils.parseEther('1')).div(ethers.utils.parseEther('100'));

            let maxBalance = totalSupply.mul(ethers.utils.parseEther('2')).div(ethers.utils.parseEther('100'));

            await owlToken.connect(user1).transfer(user2.address, initialAmount);
            let user2Balance = await owlToken.balanceOf(user2.address);
            let finalAmount = maxBalance.sub(user2Balance).add(1);

            await expect(
                owlToken.connect(user1).transfer(user2.address, finalAmount)
            ).to.be.revertedWith('Exceeds the maxWalletSize.');
        });
        
    });

    describe('Swap', async() => {

        let uniswapV2Factory;
        let uniswapV2Router;
        let uniswapV2Pair;
        let amountToken;
        let amountETH;

        // add liquidity to uniswap
        beforeEach(async () => {
            uniswapV2Router = await ethers.getContractAt('contracts/MockUniswapV2.sol:IUniswapV2Router02', uniswapV2RouterAddress);
            uniswapV2Factory = await ethers.getContractAt('contracts/MockUniswapV2.sol:IUniswapV2Factory', uniswapV2FactoryAddress);
            
            await uniswapV2Factory.createPair(owlToken.address, uniswapV2Router.WETH());
    
            amountToken = (await owlToken.balanceOf(owner.address)).div(2);
            amountETH = ethers.utils.parseEther('1');
    
            await owlToken.approve(uniswapV2RouterAddress, amountToken);
            await uniswapV2Router.addLiquidityETH(
                owlToken.address,
                amountToken,
                0,
                0,
                owner.address,
                Date.now() + 1000 * 60 * 10,
                { value: amountETH }
            );
    
            const pairAddress = await uniswapV2Factory.getPair(owlToken.address, uniswapV2Router.WETH());
            uniswapV2Pair = await ethers.getContractAt('contracts/MockUniswapV2.sol:IUniswapV2Pair', pairAddress);
        });

        it('should create pair successfully and provide liquidity', async() => {
            const reserves = await uniswapV2Pair.getReserves();
            
            expect( reserves[0] ).to.equal(amountToken);
            expect( reserves[1] ).to.equal(amountETH);
        });

        it('should give right amount of tokens to user and tax when swapping', async() => {
            let pairTotalBeforeSwap = (await uniswapV2Pair.getReserves())[0];
            let taxWalletTokensBefore = await owlToken.balanceOf(owner.address);

            // perform the swap
            const amountSwap = ethers.utils.parseEther('0.01');
            
            await uniswapV2Router.connect(user1).swapExactETHForTokensSupportingFeeOnTransferTokens(
                0,
                [ uniswapV2Router.WETH(), owlToken.address ],
                user1.address,
                Date.now() + 1000 * 60 * 10,
                { value: amountSwap }
            );

            let taxWalletTokensAfter = await owlToken.balanceOf(owner.address);
            let taxWalletTokenDiff = taxWalletTokensAfter.sub(taxWalletTokensBefore);
            
            let pairTotalAfterSwap = (await uniswapV2Pair.getReserves())[0];
            let pairTokenDiff = pairTotalBeforeSwap.sub(pairTotalAfterSwap);

            let user1Balance = await owlToken.connect(user1).balanceOf(user1.address);

            let taxFee = ethers.utils.parseEther('1');
            let burnFee = ethers.utils.parseEther('50');

            let tax = pairTokenDiff.mul(taxFee).div(ethers.utils.parseEther('100'));
            let burnAmount = tax.mul(burnFee).div(ethers.utils.parseEther('100'));

            // what pair lost is what user1 gained + tax
            expect(pairTokenDiff).to.equal(user1Balance.add(tax));

            // what user1 lost from taxes should match what tax wallet gained + burn
            expect(tax).to.equal(taxWalletTokenDiff.add(burnAmount));
        });
    });

})