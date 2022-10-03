const { ethers } = require("hardhat");
const { expect } = require("chai");
// import { time } from "@openzeppelin/test-helpers";


describe("OwlFarm", () => {
    
    let owner;
    let alice;
    let bob;
    let res;
    let owlFarm;
    let owlToken;
    let mockDai;

    const daiAmount = ethers.utils.parseEther("25000");

    beforeEach(async() => {
        const OwlFarm = await ethers.getContractFactory("OwlFarm");
        const OwlToken = await ethers.getContractFactory("OwlToken");
        const MockDai = await ethers.getContractFactory("MockERC20");
        mockDai = await MockDai.deploy("MockDai", "mDAI");
        [ owner, alice, bob ] = await ethers.getSigners();
        await Promise.all([
            mockDai.mint(owner.address, daiAmount),
            mockDai.mint(alice.address, daiAmount),
            mockDai.mint(bob.address, daiAmount)
        ]);
        owlToken = await OwlToken.deploy();
        owlFarm = await OwlFarm.deploy(mockDai.address, owlToken.address);
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
            let toTransfer = ethers.utils.parseEther("1000000")
            await mockDai.approve(owlFarm.address, toTransfer)

            await expect(owlFarm.connect(bob).stake(toTransfer))
                .to.be.revertedWith("You cannot stake zero tokens")
        })
    })

    describe("Unstake", async() => {
        beforeEach(async() => {
            let toTransfer = ethers.utils.parseEther("100")
            await mockDai.connect(alice).approve(owlFarm.address, toTransfer)
            await owlFarm.connect(alice).stake(toTransfer)
        })

        it("should unstake balance from user", async() => {
            let toTransfer = ethers.utils.parseEther("100")
            await owlFarm.connect(alice).unstake(toTransfer)

            res = await owlFarm.stakingBalance(alice.address)
            expect(Number(res))
                .to.eq(0)

            expect(await owlFarm.isStaking(alice.address))
                .to.eq(false)
        })
    })

    // describe("WithdrawYield", async() => {

    //     beforeEach(async() => {
    //         await owlToken._transferOwnership(owlFarm.address)
    //         let toTransfer = ethers.utils.parseEther("10")
    //         await mockDai.connect(alice).approve(owlFarm.address, toTransfer)
    //         await owlFarm.connect(alice).stake(toTransfer)
    //     })

    //     it("should return correct yield time", async() => {
    //         let timeStart = await owlFarm.startTime(alice.address)
    //         expect(Number(timeStart))
    //             .to.be.greaterThan(0)

    //         // Fast-forward time
    //         await time.increase(86400)

    //         expect(await owlFarm.calculateYieldTime(alice.address))
    //             .to.eq((86400))
    //     })

    //     it("should mint correct token amount in total supply and user", async() => { 
    //         await time.increase(86400)

    //         let _time = await owlFarm.calculateYieldTime(alice.address)
    //         let formatTime = _time / 86400
    //         let staked = await owlFarm.stakingBalance(alice.address)
    //         let bal = staked * formatTime
    //         let newBal = ethers.utils.formatEther(bal.toString())
    //         let expected = Number.parseFloat(newBal).toFixed(3)

    //         await owlFarm.connect(alice).withdrawYield()

    //         res = await owlToken.totalSupply()
    //         let newRes = ethers.utils.formatEther(res)
    //         let formatRes = Number.parseFloat(newRes).toFixed(3).toString()

    //         expect(expected)
    //             .to.eq(formatRes)

    //         res = await owlToken.balanceOf(alice.address)
    //         newRes = ethers.utils.formatEther(res)
    //         formatRes = Number.parseFloat(newRes).toFixed(3).toString()

    //         expect(expected)
    //             .to.eq(formatRes)
    //     })

    //     it("should update yield balance when unstaked", async() => {
    //         await time.increase(86400)
    //         await owlFarm.connect(alice).unstake(ethers.utils.parseEther("5"))

    //         res = await owlFarm.pmknBalance(alice.address)
    //         expect(Number(ethers.utils.formatEther(res)))
    //             .to.be.approximately(10, .001)
    //     })

    // })
})