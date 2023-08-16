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

        let owlTax = 1;
        let routerTransferTax = 100;

        before(async() => {
        })

        it ('should transfer eth', async() => {
            const balanceBefore = await user2.getBalance();
            const amount = ethers.utils.parseEther('1');

            // send eth to router
            await owlRouter.connect(user1).transferETH(user2.address, { value: amount });
            
            expect(await user2.getBalance()).to.equal(balanceBefore.add(amount));
        });

        it ('should transfer eth with fee', async() => {
            const user2BalanceBefore = await user2.getBalance();
            const amount = ethers.utils.parseEther('1');
            
            // 5% fee
            await owlRouter.setTaxFee('transfer', routerTransferTax);
            let tax = amount.mul(routerTransferTax).div(100000);
            const ownerBefore = await owner.getBalance();

            // console.log('tax', ethers.utils.formatEther(tax));
            // console.log('ownerBefore', ethers.utils.formatEther(ownerBefore));
            
            // send eth to router
            await owlRouter.connect(user1).transferETH(user2.address, { value: amount });

            // console.log('ownerAfter', ethers.utils.formatEther(await owner.getBalance()));
            
            expect(await user2.getBalance()).to.equal(user2BalanceBefore.add(amount.sub(tax)));
            expect(await owner.getBalance()).to.equal(ownerBefore.add(tax));
        });

        it ('should transfer DAI with fee', async() => {
            // send some DAI to user1
            const amountDAI = ethers.utils.parseEther('300');
            await daiToken.transfer(user1.address, amountDAI);

            // set tax wallet
            await owlRouter.setTaxWallet(manager.address);

            // 5% fee
            await owlRouter.setTaxFee('transfer', routerTransferTax);
            let tax = amountDAI.mul(routerTransferTax).div(100000);
            
            // send dai to user2 through router
            await daiToken.connect(user1).approve(owlRouter.address, amountDAI);
            await owlRouter.connect(user1).transfer(user2.address, daiAddress, amountDAI);
            
            expect(await daiToken.balanceOf(user1.address)).to.equal(0);
            expect(await daiToken.balanceOf(user2.address)).to.equal(amountDAI.sub(tax));
            expect(await daiToken.balanceOf(manager.address)).to.equal(tax);
        });

        it ('should transfer OWL with fee', async() => {
            // send some OWL to user1
            let amountOWL = ethers.utils.parseEther('10000');
            await owlToken.transfer(user1.address, amountOWL);
            amountOWL = await owlToken.balanceOf(user1.address);

            // set tax wallet
            await owlRouter.setTaxWallet(manager.address);

            // 5% fee
            await owlRouter.setTaxFee('transfer', routerTransferTax);
            let tax = amountOWL.mul(routerTransferTax).div(100000);
            
            // OWL fee
            let owlTaxAmount = amountOWL.sub(tax).mul(owlTax).div(100);

            // send dai to user2 through router
            await owlToken.connect(user1).approve(owlRouter.address, amountOWL);
            await owlRouter.connect(user1).transfer(user2.address, owlAddress, amountOWL);
            
            expect(await owlToken.balanceOf(user1.address)).to.equal(0);
            expect(await owlToken.balanceOf(user2.address)).to.equal(amountOWL.sub(tax).sub(owlTaxAmount));

            owlTaxAmount = tax.mul(owlTax).div(100);
            expect(await owlToken.balanceOf(manager.address)).to.equal(tax.sub(owlTaxAmount));
        });

    });


})