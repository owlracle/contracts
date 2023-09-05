const { ethers } = require('hardhat');
const { expect } = require('chai');
const { takeSnapshot } = require('@nomicfoundation/hardhat-network-helpers');


describe('OwlRouter', () => {
    
    let owner;
    let manager;
    let taxWallet;
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

        const OwlRouter = await ethers.getContractFactory('contracts/OwlRouterV2.sol:OwlRouter');
        [ owner, manager, taxWallet, user1, user2 ] = await ethers.getSigners();
        owlRouter = await OwlRouter.deploy(
            owlAddress,
            uniswapV2RouterAddress,
        );

        await owlRouter.setTaxWallet(taxWallet.address);

        // const receipt = await owlRouter.deployTransaction.wait();
        // console.log('gas used', receipt.gasUsed.toString());

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

    const groups = [
        {
            name: 'Deployment',
            tests: async() => {
                it('should initialize', async() => {
                    expect(await owlRouter).to.be.ok
                });
            }
        },
        {
            name: 'Transfer',
            tests: async() => {

                let owlTax = 1; // 1%
                let routerTax = 1000; // 1%
                let amountOWL;
        
                beforeEach(async() => {
        
                    // send OWL to user1
                    amountOWL = ethers.utils.parseEther('10000');
                    await owlToken.transfer(user1.address, amountOWL);
                    amountOWL = await owlToken.balanceOf(user1.address);
                    await owlToken.connect(user1).approve(owlRouter.address, amountOWL);
                    await owlRouter.connect(user1).deposit(amountOWL);
                    amountOWL = await owlRouter.balanceOf(user1.address);
                });
        
                it ('should transfer ETH with no tax fee', async() => {
                    const balanceBefore = await user2.getBalance();
                    const amount = ethers.utils.parseEther('1');
        
                    await owlRouter.connect(user1).transferETH(user2.address, false, '0', { value: amount });
                    
                    expect(await user2.getBalance()).to.equal(balanceBefore.add(amount));
                });

                it ('should transfer ETH with fee', async() => {
                    const user1BalanceBefore = await user1.getBalance();
                    const taxWalletBalanceBefore = await taxWallet.getBalance();
                    const amount = ethers.utils.parseEther('1');
                    
                    // router fee
                    let tax = amount.mul(routerTax).div(100000);
                    await owlRouter.connect(user2).transferETH(user1.address, false, tax, { value: amount });
        
                    expect(await user1.getBalance()).to.equal(user1BalanceBefore.add(amount).sub(tax));
                    expect(await taxWallet.getBalance()).to.equal(taxWalletBalanceBefore.add(tax));
                });
        
                it ('should transfer ETH paying with OWL', async() => {
                    const user2BalanceBefore = await user2.getBalance();
                    const amount = ethers.utils.parseEther('1');
                    
                    // router fee
                    let tax = amount.mul(routerTax).div(100000);
                    tax = (await uniswapV2Router.getAmountsOut(tax, [ await uniswapV2Router.WETH(), owlAddress ]))[1];
        
                    await owlRouter.connect(user1).transferETH(user2.address, true, tax, { value: amount });
        
                    expect(await user2.getBalance()).to.equal(user2BalanceBefore.add(amount));
                    expect(await owlRouter.balanceOf(taxWallet.address)).to.equal(tax);
                });
        
                it ('should transfer DAI with fee', async() => {
                    // send some DAI to user1
                    const amountDAI = ethers.utils.parseEther('1000');
                    await daiToken.transfer(user2.address, amountDAI);
        
                    // router fee
                    let tax = amountDAI.mul(routerTax).div(100000);
                    
                    // send dai to user2 through router
                    await daiToken.connect(user2).approve(owlRouter.address, amountDAI);
                    await owlRouter.connect(user2).transfer(user1.address, daiAddress, amountDAI, false, tax);
                    
                    expect(await daiToken.balanceOf(user2.address)).to.equal(0);
                    expect(await daiToken.balanceOf(user1.address)).to.equal(amountDAI.sub(tax));
                    expect(await daiToken.balanceOf(taxWallet.address)).to.equal(tax);
                });
        
                it ('should transfer DAI paying with OWL', async() => {
                    // send some DAI to user1
                    const amountDAI = ethers.utils.parseEther('1000');
                    await daiToken.transfer(user1.address, amountDAI);
                    
                    // router fee
                    let tax = amountDAI.mul(routerTax).div(100000);
                    // convert DAI to OWL
                    tax = (await uniswapV2Router.getAmountsOut(tax, [daiAddress, await uniswapV2Router.WETH(), owlAddress]))[2];
        
                    // send dai to user2 through router
                    await daiToken.connect(user1).approve(owlRouter.address, amountDAI);
                    await owlRouter.connect(user1).transfer(user2.address, daiAddress, amountDAI, true, tax);
                    
                    // user 1 should have no DAI
                    expect(await daiToken.balanceOf(user1.address)).to.equal(0);
                    // user 2 should have DAI transfered from user 1
                    expect(await daiToken.balanceOf(user2.address)).to.equal(amountDAI);
                    // manager should have tax
                    expect(await owlRouter.balanceOf(taxWallet.address)).to.equal(tax);
                });
        
                it ('should transfer OWL with fee', async() => {
                    let amountOWL = ethers.utils.parseEther('10000');
                    await owlToken.transfer(user2.address, amountOWL);
                    amountOWL = await owlToken.balanceOf(user2.address);
        
                    // router fee
                    let tax = amountOWL.mul(routerTax).div(100000);
                    let owlTaxAmount = amountOWL.sub(tax).mul(owlTax).div(100);
        
                    // send dai to user2 through router
                    await owlToken.connect(user2).approve(owlRouter.address, amountOWL);
                    await owlRouter.connect(user2).transfer(user1.address, owlAddress, amountOWL, false, tax);
                    
                    expect(await owlToken.balanceOf(user2.address)).to.equal(0);
                    expect(await owlToken.balanceOf(user1.address)).to.equal(amountOWL.sub(tax).sub(owlTaxAmount));
                    owlTaxAmount = tax.mul(owlTax).div(100);
                    expect(await owlToken.balanceOf(taxWallet.address)).to.equal(tax.sub(owlTaxAmount));
                });

                it ('should transfer OWL using OWL as payment', async() => {
                    let amountOWL = ethers.utils.parseEther('10000');
                    await owlToken.transfer(user1.address, amountOWL);
                    amountOWL = await owlToken.balanceOf(user1.address);
        
                    // router fee
                    let tax = amountOWL.mul(routerTax).div(100000);
        
                    // send dai to user2 through router
                    await owlToken.connect(user1).approve(owlRouter.address, amountOWL);
                    await owlRouter.connect(user1).transfer(user2.address, owlAddress, amountOWL, true, tax);
                    
                    expect(await owlToken.balanceOf(user1.address)).to.equal(0);
                    let owlTaxAmount = amountOWL.mul(owlTax).div(100);
                    expect(await owlToken.balanceOf(user2.address)).to.equal(amountOWL.sub(owlTaxAmount));
                    expect(await owlRouter.balanceOf(taxWallet.address)).to.equal(tax);
                });
            }
        },
        {
            name: 'Swap',
            tests: async() => {

                let owlTax = 1; // 1%
                let routerTax = 1000; // 1%
                let amountOWL;
        
                beforeEach(async() => {
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
                    const taxWalletBalance = await taxWallet.getBalance();
                    const balanceBefore = await user2.getBalance();
                    
                    let tax = amount.mul(routerTax).div(100000);
                    const amounts = await uniswapV2Router.getAmountsOut(amount.sub(tax), [ await uniswapV2Router.WETH(), daiAddress ]);
        
                    const tx = await owlRouter.connect(user2).swapETHForTokens(daiAddress, 0, false, tax, { value: amount });
                    
                    // reduce ETH
                    const gasUsed = (await tx.wait()).gasUsed;
                    const gasPrice = tx.gasPrice;
                    const gasCost = gasUsed.mul(gasPrice);
                    expect(await user2.getBalance()).to.equal(balanceBefore.sub(amount).sub(gasCost));
                    // increase DAI
                    expect(await daiToken.balanceOf(user2.address)).to.equal(amounts[1]);
                    // tax
                    expect(await taxWallet.getBalance()).to.equal(taxWalletBalance.add(tax));
        
        
                });
        
                it ('should swap ETH for DAI paying fee with OWL', async() => {
                    const amount = ethers.utils.parseEther('1');
                    
                    const amounts = await uniswapV2Router.getAmountsOut(amount, [ await uniswapV2Router.WETH(), daiAddress ]);
                    const owlBefore = await owlRouter.balanceOf(user1.address);

                    let tax = amount.mul(routerTax).div(100000);
                    // convert eth to OWL
                    tax = (await uniswapV2Router.getAmountsOut(tax, [ await uniswapV2Router.WETH(), owlAddress ]))[1];

                    await owlRouter.connect(user1).swapETHForTokens(daiAddress, 0, true, tax, { value: amount });
                    
                    // user1 get DAI
                    expect(await daiToken.balanceOf(user1.address)).to.equal(amounts[1]);                    
                    // user1 should have less OWL
                    expect(await owlRouter.balanceOf(user1.address)).to.equal(owlBefore.sub(tax));
                    // taxWallet should have tax
                    expect(await owlRouter.balanceOf(taxWallet.address)).to.equal(tax);
                });
        
                it ('should swap DAI for ETH paying fee with ETH', async() => {
                    const amount = ethers.utils.parseEther('1000');
                    await daiToken.transfer(user2.address, amount);
                    await daiToken.connect(user2).approve(owlRouter.address, amount);

                    const taxWalletBalance = await daiToken.balanceOf(taxWallet.address);
        
                    let tax = amount.mul(routerTax).div(100000);
                    let amountEth = (await uniswapV2Router.getAmountsOut(amount.sub(tax), [ daiAddress, await uniswapV2Router.WETH() ]))[1];
                    
                    const balanceBefore = await user2.getBalance();
                    const tx = await owlRouter.connect(user2).swapTokensForETH(daiAddress, amount, 0, false, tax);
                    
                    // reduce DAI
                    expect(await daiToken.balanceOf(user2.address)).to.equal(0);
        
                    // increase ETH            
                    const gasUsed = (await tx.wait()).gasUsed;
                    const gasPrice = tx.gasPrice;
                    const gasCost = gasUsed.mul(gasPrice);
                    const balanceAfter = await user2.getBalance();
        
                    expect(balanceAfter).to.equal(balanceBefore.add(amountEth).sub(gasCost));
        
                    // tax
                    expect(await daiToken.balanceOf(taxWallet.address)).to.equal(taxWalletBalance.add(tax));
                });
        
                it ('should swap DAI for ETH paying fee with OWL', async() => {
                    const amount = ethers.utils.parseEther('1000');
                    await daiToken.transfer(user1.address, amount);
                    await daiToken.connect(user1).approve(owlRouter.address, amount);
                    
                    const amounts = await uniswapV2Router.getAmountsOut(amount, [ daiAddress, await uniswapV2Router.WETH() ]);
        
                    let tax = amount.mul(routerTax).div(100000);
                    // convert DAI to OWL
                    tax = (await uniswapV2Router.getAmountsOut(tax, [ daiAddress, await uniswapV2Router.WETH(), owlAddress ]))[2];
        
                    const owlBefore = await owlRouter.balanceOf(user1.address);
        
                    const balanceBefore = await user1.getBalance();
                    const tx = await owlRouter.connect(user1).swapTokensForETH(daiAddress, amount, 0, true, tax);
                    
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
                    expect(await owlRouter.balanceOf(taxWallet.address)).to.equal(tax);
                });
        
                it ('should swap ETH for OWL paying fee with ETH', async() => {
                    const amount = ethers.utils.parseEther('1');
                    const taxWalletBalance = await taxWallet.getBalance();
                    
                    let tax = amount.mul(routerTax).div(100000);
                    const amounts = await uniswapV2Router.getAmountsOut(amount.sub(tax), [ await uniswapV2Router.WETH(), owlAddress ]);
                    let taxOwl = amounts[1].mul(owlTax).div(100);
        
                    await owlRouter.connect(user2).swapETHForTokens(owlAddress, 0, false, tax, { value: amount });
                    
                    // increase OWL
                    expect(await owlToken.balanceOf(user2.address)).to.equal(amounts[1].sub(taxOwl));
                    // tax
                    expect(await taxWallet.getBalance()).to.equal(taxWalletBalance.add(tax));
                });
        
                it ('should swap ETH for OWL paying fee with OWL', async() => {
                    const amount = ethers.utils.parseEther('1');
                    const balanceBefore = await owlToken.balanceOf(user1.address);
                    
                    const amountOwl = (await uniswapV2Router.getAmountsOut(amount, [ await uniswapV2Router.WETH(), owlAddress ]))[1];
                    let tax = amountOwl.mul(routerTax).div(100000);
                    // tax = (await uniswapV2Router.getAmountsOut(tax, [ await uniswapV2Router.WETH(), owlAddress ]))[1];
                    
                    await owlRouter.connect(user1).swapETHForTokens(owlAddress, 0, true, tax, { value: amount });
            
                    // increase OWL
                    expect(await owlToken.balanceOf(user1.address)).to.equal(balanceBefore.add(amountOwl).sub(tax));
                    // tax
                    expect(await owlRouter.balanceOf(taxWallet.address)).to.equal(tax);
                });
        
                it ('should swap DAI for OWL paying fee with DAI', async() => {
                    const amount = ethers.utils.parseEther('1000');
                    await daiToken.transfer(user2.address, amount);
                    await daiToken.connect(user2).approve(owlRouter.address, amount);
                    const balanceBefore = await daiToken.balanceOf(user2.address);
        
                    let tax = amount.mul(routerTax).div(100000);
                    const amounts = await uniswapV2Router.getAmountsOut(amount.sub(tax), [ daiAddress, await uniswapV2Router.WETH(), owlAddress ]);
                    let taxOwl = amounts[2].mul(owlTax).div(100);
        
                    await owlRouter.connect(user2).swapTokensForTokens(daiAddress, owlAddress, amount, 0, false, tax);
                    
                    // reduce DAI
                    expect(await daiToken.balanceOf(user2.address)).to.equal(balanceBefore.sub(amount));
                    // increase OWL
                    expect(await owlToken.balanceOf(user2.address)).to.equal(amounts[2].sub(taxOwl));
                    // tax
                    expect(await daiToken.balanceOf(taxWallet.address)).to.equal(tax);
                });
        
                it ('should swap DAI for OWL paying fee with OWL', async() => {
                    const amount = ethers.utils.parseEther('1000');
                    await daiToken.transfer(user1.address, amount);
                    await daiToken.connect(user1).approve(owlRouter.address, amount);
        
                    const amountOwl = (await uniswapV2Router.getAmountsOut(amount, [ daiAddress, await uniswapV2Router.WETH(), owlAddress ]))[2];
                    let tax = amountOwl.mul(routerTax).div(100000);
                    
                    await owlRouter.connect(user1).swapTokensForTokens(daiAddress, owlAddress, amount, 0, true, tax);
                    
                    // user1 should have no DAI
                    expect(await daiToken.balanceOf(user1.address)).to.equal(0);
                    // user1 should have OWL
                    expect(await owlToken.balanceOf(user1.address)).to.equal(amountOwl.sub(tax));
                    // tax
                    expect(await owlRouter.balanceOf(taxWallet.address)).to.equal(tax);
                });
        
            }
        },
        {
            name: 'Custom Taxes',
            tests: async() => {

                let customFee = 5000;
                let routerTax = 1000;
                let amountOWL;
                let managerOWLBalanceBefore;
                let owlTax = 1;
        
                beforeEach(async() => {
                    // manager have some OWL deposited
                    await owlToken.transfer(manager.address, ethers.utils.parseEther('10000'));
                    managerOWLBalanceBefore = await owlToken.balanceOf(manager.address);
                    await owlToken.connect(manager).approve(owlRouter.address, managerOWLBalanceBefore);
                    await owlRouter.connect(manager).deposit(managerOWLBalanceBefore);
                    managerOWLBalanceBefore = await owlRouter.balanceOf(manager.address);
        
                    // send OWL to user1 and deposit
                    amountOWL = ethers.utils.parseEther('10000');
                    await owlToken.transfer(user1.address, amountOWL);
                    amountOWL = await owlToken.balanceOf(user1.address);
                    await owlToken.connect(user1).approve(owlRouter.address, amountOWL);
                    await owlRouter.connect(user1).deposit(amountOWL);
                    amountOWL = await owlRouter.balanceOf(user1.address);
                });
        
                it ('should transfer ETH with custom fee', async() => {
                    const balanceBefore = await user1.getBalance();
                    const amount = ethers.utils.parseEther('1');
        
                    const managerETHBalanceBefore = await manager.getBalance();
        
                    let tax = amount.mul(routerTax).div(100000);
                    tax = (await uniswapV2Router.getAmountsOut(tax, [ await uniswapV2Router.WETH(), owlAddress ]))[1];
                    let customTax = amount.mul(customFee).div(100000);
                    await owlRouter.connect(user2).transferETHWithCustomFee(user1.address, false, tax, manager.address, customTax, { value: amount });
                    
                    // custom tax applied correctly
                    expect(await user1.getBalance()).to.equal(balanceBefore.add(amount.sub(customTax)));
        
                    // manager received custom tax in ETH
                    expect(await manager.getBalance()).to.equal(managerETHBalanceBefore.add(customTax));
        
                    // manager sent tax to tax wallet in OWL
                    expect(await owlRouter.balanceOf(manager.address)).to.equal(managerOWLBalanceBefore.sub(tax));
                    
                    // tax wallet received tax in OWL
                    expect(await owlRouter.balanceOf(taxWallet.address)).to.equal(tax);
                });

                it ('should transfer ETH with custom fee (pay with OWL)', async() => {
                    const balanceBefore = await user2.getBalance();
                    const amount = ethers.utils.parseEther('1');
        
                    let tax = amount.mul(routerTax).div(100000);
                    tax = (await uniswapV2Router.getAmountsOut(tax, [ await uniswapV2Router.WETH(), owlAddress ]))[1];
                    let customTax = amount.mul(customFee).div(100000);
                    customTax = (await uniswapV2Router.getAmountsOut(customTax, [ await uniswapV2Router.WETH(), owlAddress ]))[1];
                    
                    await owlRouter.connect(user1).transferETHWithCustomFee(user2.address, true, tax, manager.address, customTax, { value: amount });
                    
                    // custom tax applied correctly
                    expect(await user2.getBalance()).to.equal(balanceBefore.add(amount));
        
                    // manager received custom tax in ETH
                    // manager sent tax to tax wallet in OWL
                    expect(await owlRouter.balanceOf(manager.address)).to.equal(managerOWLBalanceBefore.add(customTax).sub(tax));
                    
                    // tax wallet received tax in OWL
                    expect(await owlRouter.balanceOf(taxWallet.address)).to.equal(tax);
                });
        
                it ('should transfer DAI with custom fee', async() => {
                    await daiToken.transfer(user2.address, ethers.utils.parseEther('1000'));
                    await daiToken.connect(user2).approve(owlRouter.address, ethers.utils.parseEther('1000'));
        
                    const balanceBefore = await daiToken.balanceOf(user1.address);
                    const amount = ethers.utils.parseEther('1000');
        
                    let tax = amount.mul(routerTax).div(100000);
                    tax = (await uniswapV2Router.getAmountsOut(tax, [ daiAddress, await uniswapV2Router.WETH(), owlAddress ]))[2];
                    let customTax = amount.mul(customFee).div(100000);
                    await owlRouter.connect(user2).transferWithCustomFee(user1.address, daiAddress, amount, false, tax, manager.address, customTax);
                    
                    // custom tax applied correctly
                    expect(await daiToken.balanceOf(user1.address)).to.equal(balanceBefore.add(amount.sub(customTax)));
        
                    // manager received custom tax in DAI
                    expect(await daiToken.balanceOf(manager.address)).to.equal(customTax);
        
                    // manager sent tax to tax wallet in OWL
                    expect(await owlRouter.balanceOf(manager.address)).to.equal(managerOWLBalanceBefore.sub(tax));
                    
                    // tax wallet received tax in OWL
                    expect(await owlRouter.balanceOf(taxWallet.address)).to.equal(tax);
                });
        
                it ('should transfer DAI with custom fee (pay with OWL)', async() => {
                    await daiToken.transfer(user1.address, ethers.utils.parseEther('1000'));
                    await daiToken.connect(user1).approve(owlRouter.address, ethers.utils.parseEther('1000'));
        
                    const balanceBefore = await daiToken.balanceOf(user2.address);
                    const amount = ethers.utils.parseEther('1000');
        
                    let tax = amount.mul(routerTax).div(100000);
                    tax = (await uniswapV2Router.getAmountsOut(tax, [ daiAddress, await uniswapV2Router.WETH(), owlAddress ]))[2];
                    let customTax = amount.mul(customFee).div(100000);
                    customTax = (await uniswapV2Router.getAmountsOut(customTax, [ daiAddress, await uniswapV2Router.WETH(), owlAddress ]))[2];
                    
                    await owlRouter.connect(user1).transferWithCustomFee(user2.address, daiAddress, amount, true, tax, manager.address, customTax);
                    
                    // user 2 received DAI
                    expect(await daiToken.balanceOf(user2.address)).to.equal(balanceBefore.add(amount));
                    
                    // custom tax applied correctly
                    expect(await owlRouter.balanceOf(user1.address)).to.equal(amountOWL.sub(customTax));
                    
                    // manager received custom tax in OWL
                    // manager sent tax to tax wallet in OWL
                    expect(await owlRouter.balanceOf(manager.address)).to.equal(managerOWLBalanceBefore.add(customTax).sub(tax));
                    
                    // tax wallet received tax in OWL
                    expect(await owlRouter.balanceOf(taxWallet.address)).to.equal(tax);
                });

                it ('should swap ETH for DAI with custom fee', async() => {
                    const amount = ethers.utils.parseEther('1');
                    const balanceBefore = await user2.getBalance();
                    const managerBalanceBefore = await manager.getBalance();
        
                    let tax = amount.mul(routerTax).div(100000);
                    tax = (await uniswapV2Router.getAmountsOut(tax, [ await uniswapV2Router.WETH(), owlAddress ]))[1];
                    let customTax = amount.mul(customFee).div(100000);
                    let daiAmount = (await uniswapV2Router.getAmountsOut(amount.sub(customTax), [ await uniswapV2Router.WETH(), daiAddress ]))[1];
                    let tx = await owlRouter.connect(user2).swapETHForTokensWithCustomFee(daiAddress, 0, false, tax, manager.address, customTax, { value: amount });
                    
                    let gasUsed = (await tx.wait()).gasUsed;
                    let gasPrice = tx.gasPrice;
                    let gasCost = gasUsed.mul(gasPrice);

                    // reduce ETH
                    expect(await user2.getBalance()).to.equal(balanceBefore.sub(amount).sub(gasCost));
                    // increase DAI
                    expect(await daiToken.balanceOf(user2.address)).to.equal(daiAmount);
                    // manager get custom tax
                    expect(await manager.getBalance()).to.equal(managerBalanceBefore.add(customTax));
                    // tax goes to tax wallet
                    expect(await owlRouter.balanceOf(taxWallet.address)).to.equal(tax);
                });

                it ('should swap ETH for DAI with custom fee (pay with OWL)', async() => {
                    const amount = ethers.utils.parseEther('1');
                    const balanceBefore = await user1.getBalance();
        
                    let tax = amount.mul(routerTax).div(100000);
                    tax = (await uniswapV2Router.getAmountsOut(tax, [ await uniswapV2Router.WETH(), owlAddress ]))[1];
                    let customTax = amount.mul(customFee).div(100000);
                    customTax = (await uniswapV2Router.getAmountsOut(customTax, [ await uniswapV2Router.WETH(), owlAddress ]))[1];
                    let daiAmount = (await uniswapV2Router.getAmountsOut(amount, [ await uniswapV2Router.WETH(), daiAddress ]))[1];
                    let tx = await owlRouter.connect(user1).swapETHForTokensWithCustomFee(daiAddress, 0, true, tax, manager.address, customTax, { value: amount });
                    
                    let gasUsed = (await tx.wait()).gasUsed;
                    let gasPrice = tx.gasPrice;
                    let gasCost = gasUsed.mul(gasPrice);

                    // reduce ETH
                    expect(await user1.getBalance()).to.equal(balanceBefore.sub(amount).sub(gasCost));
                    // increase DAI
                    expect(await daiToken.balanceOf(user1.address)).to.equal(daiAmount);
                    // manager get custom tax
                    expect(await owlRouter.balanceOf(manager.address)).to.equal(managerOWLBalanceBefore.add(customTax).sub(tax));
                    // tax goes to tax wallet
                    expect(await owlRouter.balanceOf(taxWallet.address)).to.equal(tax);
                });

                it ('should swap DAI for ETH with custom fee', async() => {
                    const amount = ethers.utils.parseEther('1000');
                    await daiToken.transfer(user1.address, amount);
                    await daiToken.connect(user1).approve(owlRouter.address, amount);

                    const balanceBefore = await user1.getBalance();
                    const managerBalanceBefore = await manager.getBalance();
        
                    let tax = amount.mul(routerTax).div(100000);
                    tax = (await uniswapV2Router.getAmountsOut(tax, [ daiAddress, await uniswapV2Router.WETH(), owlAddress ]))[2];
                    let customTax = amount.mul(customFee).div(100000);
                    let amountEth = (await uniswapV2Router.getAmountsOut(amount.sub(customTax), [ daiAddress, await uniswapV2Router.WETH() ]))[1];
                    let tx = await owlRouter.connect(user1).swapTokensForETHWithCustomFee(daiAddress, amount, 0, false, tax, manager.address, customTax);
                    
                    let gasUsed = (await tx.wait()).gasUsed;
                    let gasPrice = tx.gasPrice;
                    let gasCost = gasUsed.mul(gasPrice);

                    // reduce DAI
                    expect(await daiToken.balanceOf(user1.address)).to.equal(0);
                    // increase ETH
                    expect(await user1.getBalance()).to.equal(balanceBefore.add(amountEth).sub(gasCost));
                    // manager get custom tax
                    expect(await daiToken.balanceOf(manager.address)).to.equal(customTax);
                    // tax goes to tax wallet
                    expect(await owlRouter.balanceOf(taxWallet.address)).to.equal(tax);
                });

                it ('should swap DAI for ETH with custom fee (pay with OWL)', async() => {
                    const amount = ethers.utils.parseEther('1000');
                    await daiToken.transfer(user1.address, amount);
                    await daiToken.connect(user1).approve(owlRouter.address, amount);

                    const balanceBefore = await user1.getBalance();
        
                    let tax = amount.mul(routerTax).div(100000);
                    tax = (await uniswapV2Router.getAmountsOut(tax, [ daiAddress, await uniswapV2Router.WETH(), owlAddress ]))[2];
                    let customTax = amount.mul(customFee).div(100000);
                    customTax = (await uniswapV2Router.getAmountsOut(customTax, [ daiAddress, await uniswapV2Router.WETH(), owlAddress ]))[2];
                    let amountEth = (await uniswapV2Router.getAmountsOut(amount, [ daiAddress, await uniswapV2Router.WETH() ]))[1];
                    let tx = await owlRouter.connect(user1).swapTokensForETHWithCustomFee(daiAddress, amount, 0, true, tax, manager.address, customTax);
                    
                    let gasUsed = (await tx.wait()).gasUsed;
                    let gasPrice = tx.gasPrice;
                    let gasCost = gasUsed.mul(gasPrice);

                    // reduce DAI
                    expect(await daiToken.balanceOf(user1.address)).to.equal(0);
                    // increase ETH
                    expect(await user1.getBalance()).to.equal(balanceBefore.add(amountEth).sub(gasCost));
                    // manager get custom tax
                    expect(await owlRouter.balanceOf(manager.address)).to.equal(managerOWLBalanceBefore.add(customTax).sub(tax));
                    // tax goes to tax wallet
                    expect(await owlRouter.balanceOf(taxWallet.address)).to.equal(tax);
                });

                it ('should swap DAI for OWL with custom fee', async() => {
                    const amount = ethers.utils.parseEther('1000');
                    await daiToken.transfer(user1.address, amount);
                    await daiToken.connect(user1).approve(owlRouter.address, amount);

                    const balanceBefore = await owlToken.balanceOf(user1.address);
        
                    let tax = amount.mul(routerTax).div(100000);
                    tax = (await uniswapV2Router.getAmountsOut(tax, [ daiAddress, await uniswapV2Router.WETH(), owlAddress ]))[2];
                    let customTax = amount.mul(customFee).div(100000);
                    let amountOwl = (await uniswapV2Router.getAmountsOut(amount.sub(customTax), [ daiAddress, await uniswapV2Router.WETH(), owlAddress ]))[2];
                    let owlTaxAmount = amountOwl.mul(owlTax).div(100);
                    await owlRouter.connect(user1).swapTokensForTokensWithCustomFee(daiAddress, owlAddress, amount, 0, false, tax, manager.address, customTax);
                    
                    // reduce DAI
                    expect(await daiToken.balanceOf(user1.address)).to.equal(0);
                    // increase OWL
                    expect(await owlToken.balanceOf(user1.address)).to.equal(balanceBefore.add(amountOwl).sub(owlTaxAmount));
                    // manager get custom tax
                    expect(await daiToken.balanceOf(manager.address)).to.equal(customTax);
                    // tax goes to tax wallet
                    expect(await owlRouter.balanceOf(taxWallet.address)).to.equal(tax);
                });

                it ('should swap DAI for OWL with custom fee (pay with OWL)', async() => {
                    const amount = ethers.utils.parseEther('1000');
                    await daiToken.transfer(user1.address, amount);
                    await daiToken.connect(user1).approve(owlRouter.address, amount);

                    const balanceBefore = await owlToken.balanceOf(user1.address);
        
                    let tax = amount.mul(routerTax).div(100000);
                    tax = (await uniswapV2Router.getAmountsOut(tax, [ daiAddress, await uniswapV2Router.WETH(), owlAddress ]))[2];
                    let customTax = amount.mul(customFee).div(100000);
                    customTax = (await uniswapV2Router.getAmountsOut(customTax, [ daiAddress, await uniswapV2Router.WETH(), owlAddress ]))[2];
                    let amountOwl = (await uniswapV2Router.getAmountsOut(amount, [ daiAddress, await uniswapV2Router.WETH(), owlAddress ]))[2];
                    let owlTaxAmount = amountOwl.mul(owlTax).div(100);
                    await owlRouter.connect(user1).swapTokensForTokensWithCustomFee(daiAddress, owlAddress, amount, 0, true, tax, manager.address, customTax);
                    
                    // reduce DAI
                    expect(await daiToken.balanceOf(user1.address)).to.equal(0);
                    // increase OWL
                    expect(await owlToken.balanceOf(user1.address)).to.equal(balanceBefore.add(amountOwl).sub(owlTaxAmount));
                    // manager get custom tax
                    expect(await owlRouter.balanceOf(manager.address)).to.equal(managerOWLBalanceBefore.add(customTax).sub(tax));
                    // tax goes to tax wallet
                    expect(await owlRouter.balanceOf(taxWallet.address)).to.equal(tax);
                });

                it ('should transfer correctly when setting custom fee to 0', async() => {
                    const amount = ethers.utils.parseEther('1000');
                    daiToken.transfer(user1.address, amount);
                    await daiToken.connect(user1).approve(owlRouter.address, amount);

                    let tax = amount.mul(routerTax).div(100000);
                    tax = (await uniswapV2Router.getAmountsOut(tax, [ daiAddress, await uniswapV2Router.WETH(), owlAddress ]))[2];
                    await owlRouter.connect(user1).transferWithCustomFee(user2.address, daiAddress, amount, true, tax, manager.address, '0');
                    
                    // user1 sends dai
                    expect(await daiToken.balanceOf(user1.address)).to.equal(0);
                    // user2 receives dai
                    expect(await daiToken.balanceOf(user2.address)).to.equal(amount);
                    // manager receives 0 tax
                    expect(await daiToken.balanceOf(manager.address)).to.equal(0);
                    
                    // tax wallet receives normal tax
                    expect(await owlRouter.balanceOf(taxWallet.address)).to.equal(tax);
                });

                it ('should transfer correctly when setting regular fee to 0', async() => {
                    const amount = ethers.utils.parseEther('1000');
                    daiToken.transfer(user1.address, amount);
                    await daiToken.connect(user1).approve(owlRouter.address, amount);

                    const managerBalanceBefore = await daiToken.balanceOf(manager.address);

                    let customTax = amount.mul(customFee).div(100000);
                    await owlRouter.connect(user1).transferWithCustomFee(user2.address, daiAddress, amount, false, '0', manager.address, customTax);
                    
                    // user1 sends dai
                    expect(await daiToken.balanceOf(user1.address)).to.equal(0);
                    // user2 receives dai
                    expect(await daiToken.balanceOf(user2.address)).to.equal(amount.sub(customTax));
                    // manager receives tax
                    expect(await daiToken.balanceOf(manager.address)).to.equal(managerBalanceBefore.add(customTax));
                    
                    // tax wallet receives 0 tax
                    expect(await owlRouter.balanceOf(taxWallet.address)).to.equal(0);
                });
            }
        },
        {
            name: 'Referral',
            tests: async() => {

                let mode = 'mode';
                let routerTax = 1000;
                let amountOWLDeposited;
                let amountOWLWallet;
                let referralBonus = 20000;
        
                beforeEach(async() => {
                    [ owner, taxWallet, referrer, user1, user2 ] = await ethers.getSigners();
                    await owlRouter.setTaxFee(mode, routerTax.toString());
                    await owlRouter.setTaxWallet(taxWallet.address);
        
                    await owlRouter.setHolderDiscount([0], [ethers.utils.parseEther('0')]);
                    await owlRouter.setTaxDiscount('0');
        
                    // send OWL to user1 and deposit
                    const amountOWL = ethers.utils.parseEther('10000');
                    await owlToken.transfer(user1.address, amountOWL.mul(2));
                    await owlToken.connect(user1).approve(owlRouter.address, amountOWL);
                    await owlRouter.connect(user1).deposit(amountOWL);
                    amountOWLDeposited = await owlRouter.balanceOf(user1.address);
                    amountOWLWallet = await owlToken.balanceOf(user1.address);

                    await owlRouter.connect(user1).setReferral(referrer.address);
                    await owlRouter.setReferralBonus(referralBonus);
                });
        
                it ('should correctly set referral wallet', async() => {
                    expect(await owlRouter.getReferral(user1.address)).to.equal(referrer.address);
                });

                it ('should transfer DAI with referral bonus', async() => {
                    // send DAI to user1
                    const amount = ethers.utils.parseEther('1000');
                    await daiToken.transfer(user1.address, amount);
                    await daiToken.connect(user1).approve(owlRouter.address, amount);

                    await owlRouter.connect(user1).transfer(user2.address, daiAddress, amount, true, mode);
                    
                    // user1 sends DAI
                    expect(await daiToken.balanceOf(user1.address)).to.equal(0);
                    // user2 receives DAI
                    expect(await daiToken.balanceOf(user2.address)).to.equal(amount);
                    
                    let tax = amount.mul(routerTax).div(100000);
                    tax = (await uniswapV2Router.getAmountsOut(tax, [ daiAddress, await uniswapV2Router.WETH(), owlAddress ]))[2];
                    let referrerTax = tax.mul(referralBonus).div(100000).div(2);
                    
                    // referrer receives referral bonus
                    expect(await owlRouter.balanceOf(referrer.address)).to.equal(referrerTax);
                    // user1 receives referral bonus
                    expect(await owlRouter.balanceOf(user1.address)).to.equal(amountOWLDeposited.sub(tax).add(referrerTax));
                });

                it ('should swap ETH for DAI with referral bonus', async() => {
                    const amount = ethers.utils.parseEther('1');
                    const balanceBefore = await user1.getBalance();
                    
                    const amounts = await uniswapV2Router.getAmountsOut(amount, [ await uniswapV2Router.WETH(), daiAddress ]);

                    const tx = await owlRouter.connect(user1).swapETHForTokens(daiAddress, 0, true, mode, { value: amount });

                    // user1 sends ETH
                    const gasUsed = (await tx.wait()).gasUsed;
                    const gasPrice = tx.gasPrice;
                    const gasCost = gasUsed.mul(gasPrice);

                    // console.log('user1 balance', ethers.utils.formatEther(await user1.getBalance()));
                    expect(await user1.getBalance()).to.equal(balanceBefore.sub(amount).sub(gasCost));
                    
                    // user1 receives DAI
                    // console.log('user1 DAI balance', ethers.utils.formatEther(await daiToken.balanceOf(user1.address)));
                    expect(await daiToken.balanceOf(user1.address)).to.equal(amounts[1]);

                    let tax = amount.mul(routerTax).div(100000);
                    tax = (await uniswapV2Router.getAmountsOut(tax, [ await uniswapV2Router.WETH(), owlAddress ]))[1];
                    // console.log('tax', ethers.utils.formatEther(tax))
                    let referrerTax = tax.mul(referralBonus).div(100000).div(2);

                    // referrer receives referral bonus
                    // console.log('referrer OWL balance', ethers.utils.formatEther(await owlRouter.balanceOf(referrer.address)));
                    expect(await owlRouter.balanceOf(referrer.address)).to.equal(referrerTax);

                    // user1 receives referral bonus
                    // console.log('user1 OWL balance', ethers.utils.formatEther(await owlRouter.balanceOf(user1.address)));
                    expect(await owlRouter.balanceOf(user1.address)).to.equal(amountOWLDeposited.sub(tax).add(referrerTax));

                });
            }
        },
    ];

    [
        // 'Deployment',
        // 'Transfer',
        // 'Swap',
        'Custom Taxes',
        // 'Referral',
    ].forEach(groupName => {
        if (groups.find(g => g.name === groupName)) {
            const tests = groups.find(g => g.name === groupName).tests;
            describe(groupName, tests);
        }
    });
});

// TODO: build tests that tries to drain contract and appWallet