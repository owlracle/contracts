const { ethers } = require("hardhat");
const { MerkleTree } = require('merkletreejs');
const keccak256 = require('keccak256');
const fs = require('fs');

module.exports = async ({
    owlToken,
    deployer,
}) => {

    // deploy claim contract

    // get holders from file
    let holders = fs.readFileSync(__dirname + '/../files/airdrop-wei.txt', 'utf-8');
    holders = holders.split('\n').map(row => {
        let [address, amount] = row.replace(/\s+/, '').split(',');
        return { address, amount };
    });

    // create merkle tree
    const leaves = holders.map(({ address, amount }) => keccak256(ethers.utils.solidityPack(["address", "uint256"], [address, amount])));
    let tree = new MerkleTree(leaves, keccak256, { sort: true });
    
    // deploy claimOwl
    console.log('Deploying claim contract...')
    const ClaimOwl = await ethers.getContractFactory('ClaimOwl');
    let claimOwl = await ClaimOwl.deploy(owlToken.address, tree.getRoot());
    await claimOwl.deployed();
    
    console.log(`Tree root: ${tree.getHexRoot()}`);
    
    // exclude claimOwl from fee so users get exactly what they claim
    console.log('Excluding claim contract from fee...');
    await owlToken.excludeFromFee(claimOwl.address);

    // fund the claim contract
    console.log('Funding claim contract...');
    const ownerBalance = await owlToken.balanceOf(deployer.address);
    await owlToken.transfer(claimOwl.address, ownerBalance);


    return {
        claimOwl,
        holders,
        tree,
    }
}