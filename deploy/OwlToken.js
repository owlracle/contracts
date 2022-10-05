const { ethers } = require("hardhat");

async function main() {
    const [ deployer ] = await ethers.getSigners();
    console.log(`Deploying contracts with ${ deployer.address }`);

    const totalOwl = ethers.utils.parseEther("1000000");
    const OwlToken = await ethers.getContractFactory("OwlToken");
    const owlToken = await OwlToken.deploy(totalOwl);
    console.log(`OwlToken address: ${ owlToken.address }`);
    // copy the contract address to env GOERLI_OWL_ADDRESS
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
