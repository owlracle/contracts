const { ethers } = require('hardhat');
const { expect } = require('chai');
const { takeSnapshot } = require('@nomicfoundation/hardhat-network-helpers');


describe('OwlRouter', () => {
    
    let owner;
    let manager;
    let user1;
    let user2;
    let owlToken;
    let owlRouter;
    let daiToken;
    let startingState;
    const owlAddress = '0xBDa06080ea4961fC423396A704009873fE612B3f';
    const uniswapV2RouterAddress = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
    const daiAddress = '0x6B175474E89094C44Da98b954EedeAC495271d0F';

    before(async() => {
        owlToken = await ethers.getContractAt('contracts/OwlToken.sol:OwlToken', owlAddress);
        uniswapV2Router = await ethers.getContractAt('contracts/MockUniswapV2.sol:IUniswapV2Router02', uniswapV2RouterAddress);
        daiToken = await ethers.getContractAt('contracts/MockERC20.sol:ERC20', daiAddress);

        const OwlRouter = await ethers.getContractFactory('OwlRouter');
        [ owner, manager, user1, user2 ] = await ethers.getSigners();
        owlRouter = await OwlRouter.deploy(owlAddress, uniswapV2RouterAddress);

        // get some OWL for owner address
        await uniswapV2Router.swapExactETHForTokensSupportingFeeOnTransferTokens(
            0,
            [ uniswapV2Router.WETH(), owlAddress ],
            owner.address,
            Date.now() + 100000,
            { value: ethers.utils.parseEther('100') }
        );
        // const startingOWL = await owlToken.balanceOf(owner.address);
        // console.log('startingOWL', ethers.utils.formatEther(startingOWL));

        // get some DAI for owner address
        await uniswapV2Router.swapExactETHForTokensSupportingFeeOnTransferTokens(
            0,
            [ uniswapV2Router.WETH(), daiAddress ],
            owner.address,
            Date.now() + 100000,
            { value: ethers.utils.parseEther('100') }
        );
        // const startingOWL = await owlToken.balanceOf(owner.address);
        // console.log('startingOWL', ethers.utils.formatEther(startingOWL));

        startingState = await takeSnapshot();
    })

    beforeEach(async() => {
        await startingState.restore();
    })

    describe('Deployment', async() => {
        it('should initialize', async() => {
            expect(await owlRouter).to.be.ok
        });

        it('should change tax fee for transfers', async() => {
            await owlRouter.setTaxFee('transfer', 5000);
            expect(await owlRouter.getTaxFee('transfer')).to.equal(5000);
        });

        // add manager to wallet and test if it can call manager functions
        // remove manager and check if it can no longer call manager functions

        // transfer eth and check if tax is taken
        // same with owl

        // swap and check fee on taxwallet.
        // change taxwallet and perform transfer again.
    });

    describe('Transfer', async() => {

        let owlTax = 1; // 1%
        let routerTransferTax = 1000; // 1%
        let owlTaxDiscount = 30; // 30%

        it ('should transfer ETH', async() => {
            const balanceBefore = await user2.getBalance();
            const amount = ethers.utils.parseEther('1');

            // send eth to router
            await owlRouter.connect(user1).transferETH(user2.address, false, { value: amount });
            
            expect(await user2.getBalance()).to.equal(balanceBefore.add(amount));
        });

        it ('should transfer ETH with fee', async() => {
            const user2BalanceBefore = await user2.getBalance();
            const amount = ethers.utils.parseEther('1');
            
            // router fee
            await owlRouter.setTaxFee('transfer', routerTransferTax);
            let tax = amount.mul(routerTransferTax).div(100000);
            const ownerBefore = await owner.getBalance();

            // console.log('tax', ethers.utils.formatEther(tax));
            // console.log('ownerBefore', ethers.utils.formatEther(ownerBefore));
            
            // send eth to router
            await owlRouter.connect(user1).transferETH(user2.address, false, { value: amount });

            // console.log('ownerAfter', ethers.utils.formatEther(await owner.getBalance()));
            
            expect(await user2.getBalance()).to.equal(user2BalanceBefore.add(amount.sub(tax)));
            expect(await owner.getBalance()).to.equal(ownerBefore.add(tax));
        });

        it ('should transfer ETH paying with OWL', async() => {
            const user2BalanceBefore = await user2.getBalance();
            const amount = ethers.utils.parseEther('1');

            // send OWL to user1
            const amountOWL = ethers.utils.parseEther('10000');
            await owlToken.transfer(user1.address, amountOWL);
            
            // router fee
            await owlRouter.setTaxFee('transfer', routerTransferTax);
            let tax = amount.mul(routerTransferTax).div(100000);
            // apply OWL tax discount
            tax = tax.sub(tax.mul(owlTaxDiscount).div(100));
            // convert eth to OWL
            tax = (await uniswapV2Router.getAmountsOut(tax, [ await uniswapV2Router.WETH(), owlAddress ]))[1];
            // reduce tax by OWL fee
            tax = tax.sub(tax.mul(owlTax).div(100));
            const ownerBefore = await owlToken.balanceOf(owner.address);

            // send eth to router
            await owlToken.connect(user1).approve(owlRouter.address, amountOWL);
            await owlRouter.connect(user1).transferETH(user2.address, true, { value: amount });

            // check if user2 received eth
            expect(await user2.getBalance()).to.equal(user2BalanceBefore.add(amount));
            // check if owner received OWL tax
            expect(await owlToken.balanceOf(owner.address)).to.equal(ownerBefore.add(tax));
        });

        it ('should transfer DAI with fee', async() => {
            // send some DAI to user1
            const amountDAI = ethers.utils.parseEther('300');
            await daiToken.transfer(user1.address, amountDAI);

            // set tax wallet
            await owlRouter.setTaxWallet(manager.address);

            // router fee
            await owlRouter.setTaxFee('transfer', routerTransferTax);
            let tax = amountDAI.mul(routerTransferTax).div(100000);
            
            // send dai to user2 through router
            await daiToken.connect(user1).approve(owlRouter.address, amountDAI);
            await owlRouter.connect(user1).transfer(user2.address, daiAddress, amountDAI, false);
            
            expect(await daiToken.balanceOf(user1.address)).to.equal(0);
            expect(await daiToken.balanceOf(user2.address)).to.equal(amountDAI.sub(tax));
            expect(await daiToken.balanceOf(manager.address)).to.equal(tax);
        });

        it ('should transfer DAI paying with OWL', async() => {
            // send some DAI to user1
            const amountDAI = ethers.utils.parseEther('300');
            await daiToken.transfer(user1.address, amountDAI);

            // send OWL to user1
            const amountOWL = ethers.utils.parseEther('10000');
            await owlToken.transfer(user1.address, amountOWL);
            
            // set tax wallet
            await owlRouter.setTaxWallet(manager.address);

            // router fee
            await owlRouter.setTaxFee('transfer', routerTransferTax);
            let tax = amountDAI.mul(routerTransferTax).div(100000);
            // apply OWL tax discount
            tax = tax.sub(tax.mul(owlTaxDiscount).div(100));
            // convert DAI to ETH
            tax = (await uniswapV2Router.getAmountsOut(tax, [daiAddress, await uniswapV2Router.WETH()]))[1];
            // convert ETH to OWL
            tax = (await uniswapV2Router.getAmountsOut(tax, [await uniswapV2Router.WETH(), owlAddress]))[1];
            // reduce tax by OWL fee
            tax = tax.sub(tax.mul(owlTax).div(100));

            // send dai to user2 through router
            await daiToken.connect(user1).approve(owlRouter.address, amountDAI);
            await owlToken.connect(user1).approve(owlRouter.address, amountOWL);
            await owlRouter.connect(user1).transfer(user2.address, daiAddress, amountDAI, true);
            
            // user 1 should have no DAI
            expect(await daiToken.balanceOf(user1.address)).to.equal(0);
            // user 2 should have DAI transfered from user 1
            expect(await daiToken.balanceOf(user2.address)).to.equal(amountDAI);
            // manager should have tax
            expect(await owlToken.balanceOf(manager.address)).to.equal(tax);
        });

        it ('should transfer OWL with fee', async() => {
            // send some OWL to user1
            let amountOWL = ethers.utils.parseEther('10000');
            await owlToken.transfer(user1.address, amountOWL);
            amountOWL = await owlToken.balanceOf(user1.address);

            // set tax wallet
            await owlRouter.setTaxWallet(manager.address);

            // router fee
            await owlRouter.setTaxFee('transfer', routerTransferTax);
            let tax = amountOWL.mul(routerTransferTax).div(100000);
            
            // OWL fee
            let owlTaxAmount = amountOWL.sub(tax).mul(owlTax).div(100);

            // send dai to user2 through router
            await owlToken.connect(user1).approve(owlRouter.address, amountOWL);
            await owlRouter.connect(user1).transfer(user2.address, owlAddress, amountOWL, false);
            
            expect(await owlToken.balanceOf(user1.address)).to.equal(0);
            expect(await owlToken.balanceOf(user2.address)).to.equal(amountOWL.sub(tax).sub(owlTaxAmount));

            owlTaxAmount = tax.mul(owlTax).div(100);
            expect(await owlToken.balanceOf(manager.address)).to.equal(tax.sub(owlTaxAmount));
        });

        it ('should transfer OWL using OWL as payment (same as previous test)', async() => {
            // send some OWL to user1
            let amountOWL = ethers.utils.parseEther('10000');
            await owlToken.transfer(user1.address, amountOWL);
            amountOWL = await owlToken.balanceOf(user1.address);

            // set tax wallet
            await owlRouter.setTaxWallet(manager.address);

            // router fee
            await owlRouter.setTaxFee('transfer', routerTransferTax);
            let tax = amountOWL.mul(routerTransferTax).div(100000);
            
            // OWL fee
            let owlTaxAmount = amountOWL.sub(tax).mul(owlTax).div(100);

            // send dai to user2 through router
            await owlToken.connect(user1).approve(owlRouter.address, amountOWL);
            await owlRouter.connect(user1).transfer(user2.address, owlAddress, amountOWL, true);
            
            expect(await owlToken.balanceOf(user1.address)).to.equal(0);
            expect(await owlToken.balanceOf(user2.address)).to.equal(amountOWL.sub(tax).sub(owlTaxAmount));

            owlTaxAmount = tax.mul(owlTax).div(100);
            expect(await owlToken.balanceOf(manager.address)).to.equal(tax.sub(owlTaxAmount));
        });

    });

    describe('Swap', async() => {

        let owlTax = 1; // 1%
        let routerTransferTax = 1000; // 1%
        let owlTaxDiscount = 30; // 30%

        beforeEach(async() => {
            await owlRouter.setTaxFee('swap', routerTransferTax);
            await owlRouter.setTaxDiscount(owlTaxDiscount);
            await owlRouter.setTaxWallet(manager.address);
        });

        it ('should swap ETH for DAI paying fee with ETH', async() => {
            const amount = ethers.utils.parseEther('1');
            const managerBalance = await manager.getBalance();
            const balanceBefore = await user1.getBalance();
            
            let tax = amount.mul(routerTransferTax).div(100000);
            const amounts = await uniswapV2Router.getAmountsOut(amount.sub(tax), [ await uniswapV2Router.WETH(), daiAddress ]);

            const tx = await owlRouter.connect(user1).swapETHForTokens(daiAddress, 0, false, { value: amount });
            
            // reduce ETH
            const gasUsed = (await tx.wait()).gasUsed;
            const gasPrice = tx.gasPrice;
            const gasCost = gasUsed.mul(gasPrice);
            expect(await user1.getBalance()).to.equal(balanceBefore.sub(amount).sub(gasCost));
            // increase DAI
            expect(await daiToken.balanceOf(user1.address)).to.equal(amounts[1]);
            // tax
            expect(await manager.getBalance()).to.equal(managerBalance.add(tax));


        });

        it ('should swap ETH for DAI paying fee with OWL', async() => {
            const amount = ethers.utils.parseEther('1');
            // send OWL to user1
            const amountOWL = ethers.utils.parseEther('10000');
            await owlToken.transfer(user1.address, amountOWL);
            
            const amounts = await uniswapV2Router.getAmountsOut(amount, [ await uniswapV2Router.WETH(), daiAddress ]);
            const owlBefore = await owlToken.balanceOf(user1.address);
            
            await owlToken.connect(user1).approve(owlRouter.address, amountOWL);
            await owlRouter.connect(user1).swapETHForTokens(daiAddress, 0, true, { value: amount });
            
            expect(await daiToken.balanceOf(user1.address)).to.equal(amounts[1]);

            let tax = amount.mul(routerTransferTax).div(100000);
            // apply OWL tax discount
            tax = tax.sub(tax.mul(owlTaxDiscount).div(100));
            // convert eth to OWL
            tax = (await uniswapV2Router.getAmountsOut(tax, [ await uniswapV2Router.WETH(), owlAddress ]))[1];
            
            expect(await owlToken.balanceOf(user1.address)).to.equal(owlBefore.sub(tax));
            
            // reduce tax by OWL fee
            tax = tax.sub(tax.mul(owlTax).div(100));
            
            expect(await owlToken.balanceOf(manager.address)).to.equal(tax);
        });

        it ('should swap DAI for ETH paying fee with ETH', async() => {
            const amount = ethers.utils.parseEther('1000');
            await daiToken.transfer(user1.address, amount);
            await daiToken.connect(user1).approve(owlRouter.address, amount);

            const managerBalance = await manager.getBalance();
            
            const amounts = await uniswapV2Router.getAmountsOut(amount, [ daiAddress, await uniswapV2Router.WETH() ]);
            let tax = amounts[1].mul(routerTransferTax).div(100000);
            
            const balanceBefore = await user1.getBalance();
            const tx = await owlRouter.connect(user1).swapTokensForETH(daiAddress, amount, 0, false);
            
            // reduce DAI
            expect(await daiToken.balanceOf(user1.address)).to.equal(0);

            // increase ETH            
            const gasUsed = (await tx.wait()).gasUsed;
            const gasPrice = tx.gasPrice;
            const gasCost = gasUsed.mul(gasPrice);
            const balanceAfter = await user1.getBalance();

            expect(balanceAfter).to.equal(balanceBefore.add(amounts[1]).sub(tax).sub(gasCost));

            // tax
            expect(await manager.getBalance()).to.equal(managerBalance.add(tax));
        });

        it ('should swap DAI for ETH paying fee with OWL', async() => {
            const amount = ethers.utils.parseEther('1000');
            await daiToken.transfer(user1.address, amount);
            await daiToken.connect(user1).approve(owlRouter.address, amount);
            
            // send OWL to user1
            const amountOWL = ethers.utils.parseEther('10000');
            await owlToken.transfer(user1.address, amountOWL);
            const owlBefore = await owlToken.balanceOf(user1.address);
            await owlToken.connect(user1).approve(owlRouter.address, amountOWL);
            
            const amounts = await uniswapV2Router.getAmountsOut(amount, [ daiAddress, await uniswapV2Router.WETH() ]);

            let tax = amount.mul(routerTransferTax).div(100000);
            // apply OWL tax discount
            tax = tax.sub(tax.mul(owlTaxDiscount).div(100));
            // convert DAI to ETH
            tax = (await uniswapV2Router.getAmountsOut(tax, [ daiAddress, await uniswapV2Router.WETH() ]))[1];
            // convert ETH to OWL
            tax = (await uniswapV2Router.getAmountsOut(tax, [ await uniswapV2Router.WETH(), owlAddress ]))[1];

            const balanceBefore = await user1.getBalance();
            const tx = await owlRouter.connect(user1).swapTokensForETH(daiAddress, amount, 0, true);
            
            const gasUsed = (await tx.wait()).gasUsed;
            const gasPrice = tx.gasPrice;
            const gasCost = gasUsed.mul(gasPrice);
            const balanceAfter = await user1.getBalance();

            // reduce DAI
            expect(await daiToken.balanceOf(user1.address)).to.equal(0);
            // increase ETH
            expect(balanceAfter).to.equal(balanceBefore.add(amounts[1]).sub(gasCost));
            // reduce tax
            expect(await owlToken.balanceOf(user1.address)).to.equal(owlBefore.sub(tax));
            
            // reduce tax by OWL fee
            tax = tax.sub(tax.mul(owlTax).div(100));
            
            // tax
            expect(await owlToken.balanceOf(manager.address)).to.equal(tax);
        });

        it ('should swap ETH for OWL paying fee with ETH', async() => {
            const amount = ethers.utils.parseEther('1');
            const managerBalance = await manager.getBalance();
            
            let tax = amount.mul(routerTransferTax).div(100000);
            const amounts = await uniswapV2Router.getAmountsOut(amount.sub(tax), [ await uniswapV2Router.WETH(), owlAddress ]);
            let taxOwl = amounts[1].mul(owlTax).div(100);

            await owlRouter.connect(user1).swapETHForTokens(owlAddress, 0, false, { value: amount });
            
            // increase OWL
            expect(await owlToken.balanceOf(user1.address)).to.equal(amounts[1].sub(taxOwl));
            // tax
            expect(await manager.getBalance()).to.equal(managerBalance.add(tax));
        });

        it ('should swap ETH for OWL paying fee with OWL', async() => {
            const amount = ethers.utils.parseEther('1');
            const managerOwlBalance = await owlToken.balanceOf(manager.address);
            
            // send OWL to user1
            const amountOWL = ethers.utils.parseEther('10000');
            await owlToken.transfer(user1.address, amountOWL);
            const owlBefore = await owlToken.balanceOf(user1.address);
            
            let tax = amount.mul(routerTransferTax).div(100000);
            tax = tax.sub(tax.mul(owlTaxDiscount).div(100));
            tax = (await uniswapV2Router.getAmountsOut(tax, [ await uniswapV2Router.WETH(), owlAddress ]))[1];

            const amounts = await uniswapV2Router.getAmountsOut(amount, [ await uniswapV2Router.WETH(), owlAddress ]);
            let owlAfterSwap = amounts[1].sub(amounts[1].mul(owlTax).div(100));
            
            await owlToken.connect(user1).approve(owlRouter.address, amountOWL);
            await owlRouter.connect(user1).swapETHForTokens(owlAddress, 0, true, { value: amount });
    
            // increase OWL
            expect(await owlToken.balanceOf(user1.address)).to.equal(owlBefore.add(owlAfterSwap).sub(tax));
            // tax
            const owlTaxTransfer = tax.mul(owlTax).div(100);
            expect(await owlToken.balanceOf(manager.address)).to.equal(managerOwlBalance.add(tax).sub(owlTaxTransfer));
        });

        it ('should swap DAI for OWL paying fee with DAI', async() => {
            const amount = ethers.utils.parseEther('1000');
            await daiToken.transfer(user1.address, amount);
            await daiToken.connect(user1).approve(owlRouter.address, amount);
            const balanceBefore = await daiToken.balanceOf(user1.address);

            let tax = amount.mul(routerTransferTax).div(100000);
            const amounts = await uniswapV2Router.getAmountsOut(amount.sub(tax), [ daiAddress, await uniswapV2Router.WETH(), owlAddress ]);
            let taxOwl = amounts[2].mul(owlTax).div(100);

            await owlRouter.connect(user1).swapTokensForTokens(daiAddress, owlAddress, amount, 0, false);
            
            // let transferTax = amounts[2].mul(owlTax).div(100);

            // reduce DAI
            expect(await daiToken.balanceOf(user1.address)).to.equal(balanceBefore.sub(amount));
            // increase OWL
            expect(await owlToken.balanceOf(user1.address)).to.equal(amounts[2].sub(taxOwl));
            // tax
            expect(await daiToken.balanceOf(manager.address)).to.equal(tax);
        });

        it ('should swap DAI for OWL paying fee with OWL', async() => {
            const amount = ethers.utils.parseEther('1000');
            await daiToken.transfer(user1.address, amount);
            await daiToken.connect(user1).approve(owlRouter.address, amount);
            const balanceBefore = await daiToken.balanceOf(user1.address);

            // send OWL to user1
            const amountOWL = ethers.utils.parseEther('10000');
            await owlToken.transfer(user1.address, amountOWL);
            const owlBefore = await owlToken.balanceOf(user1.address);

            let tax = amount.mul(routerTransferTax).div(100000);
            tax = tax.sub(tax.mul(owlTaxDiscount).div(100));
            tax = (await uniswapV2Router.getAmountsOut(tax, [ daiAddress, await uniswapV2Router.WETH(), owlAddress ]))[2];

            const amounts = await uniswapV2Router.getAmountsOut(amount, [ daiAddress, await uniswapV2Router.WETH(), owlAddress ]);
            let owlAfterSwap = amounts[2].sub(amounts[2].mul(owlTax).div(100));
            
            await owlToken.connect(user1).approve(owlRouter.address, amountOWL);
            await owlRouter.connect(user1).swapTokensForTokens(daiAddress, owlAddress, amount, 0, true);
            
            // result
            expect(await daiToken.balanceOf(user1.address)).to.equal(balanceBefore.sub(amount));
            expect(await owlToken.balanceOf(user1.address)).to.equal(owlBefore.add(owlAfterSwap).sub(tax));
            // tax
            const owlTaxTransfer = tax.mul(owlTax).div(100);
            expect(await owlToken.balanceOf(manager.address)).to.equal(tax.sub(owlTaxTransfer));
        });

    });

    describe('Holder discount', async() => {

        let owlTax = 1; // 1%
        let routerTransferTax = 1000; // 1%
        let owlTaxDiscount = 30; // 30%
        let holderDiscountSteps = [
            ethers.utils.parseEther('5000'),
            ethers.utils.parseEther('30000'),
            ethers.utils.parseEther('60000'),
        ];
        let holderDiscountValues = [ 2000, 3000, 3000 ];

        function calculateDiscount(balance) {
            let discount = ethers.BigNumber.from(0);
            for (let i = 0; i < holderDiscountSteps.length; i++) {
                if (balance.lt(holderDiscountSteps[i])) {
                    discount = discount.add(balance.mul(holderDiscountValues[i]).div(holderDiscountSteps[i]));
                    break;
                }

                discount = discount.add(holderDiscountValues[i]);
                balance = balance.sub(holderDiscountSteps[i]);
            }
            return discount;
        }

        beforeEach(async() => {
            await owlRouter.setTaxFee('swap', routerTransferTax);
            await owlRouter.setTaxDiscount(owlTaxDiscount);
            await owlRouter.setTaxWallet(manager.address);
            await owlRouter.setHolderDiscount(holderDiscountValues, holderDiscountSteps);
        });

        it ('should get correct holder discount', async() => {
            let discount;
            let balance;
            let increment = 500;

            while (true) {
                if ((await owlToken.balanceOf(owner.address)).lt(ethers.utils.parseEther(increment.toString()))) {
                    break;
                }

                await owlToken.transfer(user1.address, ethers.utils.parseEther(increment.toString()));
                balance = await owlToken.balanceOf(user1.address);
                discount = await owlRouter.connect(user1).getMyHolderDiscount();

                // console.log('balance', ethers.utils.formatEther(balance), 'discount', discount);
                expect(discount).to.equal(calculateDiscount(balance));
            }
        });
    });
});