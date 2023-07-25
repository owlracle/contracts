const { ethers } = require("hardhat");

module.exports = async () => {
    const [ deployer ] = await ethers.getSigners();
    console.log(`Deploying contracts with ${ deployer.address }`);

    const OwlToken = await ethers.getContractFactory("NewOwl");
    const owlToken = await OwlToken.deploy();
    // console.log(owlToken)
    console.log(`OwlToken address: ${ owlToken.address }`);
    return { owlTokenAddress: owlToken.address };
}