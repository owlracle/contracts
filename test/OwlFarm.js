const { ethers } = require("hardhat");
const { expect } = require("chai");
const { time, takeSnapshot } = require("@nomicfoundation/hardhat-network-helpers");


describe("OwlFarm", () => {
    
    let owner;
    let alice;
    let bob;
    let res;
    let owlFarm;
    let owlToken;
    let mockDai;
    let startingState;

    const daiAmount = ethers.utils.parseEther("25000");
    const totalOwl = ethers.utils.parseEther("1000000");

    before(async() => {
        const OwlFarm = await ethers.getContractFactory("OwlFarm");
        const OwlToken = await ethers.getContractFactory("OwlToken");
        const MockDai = await ethers.getContractFactory("MockERC20");
        mockDai = await MockDai.deploy("MockDai", "mDAI");
        [ owner, alice, bob ] = await ethers.getSigners();
        await Promise.all([
            mockDai.mint(owner.address, daiAmount),
            mockDai.mint(alice.address, daiAmount),
            mockDai.mint(bob.address, ethers.utils.parseEther((100000000).toString())),
        ]);
        owlToken = await OwlToken.deploy(totalOwl);

        // owner has all the OWL, transfer some to bob
        await owlToken.connect(owner).approve(owner.address, totalOwl);
        await owlToken.transferFrom(owner.address, bob.address, daiAmount);

        owlFarm = await OwlFarm.deploy(mockDai.address, owlToken.address, 5e11);

        startingState = await takeSnapshot();
    })

    beforeEach(async() => {
        await startingState.restore();
    })

    describe("Init", async() => {
        it("should initialize", async() => {
            expect(await owlToken).to.be.ok
            expect(await owlFarm).to.be.ok
            expect(await mockDai).to.be.ok
        })
    })

    describe("Stake", async() => {
        it("should accept DAI and update mapping", async() => {
            let toTransfer = ethers.utils.parseEther("100");
            await mockDai.connect(alice).approve(owlFarm.address, toTransfer);

            expect(await owlFarm.isStaking(alice.address)).to.eq(false);
            expect(await owlFarm.connect(alice).stake(toTransfer)).to.be.ok;
            expect(await owlFarm.stakingBalance(alice.address)).to.eq(toTransfer);
            expect(await owlFarm.isStaking(alice.address)).to.eq(true);
        })

        it("should update balance with multiple stakes", async() => {
            let toTransfer = ethers.utils.parseEther("100");
            await mockDai.connect(alice).approve(owlFarm.address, toTransfer);
            await owlFarm.connect(alice).stake(toTransfer);

            await mockDai.connect(alice).approve(owlFarm.address, toTransfer);
            await owlFarm.connect(alice).stake(toTransfer);

            expect(await owlFarm.stakingBalance(alice.address)).to.eq(ethers.utils.parseEther("200"));
        })

        it("should revert with not enough funds", async() => {
            let toTransfer = ethers.utils.parseEther("1000000");
            await mockDai.approve(owlFarm.address, toTransfer);
            await expect(owlFarm.connect(alice).stake(toTransfer)).to.be.revertedWith("You cannot stake zero tokens");
        })
    })

    describe("Unstake", async() => {
        beforeEach(async() => {
            let toTransfer = ethers.utils.parseEther("100");
            await mockDai.connect(alice).approve(owlFarm.address, toTransfer);
            await owlFarm.connect(alice).stake(toTransfer);
        })

        it("should unstake balance from user", async() => {
            let toTransfer = ethers.utils.parseEther("100");
            await owlFarm.connect(alice).unstake(toTransfer);
            res = await owlFarm.stakingBalance(alice.address);

            expect(Number(res)).to.eq(0);
            expect(await owlFarm.isStaking(alice.address)).to.eq(false);
        })
    })

    describe("AddFunds", async() => {

        it("should remove token form user and add to contract", async() => {
            const testValue = 10;
            const tokenBefore = ethers.utils.formatEther( await owlToken.balanceOf(bob.address) );

            let toTransfer = ethers.utils.parseEther(testValue.toString());
            await owlToken.connect(bob).approve(owlFarm.address, toTransfer);
            await owlFarm.connect(bob).addFunds(toTransfer);
    
            const tokenBalance = await owlFarm.totalOwlBalance();

            // contract received the right amount
            expect( tokenBalance ).to.eq( toTransfer );

            const tokenAfter = ethers.utils.formatEther( await owlToken.balanceOf(bob.address) );
    
            // user wallet decreased the right amount
            expect( tokenBefore - tokenAfter ).to.eq(testValue);
        })
    })

    describe("WithdrawYield", async() => {
        const timeCapture = async (timestamp=0) => {
            const blockNum = await ethers.provider.getBlockNumber();
            const block = await ethers.provider.getBlock(blockNum);
            return block.timestamp - timestamp;
        }
        const executeAndGoBack = async (callback) => {
            const snapshot = await takeSnapshot();
            const timeStart = await timeCapture();

            const res = await callback();

            // get time it took to execute the commands
            const timeDiff = await timeCapture(timeStart);

            // restore and advance time
            await snapshot.restore();
            await time.increase(timeDiff);

            return res;
        }

        beforeEach(async() => {
            let toTransfer = ethers.utils.parseEther("10000");
            await owlToken.connect(bob).approve(owlFarm.address, toTransfer);
            await owlFarm.connect(bob).addFunds(toTransfer);

            toTransfer = ethers.utils.parseEther("990");
            await mockDai.connect(bob).approve(owlFarm.address, toTransfer);
            await owlFarm.connect(bob).stake(toTransfer);

            toTransfer = ethers.utils.parseEther("10");
            await mockDai.connect(alice).approve(owlFarm.address, toTransfer);
            await owlFarm.connect(alice).stake(toTransfer);
        })

        it("should return correct yield time", async() => {
            let timeStart = await owlFarm.startTime(alice.address);
            expect(Number(timeStart)).to.be.greaterThan(0);

            // Fast-forward time
            await time.increase(86400);

            expect(await owlFarm.calculateYieldTime(alice.address)).to.eq(86400);
        })

        it("should compound rewards correctly", async() => { 
            await time.increase(86400);

            const base = 5e-7;
            const depletePerc = Math.pow(base + 1, 86400) - 1;

            const lpStanking = ethers.utils.formatEther( await owlFarm.stakingBalance(alice.address) );
            const lpBalance = ethers.utils.formatEther( await owlFarm.totalLpBalance() );
            const lpShare = lpStanking / lpBalance;

            const rewardPerc = lpShare * depletePerc;
            const dueYield = rewardPerc * ethers.utils.formatEther( await owlFarm.totalOwlBalance() );

            const calculatedYield = Number(ethers.utils.formatEther(await owlFarm.calculateYieldTotal(alice.address))).toFixed(6);

            expect(calculatedYield).to.eq(dueYield.toFixed(6));
        })

        it("should match wallet token balance with contract supply decreased", async() => {
            await time.increase(86400);

            const tokenSupplyBefore =  ethers.utils.formatEther(await owlToken.balanceOf(owlFarm.address));
            await owlFarm.connect(alice).withdrawYield();
            const owl =  await owlToken.balanceOf(alice.address);
            const tokenSupplyAfter =  ethers.utils.formatEther(await owlToken.balanceOf(owlFarm.address));  
            
            const formattedOwl = Number(ethers.utils.formatEther(owl)).toFixed(6);
            const formattedDiff = (tokenSupplyBefore - tokenSupplyAfter).toFixed(6);

            expect( formattedOwl ).to.eq( formattedDiff );
        })

        it("should retrieve correct token amount", async() => {
            await time.increase(86400);

            const owl = await executeAndGoBack(async () => {
                await owlFarm.connect(alice).withdrawYield();
                return await owlToken.balanceOf(alice.address);
            });

            // so we can calculate yield based on the real elapsed timestamp
            const calculatedYield = await owlFarm.calculateYieldTotal(alice.address);

            expect( owl ).to.eq( calculatedYield );
        })

        it("should update yield balance when unstaked", async() => {
            await time.increase(86400);

            const unrealizedBalance = await executeAndGoBack(async () => {
                await owlFarm.connect(alice).unstake(ethers.utils.parseEther("5"));
                return await owlFarm.unrealizedBalance(alice.address);
            });

            const calculatedYield = await owlFarm.calculateYieldTotal(alice.address);

            expect( unrealizedBalance ).to.eq( calculatedYield );
        })

        it("staking rewards should not be affected by others entering/leaving", async() => {
            await time.increase(86400);

            // retrieve rewards after 1 day of staking
            const owlAlone = await executeAndGoBack(async () => {
                await owlFarm.connect(alice).withdrawYield();
                return await owlToken.balanceOf(alice.address);
            });

            // a whale deposites in the mean time
            const toTransfer = ethers.utils.parseEther("1000000");
            await mockDai.connect(bob).approve(owlFarm.address, toTransfer);
            await owlFarm.connect(bob).stake(toTransfer);

            // withdraw after the whale deposited
            await owlFarm.connect(alice).withdrawYield();
            const owlAfterWhale = await owlToken.balanceOf(alice.address);


            expect( owlAlone ).to.eq( owlAfterWhale );
        })

    })
})