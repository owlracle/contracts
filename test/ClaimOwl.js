const { ethers } = require('hardhat');
const { expect } = require('chai');
const { takeSnapshot } = require('@nomicfoundation/hardhat-network-helpers');
const fs = require('fs');
const keccak256 = require('keccak256');
const { MerkleTree } = require('merkletreejs');


describe('ClaimOwl', () => {
    
    let owlToken;
    let claimOwl;
    let startingState;
    let holders;
    let tree;
    let owner;
    let user1;

    before(async() => {

        [ owner, user1 ] = await ethers.getSigners();

        // deploy OwlToken
        const OwlToken = await ethers.getContractFactory('OwlToken');
        owlToken = await OwlToken.deploy();

        // get holders from file
        holders = fs.readFileSync(__dirname + '/../files/airdrop-wei.txt', 'utf-8');
        holders = holders.split('\n').map(row => {
            let [address, amount] = row.replace(/\s+/, '').split(',');
            return { address, amount };
        });

        // create merkle tree
        const leaves = holders.map(({ address, amount }) => keccak256(ethers.utils.solidityPack(["address", "uint256"], [address, amount])));
        tree = new MerkleTree(leaves, keccak256, { sort: true });

        // deploy claimOwl
        const ClaimOwl = await ethers.getContractFactory('ClaimOwl');
        claimOwl = await ClaimOwl.deploy(owlToken.address, tree.getRoot());

        // exclude claimOwl from fee so users get exactly what they claim
        await owlToken.excludeFromFee(claimOwl.address);

        startingState = await takeSnapshot();
    })

    beforeEach(async() => {
        await startingState.restore();
    })

    describe('Deployment', async() => {
        it('should initialize', async() => {
            expect(await claimOwl).to.be.ok;
            expect(await claimOwl.getRoot()).to.equal(tree.getHexRoot());
        });
    })

    describe('Funding', async() => {

        let amountToFund;

        beforeEach(async() => {
            const totalSupply = await owlToken.totalSupply();
            amountToFund = totalSupply.div(2);
            await owlToken.transfer(claimOwl.address, amountToFund);
        });

        it('should fund the contract', async() => {
            expect(await owlToken.balanceOf(claimOwl.address)).to.equal(amountToFund);
        });

        it('should withdraw funds', async() => {
            const ownerStartingBalance = await owlToken.balanceOf(owner.address);

            await claimOwl.withdraw();

            expect(await owlToken.balanceOf(claimOwl.address)).to.equal(0);
            expect(await owlToken.balanceOf(owner.address)).to.equal(amountToFund.add(ownerStartingBalance));
        });

        it('should not withdraw funds if not owner', async() => {
            await expect(claimOwl.connect(user1).withdraw()).to.be.revertedWith('Ownable: caller is not the owner');
        });

    });

    describe('Claiming', async() => {

        let amountToFund;
        let user;
        let leaf;
        let proof;
        
        beforeEach(async() => {
            const totalSupply = await owlToken.totalSupply();
            amountToFund = totalSupply.div(2);
            await owlToken.transfer(claimOwl.address, amountToFund);

            user = holders[0];
            leaf = keccak256(ethers.utils.solidityPack(["address", "uint256"], [user.address, user.amount]));
            proof = tree.getProof(leaf).map(p => p.data);
        });

        it('should be able to claim tokens (single user)', async() => {
            const verified = tree.verify(proof, leaf, tree.getRoot());
            // console.log('Verified:', verified)

            // this is the check before passing the proof to the contract
            expect(verified).to.be.true;
            
            await claimOwl.claim(user.address, user.amount, proof);

            // user got his funds
            const userBalance = await owlToken.balanceOf(user.address);
            expect(userBalance).to.equal(user.amount);
            // console.log('userBalance', ethers.utils.formatEther(userBalance));

            // contract has less funds
            const contractBalance = await owlToken.balanceOf(claimOwl.address);
            expect(contractBalance).to.equal(amountToFund.sub(user.amount));
            // console.log('contractBalance', ethers.utils.formatEther(contractBalance));
        });

        it('should not be able to claim tokens (single user) with wrong proof', async() => {
            let temperedAmount = ethers.BigNumber.from(user.amount).add(1);
            await expect(claimOwl.claim(user.address, temperedAmount, proof)).to.be.revertedWith('ClaimOwl: Invalid proof');
        });

        it('should not be able to claim tokens twice', async() => {
            await claimOwl.claim(user.address, user.amount, proof);
            await expect(claimOwl.claim(user.address, user.amount, proof)).to.be.revertedWith('ClaimOwl: Already claimed');
        });

        it('should not be able to claim tokens when contract has not enough funds', async() => {
            // drain contract
            await claimOwl.withdraw();

            await expect(claimOwl.claim(user.address, user.amount, proof)).to.be.revertedWith('ClaimOwl: Not enough funds');
        });

        it('should be able to claim tokens for ALL holders', async() => {

            let amountSum = ethers.BigNumber.from(0);

            for (let i in holders) {
                const user = holders[i];

                const leaf = keccak256(ethers.utils.solidityPack(["address", "uint256"], [user.address, user.amount]));
                const proof = tree.getProof(leaf).map(p => p.data);
                const verified = tree.verify(proof, leaf, tree.getRoot());
                // console.log('Verified:', verified)
    
                // this is the check before passing the proof to the contract
                expect(verified).to.be.true;
                
                await claimOwl.claim(user.address, user.amount, proof);
    
                // user got his funds
                const userBalance = await owlToken.balanceOf(user.address);
                expect(userBalance).to.equal(user.amount);
                // console.log(`user ${ user.address } balance: `, ethers.utils.formatEther(userBalance));
    
                amountSum = amountSum.add(user.amount);
            }
            
            // contract should have funds drained
            const contractBalance = await owlToken.balanceOf(claimOwl.address);
            expect(contractBalance).to.equal(amountToFund.sub(amountSum));
            // console.log('contractBalance', ethers.utils.formatEther(contractBalance));
        });

    });

})