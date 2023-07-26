const { ethers } = require("hardhat");
const keccak256 = require('keccak256');

module.exports = async ({
    holders,
    tree,
    claimOwl,
    owlToken,
}) => {

    // claim tokens

    // FLOW:
    // 1. user connect wallet
    // 2. backend checks if user is a holder, if so, return amount
    // 3. check on the contract has a valid proof and not claimed
    // 4. if so, claim tokens

    const user = holders[0];
    let leaf = keccak256(ethers.utils.solidityPack(["address", "uint256"], [user.address, user.amount]));
    let proof = tree.getProof(leaf).map(p => p.data);

    const verified = tree.verify(proof, leaf, tree.getRoot());
    const isClaimed = await claimOwl.isClaimed(user.address);

    if (verified && !isClaimed) {
        console.log('Claiming tokens...');
        await claimOwl.claim(user.address, user.amount, proof);

        // check new user balance
        const userBalance = await owlToken.balanceOf(user.address);
        console.log(`User ${user.address} balance: ${ethers.utils.formatEther(userBalance)}`);

        const contractBalance = await owlToken.balanceOf(claimOwl.address);
        console.log(`Contract balance: ${ethers.utils.formatEther(contractBalance)}`);
    }
}