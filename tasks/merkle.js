async function callback() {
    const { MerkleTree } = require('merkletreejs');
    const keccak256 = require('keccak256');
    
    // Example list of eligible recipients with corresponding amounts
    let holders = require('../files/airdrop.json');
    // console.log(holders)
    
    // Hash the address and amount data together for the Merkle tree
    const leaves = holders.map(({ address, amount }) => keccak256(ethers.utils.solidityPack(["address", "uint256"], [address, amount])));
    // console.log(leaves)
    
    // Create the Merkle tree
    const tree = new MerkleTree(leaves, keccak256, { sort: true });
    console.log('Merkle Root:', tree.getHexRoot());
    
    const user = holders[3];
    // console.log(user);
    const leaf = keccak256(ethers.utils.solidityPack(["address", "uint256"], [user.address, user.amount]));
    const proof = tree.getProof(leaf).map(p => p.data);
    const verified = tree.verify(proof, leaf, tree.getRoot());
    console.log('Verified:', verified);
    
    // get hex proof
    const proofHex = tree.getHexProof(leaf);
    console.log(`User ${user.address} amount: ${user.amount} proof: ${JSON.stringify(proofHex)}`);
}

module.exports = {
    name: 'merkle',
    description: 'Create a Merkle tree from a list of eligible recipients and create a proof for a specific user.',
    callback,
};