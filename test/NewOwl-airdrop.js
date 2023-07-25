const { ethers } = require('hardhat');
const { expect } = require('chai');
const { takeSnapshot } = require('@nomicfoundation/hardhat-network-helpers');
const fs = require('fs');
const { MerkleTree } = require('merkletreejs');
const keccak256 = require('keccak256');
const { bufferToHex } = require('ethereumjs-util');


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

    describe('Airdrop', async() => {

        let holders;
        // let merkleTree;
        // let leaves;
        // let merkleRoot = '0xa29a67e92b0321f16951187d22d9b6c67bf6168b27f52185206bb28c5433ac6e';

        beforeEach(async() => {
            // pick file and build holders array
            const file = fs.readFileSync(__dirname + '/airdrop2.txt', 'utf-8');
            holders = file.split('\n').map(row => {
                let [address, amount] = row.replace('\r', '').split(',');
                return { address, amount };
            });
            // console.log(holders)

            // // estimate airdrop gas
            // let estimate = await owlToken.estimateGas.airdrop(addresses, amounts);
            // console.log('estimate', estimate.toString());


            // await owlToken.setMerkleRoot(merkleRoot);

            // // Hash the address and amount data together for the Merkle tree
            // leaves = holders.map((recipient) => {
            //     return keccak256(recipient.address + recipient.amount);
            // });

            // // Create the Merkle tree
            // merkleTree = new MerkleTree(leaves, keccak256);
        });

        it('should airdrop tokens', async() => {

            // ----
            holders = holders.slice(0, 50);
            // ----
            
            let addresses = holders.map(holder => holder.address);
            let amounts = holders.map(holder => holder.amount);

            // let balanceTokens = await owlToken.balanceOf(owner.address);
            // console.log('balance', balanceTokens.toString());
            
            // await owlToken.airdrop(addresses, amounts);

            // estimate airdrop gas
            let estimate = await owlToken.estimateGas.airdrop(addresses, amounts);
            console.log('estimate', estimate.toString());
            
            // balanceTokens = await owlToken.balanceOf(owner.address);
            // console.log('balance', balanceTokens.toString());
        });

        // it('should match merkle root', async() => {
        //     // const checkRoot = merkleTree.getHexRoot();
        //     // expect(checkRoot).to.equal(merkleRoot);
        // });

        // it('should verify proofs', async() => {
        //     holders.forEach(holder => {
        //         const userLeaf = keccak256(holder.address + holder.amount);
        //         const proof = merkleTree.getProof(userLeaf);
        //         expect(merkleTree.verify(proof, userLeaf, merkleRoot)).to.equal(true);
        //     })
        // });

        // it('should not allow to claim if not in list', async() => {
        //     const userLeaf = keccak256(user1.address + ethers.utils.parseEther('1'));
        //     const proof = merkleTree.getProof(userLeaf);
        //     await expect(
        //         owlToken.connect(user1).claimTokens(user1.address, ethers.utils.parseEther('1'), proof)
        //     ).to.be.revertedWith('Invalid proof');
        // });

        // it('should allow to claim if in list', async() => {
        //     const data = holders[0].address + holders[0].amount;
        //     const userLeaf = bufferToHex(keccak256(data));
        //     const proof = merkleTree.getHexProof(data);
        //     const root = merkleTree.getHexRoot();

        //     expect(
        //         await owlToken.verify(proof, root, userLeaf)
        //     ).to.equal(true);
            
        // });

        // it('should not allow to claim if already claimed', async() => {

        // });
        
    });

});