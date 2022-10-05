const { ethers } = require("hardhat");
require('dotenv').config();

async function main() {
    const OWLToFund = 90600;

    const [ user ] = await ethers.getSigners();
    console.log(`I am ${ user.address }`);

    const farmAddress = process.env.GOERLI_FARM_ADDRESS;
    const owlAddress = process.env.GOERLI_OWL_ADDRESS;

    const owlFarm = await ethers.getContractAt("OwlFarm", farmAddress);
    const owlToken = await ethers.getContractAt("OwlToken", owlAddress);

    const toFund = ethers.utils.parseEther(OWLToFund.toString());
    await owlToken.connect(user).approve(owlFarm.address, toFund);
    await owlFarm.connect(user).addFunds(toFund);
    
    console.log('Added funds to contract:', ethers.utils.formatEther(toFund));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
