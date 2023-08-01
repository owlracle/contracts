const { ethers } = require("hardhat");

module.exports = async () => {

    // deploy token

    const [ deployer, user1 ] = await ethers.getSigners();
    console.log(`Deploying contracts with ${ deployer.address }`);

    let eth = await deployer.getBalance();

    const OwlToken = await ethers.getContractFactory("OwlToken");
    const owlToken = await OwlToken.deploy();
    await owlToken.deployed();

    console.log(`OwlToken address: ${ owlToken.address }`);

    let diff = eth.sub(await deployer.getBalance());
    console.log(`Deploy cost: ${ ethers.utils.formatEther(diff) } ETH`);
    
    return {
        deployer,
        user1,
        owlToken,
    }
}