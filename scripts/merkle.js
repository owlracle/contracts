const { MerkleTree } = require('merkletreejs');
const keccak256 = require('keccak256');
const fs = require('fs');

// Example list of eligible recipients with corresponding amounts
let holders = fs.readFileSync(__dirname + '/airdrop.txt', 'utf-8');
holders = holders.split('\n').map(row => {
    let [address, amount] = row.replace('\r', '').split(',');
    amount = ethers.utils.parseEther(amount).toString();
    return { address, amount };
});
// console.log(holders)

// Hash the address and amount data together for the Merkle tree
const leaves = holders.map((recipient) => {
    return keccak256(recipient.address + recipient.amount);
});
// console.log(leaves)

// Create the Merkle tree
const merkleTree = new MerkleTree(leaves, keccak256);
const merkleRoot = merkleTree.getHexRoot();

console.log('Merkle Root:', merkleRoot);

// // Provide proofs to users
// const userAddress = '0xuseraddress'; // Replace with the user's address
// const userAmount = '100'; // Replace with the user's amount

// // Find the index of the user's leaf in the leaves array
// const leafIndex = leaves.findIndex((leaf) => leaf.equals(keccak256(userAddress + userAmount)));

// // Get the Merkle proof for the user's leaf
// const proof = merkleTree.getProof(leafIndex);

// console.log('Merkle Proof:', proof);