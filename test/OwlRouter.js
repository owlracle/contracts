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

        it ('should apply custom mode discounts correctly', async() => {
            const mode = 'twelve';
            const discount = '12000';
            await owlRouter.setTaxFee(mode, discount);
            expect(await owlRouter.getTaxFee(mode)).to.equal(discount);
        });
    });

    describe('Transfer', async() => {

        let owlTax = 1; // 1%
        let routerTransferTax = 1000; // 1%
        let owlTaxDiscount = 30000; // 30%
        let mode = 'transfer';
        let amountOWL;

        beforeEach(async() => {
            await owlRouter.setHolderDiscount([ 0 ], [ ethers.utils.parseEther('0') ]);

            // send OWL to user1
            amountOWL = ethers.utils.parseEther('10000');
            await owlToken.transfer(user1.address, amountOWL);
            amountOWL = await owlToken.balanceOf(user1.address);
            await owlToken.connect(user1).approve(owlRouter.address, amountOWL);
            await owlRouter.connect(user1).deposit(amountOWL);
            amountOWL = await owlRouter.balanceOf(user1.address);
        });

        it ('should transfer ETH', async() => {
            const balanceBefore = await user2.getBalance();
            const amount = ethers.utils.parseEther('1');

            // send eth to router
            await owlRouter.connect(user1).transferETH(user2.address, false, mode, { value: amount });
            
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
            await owlRouter.connect(user1).transferETH(user2.address, false, mode, { value: amount });

            // console.log('ownerAfter', ethers.utils.formatEther(await owner.getBalance()));
            
            expect(await user2.getBalance()).to.equal(user2BalanceBefore.add(amount.sub(tax)));
            expect(await owner.getBalance()).to.equal(ownerBefore.add(tax));
        });

        it ('should transfer ETH paying with OWL', async() => {
            const user2BalanceBefore = await user2.getBalance();
            const amount = ethers.utils.parseEther('1');
            
            // router fee
            await owlRouter.setTaxFee('transfer', routerTransferTax);
            let tax = amount.mul(routerTransferTax).div(100000);
            // apply OWL tax discount
            tax = tax.sub(tax.mul(owlTaxDiscount).div(100000));
            // convert eth to OWL
            tax = (await uniswapV2Router.getAmountsOut(tax, [ await uniswapV2Router.WETH(), owlAddress ]))[1];

            // send eth to router
            await owlRouter.connect(user1).transferETH(user2.address, true, mode, { value: amount });

            // check if user2 received eth
            expect(await user2.getBalance()).to.equal(user2BalanceBefore.add(amount));
            // check if owner received OWL tax
            expect(await owlRouter.balanceOf(owner.address)).to.equal(tax);
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
            await owlRouter.connect(user1).transfer(user2.address, daiAddress, amountDAI, false, mode);
            
            expect(await daiToken.balanceOf(user1.address)).to.equal(0);
            expect(await daiToken.balanceOf(user2.address)).to.equal(amountDAI.sub(tax));
            expect(await daiToken.balanceOf(manager.address)).to.equal(tax);
        });

        it ('should transfer DAI paying with OWL', async() => {
            // send some DAI to user1
            const amountDAI = ethers.utils.parseEther('300');
            await daiToken.transfer(user1.address, amountDAI);
            
            // set tax wallet
            await owlRouter.setTaxWallet(manager.address);

            // router fee
            await owlRouter.setTaxFee('transfer', routerTransferTax);
            let tax = amountDAI.mul(routerTransferTax).div(100000);
            // apply OWL tax discount
            tax = tax.sub(tax.mul(owlTaxDiscount).div(100000));
            // convert DAI to ETH
            tax = (await uniswapV2Router.getAmountsOut(tax, [daiAddress, await uniswapV2Router.WETH()]))[1];
            // convert ETH to OWL
            tax = (await uniswapV2Router.getAmountsOut(tax, [await uniswapV2Router.WETH(), owlAddress]))[1];

            // send dai to user2 through router
            await daiToken.connect(user1).approve(owlRouter.address, amountDAI);
            await owlRouter.connect(user1).transfer(user2.address, daiAddress, amountDAI, true, mode);
            
            // user 1 should have no DAI
            expect(await daiToken.balanceOf(user1.address)).to.equal(0);
            // user 2 should have DAI transfered from user 1
            expect(await daiToken.balanceOf(user2.address)).to.equal(amountDAI);
            // manager should have tax
            expect(await owlRouter.balanceOf(manager.address)).to.equal(tax);
        });

        it ('should transfer OWL with fee', async() => {
            amountOWL = ethers.utils.parseEther('10000');
            await owlToken.transfer(user1.address, amountOWL);
            amountOWL = await owlToken.balanceOf(user1.address);

            // set tax wallet
            await owlRouter.setTaxWallet(manager.address);

            // router fee
            await owlRouter.setTaxFee('transfer', routerTransferTax);
            let tax = amountOWL.mul(routerTransferTax).div(100000);
            
            // send dai to user2 through router
            await owlToken.connect(user1).approve(owlRouter.address, amountOWL);
            await owlRouter.connect(user1).transfer(user2.address, owlAddress, amountOWL, false, mode);
            
            // user 1 send OWL to user 2
            expect(await owlToken.balanceOf(user1.address)).to.equal(0);

            let owlTaxAmount = amountOWL.sub(tax).mul(owlTax).div(100);
            // user 2 should have OWL transfered from user 1
            expect(await owlToken.balanceOf(user2.address)).to.equal(amountOWL.sub(tax).sub(owlTaxAmount));
            // manager should have tax
            owlTaxAmount = tax.mul(owlTax).div(100);
            expect(await owlToken.balanceOf(manager.address)).to.equal(tax.sub(owlTaxAmount));
        });

        it ('should transfer OWL using OWL as payment (same as previous test)', async() => {
            amountOWL = ethers.utils.parseEther('10000');
            await owlToken.transfer(user1.address, amountOWL);
            amountOWL = await owlToken.balanceOf(user1.address);

            // set tax wallet
            await owlRouter.setTaxWallet(manager.address);

            // router fee
            await owlRouter.setTaxFee('transfer', routerTransferTax);
            let tax = amountOWL.mul(routerTransferTax).div(100000);
            tax = tax.sub(tax.mul(owlTaxDiscount).div(100000));

            
            // send dai to user2 through router
            await owlToken.connect(user1).approve(owlRouter.address, amountOWL);
            await owlRouter.connect(user1).transfer(user2.address, owlAddress, amountOWL, true, mode);
            
            // user 1 send OWL to user 2
            expect(await owlToken.balanceOf(user1.address)).to.equal(0);

            let owlTaxAmount = amountOWL.mul(owlTax).div(100);
            // user 2 should have OWL transfered from user 1
            expect(await owlToken.balanceOf(user2.address)).to.equal(amountOWL.sub(owlTaxAmount));
            // manager should have tax
            expect(await owlRouter.balanceOf(manager.address)).to.equal(tax);
        });

        it ('should transfer DAI using custom mode', async() => {
            // send some DAI to user1
            const amountDAI = ethers.utils.parseEther('300');
            await daiToken.transfer(user1.address, amountDAI);

            // set tax wallet
            await owlRouter.setTaxWallet(manager.address);

            // router fee
            let fee = '12000'
            await owlRouter.setTaxFee('twelve', fee);
            let tax = amountDAI.mul(fee).div(100000);
            
            // send dai to user2 through router
            await daiToken.connect(user1).approve(owlRouter.address, amountDAI);
            await owlRouter.connect(user1).transfer(user2.address, daiAddress, amountDAI, false, 'twelve');
            
            expect(await daiToken.balanceOf(user1.address)).to.equal(0);
            expect(await daiToken.balanceOf(user2.address)).to.equal(amountDAI.sub(tax));
            expect(await daiToken.balanceOf(manager.address)).to.equal(tax);
        });

    });

    describe('Swap', async() => {

        let owlTax = 1; // 1%
        let routerTransferTax = 1000; // 1%
        let owlTaxDiscount = 30000; // 30%
        let mode = 'swap';
        let amountOWL;

        beforeEach(async() => {
            await owlRouter.setTaxFee(mode, routerTransferTax);
            await owlRouter.setTaxDiscount(owlTaxDiscount);
            await owlRouter.setTaxWallet(manager.address);
            await owlRouter.setHolderDiscount([ 0 ], [ ethers.utils.parseEther('0') ]);

            // send OWL to user1
            amountOWL = ethers.utils.parseEther('10000');
            await owlToken.transfer(user1.address, amountOWL);
            amountOWL = await owlToken.balanceOf(user1.address);
            await owlToken.connect(user1).approve(owlRouter.address, amountOWL);
            await owlRouter.connect(user1).deposit(amountOWL);
            amountOWL = await owlRouter.balanceOf(user1.address);
            
        });

        it ('should swap ETH for DAI paying fee with ETH', async() => {
            const amount = ethers.utils.parseEther('1');
            const managerBalance = await manager.getBalance();
            const balanceBefore = await user1.getBalance();
            
            let tax = amount.mul(routerTransferTax).div(100000);
            const amounts = await uniswapV2Router.getAmountsOut(amount.sub(tax), [ await uniswapV2Router.WETH(), daiAddress ]);

            const tx = await owlRouter.connect(user1).swapETHForTokens(daiAddress, 0, false, mode, { value: amount });
            
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
            
            const amounts = await uniswapV2Router.getAmountsOut(amount, [ await uniswapV2Router.WETH(), daiAddress ]);
            const owlBefore = await owlRouter.balanceOf(user1.address);
            
            await owlRouter.connect(user1).swapETHForTokens(daiAddress, 0, true, mode, { value: amount });
            
            // user1 get DAI
            expect(await daiToken.balanceOf(user1.address)).to.equal(amounts[1]);

            let tax = amount.mul(routerTransferTax).div(100000);
            // apply OWL tax discount
            tax = tax.sub(tax.mul(owlTaxDiscount).div(100000));
            // convert eth to OWL
            tax = (await uniswapV2Router.getAmountsOut(tax, [ await uniswapV2Router.WETH(), owlAddress ]))[1];
            
            // user1 should have less OWL
            expect(await owlRouter.balanceOf(user1.address)).to.equal(owlBefore.sub(tax));
            // manager should have tax
            expect(await owlRouter.balanceOf(manager.address)).to.equal(tax);
        });

        it ('should swap DAI for ETH paying fee with ETH', async() => {
            const amount = ethers.utils.parseEther('1000');
            await daiToken.transfer(user1.address, amount);
            await daiToken.connect(user1).approve(owlRouter.address, amount);

            const managerBalance = await manager.getBalance();
            
            const amounts = await uniswapV2Router.getAmountsOut(amount, [ daiAddress, await uniswapV2Router.WETH() ]);
            let tax = amounts[1].mul(routerTransferTax).div(100000);
            
            const balanceBefore = await user1.getBalance();
            const tx = await owlRouter.connect(user1).swapTokensForETH(daiAddress, amount, 0, false, mode);
            
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
            
            const amounts = await uniswapV2Router.getAmountsOut(amount, [ daiAddress, await uniswapV2Router.WETH() ]);

            let tax = amount.mul(routerTransferTax).div(100000);
            // apply OWL tax discount
            tax = tax.sub(tax.mul(owlTaxDiscount).div(100000));
            // convert DAI to OWL
            tax = (await uniswapV2Router.getAmountsOut(tax, [ daiAddress, await uniswapV2Router.WETH(), owlAddress ]))[2];

            const owlBefore = await owlRouter.balanceOf(user1.address);

            const balanceBefore = await user1.getBalance();
            const tx = await owlRouter.connect(user1).swapTokensForETH(daiAddress, amount, 0, true, mode);
            
            const gasUsed = (await tx.wait()).gasUsed;
            const gasPrice = tx.gasPrice;
            const gasCost = gasUsed.mul(gasPrice);
            const balanceAfter = await user1.getBalance();

            // reduce DAI
            expect(await daiToken.balanceOf(user1.address)).to.equal(0);
            // increase ETH
            expect(balanceAfter).to.equal(balanceBefore.add(amounts[1]).sub(gasCost));
            // reduce tax
            expect(await owlRouter.balanceOf(user1.address)).to.equal(owlBefore.sub(tax));
            // tax
            expect(await owlRouter.balanceOf(manager.address)).to.equal(tax);
        });

        it ('should swap ETH for OWL paying fee with ETH', async() => {
            const amount = ethers.utils.parseEther('1');
            const managerBalance = await manager.getBalance();
            
            let tax = amount.mul(routerTransferTax).div(100000);
            const amounts = await uniswapV2Router.getAmountsOut(amount.sub(tax), [ await uniswapV2Router.WETH(), owlAddress ]);
            let taxOwl = amounts[1].mul(owlTax).div(100);

            await owlRouter.connect(user1).swapETHForTokens(owlAddress, 0, false, mode, { value: amount });
            
            // increase OWL
            expect(await owlToken.balanceOf(user1.address)).to.equal(amounts[1].sub(taxOwl));
            // tax
            expect(await manager.getBalance()).to.equal(managerBalance.add(tax));
        });

        it ('should swap ETH for OWL paying fee with OWL', async() => {
            const amount = ethers.utils.parseEther('1');
            
            let tax = amount.mul(routerTransferTax).div(100000);
            tax = tax.sub(tax.mul(owlTaxDiscount).div(100000));
            tax = (await uniswapV2Router.getAmountsOut(tax, [ await uniswapV2Router.WETH(), owlAddress ]))[1];

            const amountOWL = (await uniswapV2Router.getAmountsOut(amount, [ await uniswapV2Router.WETH(), owlAddress ]))[1];
            let taxOwl = amountOWL.mul(owlTax).div(100);
            
            await owlRouter.connect(user1).swapETHForTokens(owlAddress, 0, true, mode, { value: amount });
    
            // increase OWL
            expect(await owlToken.balanceOf(user1.address)).to.equal(amountOWL.sub(taxOwl));
            // tax
            expect(await owlRouter.balanceOf(manager.address)).to.equal(tax);
        });

        it ('should swap DAI for OWL paying fee with DAI', async() => {
            const amount = ethers.utils.parseEther('1000');
            await daiToken.transfer(user1.address, amount);
            await daiToken.connect(user1).approve(owlRouter.address, amount);
            const balanceBefore = await daiToken.balanceOf(user1.address);

            let tax = amount.mul(routerTransferTax).div(100000);
            const amounts = await uniswapV2Router.getAmountsOut(amount.sub(tax), [ daiAddress, await uniswapV2Router.WETH(), owlAddress ]);
            let taxOwl = amounts[2].mul(owlTax).div(100);

            await owlRouter.connect(user1).swapTokensForTokens(daiAddress, owlAddress, amount, 0, false, mode);
            
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

            let tax = amount.mul(routerTransferTax).div(100000);
            tax = tax.sub(tax.mul(owlTaxDiscount).div(100000));
            tax = (await uniswapV2Router.getAmountsOut(tax, [ daiAddress, await uniswapV2Router.WETH(), owlAddress ]))[2];

            const amountOWL = (await uniswapV2Router.getAmountsOut(amount, [ daiAddress, await uniswapV2Router.WETH(), owlAddress ]))[2];
            const taxOwl = amountOWL.mul(owlTax).div(100);
            
            await owlRouter.connect(user1).swapTokensForTokens(daiAddress, owlAddress, amount, 0, true, mode);
            
            // user1 should have no DAI
            expect(await daiToken.balanceOf(user1.address)).to.equal(0);
            // user1 should have OWL
            expect(await owlToken.balanceOf(user1.address)).to.equal(amountOWL.sub(taxOwl));
            // tax
            expect(await owlRouter.balanceOf(manager.address)).to.equal(tax);
        });

    });

    describe('Holder discount', async() => {

        let owlTax = 1; // 1%
        let routerTransferTax = 1000; // 1%
        let owlTaxDiscount = 30000; // 30%
        let holderDiscountSteps = [
            ethers.utils.parseEther('5000'),
            ethers.utils.parseEther('30000'),
            ethers.utils.parseEther('60000'),
        ];
        let holderDiscountValues = [ 20000, 30000, 30000 ];
        let mode = 'swap';

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
            await owlRouter.setTaxFee(mode, routerTransferTax);
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

        it ('should swap ETH for DAI applying holder discount (ETH)', async() => {
            const amount = ethers.utils.parseEther('1');
            const managerBalance = await manager.getBalance();
            const balanceBefore = await user1.getBalance();

            // send OWL to user1
            const amountOWL = ethers.utils.parseEther('10000');
            await owlToken.transfer(user1.address, amountOWL);
            const owlBefore = await owlToken.balanceOf(user1.address);
            
            let tax = amount.mul(routerTransferTax).div(100000);
            // apply holder discount
            tax = tax.sub(tax.mul(calculateDiscount(owlBefore)).div(100000));

            const amounts = await uniswapV2Router.getAmountsOut(amount.sub(tax), [ await uniswapV2Router.WETH(), daiAddress ]);

            const tx = await owlRouter.connect(user1).swapETHForTokens(daiAddress, 0, false, mode, { value: amount });
            
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

        it ('should swap ETH for DAI applying holder discount (OWL)', async() => {
            const amount = ethers.utils.parseEther('1');
            
            // send OWL to user1 and deposit
            let amountOWL = ethers.utils.parseEther('20000');
            await owlToken.transfer(user1.address, amountOWL);
            amountOWL = await owlToken.balanceOf(user1.address);
            await owlToken.connect(user1).approve(owlRouter.address, amountOWL);
            await owlRouter.connect(user1).deposit(amountOWL.div(2));
            let amountOWLDeposited = await owlRouter.balanceOf(user1.address);
            let amountOWLWallet = await owlToken.balanceOf(user1.address);
            
            const amounts = await uniswapV2Router.getAmountsOut(amount, [ await uniswapV2Router.WETH(), daiAddress ]);
            
            await owlRouter.connect(user1).swapETHForTokens(daiAddress, 0, true, mode, { value: amount });
            
            expect(await daiToken.balanceOf(user1.address)).to.equal(amounts[1]);

            // console.log('original amount', ethers.utils.formatEther(amount));
            
            let tax = amount.mul(routerTransferTax).div(100000);
            // console.log('tax after router tax', ethers.utils.formatEther(tax));

            // apply OWL tax discount
            tax = tax.sub(tax.mul(owlTaxDiscount).div(100000));
            // console.log('tax after OWL discount', ethers.utils.formatEther(tax));

            // apply holder discount
            tax = tax.sub(tax.mul(calculateDiscount(amountOWLWallet)).div(100000));
            // console.log('holder discount', calculateDiscount(owlBefore).toString());
            // console.log('tax after holder discount', ethers.utils.formatEther(tax));

            // convert eth to OWL
            tax = (await uniswapV2Router.getAmountsOut(tax, [ await uniswapV2Router.WETH(), owlAddress ]))[1];
            
            expect(await owlRouter.balanceOf(user1.address)).to.equal(amountOWLDeposited.sub(tax));
            
            expect(await owlRouter.balanceOf(manager.address)).to.equal(tax);
        });

        it ('should swap DAI for OWL applying holder discount (DAI)', async() => {
            const amount = ethers.utils.parseEther('1000');
            await daiToken.transfer(user1.address, amount);
            await daiToken.connect(user1).approve(owlRouter.address, amount);
            const balanceBefore = await daiToken.balanceOf(user1.address);

            // send OWL to user1
            const amountOWL = ethers.utils.parseEther('10000');
            await owlToken.transfer(user1.address, amountOWL);
            const owlBefore = await owlToken.balanceOf(user1.address);
            
            let tax = amount.mul(routerTransferTax).div(100000);
            // console.log('tax after router tax', ethers.utils.formatEther(tax));
            
            // apply holder discount
            tax = tax.sub(tax.mul(calculateDiscount(owlBefore)).div(100000));
            // console.log('holder discount', calculateDiscount(owlBefore).toString());
            // console.log('tax after holder discount', ethers.utils.formatEther(tax));

            const amounts = await uniswapV2Router.getAmountsOut(amount.sub(tax), [ daiAddress, await uniswapV2Router.WETH(), owlAddress ]);
            let taxOwl = amounts[2].mul(owlTax).div(100);

            await owlRouter.connect(user1).swapTokensForTokens(daiAddress, owlAddress, amount, 0, false, mode);
            
            // reduce DAI
            expect(await daiToken.balanceOf(user1.address)).to.equal(balanceBefore.sub(amount));
            // increase OWL
            expect(await owlToken.balanceOf(user1.address)).to.equal(owlBefore.add(amounts[2]).sub(taxOwl));
            // tax
            expect(await daiToken.balanceOf(manager.address)).to.equal(tax);
        });

    });

    describe('Custom Taxes', async() => {

        let managerOWLBalanceBefore;
        let customFee = 5000;
        let mode = 'transfer';
        let routerTax = 1000;
        let amountOWL;

        beforeEach(async() => {
            [ owner, manager, taxWallet, user1, user2 ] = await ethers.getSigners();
            await owlRouter.setTaxFee(mode, routerTax.toString());
            await owlRouter.setTaxWallet(taxWallet.address);
            await owlRouter.connect(manager).setCustomFee(mode, customFee.toString());

            // manager have some OWL deposited
            await owlToken.transfer(manager.address, ethers.utils.parseEther('10000'));
            managerOWLBalanceBefore = await owlToken.balanceOf(manager.address);
            await owlToken.connect(manager).approve(owlRouter.address, managerOWLBalanceBefore);
            await owlRouter.connect(manager).deposit(managerOWLBalanceBefore);
            managerOWLBalanceBefore = await owlRouter.balanceOf(manager.address);

            await owlRouter.setHolderDiscount([0], [ethers.utils.parseEther('0')]);
            await owlRouter.setTaxDiscount('0');

            // send OWL to user1 and deposit
            amountOWL = ethers.utils.parseEther('10000');
            await owlToken.transfer(user1.address, amountOWL);
            amountOWL = await owlToken.balanceOf(user1.address);
            await owlToken.connect(user1).approve(owlRouter.address, amountOWL);
            await owlRouter.connect(user1).deposit(amountOWL);
            amountOWL = await owlRouter.balanceOf(user1.address);
        });

        it ('should set custom fee', async() => {
            expect(await owlRouter.connect(manager).getCustomFee(mode)).to.equal(customFee.toString());
        });

        it ('should transfer ETH with custom fee', async() => {
            const balanceBefore = await user2.getBalance();
            const amount = ethers.utils.parseEther('1');

            const managerETHBalanceBefore = await manager.getBalance();

            let tax = amount.mul(customFee).div(100000);
            await owlRouter.connect(user1).transferETHWithCustomFee(user2.address, false, mode, manager.address, { value: amount });
            
            // custom tax applied correctly
            expect(await user2.getBalance()).to.equal(balanceBefore.add(amount.sub(tax)));

            // manager received custom tax in ETH
            expect(await manager.getBalance()).to.equal(managerETHBalanceBefore.add(tax));

            // manager sent tax to tax wallet in OWL
            tax = amount.mul(routerTax).div(100000);
            tax = (await uniswapV2Router.getAmountsOut(tax, [ await uniswapV2Router.WETH(), owlAddress ]))[1];
            expect(await owlRouter.balanceOf(manager.address)).to.equal(managerOWLBalanceBefore.sub(tax));
            
            // tax wallet received tax in OWL
            expect(await owlRouter.balanceOf(taxWallet.address)).to.equal(tax);
        });

        it ('should transfer DAI with custom fee', async() => {
            await daiToken.transfer(user1.address, ethers.utils.parseEther('1000'));
            await daiToken.connect(user1).approve(owlRouter.address, ethers.utils.parseEther('1000'));

            const balanceBefore = await daiToken.balanceOf(user2.address);
            const amount = ethers.utils.parseEther('1000');

            let tax = amount.mul(customFee).div(100000);
            await owlRouter.connect(user1).transferWithCustomFee(user2.address, daiAddress, amount, false, mode, manager.address);
            
            // custom tax applied correctly
            expect(await daiToken.balanceOf(user2.address)).to.equal(balanceBefore.add(amount.sub(tax)));

            // manager received custom tax in DAI
            expect(await daiToken.balanceOf(manager.address)).to.equal(tax);

            // manager sent tax to tax wallet in OWL
            tax = amount.mul(routerTax).div(100000);
            tax = (await uniswapV2Router.getAmountsOut(tax, [ daiAddress, await uniswapV2Router.WETH(), owlAddress ]))[2];
            expect(await owlRouter.balanceOf(manager.address)).to.equal(managerOWLBalanceBefore.sub(tax));
            
            // tax wallet received tax in OWL
            expect(await owlRouter.balanceOf(taxWallet.address)).to.equal(tax);
        });

        it ('should transfer DAI with custom fee (pay OWL)', async() => {
            await daiToken.transfer(user1.address, ethers.utils.parseEther('1000'));
            await daiToken.connect(user1).approve(owlRouter.address, ethers.utils.parseEther('1000'));

            const balanceBefore = await daiToken.balanceOf(user2.address);
            const amount = ethers.utils.parseEther('1000');

            let tax = amount.mul(customFee).div(100000);
            tax = (await uniswapV2Router.getAmountsOut(tax, [ daiAddress, await uniswapV2Router.WETH(), owlAddress ]))[2];
            
            await owlRouter.connect(user1).transferWithCustomFee(user2.address, daiAddress, amount, true, mode, manager.address);
            
            // user 2 received DAI
            expect(await daiToken.balanceOf(user2.address)).to.equal(balanceBefore.add(amount));
            
            // custom tax applied correctly
            expect(await owlRouter.balanceOf(user1.address)).to.equal(amountOWL.sub(tax));
            
            let taxOut = amount.mul(routerTax).div(100000);
            taxOut = (await uniswapV2Router.getAmountsOut(taxOut, [ daiAddress, await uniswapV2Router.WETH(), owlAddress ]))[2];
            // manager received custom tax in OWL
            // manager sent tax to tax wallet in OWL
            expect(await owlRouter.balanceOf(manager.address)).to.equal(managerOWLBalanceBefore.add(tax).sub(taxOut));
            
            // tax wallet received tax in OWL
            expect(await owlRouter.balanceOf(taxWallet.address)).to.equal(taxOut);
        });

        it ('should not transfer if using invalid app address', async() => {
            const amount = ethers.utils.parseEther('1');
            await expect(
                owlRouter.connect(user1).transferETHWithCustomFee(user2.address, false, mode, owner.address, { value: amount })
            ).to.be.revertedWith('OwlRouter: custom tax fee is not enabled');
        });
    });
});