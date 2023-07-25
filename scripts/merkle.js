const { MerkleTree } = require('merkletreejs');
const keccak256 = require('keccak256');
const fs = require('fs');

// Example list of eligible recipients with corresponding amounts
let holders = fs.readFileSync(__dirname + '/../files/airdrop-wei.txt', 'utf-8');
holders = holders.split('\n').map(row => {
    let [address, amount] = row.replace(/\s+/, '').split(',');
    return { address, amount };
});
// console.log(holders)

// Hash the address and amount data together for the Merkle tree
const leaves = holders.map(({ address, amount }) => keccak256(address + amount));
// console.log(leaves)

// Create the Merkle tree
const merkleTree = new MerkleTree(leaves, keccak256, { sort: true });
const merkleRoot = merkleTree.getRoot();

console.log('Merkle Root:', merkleRoot);

const user = holders[10];
const leafIndex = leaves.findIndex(leaf => leaf.equals(keccak256(user.address + user.amount)));
const leaf = merkleTree.getHexLeaves()[leafIndex];
const proof = merkleTree.getProof(leaf);
const verified = merkleTree.verify(proof, leaf, merkleRoot);
console.log('Verified:', verified);