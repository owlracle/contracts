const { ethers } = require("hardhat");
require('dotenv').config();

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log(`Deploying contracts with ${deployer.address}`);

    const OWLUSDCLPAddress = process.env.GOERLI_LP_ADDRESS;
    const OWLAddress = process.env.GOERLI_OWL_ADDRESS;

    const OwlFarm = await ethers.getContractFactory("OwlFarm");
    const owlFarm = await OwlFarm.deploy(OWLUSDCLPAddress, OWLAddress, 5e11);
    console.log(`OwlFarm address: ${owlFarm.address}`)

}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
