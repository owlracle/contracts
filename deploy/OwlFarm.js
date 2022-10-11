const { ethers } = require("hardhat");
require('dotenv').config();

module.exports = async input => {
    const [deployer] = await ethers.getSigners();
    console.log(`Deploying contracts with ${deployer.address}`);

    const OWLUSDCLPAddress = process.env.GOERLI_LP_ADDRESS;
    const OWLAddress = input.owlTokenAddress;

    const OwlFarm = await ethers.getContractFactory("OwlFarm");
    const owlFarm = await OwlFarm.deploy(OWLUSDCLPAddress, OWLAddress, 5e11);
    console.log(`OwlFarm address: ${owlFarm.address}`);

    return { owlFarmAddress: owlFarm.address };
}