const { ethers } = require("hardhat");
const { expect } = require("chai");
const { takeSnapshot } = require("@nomicfoundation/hardhat-network-helpers");


describe("OwlToken", () => {
    
    let owner;
    let user1;
    let owlToken;
    let startingState;

    const totalOwl = ethers.utils.parseEther("1000000");

    before(async() => {
        const OwlToken = await ethers.getContractFactory("OwlToken");
        [ owner, user1 ] = await ethers.getSigners();
        owlToken = await OwlToken.deploy(totalOwl);

        startingState = await takeSnapshot();
    })

    beforeEach(async() => {
        await startingState.restore();
    })

    describe("Deployment", async() => {
        it("should initialize", async() => {
            expect(await owlToken).to.be.ok
        });

        it("Should assign the total supply of tokens to the owner", async function () {
            const ownerBalance = await owlToken.balanceOf(owner.address);
            expect(await owlToken.totalSupply()).to.equal(ownerBalance);
        });
    })

    describe("Transfer", async() => {
        it("should transfer tokens", async() => {
            const amount = ethers.utils.parseEther("1");
            await owlToken.transfer(user1.address, amount);
            expect(await owlToken.balanceOf(user1.address)).to.equal(amount);
        });

        it("should not transfer tokens if sender does not have enough", async() => {
            const amount = ethers.utils.parseEther("10");
            await expect(owlToken.connect(user1).transfer(owner.address, amount)).to.be.revertedWith("ERC20: transfer amount exceeds balance");
        });

    });

})