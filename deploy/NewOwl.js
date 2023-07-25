const { ethers } = require("hardhat");

module.exports = async () => {

    // deploy token

    const [ deployer, user1 ] = await ethers.getSigners();
    console.log(`Deploying contracts with ${ deployer.address }`);

    const OwlToken = await ethers.getContractFactory("NewOwl");
    const owlToken = await OwlToken.deploy();
    await owlToken.deployed();

    console.log(`OwlToken address: ${ owlToken.address }`);
    
    return {
        deployer,
        user1,
        owlToken,
    }
}