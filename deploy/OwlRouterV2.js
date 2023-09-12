const { ethers } = require("hardhat");

module.exports = async () => {
    const owlAddress = '0xBDa06080ea4961fC423396A704009873fE612B3f';
    const uniswapV2RouterAddress = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
    
    [ deployer ] = await ethers.getSigners();
    console.log(`Deploying contracts with ${ deployer.address }`);

    let eth = await deployer.getBalance();

    const OwlRouter = await ethers.getContractFactory('contracts/OwlRouterV2.sol:OwlRouter');
    const owlRouter = await OwlRouter.deploy(
        owlAddress,
        uniswapV2RouterAddress,
    );
    await owlRouter.deployed();

    console.log(`OwlRouter address: ${ owlRouter.address }`);

    let diff = eth.sub(await deployer.getBalance());
    console.log(`Deploy cost: ${ ethers.utils.formatEther(diff) } ETH`);

    return {
        deployer,
        owlRouter,
    }
}